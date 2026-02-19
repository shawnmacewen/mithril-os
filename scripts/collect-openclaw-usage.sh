#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="/backup/telemetry"
OUT_FILE="$OUT_DIR/openclaw-usage.json"
mkdir -p "$OUT_DIR"

docker logs --tail 2500 openclaw-gateway 2>&1 > /tmp/openclaw-gateway-tail.log || true

python3 - <<'PY' "/tmp/openclaw-gateway-tail.log" "$OUT_FILE"
import json
import re
import sys
import datetime

log_path = sys.argv[1]
out_path = sys.argv[2]

best = None

with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
    lines = f.readlines()

for line in reversed(lines):
    s = line.strip()
    if not s:
        continue

    in_tok = re.search(r'input[_ ]?tokens?[:=]\s*(\d+)', s, re.I)
    out_tok = re.search(r'output[_ ]?tokens?[:=]\s*(\d+)', s, re.I)
    tot_tok = re.search(r'total[_ ]?tokens?[:=]\s*(\d+)', s, re.I)
    cost = re.search(r'cost(?:_usd| usd)?[:=]\s*([0-9]+(?:\.[0-9]+)?)', s, re.I)

    if in_tok or out_tok or tot_tok or cost:
        best = {
            "inputTokens": int(in_tok.group(1)) if in_tok else None,
            "outputTokens": int(out_tok.group(1)) if out_tok else None,
            "totalTokens": int(tot_tok.group(1)) if tot_tok else None,
            "costUsd": float(cost.group(1)) if cost else None,
            "rawLine": s[:1200],
        }
        break

if best is None:
    payload = {
        "ok": False,
        "source": "gateway-logs",
        "error": "no token/cost markers found in recent logs",
    }
else:
    if best["totalTokens"] is None:
        a = best["inputTokens"] or 0
        b = best["outputTokens"] or 0
        best["totalTokens"] = (a + b) if (a + b) > 0 else None

    payload = {
        "ok": True,
        "source": "gateway-logs",
        "capturedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "usage": best,
    }

with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(payload, f)
PY
