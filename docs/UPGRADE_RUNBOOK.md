# OpenClaw + Mithril-OS Upgrade Runbook (Docker Compose)

This runbook is for the mini-pc setup where OpenClaw is managed via Docker Compose.

## Canonical Paths

- OpenClaw compose project: `/home/mini-home-lab/openclaw`
- OpenClaw data/config/workspace: `/home/mini-home-lab/.openclaw`
- Mithril-OS live repo: `/mithril-os`
- Ops Console app: `/mithril-os/apps/ops-console`

## Source-of-truth Rules

1. Use Compose from `/home/mini-home-lab/openclaw` only.
2. Keep custom settings in `docker-compose.override.yml` (not only upstream compose).
3. Live Mithril edits happen in `/mithril-os`.
4. Never call upgrade complete until post-upgrade checks pass.

---

## Preflight (Required)

```bash
sudo systemctl start mithril-backup.service
curl -sS http://192.168.2.58:3001/api/backups/status | jq .
```

Capture pre-upgrade snapshot:

```bash
cd /home/mini-home-lab/openclaw
docker compose config > /tmp/openclaw-compose.pre.yml
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
curl -sS http://192.168.2.58:3001/api/status | jq .
```

---

## Upgrade (Preferred)

```bash
/home/mini-home-lab/openclaw/oc-upgrade-safe.sh
```

---

## Post-upgrade Validation (Required)

```bash
/home/mini-home-lab/openclaw/oc-post-upgrade-check.sh
```

Also compare compose render:

```bash
cd /home/mini-home-lab/openclaw
docker compose config > /tmp/openclaw-compose.post.yml
diff -u /tmp/openclaw-compose.pre.yml /tmp/openclaw-compose.post.yml | less
```

---

## GitHub Auth Re-sync (If Git breaks)

```bash
export GITHUB_TOKEN='YOUR_TOKEN'
/home/mini-home-lab/openclaw/oc-github-auth-sync.sh
unset GITHUB_TOKEN
```

Validation:

```bash
docker exec openclaw-gateway sh -lc 'git -C /home/node/.openclaw/workspace ls-remote origin refs/heads/main'
```

---

## Recovery: Stuck Mithril Deploy Lock

```bash
sudo pkill -f '/mithril-os/scripts/deploy-ops-console.sh' || true
sudo pkill -f 'flock.*ops-console' || true
sudo rm -f /tmp/mithril-ops-console-deploy.lock /var/lock/mithril-ops-console-deploy.lock || true
/mithril-os/scripts/deploy-ops-console.sh
```

---

## Rollback (Targeted)

```bash
sudo rsync -aHAX --delete /backup/latest/home/mini-home-lab/.openclaw/ /home/mini-home-lab/.openclaw/
sudo rsync -aHAX --delete /backup/latest/mithril-os/ /mithril-os/
sudo rsync -aHAX --delete /backup/latest/home/mini-home-lab/homelab/homeassistant/config/ /home/mini-home-lab/homelab/homeassistant/config/
```
