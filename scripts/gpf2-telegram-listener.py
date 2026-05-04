"""GPF-II two-way Telegram listener — Colby talks to the campaign.

Long-polls Telegram getUpdates, routes inbound messages to Claude with a
read-only Instantly toolset, and replies in the same chat.

Auth model: only TELEGRAM_CHAT_ID may interact. All other chat ids are dropped.
Tools are READ-ONLY in this version — no mutation of campaigns or leads.
Phase 2 will add pause/resume/draft-reply with confirmation flows.

Runs as PM2 long-running process (autorestart=true).
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:
    pass

REPO = Path(__file__).resolve().parent.parent
TOUCHES_CFG = REPO / "data" / "gpf2-touches.json"

# ---------- env loader ---------------------------------------------------

def _load_env() -> None:
    env_path = REPO / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()
TELEGRAM_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT = os.environ.get("TELEGRAM_CHAT_ID")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY")
INSTANTLY_KEY = os.environ.get("INSTANTLY_API_KEY")

if not all([TELEGRAM_TOKEN, TELEGRAM_CHAT, ANTHROPIC_KEY, INSTANTLY_KEY]):
    print("ERROR: missing required env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY, INSTANTLY_API_KEY)", file=sys.stderr)
    sys.exit(1)

ALLOWED_CHAT_ID = int(TELEGRAM_CHAT)

try:
    from anthropic import Anthropic
except ImportError:
    print("ERROR: pip install anthropic", file=sys.stderr)
    sys.exit(1)

CLIENT = Anthropic(api_key=ANTHROPIC_KEY, timeout=90.0)
MODEL = "claude-sonnet-4-6"

TOUCHES = json.loads(TOUCHES_CFG.read_text())

# ---------- HTTP helpers --------------------------------------------------

def _instantly(method: str, path: str, body: dict | None = None) -> dict:
    headers = {
        "Authorization": f"Bearer {INSTANTLY_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "curl/8.5.0",
        "Accept": "application/json",
        "Connection": "close",
    }
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"https://api.instantly.ai/api/v2{path}", data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def _tg(method: str, payload: dict, timeout: int = 20) -> dict:
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}"
    body = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def tg_send(text: str, *, chat_id: int | None = None, parse_mode: str = "Markdown") -> bool:
    cid = chat_id if chat_id is not None else ALLOWED_CHAT_ID
    for attempt in range(3):
        try:
            r = _tg("sendMessage", {"chat_id": cid, "text": text[:4000], "parse_mode": parse_mode})
            if r.get("ok"):
                return True
        except Exception:
            pass
        time.sleep(1 + attempt)
    return False


# ---------- Tools (READ-ONLY) --------------------------------------------

TOOLS = [
    {
        "name": "get_campaign_status",
        "description": "Get current status of all 4 GPF-II touch campaigns (T1-T4): active/paused/complete, daily cap, and today's cumulative sent/opens/replies/bounces.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_inbox_health",
        "description": "Get health of all 9 sending inboxes: status (1=active), warmup_status, warmup_score, daily_limit. Use to check if any inbox got suspended.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_inbox_detail",
        "description": "Get full detail for a single sending inbox by email address.",
        "input_schema": {
            "type": "object",
            "properties": {"email": {"type": "string", "description": "Inbox email address"}},
            "required": ["email"],
        },
    },
    {
        "name": "find_lead",
        "description": "Find a lead in any of the 4 touch campaigns by email address. Returns name, company, status, last activity, interest_status.",
        "input_schema": {
            "type": "object",
            "properties": {"email": {"type": "string", "description": "Lead email address"}},
            "required": ["email"],
        },
    },
    {
        "name": "get_recent_replies",
        "description": "Get recent replies received across the GPF-II campaigns. Returns lead email, reply text snippet, and timestamp.",
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "default": 10, "description": "Number of replies to fetch (default 10, max 25)"}},
            "required": [],
        },
    },
    {
        "name": "get_today_summary",
        "description": "Get today's overall summary: total sent today, open rate, reply rate, bounce rate, vs yesterday delta. Use for 'how's it going' style questions.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]


def tool_get_campaign_status() -> dict:
    out = []
    status_label = {1: "ACTIVE", 2: "PAUSED", 3: "COMPLETE", 4: "ERROR"}
    for n in (1, 2, 3, 4):
        cid = TOUCHES[f"touch_{n}"]
        try:
            c = _instantly("GET", f"/campaigns/{cid}")
            a = _instantly("GET", f"/campaigns/analytics?id={cid}")
            a = a[0] if isinstance(a, list) and a else (a if isinstance(a, dict) else {})
            out.append({
                "touch": n,
                "name": c.get("name"),
                "status": status_label.get(c.get("status"), str(c.get("status"))),
                "daily_cap": c.get("daily_limit"),
                "sent": int(a.get("emails_sent_count") or 0),
                "opens": int(a.get("open_count") or 0),
                "replies": int(a.get("reply_count") or 0),
                "bounces": int(a.get("bounced_count") or 0),
            })
        except Exception as e:
            out.append({"touch": n, "error": str(e)[:200]})
    return {"campaigns": out}


def tool_get_inbox_health() -> dict:
    t1 = _instantly("GET", f"/campaigns/{TOUCHES['touch_1']}")
    rows = []
    for em in t1.get("email_list", []) or []:
        try:
            a = _instantly("GET", f"/accounts/{urllib.parse.quote(em)}")
            rows.append({
                "email": em,
                "status": a.get("status"),
                "warmup_status": a.get("warmup_status"),
                "warmup_score": a.get("warmup_score"),
                "daily_limit": a.get("daily_limit"),
            })
        except Exception as e:
            rows.append({"email": em, "error": str(e)[:160]})
    return {"inboxes": rows}


def tool_get_inbox_detail(email: str) -> dict:
    try:
        a = _instantly("GET", f"/accounts/{urllib.parse.quote(email)}")
        return {"inbox": a}
    except Exception as e:
        return {"error": str(e)[:300]}


def tool_find_lead(email: str) -> dict:
    for n in (1, 2, 3, 4):
        cid = TOUCHES[f"touch_{n}"]
        try:
            r = _instantly("POST", "/leads/list", body={"campaign": cid, "search": email, "limit": 5})
            items = r.get("items") or []
            for item in items:
                if (item.get("email") or "").lower() == email.lower():
                    return {
                        "found_in": f"Touch {n}",
                        "email": item.get("email"),
                        "first_name": item.get("first_name"),
                        "last_name": item.get("last_name"),
                        "company_name": item.get("company_name"),
                        "status": item.get("status"),
                        "interest_status": item.get("interest_status"),
                        "email_open_count": item.get("email_open_count"),
                        "email_reply_count": item.get("email_reply_count"),
                    }
        except Exception:
            continue
    return {"error": f"lead {email} not found in any touch"}


def tool_get_recent_replies(limit: int = 10) -> dict:
    limit = min(max(int(limit), 1), 25)
    replies = []
    for n in (1, 2, 3, 4):
        cid = TOUCHES[f"touch_{n}"]
        try:
            r = _instantly("POST", "/leads/list", body={
                "campaign": cid,
                "limit": limit,
                "filter": {"interest_status": [1, 2, 3]},  # interested / meeting / not interested
            })
            for item in r.get("items") or []:
                replies.append({
                    "touch": n,
                    "email": item.get("email"),
                    "name": f"{item.get('first_name','')} {item.get('last_name','')}".strip(),
                    "company": item.get("company_name"),
                    "interest_status": item.get("interest_status"),
                    "reply_count": item.get("email_reply_count"),
                })
        except Exception:
            continue
    return {"replies": replies[:limit], "total_found": len(replies)}


def tool_get_today_summary() -> dict:
    cs = tool_get_campaign_status()
    total = {"sent": 0, "opens": 0, "replies": 0, "bounces": 0}
    for c in cs["campaigns"]:
        if "error" in c:
            continue
        total["sent"] += c["sent"]
        total["opens"] += c["opens"]
        total["replies"] += c["replies"]
        total["bounces"] += c["bounces"]
    sent = total["sent"]
    rates = {
        "open_pct": round(100 * total["opens"] / sent, 1) if sent else 0.0,
        "reply_pct": round(100 * total["replies"] / sent, 2) if sent else 0.0,
        "bounce_pct": round(100 * total["bounces"] / sent, 2) if sent else 0.0,
    }
    return {"totals": total, "rates": rates, "per_touch": cs["campaigns"]}


TOOL_DISPATCH = {
    "get_campaign_status": lambda **_: tool_get_campaign_status(),
    "get_inbox_health": lambda **_: tool_get_inbox_health(),
    "get_inbox_detail": tool_get_inbox_detail,
    "find_lead": tool_find_lead,
    "get_recent_replies": tool_get_recent_replies,
    "get_today_summary": tool_get_today_summary,
}


# ---------- Claude conversation loop -------------------------------------

SYSTEM_PROMPT = """You are the GPF-II Campaign Employee — a real-time assistant for Granite Park Capital Fund II's outbound email campaign.

Context:
- Campaign launched Mon May 4 2026. Multi-touch architecture: 4 single-step Instantly campaigns (T1-T4) chained 3/7/7 days apart.
- 9 sending inboxes across 3 domains (granite-park-fund.com, granitehousingfund.com, granitehousingpartners.com).
- 3K-lead queue, 150 loaded per day from gpf2-monday-3k-queue.csv.
- Daily send window 08:00-17:00 ET Mon-Fri.
- Operator: Colby Watkins. Direct, no fluff. He values speed over caveats.

Your job: answer Colby's questions about campaign state using the tools provided. Be concise — Telegram, not email. Use Markdown sparingly.

Style rules:
- 1-3 sentences when possible. Short bullet lists OK.
- Lead with the answer, then one supporting detail if needed.
- If asked something tools can't answer, say so plainly.
- Never invent numbers. Only report what the tools return.
- For unfamiliar requests: ask one clarifying question, don't guess.
"""


def _sdk_create(messages: list, tools: list, system: str) -> object:
    return CLIENT.messages.create(
        model=MODEL,
        max_tokens=2048,
        system=system,
        tools=tools,
        messages=messages,
    )


def claude_respond(user_message: str) -> str:
    messages = [{"role": "user", "content": user_message}]
    for _step in range(8):
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        future = executor.submit(_sdk_create, messages, TOOLS, SYSTEM_PROMPT)
        try:
            resp = future.result(timeout=90)
        except concurrent.futures.TimeoutError:
            executor.shutdown(wait=False)
            return "⚠️ Claude timed out (>90s). Try again."
        executor.shutdown(wait=False)
        if resp.stop_reason == "tool_use":
            tool_results: list[dict] = []
            assistant_blocks = []
            for block in resp.content:
                assistant_blocks.append(block.model_dump() if hasattr(block, "model_dump") else block.dict())
                if getattr(block, "type", None) == "tool_use":
                    fn = TOOL_DISPATCH.get(block.name)
                    if not fn:
                        result_text = json.dumps({"error": f"unknown tool {block.name}"})
                    else:
                        try:
                            result = fn(**block.input)
                            result_text = json.dumps(result, default=str)[:8000]
                        except Exception as e:
                            result_text = json.dumps({"error": str(e)[:300]})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result_text,
                    })
            messages.append({"role": "assistant", "content": assistant_blocks})
            messages.append({"role": "user", "content": tool_results})
            continue
        text_parts = [b.text for b in resp.content if getattr(b, "type", None) == "text"]
        return "\n".join(text_parts).strip() or "(no response)"
    return "(tool loop exceeded — partial result)"


# ---------- Main long-poll loop ------------------------------------------

OFFSET_FILE = REPO / "data" / "gpf2-tg-offset.txt"


def _load_offset() -> int:
    try:
        return int(OFFSET_FILE.read_text().strip())
    except Exception:
        return 0


def _save_offset(offset: int) -> None:
    try:
        OFFSET_FILE.write_text(str(offset))
    except Exception:
        pass


def main() -> int:
    print(f"[{datetime.now(timezone.utc).isoformat()}] gpf2-telegram-listener START (allowed_chat={ALLOWED_CHAT_ID})", flush=True)
    tg_send("🤖 GPF-II Campaign Employee online. Ask me anything about today's send.")
    offset = _load_offset()
    consecutive_409 = 0
    _409_alerted = False
    while True:
        try:
            r = _tg("getUpdates", {"offset": offset, "timeout": 25}, timeout=35)
            consecutive_409 = 0
            _409_alerted = False
            for update in r.get("result", []) or []:
                offset = update["update_id"] + 1
                _save_offset(offset)  # persist before processing so restarts don't replay
                msg = update.get("message") or update.get("edited_message")
                if not msg:
                    continue
                cid = msg.get("chat", {}).get("id")
                text = (msg.get("text") or "").strip()
                if cid != ALLOWED_CHAT_ID:
                    print(f"DROPPED unauthorized chat={cid} text={text[:80]!r}", flush=True)
                    continue
                if not text:
                    continue
                print(f"<- {text[:200]}", flush=True)
                try:
                    answer = claude_respond(text)
                except Exception as e:
                    answer = f"⚠️ error: {str(e)[:300]}"
                print(f"-> {answer[:200]}", flush=True)
                tg_send(answer)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")
            except Exception:
                pass
            print(f"poll HTTPError {e.code}: {body[:300]}", flush=True)
            if e.code == 409:
                consecutive_409 += 1
                if consecutive_409 >= 6 and not _409_alerted:
                    _409_alerted = True
                    tg_send("⚠️ Bot stuck: another getUpdates session is active (409 loop). Kill competing process (check Mac Mini `pm2 list`) then I'll resume.")
            time.sleep(10)
        except urllib.error.URLError as e:
            print(f"poll URLError {e}", flush=True)
            time.sleep(10)
        except Exception as e:
            print(f"poll exception {type(e).__name__} {e}", flush=True)
            time.sleep(10)


if __name__ == "__main__":
    sys.exit(main())
