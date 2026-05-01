#!/usr/bin/env python
"""Hero X full-launch orchestrator.

Runs end-to-end automation against everything that has an API path today:
  Stage 1 -- Create Hero X GHL sub-account (POST /companies/{id}/locations)
  Stage 2 -- Append GHL_HEROX_LOCATION_ID + agency-key fallback to .env
  Stage 3 -- Provision prereqs in new sub-account
            (custom fields, tags, pipeline, custom values)
  Stage 4 -- Cloudflare DNS for mail.heroxbio.com
            (SPF + DMARC; DKIM deferred until Colby pulls from GHL UI)
  Stage 5 -- Provision 4 WC coupons via WP-CLI on prod
            (HEROX5, BAC50OFF, REORDER10, STACK15)

What this script does NOT do (genuinely UI-only or external-blocker):
  - Generate Private Integration Token (UI-only -- uses agency key as auth)
  - Add the GHL sending domain (UI requires DKIM record exchange)
  - Author the 8 workflows  (separate script: herox-launch-workflows.py
    uses the mcp__ghl tool -- must run from Claude session)
  - Build FunnelKit FK1/FK2/FK3 funnels (Playwright on WP admin, deferred)
  - Apply for processor stack (Easy Pay Direct, Coinbase) -- external

Usage:
  python scripts/herox-launch-orchestrator.py --dry-run     # preview
  python scripts/herox-launch-orchestrator.py --apply       # execute
  python scripts/herox-launch-orchestrator.py --apply --skip-stages 4,5
"""
import argparse
import json
import os
import sys
import time

import requests

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", ".env")
GHL_BASE = "https://services.leadconnectorhq.com"
GHL_VERSION = "2021-07-28"


# ---------- env helpers ----------

def load_env():
    env = {}
    if not os.path.isfile(ENV_PATH):
        sys.exit(f"[fatal] .env not found at {ENV_PATH}")
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def append_env(kvs: dict, label: str = ""):
    """Append non-existing keys to .env (idempotent)."""
    existing = load_env()
    new_lines = []
    for k, v in kvs.items():
        if k in existing:
            continue
        new_lines.append(f"{k}={v}")
    if not new_lines:
        return
    with open(ENV_PATH, "a") as f:
        f.write(f"\n# Hero X launch orchestrator{(' -- '+label) if label else ''} {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        for line in new_lines:
            f.write(line + "\n")
    print(f"  + appended {len(new_lines)} key(s) to .env")


def headers_v2(token):
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Version": GHL_VERSION,
    }


# ---------- Stage 1: GHL location creation ----------

LOCATION_PAYLOAD = {
    "name": "Hero X Bio Peptides",
    # NOTE: address fields are required by GHL — using BMN's existing
    # registered Florida address since Supplements International LLC is a
    # BMN sub-entity. Colby can update via UI if Hero X needs a separate
    # registered agent address for CAN-SPAM compliance.
    "address": "1126 S Federal Hwy",
    "city": "Ft Lauderdale",
    "state": "FL",
    "country": "US",
    "postalCode": "33316",
    "website": "https://heroxbio.com",
    "timezone": "America/Los_Angeles",
    "email": "ops@heroxbio.com",
}


def stage_1_create_location(env, dry):
    company_id = env["GHL_COMPANY_ID"]
    agency_key = env["GHL_AGENCY_API_KEY"]
    print(f"\n[Stage 1] Create Hero X GHL sub-account")
    print(f"  POST {GHL_BASE}/locations/")
    print(f"  name=\"Hero X Bio Peptides\"  companyId={company_id}")
    if dry:
        print("  [dry-run] skipping POST")
        return None
    body = {**LOCATION_PAYLOAD, "companyId": company_id}
    r = requests.post(f"{GHL_BASE}/locations/",
                      headers=headers_v2(agency_key), json=body, timeout=60)
    if r.status_code not in (200, 201):
        print(f"  [FAIL] status={r.status_code} body={r.text[:500]}")
        return None
    data = r.json()
    loc_id = data.get("id") or data.get("location", {}).get("id") or data.get("locationId")
    print(f"  [ok] created locationId={loc_id}")
    return loc_id


# ---------- Stage 3: prereqs (custom fields/tags/pipeline/custom values) ----------

CUSTOM_FIELDS = [
    {"name": "Hero X Customer", "fieldKey": "hero_x_customer", "dataType": "CHECKBOX"},
    {"name": "Last Order Date", "fieldKey": "last_order_date", "dataType": "DATE"},
    {"name": "Last Order Value", "fieldKey": "last_order_value", "dataType": "MONETORY"},
    {"name": "Lifetime Value", "fieldKey": "ltv", "dataType": "MONETORY"},
    {"name": "Last SKU Purchased", "fieldKey": "last_sku_purchased", "dataType": "TEXT"},
    {"name": "Restock SKU", "fieldKey": "restock_sku", "dataType": "TEXT"},
    {"name": "Subscription Renews At", "fieldKey": "subscription_renews_at", "dataType": "DATE"},
    {"name": "Subscription Status", "fieldKey": "subscription_status", "dataType": "TEXT"},
    {"name": "Reorder Cookie Sent", "fieldKey": "reorder_cookie_sent", "dataType": "CHECKBOX"},
    {"name": "Order Count", "fieldKey": "order_count", "dataType": "NUMERICAL"},
    {"name": "First Order Date", "fieldKey": "first_order_date", "dataType": "DATE"},
    {"name": "BMN Cross-Brand Contact ID", "fieldKey": "bmn_contact_id", "dataType": "TEXT"},
    {"name": "Compliance Geo State", "fieldKey": "geo_state", "dataType": "TEXT"},
]
TAGS = [
    "hero-x-customer", "hero-x-subscriber", "hero-x-vip-500plus", "hero-x-vip-1500plus",
    "hero-x-cart-abandoned", "hero-x-restock-waitlist", "hero-x-lapsed-90d",
    "hero-x-lapsed-180d", "hero-x-suppressed-marketing", "hero-x-research-protocols",
    "also-bmn-customer",
]
PIPELINE_NAME = "Hero X Bio Peptides -- Customer Lifecycle"
PIPELINE_STAGES = ["New Customer", "Active Subscriber", "At-Risk (90d)",
                   "Lapsed (180d)", "Won-Back", "Churned"]
CUSTOM_VALUES = [
    ("business_address", "Supplements International LLC, [SET REGISTERED AGENT ADDRESS], [STATE] [ZIP]"),
    ("coa_archive_url", "https://heroxbio.com/lab/coa/"),
    ("lab_protocols_url", "https://heroxbio.com/lab-protocols/"),
    ("lab_reference_url", "https://heroxbio.com/lab/reference/"),
    ("from_name", "Hero X Bio Peptides"),
    ("reply_to", "ops@heroxbio.com"),
    ("support_email", "ops@heroxbio.com"),
    ("plasma_cyan", "#2DD4BF"),
    ("ruo_disclaimer", "For laboratory research use only. Not for human or veterinary use."),
]


def stage_3_provision(loc_id, token, dry):
    print(f"\n[Stage 3] Provision prereqs in {loc_id}")
    if dry:
        print("  [dry-run] would create:")
        print(f"    - {len(CUSTOM_FIELDS)} custom fields")
        print(f"    - {len(TAGS)} tags")
        print(f"    - 1 pipeline ({PIPELINE_NAME}) with {len(PIPELINE_STAGES)} stages")
        print(f"    - {len(CUSTOM_VALUES)} custom values")
        return
    sleep = 0.25
    # custom fields
    for f in CUSTOM_FIELDS:
        body = {**f, "locationId": loc_id, "model": "contact"}
        r = requests.post(f"{GHL_BASE}/locations/{loc_id}/customFields",
                          headers=headers_v2(token), json=body, timeout=30)
        ok = 200 <= r.status_code < 300
        print(f"  {'+' if ok else '!'} field {f['fieldKey']}: {r.status_code}")
        if not ok: print(f"      err: {r.text[:200]}")
        time.sleep(sleep)
    # tags
    for t in TAGS:
        r = requests.post(f"{GHL_BASE}/locations/{loc_id}/tags",
                          headers=headers_v2(token), json={"name": t}, timeout=30)
        ok = 200 <= r.status_code < 300
        print(f"  {'+' if ok else '!'} tag {t}: {r.status_code}")
        time.sleep(sleep)
    # pipeline
    body = {"name": PIPELINE_NAME, "locationId": loc_id,
            "stages": [{"name": s, "position": i + 1} for i, s in enumerate(PIPELINE_STAGES)]}
    r = requests.post(f"{GHL_BASE}/opportunities/pipelines",
                      headers=headers_v2(token), json=body, timeout=30)
    ok = 200 <= r.status_code < 300
    print(f"  {'+' if ok else '!'} pipeline: {r.status_code}")
    if not ok: print(f"      err: {r.text[:200]}")
    # custom values
    for n, v in CUSTOM_VALUES:
        r = requests.post(f"{GHL_BASE}/locations/{loc_id}/customValues",
                          headers=headers_v2(token), json={"name": n, "value": v, "locationId": loc_id}, timeout=30)
        ok = 200 <= r.status_code < 300
        print(f"  {'+' if ok else '!'} cv {n}: {r.status_code}")
        time.sleep(sleep)


# ---------- Stage 4: Cloudflare DNS ----------

def cf_get(token, path):
    r = requests.get(f"https://api.cloudflare.com/client/v4{path}",
                     headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                     timeout=30)
    return r.status_code, r.json() if r.text else {}


def cf_post(token, path, body):
    r = requests.post(f"https://api.cloudflare.com/client/v4{path}",
                      headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                      json=body, timeout=30)
    return r.status_code, r.json() if r.text else {}


def stage_4_dns(env, dry):
    print(f"\n[Stage 4] Cloudflare DNS for mail.heroxbio.com")
    cf_token = env.get("CLOUDFLARE_API_TOKEN")
    if not cf_token:
        print("  [skip] CLOUDFLARE_API_TOKEN not set")
        return
    # Find heroxbio.com zone
    code, zones = cf_get(cf_token, "/zones?name=heroxbio.com")
    if code != 200 or not zones.get("success") or not zones.get("result"):
        print(f"  [FAIL] zone lookup status={code}")
        if code == 200: print(f"      {json.dumps(zones, indent=2)[:400]}")
        return
    zone_id = zones["result"][0]["id"]
    print(f"  [ok] zone heroxbio.com -> {zone_id[:8]}...")
    # SPF (TXT on mail.heroxbio.com)
    spf = {"type": "TXT", "name": "mail", "content": "v=spf1 include:mailgun.org ~all", "ttl": 1}
    # DMARC (TXT on _dmarc.mail.heroxbio.com)
    dmarc = {"type": "TXT", "name": "_dmarc.mail",
             "content": "v=DMARC1; p=quarantine; rua=mailto:dmarc@heroxbio.com; pct=100", "ttl": 1}
    records = [("SPF", spf), ("DMARC", dmarc)]
    if dry:
        for label, rec in records:
            print(f"  [dry-run] would create {label}: {rec['type']} {rec['name']} = {rec['content'][:60]}...")
        return
    for label, rec in records:
        # Check if already exists
        code, existing = cf_get(cf_token, f"/zones/{zone_id}/dns_records?type={rec['type']}&name={rec['name']}.heroxbio.com")
        if code == 200 and existing.get("result"):
            same = any(r["content"] == rec["content"] for r in existing["result"])
            if same:
                print(f"  = {label} record exists, skip")
                continue
        code, body = cf_post(cf_token, f"/zones/{zone_id}/dns_records", rec)
        ok = code in (200, 201) and body.get("success")
        print(f"  {'+' if ok else '!'} {label}: status={code} {'' if ok else json.dumps(body)[:200]}")
    print("  [note] DKIM record is GHL-generated. Add it after sending domain is provisioned in GHL UI.")


# ---------- Stage 5: WC coupons via WP-CLI over SSH ----------

def stage_5_coupons(dry):
    print("\n[Stage 5] WC coupons via WP-CLI over SSH")
    coupons = [
        # (code, type, amount, usage_per_user, min_spend, expires_in_days)
        ("HEROX5", "fixed_cart", "5", 1, "50", 7),
        ("BAC50OFF", "percent", "50", 1, "0", 1),  # 50% off, single use, very short window -- used in FK3 upsell
        ("REORDER10", "percent", "10", 1, "50", 90),
        ("STACK15", "percent", "15", 0, "0", 0),  # Bundle pricing already applies; this is for manual override
    ]
    if dry:
        print(f"  [dry-run] would create {len(coupons)} coupons via wp wc shop_coupon create")
        for c in coupons:
            print(f"    + {c[0]}  type={c[1]}  amount={c[2]}  per_user_limit={c[3]}  min_spend={c[4]}  expires_in_days={c[5]}")
        return

    # Use the existing paramiko-based pattern from the heroxlabs-com deploy scripts
    import paramiko
    env_local_path = os.path.expanduser("~/Repos/heroxlabs-com/deploy/.env.local")
    env_local = {}
    with open(env_local_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k, _, v = line.partition("=")
            env_local[k.strip()] = v.strip().strip('"').strip("'")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(hostname=env_local["HEROX_DROPLET_IP"], username=env_local["HEROX_SYS_USER"],
                password=env_local["HEROX_SYS_PASS"], timeout=30)
    pub = "applications/krgndbznnu/public_html"
    for code, type_, amount, per_user, min_spend, expires in coupons:
        # Idempotent: only create if not exists
        check_cmd = f"cd {pub} && wp wc shop_coupon list --code={code} --user=2 --field=id 2>/dev/null"
        _, out, _ = ssh.exec_command(check_cmd, timeout=30)
        existing = out.read().decode().strip()
        if existing:
            print(f"  = {code} exists (id={existing}), skip")
            continue
        from datetime import datetime, timedelta
        date_expires = ""
        if expires > 0:
            d = (datetime.utcnow() + timedelta(days=expires)).strftime("%Y-%m-%dT00:00:00")
            date_expires = f" --date_expires=\"{d}\""
        per_user_arg = f" --usage_limit_per_user={per_user}" if per_user > 0 else ""
        min_spend_arg = f" --minimum_amount={min_spend}" if min_spend != "0" else ""
        # Use admin user 2 (herox-ops-1982617875) which has manage_woocommerce.
        cmd = (f'cd {pub} && wp wc shop_coupon create --user=2 '
               f'--code={code} --discount_type={type_} --amount={amount}'
               f'{per_user_arg}{min_spend_arg}{date_expires} 2>&1 | head -3')
        _, out, _ = ssh.exec_command(cmd, timeout=60)
        out_s = out.read().decode().strip()
        ok = "Success" in out_s or "Created" in out_s or out_s.isdigit()
        print(f"  {'+' if ok else '!'} {code}: {out_s[:140]}")
        time.sleep(0.5)
    ssh.close()


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--skip-stages", default="", help="Comma-separated stage numbers to skip, e.g. 4,5")
    ap.add_argument("--only-stages", default="", help="Comma-separated stage numbers to run, e.g. 5")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("Pass --dry-run or --apply.")

    env = load_env()
    skip = {int(s) for s in args.skip_stages.split(",") if s.strip()}
    only = {int(s) for s in args.only_stages.split(",") if s.strip()}

    def should_run(n):
        if only:
            return n in only
        return n not in skip

    print(f"[mode] {'APPLY' if args.apply else 'DRY-RUN'}")
    if skip: print(f"[skip-stages] {sorted(skip)}")
    if only: print(f"[only-stages] {sorted(only)}")

    loc_id = env.get("GHL_HEROX_LOCATION_ID")

    # Stage 1
    if should_run(1) and not loc_id:
        new_loc = stage_1_create_location(env, args.dry_run)
        if new_loc and args.apply:
            append_env({"GHL_HEROX_LOCATION_ID": new_loc}, label="stage 1")
            loc_id = new_loc
            env = load_env()
    elif loc_id:
        print(f"\n[Stage 1] Skip -- GHL_HEROX_LOCATION_ID already set to {loc_id[:8]}...")

    # Stage 3 -- needs loc_id
    if should_run(3):
        if loc_id:
            # Use agency key as fallback if no PIT yet
            token = env.get("GHL_HEROX_LOCATION_API_KEY") or env["GHL_AGENCY_API_KEY"]
            stage_3_provision(loc_id, token, args.dry_run)
        else:
            print("\n[Stage 3] Skip -- no loc_id available")

    # Stage 4 -- Cloudflare DNS
    if should_run(4):
        stage_4_dns(env, args.dry_run)

    # Stage 5 -- Coupons
    if should_run(5):
        stage_5_coupons(args.dry_run)

    print("\n[done]")


if __name__ == "__main__":
    main()
