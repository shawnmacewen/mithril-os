#!/usr/bin/env bash
set -euo pipefail

CANDIDATE_HOMES=(
  "/home/mini-home-lab/.openclaw"
  "/home/node/.openclaw"
)

ACTIVE_HOME=""
ACTIVE_AUTH=""
for h in "${CANDIDATE_HOMES[@]}"; do
  if [ -f "$h/agents/main/agent/auth-profiles.json" ]; then
    ACTIVE_HOME="$h"
    ACTIVE_AUTH="$h/agents/main/agent/auth-profiles.json"
    break
  fi
done

if [ -z "$ACTIVE_HOME" ]; then
  echo "[fail] no active auth store found in expected homes: ${CANDIDATE_HOMES[*]}"
  exit 1
fi

NESTED_AUTH="$ACTIVE_HOME/.openclaw/agents/main/agent/auth-profiles.json"

echo "[auth-check] active OPENCLAW_HOME: $ACTIVE_HOME"
echo "[ok] active auth store exists: $ACTIVE_AUTH"

if [ -f "$NESTED_AUTH" ]; then
  echo "[warn] nested auth store detected: $NESTED_AUTH"
  echo "[warn] this may indicate OAuth wrote to the wrong home path"
else
  echo "[ok] no nested auth store detected"
fi

python3 - <<'PY'
import json, os
homes=['/home/mini-home-lab/.openclaw','/home/node/.openclaw']
active=None
for h in homes:
    p=f'{h}/agents/main/agent/auth-profiles.json'
    if os.path.exists(p):
        active=h
        break
if not active:
    print('[fail] no readable auth-profiles.json in candidate homes')
    raise SystemExit(1)

active_path=f'{active}/agents/main/agent/auth-profiles.json'
nested_path=f'{active}/.openclaw/agents/main/agent/auth-profiles.json'

def keys(path):
    try:
        return sorted(json.load(open(path)).keys())
    except Exception:
        return []

print('[info] active providers:', ', '.join(keys(active_path)) or '(none)')
if os.path.exists(nested_path):
    print('[info] nested providers:', ', '.join(keys(nested_path)) or '(none)')
PY

echo "[hint] when re-authenticating, always run with explicit home:"
echo "       OPENCLAW_HOME=$ACTIVE_HOME openclaw models auth login --provider <provider>"
