#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="/backup/telemetry"
OUT_FILE="$OUT_DIR/openclaw-usage.json"
mkdir -p "$OUT_DIR"

# Best effort: capture built-in session telemetry
RAW=""
if command -v openclaw >/dev/null 2>&1; then
  RAW="$(openclaw session status --json 2>/dev/null || true)"
  if [ -z "$RAW" ]; then
    RAW="$(openclaw status --json 2>/dev/null || true)"
  fi
fi

if [ -z "$RAW" ]; then
  # leave previous data untouched but emit marker file for diagnostics
  cat > "$OUT_FILE" <<'JSON'
{"ok":false,"error":"openclaw telemetry command unavailable on host"}
JSON
  exit 0
fi

# validate json before writing
python3 - <<'PY' "$RAW" "$OUT_FILE"
import json,sys
raw=sys.argv[1]
out=sys.argv[2]
obj=json.loads(raw)
payload={
  "ok": True,
  "capturedAt": __import__('datetime').datetime.utcnow().isoformat()+"Z",
  "usage": obj.get("usage") if isinstance(obj,dict) else obj,
  "raw": obj,
}
with open(out,'w',encoding='utf-8') as f:
  json.dump(payload,f)
PY
