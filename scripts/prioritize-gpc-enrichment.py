"""
Prioritize enrichment_ready.csv for a fixed budget.

Scores each record 0-100 for GPC (affordable housing BTR, $250K min, 506(c)) fit:
  - REIT officers = top (they literally invest in housing)
  - Real estate occupation = top tier
  - PE/VC/hedge fund firms = strong (sophisticated alt allocators)
  - Family office / wealth management = strong
  - SEC 10% owners / small-cap founders = strong
  - SEC CFOs = strong (understand deal math)
  - Political giving >= $100K = +10
  - Wealth-center states (NY/CA/FL/TX) = +5
  - Tech SaaS public company execs = -10 (wrong risk appetite)
  - Celebrity-famous names = -20 (have gatekeepers)

Outputs prioritized_<budget>.csv with budget-fitting top-N.

Usage:
  python3 scripts/prioritize-gpc-enrichment.py --budget=100
"""
import argparse
import re
import sys
from pathlib import Path
import pandas as pd

REPO = Path(__file__).parent.parent
CLEAN = REPO / "data" / "gpc-top-tier" / "clean"

# AMF + Findymail economics (from earlier planning)
AMF_PRICE_PER_VALID = 0.049
AMF_EXPECTED_HIT = 0.55
FM_PRICE_PER_VALID = 0.04
FM_EXPECTED_RESCUE = 0.15  # on AMF misses
VERIFY_PRICE_PER_EMAIL = 0.0008

# ─────────────────────────────────────────────────────────────
# Signal keywords
# ─────────────────────────────────────────────────────────────
REIT_TICKERS = {
    "UDR", "EQR", "AVB", "ESS", "MAA", "CPT", "INVH", "AMH", "SUI", "ELS",
    "MAC", "REG", "FRT", "O", "NNN", "BRX", "SPG", "KIM", "AIV", "AIRC",
    "NXRT", "BRT", "UMH", "IRT", "IRM", "EQC", "EXR", "PSA", "LSI", "CUBE",
    "PLD", "PSB", "REXR", "FR", "EGP", "STAG", "ARE", "BXP", "KRC", "VNO",
    "HIW", "CUZ", "WRE", "DEI", "CIO", "BRG", "STOR",
}

RE_OCCUPATION_RE = re.compile(
    r"\b(real[\s-]?estate|property|realtor|developer|realty|housing|apartments?|multifamily|construction|homebuilder)\b",
    re.I,
)

PE_VC_HEDGE_RE = re.compile(
    r"\b(blackstone|kkr|carlyle|apollo|bain|tpg|oaktree|ares|stone[\s-]?point|"
    r"fortress|elliott|bridgewater|citadel|millennium|man group|d\.?e\.?\s*shaw|"
    r"two sigma|renaissance|balyasny|point72|lone pine|coatue|tiger global|"
    r"jane street|sig susquehanna|jump trading|hudson river|virtu|"
    r"andreessen|sequoia|kleiner|accel|greylock|general catalyst|bessemer|"
    r"insight|lightspeed|nea|benchmark|founders fund|khosla|thrive|"
    r"cerberus|providence|clearlake|vista|silver lake|thoma bravo|hellman|"
    r"warburg|general atlantic|summit|tpg growth|advent|bain capital|"
    r"neuberger|franklin templeton|pimco|brookfield|starwood|macquarie|"
    r"blackrock|state street|vanguard|invesco)\b",
    re.I,
)

FAMILY_OFFICE_RE = re.compile(
    r"\b(family[\s-]?office|wealth management|capital management|investments?|holdings)\b",
    re.I,
)

LAW_FIRM_RE = re.compile(
    r"\b(kirkland|sullivan.*cromwell|latham|skadden|weil|davis polk|cleary|"
    r"paul weiss|wachtell|cravath|debevoise|simpson thacher|white.*case|"
    r"jones day|mayer brown|greenberg traurig|goodwin|ropes.*gray|"
    r"cooley|morrison.*foerster|gibson dunn|covington)\b",
    re.I,
)

TECH_SAAS_EMPLOYER_RE = re.compile(
    r"\b(google|alphabet|microsoft|oracle|salesforce|adobe|servicenow|workday|"
    r"snowflake|datadog|cloudflare|mongodb|okta|zscaler|crowdstrike|palo alto|"
    r"fortinet|splunk|elastic|twilio|shopify|block|square|paypal|affirm|"
    r"robinhood|coinbase|stripe|plaid|netflix|spotify|uber|lyft|doordash|"
    r"airbnb|instacart|amazon|meta|apple|nvidia|amd|intel|qualcomm|broadcom)\b",
    re.I,
)

CELEBRITY_NAME_RE = re.compile(
    r"^(elon musk|jeff bezos|mark zuckerberg|bill gates|warren buffett|"
    r"michael bloomberg|mark cuban|richard branson|peter thiel|reid hoffman|"
    r"marc andreessen|ben horowitz|kenneth griffin|ray dalio|stephen schwarzman|"
    r"david tepper|carl icahn|stanley druckenmiller|paul tudor jones|"
    r"george soros|jim simons|howard marks|henry kravis|david rubenstein|"
    r"donald trump|mike pence|kamala harris|joe biden|nancy pelosi|chuck schumer)$",
    re.I,
)

REIT_NAME_RE = re.compile(
    r"\b(REIT|real estate|residential|apartment|multifamily|equity residential|"
    r"avalonbay|camden|essex|mid-america|udr|invitation homes|american homes|"
    r"sun communities|equity lifestyle|public storage|extra space|"
    r"prologis|duke realty|eastgroup|first industrial|stag industrial)\b",
    re.I,
)

# ─────────────────────────────────────────────────────────────
# Scoring
# ─────────────────────────────────────────────────────────────
def score_record(r: dict) -> tuple[int, list[str]]:
    score = 50  # baseline
    reasons: list[str] = []
    employer = (r.get("company") or "").strip()
    title = (r.get("title") or "").strip()
    ticker = (r.get("ticker") or "").strip().upper()
    source = (r.get("source") or "").strip()
    state = (r.get("state") or "").strip().upper()
    dollar = float(r.get("signal_dollar_value") or 0)
    full_name = f"{(r.get('first_name') or '').lower()} {(r.get('last_name') or '').lower()}".strip()

    # REIT officers — golden
    if ticker and ticker in REIT_TICKERS:
        score += 40
        reasons.append("REIT_OFFICER")
    elif employer and REIT_NAME_RE.search(employer):
        score += 30
        reasons.append("REIT_ISSUER")

    # Real estate occupation (FEC)
    if RE_OCCUPATION_RE.search(title) or RE_OCCUPATION_RE.search(employer):
        score += 35
        reasons.append("RE_OCCUPATION")

    # PE/VC/hedge firms
    if PE_VC_HEDGE_RE.search(employer):
        score += 25
        reasons.append("PE_VC_HEDGE_FIRM")

    # Family office / wealth management
    if FAMILY_OFFICE_RE.search(employer):
        score += 20
        reasons.append("FAMILY_OFFICE_WEALTH")

    # Law firm at tax/RE specialty
    if LAW_FIRM_RE.search(employer):
        score += 12
        reasons.append("ELITE_LAW_FIRM")

    # Sophisticated allocator occupations (FEC)
    occ_lower = title.lower()
    if any(k in occ_lower for k in (
        "managing partner", "managing director", "principal", "portfolio manager",
        "cio", "chief investment officer", "investor",
    )):
        score += 15
        reasons.append("SOPHISTICATED_ALLOCATOR")
    elif any(k in occ_lower for k in ("cfo", "chief financial officer")):
        score += 15
        reasons.append("CFO_UNDERSTANDS_MATH")
    elif any(k in occ_lower for k in ("founder", "owner", "entrepreneur")):
        score += 10
        reasons.append("FOUNDER_LIQUIDITY")

    # SEC signal: 10% owner = founder with concentrated wealth
    if source == "sec-form-4":
        if "10%" in title or "Ten Percent" in title:
            score += 15
            reasons.append("SEC_10PCT_OWNER")
        elif title == "Director":
            score += 5
            reasons.append("SEC_DIRECTOR")
        # Small-cap liquidity sweet spot: $500K-$5M
        if 500_000 <= dollar <= 5_000_000:
            score += 10
            reasons.append("SMALL_CAP_LIQUIDITY")

    # FEC signal: $100K+ giving = serious money
    if source == "fec" and dollar >= 100_000:
        score += 10
        reasons.append("HIGH_POLITICAL_GIVER")
    elif source == "fec" and dollar >= 50_000:
        score += 5
        reasons.append("MID_POLITICAL_GIVER")

    # Wealth center states
    if state in {"NY", "CA", "FL", "TX", "MA", "CT", "IL", "NJ"}:
        score += 5
        reasons.append(f"WEALTH_CENTER_{state}")

    # Penalties
    if TECH_SAAS_EMPLOYER_RE.search(employer) and any(
        k in title.lower() for k in ("ceo", "chief technology", "cto", "engineer", "product manager", "vp engineering")
    ):
        score -= 15
        reasons.append("TECH_SAAS_MISMATCH")

    if CELEBRITY_NAME_RE.match(full_name):
        score -= 30
        reasons.append("CELEBRITY_WONT_RESPOND")

    # Cap 0-100
    score = max(0, min(100, score))
    return score, reasons

# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=100.0, help="USD budget for enrichment")
    ap.add_argument("--input", default=str(CLEAN / "enrichment_ready.csv"))
    args = ap.parse_args()

    df = pd.read_csv(args.input, dtype=str, keep_default_na=False)
    print(f"Loaded {len(df):,} enrichment-ready records from {Path(args.input).name}")

    # Score
    scores = []
    reason_lists = []
    for _, row in df.iterrows():
        s, rs = score_record(row.to_dict())
        scores.append(s)
        reason_lists.append("|".join(rs))
    df["priority_score"] = scores
    df["priority_reasons"] = reason_lists

    # Sort desc
    df = df.sort_values("priority_score", ascending=False).reset_index(drop=True)

    # Budget math: records go through AMF (pay only on valid), then FM rescue
    # Expected cost per record:
    #   AMF: 0.55 * $0.049 = $0.027 (valid)
    #   FM (on 0.45 misses): 0.45 * 0.15 * $0.04 = $0.0027
    #   Verify on all valid: (0.55 + 0.45*0.15) * $0.0008 = $0.0005
    #   Total per record: ~$0.0302
    per_record_cost = (
        AMF_EXPECTED_HIT * AMF_PRICE_PER_VALID
        + (1 - AMF_EXPECTED_HIT) * FM_EXPECTED_RESCUE * FM_PRICE_PER_VALID
        + (AMF_EXPECTED_HIT + (1 - AMF_EXPECTED_HIT) * FM_EXPECTED_RESCUE) * VERIFY_PRICE_PER_EMAIL
    )
    n_to_process = int(args.budget / per_record_cost)
    n_to_process = min(n_to_process, len(df))

    top = df.head(n_to_process).copy()
    rest = df.iloc[n_to_process:].copy()

    expected_valid = int(n_to_process * (AMF_EXPECTED_HIT + (1 - AMF_EXPECTED_HIT) * FM_EXPECTED_RESCUE))
    expected_cost = round(n_to_process * per_record_cost, 2)

    # Breakdown by top priority reason
    reason_tally = {}
    for rs in top["priority_reasons"]:
        for r in rs.split("|"):
            if r:
                reason_tally[r] = reason_tally.get(r, 0) + 1

    # Output
    out_top = CLEAN / f"prioritized_budget_{int(args.budget)}.csv"
    out_rest = CLEAN / f"deferred_for_later_budget_{int(args.budget)}.csv"
    top.to_csv(out_top, index=False)
    rest.to_csv(out_rest, index=False)

    print(f"\n--- Budget plan @ ${args.budget:.0f} ---")
    print(f"  Per-record expected cost: ${per_record_cost:.4f}")
    print(f"  Records to enrich:        {n_to_process:,}")
    print(f"  Expected valid emails:    {expected_valid:,}")
    print(f"  Expected cost:            ${expected_cost:.2f}")
    print(f"  Score range of batch:     {top['priority_score'].min():.0f} - {top['priority_score'].max():.0f}")
    print(f"  Median score:             {top['priority_score'].median():.0f}")
    print(f"\n--- Top priority reasons in batch ---")
    for reason, cnt in sorted(reason_tally.items(), key=lambda x: -x[1])[:15]:
        print(f"  {reason:<30} {cnt:>5}")

    print(f"\n--- Top 15 records by score ---")
    for _, r in top.head(15).iterrows():
        name = f"{r['first_name']} {r['last_name']}"[:25]
        emp = (r.get('company', '') or '')[:28]
        title = (r.get('title', '') or '')[:20]
        print(f"  [{int(r['priority_score']):>3}] {name:<25} {emp:<28} {title:<20} ({r.get('source', '')})")

    print(f"\nOutputs:")
    print(f"  {out_top}  ({n_to_process:,} rows to enrich now)")
    print(f"  {out_rest}  ({len(rest):,} rows deferred)")

if __name__ == "__main__":
    main()
