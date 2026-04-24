"""
Enrich GPC prioritized list via AMF -> Findymail waterfall (optional MV verify).

Hard-stops at --budget USD (default $100, safety cushion $95).
Writes incrementally so crashes don't lose data.

Usage:
  python3 scripts/enrich-gpc-prioritized.py --budget=100
  python3 scripts/enrich-gpc-prioritized.py --budget=100 --test=5  # test run, 5 records max
"""
from __future__ import annotations
import os
import sys
import time
import argparse
import csv
import json
from pathlib import Path
from datetime import datetime
from dotenv import load_dotenv
import pandas as pd
import requests

REPO = Path(__file__).parent.parent
load_dotenv(REPO / ".env")

CLEAN = REPO / "data" / "gpc-top-tier" / "clean"

AMF_KEY = os.environ.get("ANYMAILFINDER_API_KEY", "")
FM_KEY = os.environ.get("FINDYMAIL_API_KEY", "")
MV_KEY = os.environ.get("MILLIONVERIFIER_API_KEY", "")

AMF_URL = "https://api.anymailfinder.com/v5.1/find-email/person"
FM_URL = "https://app.findymail.com/api/search/name"
MV_URL = "https://api.millionverifier.com/api/v3/"

AMF_COST_PER_VALID = 0.049
FM_COST_PER_VALID = 0.04
MV_COST_PER_VERIFY = 0.0008

def now() -> str:
    return datetime.now().isoformat(timespec="seconds")

# ─────────────────────────────────────────────────────────────
# Vendor calls
# ─────────────────────────────────────────────────────────────
def call_amf(first: str, last: str, company: str, domain: str = "") -> dict:
    """Returns {status, email, valid_email, cost_usd}. Free on miss."""
    if not AMF_KEY:
        return {"status": "error", "error": "AMF key not set"}
    headers = {"Authorization": AMF_KEY, "Content-Type": "application/json"}
    payload = {"first_name": first, "last_name": last}
    if domain:
        payload["domain"] = domain
    elif company:
        payload["company_name"] = company
    try:
        r = requests.post(AMF_URL, headers=headers, json=payload, timeout=180)
    except requests.RequestException as ex:
        return {"status": "error", "error": str(ex), "cost_usd": 0.0}
    if r.status_code == 404:
        return {"status": "not_found", "cost_usd": 0.0}
    if r.status_code == 401:
        return {"status": "auth_error", "cost_usd": 0.0}
    if r.status_code == 402:
        return {"status": "out_of_credits", "cost_usd": 0.0}
    if r.status_code != 200:
        return {"status": f"http_{r.status_code}", "error": r.text[:200], "cost_usd": 0.0}
    try:
        data = r.json()
    except Exception:
        return {"status": "bad_json", "cost_usd": 0.0}
    email_status = data.get("email_status") or data.get("status") or ""
    email = data.get("email") or data.get("valid_email") or ""
    if email_status == "valid" and email:
        return {"status": "valid", "email": email, "cost_usd": AMF_COST_PER_VALID}
    if email_status == "risky":
        return {"status": "risky", "email": email, "cost_usd": 0.0}
    return {"status": email_status or "not_found", "email": email, "cost_usd": 0.0}

def call_findymail(first: str, last: str, company: str, domain: str = "") -> dict:
    """Findymail: name + domain or company. Pays on hit only."""
    if not FM_KEY:
        return {"status": "error", "error": "FM key not set"}
    headers = {"Authorization": f"Bearer {FM_KEY}", "Content-Type": "application/json"}
    payload = {"name": f"{first} {last}".strip()}
    if domain:
        payload["domain"] = domain
    elif company:
        payload["domain"] = company  # Findymail accepts company string in domain field too
    try:
        r = requests.post(FM_URL, headers=headers, json=payload, timeout=60)
    except requests.RequestException as ex:
        return {"status": "error", "error": str(ex), "cost_usd": 0.0}
    if r.status_code in (402, 429):
        return {"status": "rate_or_quota", "cost_usd": 0.0}
    if r.status_code != 200:
        return {"status": f"http_{r.status_code}", "error": r.text[:200], "cost_usd": 0.0}
    try:
        data = r.json()
    except Exception:
        return {"status": "bad_json", "cost_usd": 0.0}
    contact = data.get("contact") or {}
    email = contact.get("email") or data.get("email") or ""
    if email:
        return {"status": "valid", "email": email, "cost_usd": FM_COST_PER_VALID}
    return {"status": "not_found", "cost_usd": 0.0}

# ─────────────────────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=100.0)
    ap.add_argument("--input", default=str(CLEAN / "prioritized_budget_100.csv"))
    ap.add_argument("--output", default=str(CLEAN / "enriched_budget_100.csv"))
    ap.add_argument("--test", type=int, default=0, help="Process only first N records")
    ap.add_argument("--no-findymail", action="store_true", help="Skip Findymail rescue")
    args = ap.parse_args()

    safety_cap = args.budget * 0.97  # stop at 97% of budget

    print(f"[{now()}] GPC enrichment runner")
    print(f"  Budget:          ${args.budget:.2f}")
    print(f"  Safety cap:      ${safety_cap:.2f}")
    print(f"  AMF key:         {'set' if AMF_KEY else 'MISSING'}")
    print(f"  Findymail key:   {'set' if FM_KEY else 'MISSING'}")
    print(f"  Findymail:       {'disabled' if args.no_findymail else 'enabled'}")

    if not AMF_KEY:
        print("FATAL: ANYMAILFINDER_API_KEY not set in .env")
        sys.exit(1)

    df = pd.read_csv(args.input, dtype=str, keep_default_na=False)
    if args.test:
        df = df.head(args.test)
    print(f"  Records queued:  {len(df):,}")

    out_path = Path(args.output)
    log_path = out_path.with_suffix(".log.jsonl")

    # Resume support: if output exists, skip already-processed records
    already_processed = set()
    if out_path.exists():
        try:
            done_df = pd.read_csv(out_path, dtype=str, keep_default_na=False)
            for _, r in done_df.iterrows():
                already_processed.add(f"{(r.get('first_name') or '').lower()}|{(r.get('last_name') or '').lower()}|{(r.get('company') or '').lower()}")
            print(f"  Already processed (resume): {len(already_processed):,}")
        except Exception:
            pass

    total_cost = 0.0
    valid = 0
    amf_hits = 0
    fm_hits = 0
    amf_misses = 0
    errors = 0

    # Open outputs in append mode if resuming
    write_header = not out_path.exists()
    out_f = open(out_path, "a", newline="", encoding="utf-8")
    log_f = open(log_path, "a", encoding="utf-8")
    writer = csv.DictWriter(out_f, fieldnames=[
        "first_name", "last_name", "company", "title", "source",
        "priority_score", "priority_reasons",
        "email", "email_source", "email_status", "record_cost_usd",
        "enriched_at",
    ])
    if write_header:
        writer.writeheader()
        out_f.flush()

    try:
        for i, row in df.iterrows():
            if total_cost >= safety_cap:
                print(f"\n  Safety cap reached (${total_cost:.2f}). Halting.")
                break

            first = (row.get("first_name") or "").strip()
            last = (row.get("last_name") or "").strip()
            company = (row.get("company") or "").strip()
            if not first or not last or not company:
                continue

            dedup_key = f"{first.lower()}|{last.lower()}|{company.lower()}"
            if dedup_key in already_processed:
                continue

            # Skip garbage SEC names like "Llc Clarkston Ventures" (corporate reporter)
            if any(tok in first.lower() for tok in ("llc", "l.p.", "inc", "corp", "holdings", "partners", "ventures", "fund")):
                log_f.write(json.dumps({"skip": "corporate_reporter", "first": first, "last": last}) + "\n")
                continue

            # AMF primary
            amf_result = call_amf(first, last, company)
            cost_step = amf_result.get("cost_usd", 0.0)
            total_cost += cost_step

            email = amf_result.get("email", "")
            source = "amf" if amf_result["status"] == "valid" else ""
            status = amf_result["status"]

            if amf_result["status"] == "valid":
                amf_hits += 1
                valid += 1
            else:
                amf_misses += 1
                # Findymail rescue if budget allows and enabled
                if not args.no_findymail and total_cost + FM_COST_PER_VALID < safety_cap:
                    fm_result = call_findymail(first, last, company)
                    cost_step += fm_result.get("cost_usd", 0.0)
                    total_cost += fm_result.get("cost_usd", 0.0)
                    if fm_result["status"] == "valid":
                        email = fm_result["email"]
                        source = "findymail"
                        status = "valid"
                        fm_hits += 1
                        valid += 1

            if amf_result["status"] in ("auth_error", "out_of_credits"):
                errors += 1
                print(f"\n  VENDOR ERROR: {amf_result['status']} — halting.")
                break

            record = {
                "first_name": first,
                "last_name": last,
                "company": company,
                "title": row.get("title", ""),
                "source": row.get("source", ""),
                "priority_score": row.get("priority_score", ""),
                "priority_reasons": row.get("priority_reasons", ""),
                "email": email,
                "email_source": source,
                "email_status": status,
                "record_cost_usd": round(cost_step, 4),
                "enriched_at": now(),
            }
            writer.writerow(record)
            out_f.flush()
            log_f.write(json.dumps({**record, "total_cost": round(total_cost, 4)}) + "\n")
            log_f.flush()

            # Live progress every 25 records
            if (i + 1) % 25 == 0 or i == 0:
                print(f"  [{i+1:>5}/{len(df)}] cost=${total_cost:>6.2f} valid={valid} amf={amf_hits} fm={fm_hits} miss={amf_misses}")

    finally:
        out_f.close()
        log_f.close()

    print(f"\n[{now()}] Done.")
    print(f"  Total cost:      ${total_cost:.2f}")
    print(f"  Valid emails:    {valid}")
    print(f"  AMF hits:        {amf_hits}")
    print(f"  Findymail hits:  {fm_hits}")
    print(f"  Misses:          {amf_misses - fm_hits}")
    print(f"  Errors:          {errors}")
    print(f"  Output:          {out_path}")

if __name__ == "__main__":
    main()
