"""
/dataclean GPC top-tier — rigorous dedupe pass.

Inputs (NEW scrapes — target):
  data/gpc-top-tier/sec-form-4/form-4-2026-04-20.jsonl
  data/gpc-top-tier/fec/fec-donors-2026-04-20.jsonl

Inputs (EXISTING pool — suppress/match against):
  data/enrichment-batches/gpf2-first-send-INSTANTLY-READY.csv
  data/enrichment-batches/batch-1-linkedin-scrape.csv
  data/enrichment-batches/source-linkedin-scrape-clean.csv
  data/enrichment-batches/gpf2-claude-evaluated.csv
  data/enrichment-batches/batch-7-irs-foundations.csv
  data/enrichment-batches/batch-3-amf-enriched.csv
  data/excluded-not-lps.csv                     (HARD suppress)

Pipeline (per /dataclean spec):
  1. Ingest all
  2. Normalize names (nameparser), companies (cleanco), domains (tldextract)
  3. Build blocking index on existing pool: (last_metaphone, first_initial) -> [candidates]
  4. For each new record, score against block candidates using weighted fuzzy:
       first_name JW, last_name JW, company token_set_ratio
  5. Route:
       >= 0.92 -> OUTBOUND_SAFE if existing has email, else still ENRICHMENT_READY
       0.75–0.92 -> REVIEW
       < 0.75 -> ENRICHMENT_READY (truly new)
       In excluded-not-lps.csv -> REJECT
  6. Emit clean outputs in data/gpc-top-tier/clean/

Zero paid API calls.
"""
from __future__ import annotations
import json
import sys
import re
import hashlib
from pathlib import Path
from datetime import datetime
import pandas as pd
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler
import jellyfish
from cleanco import basename
from nameparser import HumanName
import tldextract

REPO = Path(__file__).parent.parent
DATA = REPO / "data"
GPC_DIR = DATA / "gpc-top-tier"
ENRICH_DIR = DATA / "enrichment-batches"
OUT_DIR = GPC_DIR / "clean"
OUT_DIR.mkdir(parents=True, exist_ok=True)

EXISTING_FILES = [
    "gpf2-first-send-INSTANTLY-READY.csv",
    "batch-1-linkedin-scrape.csv",
    "source-linkedin-scrape-clean.csv",
    "gpf2-claude-evaluated.csv",
    "batch-7-irs-foundations.csv",
    "batch-3-amf-enriched.csv",
]

# Thresholds per /dataclean spec
AUTO_MERGE = 0.92
REVIEW_MIN = 0.75
DISTINCT_MAX = 0.75

# ─────────────────────────────────────────────────────────────
# Normalization
# ─────────────────────────────────────────────────────────────
STOPWORDS = {
    "the", "and", "group", "holdings", "holding", "international", "global",
    "services", "solutions", "technologies", "systems", "corp", "corporation",
    "co", "company", "capital", "partners", "management", "mgmt", "llc", "inc",
    "ltd", "limited", "lp", "llp", "pc", "pllc", "pa", "gmbh", "ag", "sa",
    "bv", "nv", "spa", "ab", "kk", "pty", "pvt",
}

_WS_RE = re.compile(r"\s+")
_PUNCT_RE = re.compile(r"[.,&/()\-'\"]+")

def norm_company(s: str) -> str:
    if not s:
        return ""
    s = basename(str(s))  # strips Inc/LLC/Corp/etc.
    s = s.lower()
    s = _PUNCT_RE.sub(" ", s)
    toks = [t for t in _WS_RE.split(s) if t and t not in STOPWORDS]
    return " ".join(toks)

def norm_name(s: str) -> str:
    if not s:
        return ""
    return re.sub(r"[^a-z]", "", str(s).lower())

def metaphone(s: str) -> str:
    if not s:
        return ""
    try:
        return jellyfish.metaphone(s)[:8]
    except Exception:
        return ""

def parse_name(raw: str) -> tuple[str, str]:
    """Return (first, last) from messy SEC reporter name field."""
    if not raw:
        return "", ""
    s = str(raw).strip()
    # SEC Form 4 reporter names often LAST FIRST MIDDLE (all caps)
    if s == s.upper() and "," not in s:
        parts = [p for p in s.split() if p]
        if len(parts) >= 2:
            return parts[1].capitalize(), parts[0].capitalize()
    # Comma format: "Last, First Middle"
    if "," in s:
        last, rest = s.split(",", 1)
        first_tok = rest.strip().split()
        return (first_tok[0] if first_tok else "").capitalize(), last.strip().capitalize()
    # Fallback via nameparser
    try:
        hn = HumanName(s)
        return hn.first, hn.last
    except Exception:
        parts = s.split()
        return (parts[0] if parts else ""), (parts[-1] if len(parts) > 1 else "")

def norm_email(e: str) -> str:
    if not e:
        return ""
    e = str(e).strip().lower()
    if "<" in e and ">" in e:
        m = re.search(r"<([^>]+)>", e)
        if m:
            e = m.group(1)
    if "@" not in e:
        return ""
    local, domain = e.rsplit("@", 1)
    local = local.split("+", 1)[0]
    if domain in ("gmail.com", "googlemail.com"):
        local = local.replace(".", "")
    return f"{local}@{domain}"

def registrable_domain(s: str) -> str:
    if not s:
        return ""
    s = str(s).strip().lower()
    if "@" in s:
        s = s.rsplit("@", 1)[1]
    ext = tldextract.extract(s)
    if ext.domain and ext.suffix:
        return f"{ext.domain}.{ext.suffix}"
    return ""

# ─────────────────────────────────────────────────────────────
# Loaders
# ─────────────────────────────────────────────────────────────
def load_existing() -> pd.DataFrame:
    frames = []
    for fn in EXISTING_FILES:
        p = ENRICH_DIR / fn
        if not p.exists():
            print(f"  (missing: {fn})")
            continue
        try:
            df = pd.read_csv(p, dtype=str, keep_default_na=False, encoding="utf-8")
        except UnicodeDecodeError:
            df = pd.read_csv(p, dtype=str, keep_default_na=False, encoding="cp1252")
        except Exception as ex:
            print(f"  failed {fn}: {ex}")
            continue
        df["_source_file"] = fn
        # Standardize column names we care about
        col_first = next((c for c in df.columns if c.lower() in ("first_name", "firstname", "first")), None)
        col_last = next((c for c in df.columns if c.lower() in ("last_name", "lastname", "last")), None)
        col_company = next((c for c in df.columns if c.lower() in ("company", "company_name", "companyname", "employer")), None)
        col_email = next((c for c in df.columns if c.lower() in ("email", "work_email", "personal_email")), None)
        if not col_first or not col_last:
            print(f"  skip {fn}: missing name columns")
            continue
        df = df.rename(columns={
            col_first: "first_name",
            col_last: "last_name",
            **({col_company: "company"} if col_company else {}),
            **({col_email: "email"} if col_email else {}),
        })
        for c in ("first_name", "last_name", "company", "email"):
            if c not in df.columns:
                df[c] = ""
        frames.append(df[["first_name", "last_name", "company", "email", "_source_file"]])
        print(f"  {fn}: {len(df):>6} rows")
    if not frames:
        return pd.DataFrame(columns=["first_name", "last_name", "company", "email", "_source_file"])
    return pd.concat(frames, ignore_index=True)

def load_excluded() -> set[str]:
    p = DATA / "excluded-not-lps.csv"
    if not p.exists():
        return set()
    try:
        df = pd.read_csv(p, dtype=str, keep_default_na=False)
    except Exception:
        return set()
    keys: set[str] = set()
    for _, r in df.iterrows():
        first = r.get("first_name") or r.get("firstName") or r.get("first") or ""
        last = r.get("last_name") or r.get("lastName") or r.get("last") or ""
        full = r.get("full_name") or r.get("fullName") or r.get("name") or ""
        if not (first and last) and full:
            hn = HumanName(str(full))
            first, last = hn.first, hn.last
        if first and last:
            keys.add(f"{norm_name(first)}|{norm_name(last)}")
    return keys

def load_sec() -> pd.DataFrame:
    files = sorted((GPC_DIR / "sec-form-4").glob("*.jsonl"))
    if not files:
        return pd.DataFrame()
    path = files[-1]
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        first, last = parse_name(r.get("reporterName", ""))
        if not first or not last:
            continue
        role = r.get("officerTitle") or (
            "Director" if r.get("isDirector") else (
                "10% Owner" if r.get("isTenPercentOwner") else "Insider"
            )
        )
        txns = r.get("transactions") or []
        best_txn = max(txns, key=lambda t: t.get("totalValueUsd", 0)) if txns else {}
        rows.append({
            "source": "sec-form-4",
            "first_name": first,
            "last_name": last,
            "company": r.get("issuerName", ""),
            "ticker": r.get("issuerTicker", ""),
            "title": role,
            "city": "",
            "state": "",
            "signal_dollar_value": r.get("maxTransactionUsd", 0) or 0,
            "signal_date": best_txn.get("transactionDate", r.get("filedAt", "")),
            "source_url": r.get("sourceUrl", ""),
        })
    df = pd.DataFrame(rows)
    # Dedupe: same person multiple filings -> keep highest-dollar transaction
    df = df.sort_values("signal_dollar_value", ascending=False)
    df["_key"] = df.apply(lambda r: f"{norm_name(r['first_name'])}|{norm_name(r['last_name'])}|{norm_company(r['company'])}", axis=1)
    df = df.drop_duplicates("_key", keep="first").drop(columns="_key").reset_index(drop=True)
    return df

def load_fec() -> pd.DataFrame:
    files = sorted((GPC_DIR / "fec").glob("*.jsonl"))
    if not files:
        return pd.DataFrame()
    path = files[-1]
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        rows.append({
            "source": "fec",
            "first_name": r.get("first_name", ""),
            "last_name": r.get("last_name", ""),
            "company": r.get("employer", ""),
            "ticker": "",
            "title": r.get("occupation", ""),
            "city": r.get("city", ""),
            "state": r.get("state", ""),
            "signal_dollar_value": r.get("total_contributions_usd", 0) or 0,
            "signal_date": r.get("last_contribution_date", ""),
            "source_url": (r.get("source_urls") or [""])[0] if r.get("source_urls") else "",
        })
    return pd.DataFrame(rows)

# ─────────────────────────────────────────────────────────────
# Blocking + fuzzy match
# ─────────────────────────────────────────────────────────────
def build_block_index(df: pd.DataFrame) -> dict[str, list[int]]:
    """Block key: (last_metaphone, first_initial). Returns key -> list of row indices."""
    idx: dict[str, list[int]] = {}
    for i, row in df.iterrows():
        mph = metaphone(row["last_name"])
        fi = (row["first_name"] or "?")[:1].upper()
        if not mph:
            continue
        key = f"{mph}|{fi}"
        idx.setdefault(key, []).append(i)
    return idx

def score_pair(new_row: dict, ex_row: pd.Series) -> float:
    """Weighted similarity on (first_name, last_name, company).
    Per /dataclean spec: Jaro-Winkler on names, token_set on company."""
    # Last name — heaviest weight (0.50 combined with blocking already)
    last_jw = JaroWinkler.similarity(
        (new_row["last_name"] or "").lower(),
        (ex_row.get("last_name") or "").lower(),
    )
    # First name (initial-rule: "J" vs "John" = 0.85)
    new_first = (new_row["first_name"] or "").lower()
    ex_first = (ex_row.get("first_name") or "").lower()
    if new_first and ex_first and (
        (len(new_first) == 1 and ex_first.startswith(new_first))
        or (len(ex_first) == 1 and new_first.startswith(ex_first))
    ):
        first_jw = 0.85
    else:
        first_jw = JaroWinkler.similarity(new_first, ex_first) if new_first and ex_first else 0.0
    # Company — use token_set_ratio, which handles "APOLLO MGMT" vs "APOLLO GLOBAL MANAGEMENT"
    new_co = norm_company(new_row["company"])
    ex_co = norm_company(ex_row.get("company") or "")
    if new_co and ex_co:
        co_sim = fuzz.token_set_ratio(new_co, ex_co) / 100.0
    else:
        co_sim = 0.0
    # Weighted blend — more weight on names since blocking already narrowed by metaphone
    confidence = (last_jw * 0.45) + (first_jw * 0.25) + (co_sim * 0.30)
    # Hard veto: if both have emails and they differ, not a match
    new_email = norm_email(new_row.get("email", ""))
    ex_email = norm_email(ex_row.get("email") or "")
    if new_email and ex_email and new_email != ex_email:
        # Different person on same name+company -> block
        if co_sim < 0.9:
            return 0.0
    return confidence

def classify_match(new_row: dict, existing_df: pd.DataFrame, block_idx: dict) -> tuple[str, float, int | None]:
    """Return (tier, confidence, matched_index). tier in EXACT|FUZZY|AMBIGUOUS|NO_MATCH"""
    mph = metaphone(new_row["last_name"])
    fi = (new_row["first_name"] or "?")[:1].upper()
    key = f"{mph}|{fi}"
    candidates = block_idx.get(key, [])
    if not candidates:
        return ("NO_MATCH", 0.0, None)
    best_score = 0.0
    best_idx = None
    for ci in candidates:
        ex = existing_df.iloc[ci]
        score = score_pair(new_row, ex)
        if score > best_score:
            best_score = score
            best_idx = ci
    if best_score >= AUTO_MERGE:
        return ("EXACT", best_score, best_idx)
    if best_score >= REVIEW_MIN:
        return ("AMBIGUOUS", best_score, best_idx)
    return ("NO_MATCH", best_score, best_idx)

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main():
    run_at = datetime.now().isoformat(timespec="seconds")
    print(f"[/dataclean] GPC top-tier rigorous dedupe — {run_at}")

    print("\n[1/5] Loading existing GPC pool...")
    existing = load_existing()
    print(f"  Total existing rows: {len(existing):,}")
    # Pre-normalize existing: compute metaphone + first_initial + normalized company
    existing = existing.assign(
        _last_mph=existing["last_name"].fillna("").astype(str).apply(metaphone),
        _first_init=existing["first_name"].fillna("").astype(str).str.upper().str[:1],
        _email_norm=existing["email"].fillna("").astype(str).apply(norm_email),
    )
    # De-dupe existing pool itself (cross-file dedupe)
    before = len(existing)
    existing = existing.drop_duplicates(
        subset=["first_name", "last_name", "company"], keep="first"
    ).reset_index(drop=True)
    print(f"  After internal cross-file dedupe: {len(existing):,} (removed {before - len(existing):,})")
    has_email_pool = (existing["_email_norm"].str.len() > 0).sum()
    print(f"  Existing with valid email: {has_email_pool:,}")

    print("\n[2/5] Loading suppressions...")
    excluded = load_excluded()
    print(f"  Excluded-not-lps keys: {len(excluded):,}")

    print("\n[3/5] Loading new scrapes...")
    sec = load_sec()
    fec = load_fec()
    print(f"  SEC unique people:  {len(sec):,}")
    print(f"  FEC donors:         {len(fec):,}")
    new = pd.concat([sec, fec], ignore_index=True)
    # Dedupe within new set (loose key: name only)
    new = new.sort_values("signal_dollar_value", ascending=False)
    new["_key"] = new.apply(
        lambda r: f"{norm_name(r['first_name'])}|{norm_name(r['last_name'])}|{norm_company(r['company'])}",
        axis=1,
    )
    new = new.drop_duplicates("_key", keep="first").drop(columns="_key").reset_index(drop=True)
    print(f"  After cross-source dedupe: {len(new):,}")

    print("\n[4/5] Building blocking index on existing pool...")
    block_idx = build_block_index(existing)
    print(f"  Blocks: {len(block_idx):,} unique (last_metaphone, first_initial) keys")

    print("\n[5/5] Classifying each new record...")
    outbound_safe_rows = []    # matched existing AND existing has email
    enrichment_ready_rows = [] # no match OR matched but no existing email
    review_rows = []            # ambiguous match
    rejected_rows = []          # in excluded-not-lps

    for i, row in new.iterrows():
        if (i + 1) % 2000 == 0:
            print(f"    {i+1:,}/{len(new):,} classified")
        rowd = row.to_dict()
        # Hard suppress — excluded-not-lps
        excl_key = f"{norm_name(rowd['first_name'])}|{norm_name(rowd['last_name'])}"
        if excl_key in excluded:
            rowd["reject_reason"] = "in_excluded_not_lps"
            rejected_rows.append(rowd)
            continue
        # .co domain suppression (not relevant here since no email yet, but for completeness)
        tier, conf, match_idx = classify_match(rowd, existing, block_idx)
        if tier == "EXACT" and match_idx is not None:
            ex = existing.iloc[match_idx]
            if ex["_email_norm"]:
                rowd["matched_existing_email"] = ex["_email_norm"]
                rowd["matched_source_file"] = ex["_source_file"]
                rowd["match_confidence"] = round(conf, 3)
                outbound_safe_rows.append(rowd)
            else:
                rowd["match_confidence"] = round(conf, 3)
                rowd["matched_source_file"] = ex["_source_file"]
                enrichment_ready_rows.append(rowd)
        elif tier == "AMBIGUOUS" and match_idx is not None:
            ex = existing.iloc[match_idx]
            rowd["match_confidence"] = round(conf, 3)
            rowd["possible_match_first"] = ex.get("first_name", "")
            rowd["possible_match_last"] = ex.get("last_name", "")
            rowd["possible_match_company"] = ex.get("company", "")
            rowd["possible_match_email"] = ex.get("_email_norm", "") or ""
            rowd["matched_source_file"] = ex["_source_file"]
            review_rows.append(rowd)
        else:
            enrichment_ready_rows.append(rowd)

    print("\nResults:")
    print(f"  OUTBOUND_SAFE (matched + existing email):  {len(outbound_safe_rows):,}")
    print(f"  ENRICHMENT_READY (truly new OR no email):  {len(enrichment_ready_rows):,}")
    print(f"  REVIEW (fuzzy 0.75-0.92):                   {len(review_rows):,}")
    print(f"  REJECTED (in excluded-not-lps):             {len(rejected_rows):,}")

    # Write outputs
    def write_csv(rows, name):
        path = OUT_DIR / name
        if not rows:
            pd.DataFrame().to_csv(path, index=False)
            return path
        df = pd.DataFrame(rows)
        df.to_csv(path, index=False)
        return path

    p1 = write_csv(outbound_safe_rows, "outbound_safe.csv")
    p2 = write_csv(enrichment_ready_rows, "enrichment_ready.csv")
    p3 = write_csv(review_rows, "review_queue.csv")
    p4 = write_csv(rejected_rows, "rejected.csv")

    # Manifest
    manifest = {
        "run_at": run_at,
        "existing_pool_rows": int(len(existing)),
        "existing_with_email": int(has_email_pool),
        "new_scrapes": {"sec_form_4": int(len(sec)), "fec_donors": int(len(fec))},
        "new_after_cross_source_dedupe": int(len(new)),
        "outbound_safe": len(outbound_safe_rows),
        "enrichment_ready": len(enrichment_ready_rows),
        "review_queue": len(review_rows),
        "rejected": len(rejected_rows),
        "thresholds": {"auto_merge": AUTO_MERGE, "review_min": REVIEW_MIN},
        "outputs": {
            "outbound_safe": str(p1),
            "enrichment_ready": str(p2),
            "review_queue": str(p3),
            "rejected": str(p4),
        },
        "cost_delta_vs_naive": {
            "naive_enrichment_ready": 15960,
            "rigorous_enrichment_ready": len(enrichment_ready_rows),
            "moved_to_outbound_safe": len(outbound_safe_rows),
            "moved_to_review": len(review_rows),
            "estimated_savings_usd": round((15960 - len(enrichment_ready_rows)) * 0.049 * 0.55, 2),
        },
    }
    (OUT_DIR / "run_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Audit report
    top_new_employers = (
        pd.DataFrame(enrichment_ready_rows)["company"].value_counts().head(20).to_dict()
        if enrichment_ready_rows else {}
    )
    audit_md = f"""# /dataclean GPC top-tier dedupe report

Run: {run_at}

## Pipeline

New scrapes -> normalize -> metaphone-block against existing pool -> fuzzy-score -> route.

## Rows

| Stage | Count |
|---|---|
| Existing pool (deduped across 6 files) | {len(existing):,} |
| Existing with valid email | {has_email_pool:,} |
| SEC Form 4 unique people | {len(sec):,} |
| FEC donors | {len(fec):,} |
| New after cross-source dedupe | {len(new):,} |
| OUTBOUND_SAFE (matched + email) | {len(outbound_safe_rows):,} |
| ENRICHMENT_READY (needs email) | {len(enrichment_ready_rows):,} |
| REVIEW (fuzzy ambiguous) | {len(review_rows):,} |
| REJECTED (excluded-not-lps) | {len(rejected_rows):,} |

## Cost delta vs naive dedupe

Naive (exact-match only) ENRICHMENT_READY: 15,960
Rigorous (fuzzy-match + metaphone blocking): {len(enrichment_ready_rows):,}
Moved to OUTBOUND_SAFE (already enriched): {len(outbound_safe_rows):,}
Moved to REVIEW (human check): {len(review_rows):,}

**Estimated AMF savings:** ~${manifest['cost_delta_vs_naive']['estimated_savings_usd']:,.2f}
(based on AMF $0.049/valid × ~55% hit rate on records we no longer need to enrich)

## Top 20 employers in ENRICHMENT_READY

{chr(10).join(f"  {emp}: {cnt}" for emp, cnt in top_new_employers.items())}
"""
    (OUT_DIR / "audit_report.md").write_text(audit_md, encoding="utf-8")

    print(f"\nOutputs: {OUT_DIR}/")
    print(f"  outbound_safe.csv     -> ship directly to Instantly")
    print(f"  enrichment_ready.csv  -> AMF+FM waterfall")
    print(f"  review_queue.csv      -> human review")
    print(f"  rejected.csv          -> excluded")
    print(f"  run_manifest.json")
    print(f"  audit_report.md")

if __name__ == "__main__":
    main()
