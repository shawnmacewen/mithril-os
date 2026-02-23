#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${1:-https://github.com/OddEye-Agent/mithril-os.git}"
REPO_DIR="${2:-/mithril-os}"

echo "== Git Auth Check =="
echo "repo_url=$REPO_URL"
echo "repo_dir=$REPO_DIR"
echo

echo "[1/3] Host credential files"
ls -la "$HOME/.git-credentials" 2>/dev/null || echo "warn: host ~/.git-credentials missing"
ls -la /home/mini-home-lab/.openclaw/.git-credentials 2>/dev/null || echo "warn: /home/mini-home-lab/.openclaw/.git-credentials missing"
echo

echo "[2/3] Host auth test"
if git ls-remote --heads "$REPO_URL" >/tmp/git-auth-host.out 2>/tmp/git-auth-host.err; then
  echo "ok: host git auth works"
  head -n 3 /tmp/git-auth-host.out || true
else
  echo "fail: host git auth failed"
  cat /tmp/git-auth-host.err || true
fi
echo

echo "[3/3] Container auth test (openclaw-gateway)"
if ! command -v docker >/dev/null 2>&1; then
  echo "warn: docker command not available in this shell"
elif docker ps --format '{{.Names}}' | grep -qx 'openclaw-gateway'; then
  if docker exec openclaw-gateway sh -lc "git -C /home/node/.openclaw/workspace ls-remote origin refs/heads/main" >/tmp/git-auth-container.out 2>/tmp/git-auth-container.err; then
    echo "ok: container git auth works"
    cat /tmp/git-auth-container.out || true
  else
    echo "fail: container git auth failed"
    cat /tmp/git-auth-container.err || true
  fi
else
  echo "warn: openclaw-gateway container not running"
fi

echo
echo "Done."
