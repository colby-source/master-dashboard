#!/usr/bin/env python
"""Provision the Hero X Bio Peptides GHL sub-account scaffolding.

ONE-SHOT idempotent setup. Run AFTER Colby has:
  1. Created a new GHL sub-account named "Hero X Bio Peptides"
  2. Generated a Private Integration Token for it (sub-account →
     Settings → Integrations → Private Integrations → Create)
  3. Pasted these into master-dashboard/.env:
       GHL_HEROX_LOCATION_ID=<new location id>
       GHL_HEROX_LOCATION_API_KEY=<new private integration token>

What this script provisions (idempotent — safe to re-run):
  - 13 custom contact fields
  - 11 tags
  - 1 pipeline "Hero X Bio Peptides — Customer Lifecycle" with 6 stages
  - 9 custom values (business_address, footer, etc.)

Run with --dry-run first to preview. Run with --apply to execute.

Usage:
  python scripts/provision-herox-ghl-prereqs.py --dry-run
  python scripts/provision-herox-ghl-prereqs.py --apply
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


def headers(token):
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Version": GHL_VERSION,
    }


# ---- Custom Fields (contact-level) ----
CUSTOM_FIELDS = [
    {"name": "Hero X Customer",        "fieldKey": "hero_x_customer",        "dataType": "CHECKBOX"},
    {"name": "Last Order Date",        "fieldKey": "last_order_date",        "dataType": "DATE"},
    {"name": "Last Order Value",       "fieldKey": "last_order_value",       "dataType": "MONETORY"},
    {"name": "Lifetime Value",         "fieldKey": "ltv",                    "dataType": "MONETORY"},
    {"name": "Last SKU Purchased",     "fieldKey": "last_sku_purchased",     "dataType": "TEXT"},
    {"name": "Restock SKU",            "fieldKey": "restock_sku",            "dataType": "TEXT"},
    {"name": "Subscription Renews At", "fieldKey": "subscription_renews_at", "dataType": "DATE"},
    {"name": "Subscription Status",    "fieldKey": "subscription_status",    "dataType": "TEXT"},
    {"name": "Reorder Cookie Sent",    "fieldKey": "reorder_cookie_sent",    "dataType": "CHECKBOX"},
    {"name": "Order Count",            "fieldKey": "order_count",            "dataType": "NUMERICAL"},
    {"name": "First Order Date",       "fieldKey": "first_order_date",       "dataType": "DATE"},
    {"name": "BMN Cross-Brand Contact ID", "fieldKey": "bmn_contact_id",     "dataType": "TEXT"},
    {"name": "Compliance Geo State",   "fieldKey": "geo_state",              "dataType": "TEXT"},
]

# ---- Tags ----
TAGS = [
    "hero-x-customer",
    "hero-x-subscriber",
    "hero-x-vip-500plus",
    "hero-x-vip-1500plus",
    "hero-x-cart-abandoned",
    "hero-x-restock-waitlist",
    "hero-x-lapsed-90d",
    "hero-x-lapsed-180d",
    "hero-x-suppressed-marketing",
    "hero-x-research-protocols",
    "also-bmn-customer",
]

# ---- Pipeline ----
PIPELINE_NAME = "Hero X Bio Peptides — Customer Lifecycle"
PIPELINE_STAGES = [
    "New Customer",
    "Active Subscriber",
    "At-Risk (90d)",
    "Lapsed (180d)",
    "Won-Back",
    "Churned",
]

# ---- Custom Values (location-level) ----
CUSTOM_VALUES = [
    ("business_address", "Supplements International LLC, [SET REGISTERED AGENT ADDRESS], [STATE] [ZIP]"),
    ("coa_archive_url",  "https://heroxbio.com/lab/coa/"),
    ("lab_protocols_url", "https://heroxbio.com/lab-protocols/"),
    ("lab_reference_url", "https://heroxbio.com/lab/reference/"),
    ("from_name",         "Hero X Bio Peptides"),
    ("reply_to",          "ops@heroxbio.com"),
    ("support_email",     "ops@heroxbio.com"),
    ("plasma_cyan",       "#2DD4BF"),
    ("ruo_disclaimer",    "For laboratory research use only. Not for human or veterinary use."),
]


# ---- API helpers ----

def get_existing_custom_fields(loc_id, token):
    r = requests.get(f"{GHL_BASE}/locations/{loc_id}/customFields", headers=headers(token), timeout=30)
    if r.status_code != 200: return {}
    fields = r.json().get("customFields", [])
    return {f.get("fieldKey"): f for f in fields if f.get("fieldKey")}


def get_existing_tags(loc_id, token):
    r = requests.get(f"{GHL_BASE}/locations/{loc_id}/tags", headers=headers(token), timeout=30)
    if r.status_code != 200: return {}
    tags = r.json().get("tags", [])
    return {t.get("name"): t for t in tags if t.get("name")}


def get_existing_pipelines(loc_id, token):
    r = requests.get(f"{GHL_BASE}/opportunities/pipelines?locationId={loc_id}", headers=headers(token), timeout=30)
    if r.status_code != 200: return {}
    pipes = r.json().get("pipelines", [])
    return {p.get("name"): p for p in pipes if p.get("name")}


def get_existing_custom_values(loc_id, token):
    r = requests.get(f"{GHL_BASE}/locations/{loc_id}/customValues", headers=headers(token), timeout=30)
    if r.status_code != 200: return {}
    cvs = r.json().get("customValues", [])
    return {c.get("name"): c for c in cvs if c.get("name")}


def create_custom_field(loc_id, token, field):
    body = {**field, "locationId": loc_id, "model": "contact"}
    r = requests.post(f"{GHL_BASE}/locations/{loc_id}/customFields",
                      headers=headers(token), json=body, timeout=30)
    return r.status_code, r.json() if r.text else {}


def create_tag(loc_id, token, name):
    r = requests.post(f"{GHL_BASE}/locations/{loc_id}/tags",
                      headers=headers(token), json={"name": name}, timeout=30)
    return r.status_code, r.json() if r.text else {}


def create_pipeline(loc_id, token, name, stages):
    body = {
        "name": name,
        "locationId": loc_id,
        "stages": [{"name": s, "position": i + 1} for i, s in enumerate(stages)],
    }
    r = requests.post(f"{GHL_BASE}/opportunities/pipelines",
                      headers=headers(token), json=body, timeout=30)
    return r.status_code, r.json() if r.text else {}


def create_custom_value(loc_id, token, name, value):
    body = {"name": name, "value": value, "locationId": loc_id}
    r = requests.post(f"{GHL_BASE}/locations/{loc_id}/customValues",
                      headers=headers(token), json=body, timeout=30)
    return r.status_code, r.json() if r.text else {}


# ---- Main ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Preview only — no API writes.")
    ap.add_argument("--apply", action="store_true", help="Execute the writes.")
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        ap.error("Pass --dry-run to preview or --apply to execute.")

    env = load_env()
    loc_id = env.get("GHL_HEROX_LOCATION_ID")
    token = env.get("GHL_HEROX_LOCATION_API_KEY")
    if not loc_id or not token:
        sys.exit("[fatal] Set GHL_HEROX_LOCATION_ID and GHL_HEROX_LOCATION_API_KEY in .env first.")

    print(f"[target] location: {loc_id}")
    print(f"[mode] {'APPLY' if args.apply else 'DRY-RUN'}")

    # ---- Discover current state ----
    print("\n[discover] reading current state...")
    existing_fields = get_existing_custom_fields(loc_id, token)
    existing_tags = get_existing_tags(loc_id, token)
    existing_pipes = get_existing_pipelines(loc_id, token)
    existing_cvs = get_existing_custom_values(loc_id, token)
    print(f"  custom fields: {len(existing_fields)}")
    print(f"  tags: {len(existing_tags)}")
    print(f"  pipelines: {len(existing_pipes)}")
    print(f"  custom values: {len(existing_cvs)}")

    # ---- Plan diff ----
    fields_to_create = [f for f in CUSTOM_FIELDS if f["fieldKey"] not in existing_fields]
    tags_to_create = [t for t in TAGS if t not in existing_tags]
    pipeline_needed = PIPELINE_NAME not in existing_pipes
    cvs_to_create = [(n, v) for n, v in CUSTOM_VALUES if n not in existing_cvs]

    print("\n[plan]")
    print(f"  custom fields to create: {len(fields_to_create)}/{len(CUSTOM_FIELDS)}")
    for f in fields_to_create: print(f"    + {f['fieldKey']} ({f['dataType']})")
    print(f"  tags to create: {len(tags_to_create)}/{len(TAGS)}")
    for t in tags_to_create: print(f"    + {t}")
    print(f"  pipeline '{PIPELINE_NAME}': {'CREATE' if pipeline_needed else 'exists, skip'}")
    if pipeline_needed:
        for s in PIPELINE_STAGES: print(f"    + stage: {s}")
    print(f"  custom values to create: {len(cvs_to_create)}/{len(CUSTOM_VALUES)}")
    for n, _ in cvs_to_create: print(f"    + {n}")

    if args.dry_run:
        print("\n[dry-run] no writes. Re-run with --apply to execute.")
        return

    # ---- Execute ----
    print("\n[execute] writing...")
    rate_limit_sleep = 0.2

    for f in fields_to_create:
        code, body = create_custom_field(loc_id, token, f)
        ok = 200 <= code < 300
        print(f"  {'+' if ok else '!'} field {f['fieldKey']}: {code} {body.get('error','') if not ok else 'ok'}")
        time.sleep(rate_limit_sleep)

    for t in tags_to_create:
        code, body = create_tag(loc_id, token, t)
        ok = 200 <= code < 300
        print(f"  {'+' if ok else '!'} tag {t}: {code} {body.get('error','') if not ok else 'ok'}")
        time.sleep(rate_limit_sleep)

    if pipeline_needed:
        code, body = create_pipeline(loc_id, token, PIPELINE_NAME, PIPELINE_STAGES)
        ok = 200 <= code < 300
        print(f"  {'+' if ok else '!'} pipeline {PIPELINE_NAME}: {code} {body.get('error','') if not ok else 'ok'}")

    for n, v in cvs_to_create:
        code, body = create_custom_value(loc_id, token, n, v)
        ok = 200 <= code < 300
        print(f"  {'+' if ok else '!'} custom value {n}: {code} {body.get('error','') if not ok else 'ok'}")
        time.sleep(rate_limit_sleep)

    print("\n[done] re-run with --dry-run to verify.")


if __name__ == "__main__":
    main()
