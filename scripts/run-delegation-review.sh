#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3001}"

curl -fsS -X POST "$API_BASE/api/delegations/review/run" -H 'content-type: application/json' -d '{}' >/tmp/mithril-delegation-review-last.json
curl -fsS "$API_BASE/api/agent-routing/insights" >/tmp/mithril-routing-insights-last.json

echo "Delegation review completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
