#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3001}"
PAYLOAD_FILE="${1:-/mithril-os/templates/delegation-contract.json}"

if [ ! -f "$PAYLOAD_FILE" ]; then
  echo "payload file not found: $PAYLOAD_FILE" >&2
  exit 1
fi

curl -sS -X POST "$API_BASE/api/delegations" \
  -H 'content-type: application/json' \
  --data-binary "@$PAYLOAD_FILE"

echo
