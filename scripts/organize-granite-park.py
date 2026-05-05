"""
Organize all Granite Park Capital prospect data into a single canonical home:
  data/granite-park/
    master.csv                          (the master — all unique people)
    master.parquet
    queues/send-ready.csv               (valid email, not in Instantly)
    queues/enrichment-pending.csv       (no email, score >= 75)
    queues/review.csv                   (ambiguous / risky)
    signals/sec-form-4-latest.csv
    signals/fec-donors-latest.csv
    exclusions/not-lps.csv
    exclusions/enriched-no-email.csv
    history/ (prior masters preserved)
    README.md
    manifest.json

Pipeline:
  1. Load base master from data/unified-cleaned/master_cleaned.csv
  2. Load this session's new scrapes + enrichment output (budget_100)
  3. Load manual exclusions (data/excluded-not-lps.csv)
  4. Metaphone-blocked fuzzy merge -> unified master
  5. Attach signals[] per person (SEC Form 4 liquidity event, FEC political donation)
  6. Route each record to appropriate queue
  7. Copy old masters into history/
  8. Write README + manifest

Safe: does NOT delete any source files. Only writes new files in data/granite-park/.
"""
from __future__ import annotations
import json
import re
import shutil
from pathlib import Path
from datetime import datetime
import pandas as pd
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler
import jellyfish
from cleanco import basename
from nameparser import HumanName

REPO = Path(__file__).parent.parent
DATA = REPO / "data"
OUT = DATA / "granite-park"

# Inputs
BASE_MASTER = DATA / "unified-cleaned" / "master_cleaned.csv"
OLD_MASTER = DATA / "master-cleaned" / "master_cleaned.csv"
ENRICHMENT_DIR = DATA / "enrichment-batches"
GPC_TOPTIER = DATA / "gpc-top-tier"
ENRICHED = GPC_TOPTIER / "clean" / "enriched_budget_100.csv"
EXCLUDED_LPS = DATA / "excluded-not-lps.csv"
SEC_JSONL_DIR = GPC_TOPTIER / "sec-form-4"
FEC_JSONL_DIR = GPC_TOPTIER / "fec"

# Lead CSVs to fold in (in addition to BASE_MASTER)
SECONDARY_LEAD_CSVS = [
    "gpf2-first-send-INSTANTLY-READY.csv",
    "batch-1-linkedin-scrape.csv",
    "source-linkedin-scrape-clean.csv",
    "gpf2-claude-evaluated.csv",
    "batch-7-irs-foundations.csv",
    "batch-3-amf-enriched.csv",
]

# ─────────────────────────────────────────────────────────────
# Normalization utilities
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
_ROLE_LOCAL_RE = re.compile(
    r"^(info|contact|admin|sales|support|hello|hi|help|billing|accounts?|"
    r"office|service|marketing|media|press|team|inquiry|enquiries|"
    r"hr|careers|jobs|legal|compliance|noreply|no-reply|donotreply)@",
    re.I,
)
FREEMAIL_DOMAINS = {
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "live.com", "aol.com", "icloud.com", "me.com", "mac.com", "protonmail.com",
    "proton.me", "msn.com", "yandex.com", "zoho.com", "mail.com",
}

def norm_name(s: str) -> str:
    return re.sub(r"[^a-z]", "", str(s or "").lower())

def norm_company(s: str) -> str:
    if not s:
        return ""
    s = basename(str(s)).lower()
    s = _PUNCT_RE.sub(" ", s)
    return " ".join(t for t in _WS_RE.split(s) if t and t not in STOPWORDS)

def metaphone(s: str) -> str:
    if not s:
        return ""
    try:
        return jellyfish.metaphone(s)[:8]
    except Exception:
        return ""

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

def is_role_email(e: str) -> bool:
    return bool(e) and bool(_ROLE_LOCAL_RE.match(e))

def is_freemail(e: str) -> bool:
    if not e or "@" not in e:
        return False
    return e.rsplit("@", 1)[1] in FREEMAIL_DOMAINS

def parse_name(raw: str) -> tuple[str, str]:
    if not raw:
        return "", ""
    s = str(raw).strip()
    if s == s.upper() and "," not in s:
        parts = [p for p in s.split() if p]
        if len(parts) >= 2:
            return parts[1].capitalize(), parts[0].capitalize()
    if "," in s:
        last, rest = s.split(",", 1)
        first_tok = rest.strip().split()
        return (first_tok[0] if first_tok else "").capitalize(), last.strip().capitalize()
    try:
        hn = HumanName(s)
        return hn.first, hn.last
    except Exception:
        parts = s.split()
        return (parts[0] if parts else ""), (parts[-1] if len(parts) > 1 else "")

# ─────────────────────────────────────────────────────────────
# Loaders — each returns a normalized DataFrame with standard columns
# ─────────────────────────────────────────────────────────────
STANDARD_COLS = [
    "first_name", "last_name", "full_name", "email", "company", "title",
    "state", "city", "linkedin_url", "source_file", "source_tier",
    "category", "lp_score", "enrichment_stage",
]

def empty_std() -> pd.DataFrame:
    return pd.DataFrame({c: pd.Series(dtype=str) for c in STANDARD_COLS})

def read_csv_safe(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8")
    except UnicodeDecodeError:
        return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="cp1252")
    except Exception:
        return pd.DataFrame()

def load_base_master() -> pd.DataFrame:
    df = read_csv_safe(BASE_MASTER)
    if df.empty:
        return empty_std()
    # Parse full_name into first/last
    fn, ln = [], []
    for nm in df.get("full_name", pd.Series([""] * len(df))):
        f, l = parse_name(nm)
        fn.append(f)
        ln.append(l)
    out = pd.DataFrame({
        "first_name": fn,
        "last_name": ln,
        "full_name": df.get("full_name", ""),
        "email": df.get("final_email", ""),
        "company": df.get("company", ""),
        "title": df.get("title", ""),
        "state": df.get("state", ""),
        "city": "",
        "linkedin_url": df.get("linkedin_keys", ""),
        "source_file": "unified-cleaned/master",
        "source_tier": df.get("source_tier", "A"),
        "category": df.get("category", ""),
        "lp_score": df.get("lp_heuristic_score", ""),
        "enrichment_stage": df.get("enrichment_stage", ""),
    })
    return out

def load_secondary_csvs() -> pd.DataFrame:
    frames = [empty_std()]
    for fn in SECONDARY_LEAD_CSVS:
        p = ENRICHMENT_DIR / fn
        df = read_csv_safe(p)
        if df.empty:
            continue
        col = lambda keys: next((c for c in df.columns if c.lower() in keys), None)
        cf = col({"first_name", "firstname", "first"})
        cl = col({"last_name", "lastname", "last"})
        cc = col({"company", "company_name", "employer", "firm_name", "firm"})
        ce = col({"email", "work_email", "final_email", "email_found"})
        ct = col({"title", "job_title", "role"})
        cs = col({"state"})
        ci = col({"city"})
        cli = col({"linkedin_url", "linkedin", "linkedin_keys"})
        if not cf or not cl:
            continue
        out = pd.DataFrame({
            "first_name": df[cf],
            "last_name": df[cl],
            "full_name": (df[cf].astype(str) + " " + df[cl].astype(str)).str.strip(),
            "email": df[ce] if ce else "",
            "company": df[cc] if cc else "",
            "title": df[ct] if ct else "",
            "state": df[cs] if cs else "",
            "city": df[ci] if ci else "",
            "linkedin_url": df[cli] if cli else "",
            "source_file": fn,
            "source_tier": "B",
            "category": "",
            "lp_score": "",
            "enrichment_stage": "",
        })
        frames.append(out)
    return pd.concat(frames, ignore_index=True)

def load_sec_signals() -> pd.DataFrame:
    """SEC Form 4 as signal records (one row per person with latest transaction)."""
    files = sorted(SEC_JSONL_DIR.glob("*.jsonl"))
    if not files:
        return empty_std()
    rows = []
    for line in files[-1].read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        first, last = parse_name(r.get("reporterName", ""))
        if not first or not last:
            continue
        txns = r.get("transactions") or []
        best = max(txns, key=lambda t: t.get("totalValueUsd", 0)) if txns else {}
        role = r.get("officerTitle") or (
            "Director" if r.get("isDirector") else (
                "10% Owner" if r.get("isTenPercentOwner") else "Insider"
            )
        )
        rows.append({
            "first_name": first,
            "last_name": last,
            "full_name": f"{first} {last}".strip(),
            "email": "",
            "company": r.get("issuerName", ""),
            "title": role,
            "state": "",
            "city": "",
            "linkedin_url": "",
            "source_file": "sec-form-4",
            "source_tier": "A",
            "category": "SEC_INSIDER_LIQUIDITY",
            "lp_score": "",
            "enrichment_stage": "",
            "_signal_type": "sec-form-4",
            "_signal_value": r.get("maxTransactionUsd", 0),
            "_signal_date": best.get("transactionDate", r.get("filedAt", "")),
            "_signal_extra": f"{r.get('issuerTicker', '')}|{best.get('transactionCode', '')}",
        })
    df = pd.DataFrame(rows)
    return df

def load_fec_signals() -> pd.DataFrame:
    files = sorted(FEC_JSONL_DIR.glob("*.jsonl"))
    if not files:
        return empty_std()
    rows = []
    for line in files[-1].read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        rows.append({
            "first_name": r.get("first_name", ""),
            "last_name": r.get("last_name", ""),
            "full_name": f"{r.get('first_name','')} {r.get('last_name','')}".strip(),
            "email": "",
            "company": r.get("employer", ""),
            "title": r.get("occupation", ""),
            "state": r.get("state", ""),
            "city": r.get("city", ""),
            "linkedin_url": "",
            "source_file": "fec-donors",
            "source_tier": "A",
            "category": "FEC_POLITICAL_DONOR",
            "lp_score": "",
            "enrichment_stage": "",
            "_signal_type": "fec",
            "_signal_value": r.get("total_contributions_usd", 0),
            "_signal_date": r.get("last_contribution_date", ""),
            "_signal_extra": f"cycles={'|'.join(map(str, r.get('cycles', []) or []))}",
        })
    return pd.DataFrame(rows)

def load_fresh_enrichment() -> pd.DataFrame:
    """This session's $100 enrichment output — overrides email for matched records."""
    if not ENRICHED.exists():
        return pd.DataFrame()
    df = read_csv_safe(ENRICHED)
    if df.empty:
        return df
    df = df[df["email_status"].isin(["valid"])].copy()
    df["email_normalized"] = df["email"].apply(norm_email)
    return df

def load_excluded_lps() -> set[str]:
    df = read_csv_safe(EXCLUDED_LPS)
    if df.empty:
        return set()
    keys = set()
    for _, r in df.iterrows():
        first = r.get("first_name") or ""
        last = r.get("last_name") or ""
        full = r.get("full_name") or ""
        if not (first and last) and full:
            hn = HumanName(str(full))
            first, last = hn.first, hn.last
        if first and last:
            keys.add(f"{norm_name(first)}|{norm_name(last)}")
    return keys

# ─────────────────────────────────────────────────────────────
# Dedupe + merge
# ─────────────────────────────────────────────────────────────
def build_block_index(df: pd.DataFrame) -> dict[str, list[int]]:
    idx: dict[str, list[int]] = {}
    for i, row in df.iterrows():
        mph = metaphone(row.get("last_name", ""))
        fi = (row.get("first_name", "") or "?")[:1].upper()
        if not mph:
            continue
        key = f"{mph}|{fi}"
        idx.setdefault(key, []).append(i)
    return idx

def sim_score(a: dict, b: dict) -> float:
    last_jw = JaroWinkler.similarity(
        (a.get("last_name") or "").lower(),
        (b.get("last_name") or "").lower(),
    )
    af = (a.get("first_name") or "").lower()
    bf = (b.get("first_name") or "").lower()
    if af and bf and (
        (len(af) == 1 and bf.startswith(af)) or (len(bf) == 1 and af.startswith(bf))
    ):
        first_jw = 0.85
    else:
        first_jw = JaroWinkler.similarity(af, bf) if af and bf else 0.0
    ac = norm_company(a.get("company") or "")
    bc = norm_company(b.get("company") or "")
    co_sim = fuzz.token_set_ratio(ac, bc) / 100.0 if ac and bc else 0.0
    score = (last_jw * 0.45) + (first_jw * 0.25) + (co_sim * 0.30)
    # Hard veto: both have emails that differ and company mismatch
    ae = norm_email(a.get("email") or "")
    be = norm_email(b.get("email") or "")
    if ae and be and ae != be and co_sim < 0.9:
        return 0.0
    return score

SOURCE_TIER_RANK = {"S": 5, "A": 4, "B": 3, "C": 2, "D": 1, "": 0}

def merge_values(primary: dict, other: dict, fields: list[str]) -> dict:
    """Pick best non-null value per field, preferring higher source_tier."""
    p_rank = SOURCE_TIER_RANK.get(primary.get("source_tier", ""), 0)
    o_rank = SOURCE_TIER_RANK.get(other.get("source_tier", ""), 0)
    merged = dict(primary)
    for f in fields:
        p_val = (primary.get(f) or "").strip() if isinstance(primary.get(f), str) else primary.get(f)
        o_val = (other.get(f) or "").strip() if isinstance(other.get(f), str) else other.get(f)
        if not p_val and o_val:
            merged[f] = o_val
        elif p_val and o_val and o_rank > p_rank:
            # Higher tier wins
            merged[f] = o_val
    return merged

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main():
    started = datetime.now().isoformat(timespec="seconds")
    print(f"[organize-granite-park] {started}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "queues").mkdir(exist_ok=True)
    (OUT / "signals").mkdir(exist_ok=True)
    (OUT / "exclusions").mkdir(exist_ok=True)
    (OUT / "history").mkdir(exist_ok=True)

    print("\n[1/6] Loading base + secondary sources...")
    base = load_base_master()
    secondary = load_secondary_csvs()
    sec = load_sec_signals()
    fec = load_fec_signals()
    enriched = load_fresh_enrichment()
    excluded = load_excluded_lps()
    print(f"  base master:            {len(base):>6,}")
    print(f"  secondary CSVs combined: {len(secondary):>6,}")
    print(f"  SEC Form 4 signals:     {len(sec):>6,}")
    print(f"  FEC signals:            {len(fec):>6,}")
    print(f"  fresh valid enrichment: {len(enriched):>6,}")
    print(f"  excluded-not-lps keys:  {len(excluded):>6,}")

    print("\n[2/6] Pre-normalizing...")
    all_sources = pd.concat([base, secondary, sec, fec], ignore_index=True)
    all_sources["_email_norm"] = all_sources["email"].apply(norm_email)
    all_sources["_name_key"] = all_sources.apply(
        lambda r: f"{norm_name(r['first_name'])}|{norm_name(r['last_name'])}", axis=1
    )
    all_sources["_company_norm"] = all_sources["company"].apply(norm_company)
    # Drop records with no identifying keys
    before = len(all_sources)
    all_sources = all_sources[
        (all_sources["_name_key"].str.len() >= 3) |
        (all_sources["_email_norm"].str.len() > 0)
    ].reset_index(drop=True)
    print(f"  kept {len(all_sources):,} of {before:,} (dropped rows with no usable keys)")

    print("\n[3/6] Building clusters via metaphone blocking + fuzzy merge...")
    # Sort by source_tier DESC so higher-tier records anchor clusters
    all_sources["_tier_rank"] = all_sources["source_tier"].map(lambda t: SOURCE_TIER_RANK.get(t, 0))
    all_sources = all_sources.sort_values(
        ["_tier_rank", "_email_norm"], ascending=[False, False]
    ).reset_index(drop=True)

    block_idx = build_block_index(all_sources)
    cluster_of: dict[int, int] = {}  # row_idx -> cluster_idx
    clusters: list[list[int]] = []

    for i, row in all_sources.iterrows():
        if i in cluster_of:
            continue
        # Find candidates in same metaphone block
        mph = metaphone(row.get("last_name", ""))
        fi = (row.get("first_name", "") or "?")[:1].upper()
        block = block_idx.get(f"{mph}|{fi}", [])
        my_cluster: list[int] = [i]
        cluster_of[i] = len(clusters)
        for ci in block:
            if ci == i or ci in cluster_of:
                continue
            if sim_score(row.to_dict(), all_sources.iloc[ci].to_dict()) >= 0.88:
                cluster_of[ci] = len(clusters)
                my_cluster.append(ci)
        # Also merge exact-email matches regardless of name block
        my_email = norm_email(row.get("email", ""))
        if my_email and not is_role_email(my_email):
            same_email = all_sources.index[all_sources["_email_norm"] == my_email].tolist()
            for se in same_email:
                if se not in cluster_of:
                    cluster_of[se] = len(clusters)
                    my_cluster.append(se)
        clusters.append(my_cluster)
        if (len(clusters)) % 10000 == 0:
            print(f"    clustered {len(clusters):,} (rows seen: {i+1:,}/{len(all_sources):,})")

    print(f"  total clusters: {len(clusters):,}")

    print("\n[4/6] Building master records from clusters...")
    master_records = []
    signals_out = []
    for cid, member_idxs in enumerate(clusters):
        members = [all_sources.iloc[mi].to_dict() for mi in member_idxs]
        # Sort by tier rank desc so first member wins on conflicts
        members.sort(key=lambda m: SOURCE_TIER_RANK.get(m.get("source_tier", ""), 0), reverse=True)
        primary = dict(members[0])
        merge_fields = ["email", "company", "title", "state", "city", "linkedin_url", "category", "lp_score"]
        for other in members[1:]:
            primary = merge_values(primary, other, merge_fields)

        name_key = f"{norm_name(primary.get('first_name', ''))}|{norm_name(primary.get('last_name', ''))}"
        sources_list = sorted({m.get("source_file", "") for m in members if m.get("source_file")})

        # Collect signals — guard against NaN (floats) leaking in from DataFrame.to_dict()
        member_signals = []
        for m in members:
            st = m.get("_signal_type", "")
            if not isinstance(st, str) or not st:
                continue
            try:
                val = float(m.get("_signal_value") or 0)
            except (TypeError, ValueError):
                val = 0.0
            sd = m.get("_signal_date", "")
            if not isinstance(sd, str):
                sd = ""
            sx = m.get("_signal_extra", "")
            if not isinstance(sx, str):
                sx = ""
            member_signals.append({
                "type": st,
                "value_usd": val,
                "date": sd,
                "extra": sx,
            })

        do_not_contact = name_key in excluded

        master_records.append({
            "person_id": f"gpc_{cid:07d}",
            "first_name": primary.get("first_name", ""),
            "last_name": primary.get("last_name", ""),
            "full_name": f"{primary.get('first_name', '')} {primary.get('last_name', '')}".strip(),
            "email": primary.get("email", ""),
            "email_normalized": norm_email(primary.get("email", "")),
            "email_is_role": is_role_email(primary.get("email", "")),
            "email_is_freemail": is_freemail(primary.get("email", "")),
            "company": primary.get("company", ""),
            "company_normalized": norm_company(primary.get("company", "")),
            "title": primary.get("title", ""),
            "state": primary.get("state", ""),
            "city": primary.get("city", ""),
            "linkedin_url": primary.get("linkedin_url", ""),
            "category": primary.get("category", ""),
            "lp_score": primary.get("lp_score", ""),
            "source_files": "|".join(sources_list),
            "source_count": len(sources_list),
            "source_tier_best": max((m.get("source_tier", "") for m in members), key=lambda t: SOURCE_TIER_RANK.get(t, 0), default=""),
            "signal_types": "|".join(sorted({s["type"] for s in member_signals})),
            "signal_count": len(member_signals),
            "signal_max_usd": max((s["value_usd"] for s in member_signals), default=0),
            "signal_latest_date": max((s["date"] for s in member_signals), default="") if member_signals else "",
            "do_not_contact": do_not_contact,
        })

        # Also emit flat signals
        for s in member_signals:
            signals_out.append({
                "person_id": f"gpc_{cid:07d}",
                "name": f"{primary.get('first_name','')} {primary.get('last_name','')}".strip(),
                "company": primary.get("company", ""),
                "signal_type": s["type"],
                "value_usd": s["value_usd"],
                "date": s["date"],
                "extra": s["extra"],
            })

    master_df = pd.DataFrame(master_records)

    # Layer in fresh enrichment emails (best/last)
    if not enriched.empty:
        enriched["_name_key"] = enriched.apply(
            lambda r: f"{norm_name(r['first_name'])}|{norm_name(r['last_name'])}", axis=1
        )
        enriched["_company_norm"] = enriched["company"].apply(norm_company)
        enriched_emails_applied = 0
        # Build a quick lookup by (name_key, company_norm) -> email
        lookup = {}
        for _, r in enriched.iterrows():
            key = (r["_name_key"], r["_company_norm"])
            lookup[key] = r["email_normalized"]
        # Update master where missing email
        def maybe_patch_email(row):
            nonlocal enriched_emails_applied
            if row["email_normalized"]:
                return row["email"]
            key = (f"{norm_name(row['first_name'])}|{norm_name(row['last_name'])}", row["company_normalized"])
            e = lookup.get(key)
            if e:
                enriched_emails_applied += 1
                return e
            return row["email"]
        master_df["email"] = master_df.apply(maybe_patch_email, axis=1)
        master_df["email_normalized"] = master_df["email"].apply(norm_email)
        master_df["email_is_role"] = master_df["email"].apply(is_role_email)
        master_df["email_is_freemail"] = master_df["email"].apply(is_freemail)
        print(f"  applied {enriched_emails_applied:,} fresh emails from $100 enrichment run")

    print(f"  master rows: {len(master_df):,}")

    print("\n[5/6] Routing to queues...")
    def queue_for(r) -> str:
        if r["do_not_contact"]:
            return "excluded"
        em = r["email_normalized"]
        if em and not r["email_is_role"] and not r["email_is_freemail"]:
            return "send-ready"
        if em and r["email_is_freemail"]:
            return "send-ready-freemail"
        if not em and r.get("first_name") and r.get("last_name") and r.get("company"):
            return "enrichment-pending"
        return "review"

    master_df["queue"] = master_df.apply(queue_for, axis=1)
    master_df["updated_at"] = datetime.now().isoformat(timespec="seconds")

    # Write outputs
    print("\n[6/6] Writing outputs...")
    master_df.to_csv(OUT / "master.csv", index=False)
    master_df.to_parquet(OUT / "master.parquet", index=False)

    master_df[master_df["queue"] == "send-ready"].to_csv(OUT / "queues" / "send-ready.csv", index=False)
    master_df[master_df["queue"] == "send-ready-freemail"].to_csv(OUT / "queues" / "send-ready-freemail.csv", index=False)
    master_df[master_df["queue"] == "enrichment-pending"].to_csv(OUT / "queues" / "enrichment-pending.csv", index=False)
    master_df[master_df["queue"] == "review"].to_csv(OUT / "queues" / "review.csv", index=False)
    master_df[master_df["queue"] == "excluded"].to_csv(OUT / "exclusions" / "not-lps.csv", index=False)

    # Signals
    if signals_out:
        sig_df = pd.DataFrame(signals_out)
        sig_df[sig_df["signal_type"] == "sec-form-4"].to_csv(OUT / "signals" / "sec-form-4-latest.csv", index=False)
        sig_df[sig_df["signal_type"] == "fec"].to_csv(OUT / "signals" / "fec-donors-latest.csv", index=False)

    # Not-found history (for do-not-retry)
    if ENRICHED.exists():
        raw_enrich = read_csv_safe(ENRICHED)
        if not raw_enrich.empty and "email_status" in raw_enrich.columns:
            raw_enrich[raw_enrich["email_status"].isin(["not_found", "risky"])].to_csv(
                OUT / "exclusions" / "enriched-no-email.csv", index=False
            )

    # History copies
    for src in [BASE_MASTER, OLD_MASTER]:
        if src.exists():
            dest_name = src.parent.name + "-" + src.stem + ".csv"
            shutil.copy2(src, OUT / "history" / dest_name)

    # Manifest
    counts = master_df["queue"].value_counts().to_dict()
    manifest = {
        "version": 1,
        "created_at": started,
        "finished_at": datetime.now().isoformat(timespec="seconds"),
        "master_rows": int(len(master_df)),
        "queue_counts": {str(k): int(v) for k, v in counts.items()},
        "with_verified_email": int((master_df["email_normalized"].str.len() > 0).sum()),
        "sources_used": {
            "base_master": int(len(base)),
            "secondary_csvs": int(len(secondary)),
            "sec_form_4_signals": int(len(sec)),
            "fec_signals": int(len(fec)),
            "fresh_enrichment_valid": int(len(enriched)),
            "excluded_not_lps": len(excluded),
        },
        "signal_summary": {
            "sec_form_4_attached": int(master_df["signal_types"].str.contains("sec-form-4", regex=False).sum()),
            "fec_attached": int(master_df["signal_types"].str.contains("fec", regex=False).sum()),
        },
        "outputs": {
            "master": str((OUT / "master.csv").resolve()),
            "send_ready": str((OUT / "queues" / "send-ready.csv").resolve()),
            "enrichment_pending": str((OUT / "queues" / "enrichment-pending.csv").resolve()),
            "review": str((OUT / "queues" / "review.csv").resolve()),
            "excluded": str((OUT / "exclusions" / "not-lps.csv").resolve()),
        },
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    readme = f"""# Granite Park — Master Prospect Data

**Canonical home for all GPC lead data.** Last built: {manifest["finished_at"]}

## Files

| Path | What | Rows |
|---|---|---|
| `master.csv` / `master.parquet` | One row per unique person; full provenance | {manifest['master_rows']:,} |
| `queues/send-ready.csv` | Verified corporate email, not role/freemail. Ship to Instantly. | {counts.get('send-ready', 0):,} |
| `queues/send-ready-freemail.csv` | Has freemail (Gmail/Yahoo). Founders OK, others review. | {counts.get('send-ready-freemail', 0):,} |
| `queues/enrichment-pending.csv` | Missing email, has name+company. Run AMF+FM waterfall. | {counts.get('enrichment-pending', 0):,} |
| `queues/review.csv` | Ambiguous dedupe or incomplete identity. | {counts.get('review', 0):,} |
| `exclusions/not-lps.csv` | Manually flagged as not-LP (do-not-contact). | {counts.get('excluded', 0):,} |
| `exclusions/enriched-no-email.csv` | Already tried AMF+FM and failed. Do not retry. | — |
| `signals/sec-form-4-latest.csv` | Fresh insider stock liquidity events. | — |
| `signals/fec-donors-latest.csv` | Fresh political donation signals. | — |
| `history/` | Prior master CSVs preserved. | — |
| `manifest.json` | Build metadata + provenance. | — |

## How to use

1. **Daily send:** `queues/send-ready.csv` → Instantly. Verified email, deliverability-safe.
2. **Enrichment batches:** `queues/enrichment-pending.csv` → AMF+FM. Top-scored prospects first.
3. **Before shipping:** always re-check `exclusions/not-lps.csv` and dedupe against current Instantly leads.
4. **Signals are fresh intel:** attach as a custom field in Instantly for personalization.

## Schema (master.csv key columns)

- `person_id` — stable unique id (`gpc_NNNNNNN`)
- `full_name`, `first_name`, `last_name`
- `email`, `email_normalized` — primary email
- `email_is_role`, `email_is_freemail` — flags
- `company`, `title`, `state`, `city`, `linkedin_url`
- `source_files` — pipe-separated list of every source this person appears in
- `source_count` — dedupe depth
- `signal_types` — what fresh signals are attached (sec-form-4, fec)
- `signal_max_usd` — biggest recent signal value (liquidity or political giving)
- `signal_latest_date` — most recent signal
- `do_not_contact` — in excluded-not-lps list
- `queue` — routing destination

## Rebuilding

```bash
python3 scripts/organize-granite-park.py
```

Idempotent. Overwrites outputs; does NOT touch sources.
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")

    # Report
    print(f"\nDone.")
    print(f"  master.csv:             {manifest['master_rows']:,} rows")
    print(f"  send-ready:             {counts.get('send-ready', 0):,}")
    print(f"  send-ready-freemail:    {counts.get('send-ready-freemail', 0):,}")
    print(f"  enrichment-pending:     {counts.get('enrichment-pending', 0):,}")
    print(f"  review:                 {counts.get('review', 0):,}")
    print(f"  excluded (do-not-lps):  {counts.get('excluded', 0):,}")
    print(f"  with verified email:    {manifest['with_verified_email']:,}")
    print(f"  SEC Form 4 signals:     {manifest['signal_summary']['sec_form_4_attached']:,}")
    print(f"  FEC signals:            {manifest['signal_summary']['fec_attached']:,}")
    print(f"\nOutput dir: {OUT}")

if __name__ == "__main__":
    main()
