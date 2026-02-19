#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="/backup/telemetry"
OUT_FILE="$OUT_DIR/openclaw-usage.json"
EVENTS_FILE="$OUT_DIR/openclaw-usage-events.jsonl"
mkdir -p "$OUT_DIR"

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TIMER_STATE="$(systemctl is-active openclaw-usage-collector.timer 2>/dev/null || true)"
GW_STATE="$(docker inspect -f '{{.State.Status}}' openclaw-gateway 2>/dev/null || echo unknown)"

docker logs --tail 4000 openclaw-gateway 2>&1 > /tmp/openclaw-gateway-tail.log || true

python3 - <<'PY' "/tmp/openclaw-gateway-tail.log" "$OUT_FILE" "$EVENTS_FILE" "$NOW" "$TIMER_STATE" "$GW_STATE"
import json
import re
import sys

log_path, out_path, events_path, now, timer_state, gw_state = sys.argv[1:7]

usage = {
    "inputTokens": None,
    "outputTokens": None,
    "totalTokens": None,
    "costUsd": None,
}

raw_line = None

INPUT_KEYS = {"inputtokens", "prompttokens", "input_tokens", "prompt_tokens", "input"}
OUTPUT_KEYS = {"outputtokens", "completiontokens", "output_tokens", "completion_tokens", "output"}
TOTAL_KEYS = {"totaltokens", "total_tokens", "total"}
COST_KEYS = {"costusd", "cost_usd", "cost", "estimatedcostusd", "estimated_cost_usd"}


def normalize_key(k: str) -> str:
    return re.sub(r"[^a-z0-9_]", "", k.lower())


def extract_from_obj(obj):
    found = {"in": None, "out": None, "tot": None, "cost": None}

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                nk = normalize_key(str(k))
                if isinstance(v, (int, float, str)):
                    sv = str(v)
                    num = None
                    try:
                        if isinstance(v, (int, float)):
                            num = float(v)
                        elif re.fullmatch(r"\d+(?:\.\d+)?", sv.strip()):
                            num = float(sv.strip())
                    except Exception:
                        num = None

                    if num is not None:
                        if nk in INPUT_KEYS and found["in"] is None:
                            found["in"] = int(num)
                        elif nk in OUTPUT_KEYS and found["out"] is None:
                            found["out"] = int(num)
                        elif nk in TOTAL_KEYS and found["tot"] is None:
                            found["tot"] = int(num)
                        elif nk in COST_KEYS and found["cost"] is None:
                            found["cost"] = float(num)
                walk(v)
        elif isinstance(x, list):
            for i in x:
                walk(i)

    walk(obj)
    return found


def extract_from_text(line):
    out = {}
    patterns = {
        "in": r"(?:input|prompt)[_ ]?tokens?[:=]\s*(\d+)",
        "out": r"(?:output|completion)[_ ]?tokens?[:=]\s*(\d+)",
        "tot": r"total[_ ]?tokens?[:=]\s*(\d+)",
        "cost": r"(?:cost(?:_usd| usd)?|estimated[_ ]?cost(?:_usd)?)[:=]\s*([0-9]+(?:\.[0-9]+)?)",
    }
    for k, p in patterns.items():
        m = re.search(p, line, re.I)
        if m:
            out[k] = float(m.group(1)) if k == "cost" else int(m.group(1))
    return out


try:
    with open(log_path, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
except Exception:
    lines = []

for line in reversed(lines):
    s = line.strip()
    if not s:
        continue

    text_hits = extract_from_text(s)

    obj_hits = {}
    try:
        o = json.loads(s)
        obj_hits = extract_from_obj(o)
    except Exception:
        obj_hits = {}

    merged = {
        "in": obj_hits.get("in") if obj_hits.get("in") is not None else text_hits.get("in"),
        "out": obj_hits.get("out") if obj_hits.get("out") is not None else text_hits.get("out"),
        "tot": obj_hits.get("tot") if obj_hits.get("tot") is not None else text_hits.get("tot"),
        "cost": obj_hits.get("cost") if obj_hits.get("cost") is not None else text_hits.get("cost"),
    }

    if any(v is not None for v in merged.values()):
        usage["inputTokens"] = merged["in"]
        usage["outputTokens"] = merged["out"]
        usage["totalTokens"] = merged["tot"]
        usage["costUsd"] = merged["cost"]
        raw_line = s[:1600]
        break

if usage["totalTokens"] is None:
    a = usage["inputTokens"] or 0
    b = usage["outputTokens"] or 0
    usage["totalTokens"] = (a + b) if (a + b) > 0 else None

payload = {
    "ok": True,
    "source": "gateway-logs-parser-v3",
    "capturedAt": now,
    "usage": usage,
    "collector": {
        "timerState": timer_state,
        "gatewayContainerState": gw_state,
        "rawLineFound": bool(raw_line),
    },
    "note": "If token fields remain null, current logs do not include token/cost markers.",
}

if raw_line:
    payload["rawLine"] = raw_line

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(payload, f)

with open(events_path, "a", encoding="utf-8") as f:
    f.write(json.dumps(payload) + "\n")
PY
