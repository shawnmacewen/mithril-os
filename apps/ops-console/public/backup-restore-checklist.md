# Backup Restore Checklist (Mithril-OS) — v2 minimal

Use this checklist when restoring from backup after a bad deploy, failed upgrade, or data drift.

## Scope

- Host: mini-home-lab
- Backup root: `/backup/snapshots`
- Latest symlink: `/backup/latest`
- OpenClaw data: `/home/mini-home-lab/.openclaw`
- OpenClaw compose stack: `/home/mini-home-lab/openclaw`
- Mithril repo (live): `/mithril-os`
- Home Assistant config: `/home/mini-home-lab/homelab/homeassistant/config`

---

## Canonical snapshot layout (current)

Expected inside each snapshot:

- `openclaw/.openclaw/`
- `openclaw-stack/`
- `mithril-os/repo/`
- `homeassistant/config/`
- `bw-shell/repo/`
- `railfin-io/repo/`
- `obsidian/personal-assistant/`
- `meta/backup-meta.txt`

If this layout does not exist, stop and verify backup script/version before restoring.

---

## 1) Pre-restore safety

- [ ] Identify exact snapshot and verify layout
  ```bash
  ls -lah /backup/snapshots
  readlink -f /backup/latest
  SNAP=/backup/snapshots/<SNAPSHOT_NAME>
  test -d "$SNAP/openclaw/.openclaw" && echo ok:openclaw || echo missing:openclaw
  test -d "$SNAP/mithril-os/repo" && echo ok:mithril || echo missing:mithril
  test -d "$SNAP/homeassistant/config" && echo ok:ha || echo missing:ha
  ```

- [ ] Decide restore mode
  - Targeted restore (recommended)
  - Full filesystem restore (last resort)

- [ ] Stop conflicting services before file restore
  ```bash
  sudo systemctl stop docker || true
  sudo systemctl --user stop openclaw-gateway.service || true
  sudo systemctl --user disable openclaw-gateway.service || true
  ```

---

## 2) Targeted restore (recommended)

Restore only critical paths from canonical layout:

```bash
SNAP=/backup/latest

sudo rsync -aHAX --delete "$SNAP/openclaw/.openclaw/" /home/mini-home-lab/.openclaw/
sudo rsync -aHAX --delete "$SNAP/openclaw-stack/" /home/mini-home-lab/openclaw/
sudo rsync -aHAX --delete "$SNAP/mithril-os/repo/" /mithril-os/
sudo rsync -aHAX --delete "$SNAP/homeassistant/config/" /home/mini-home-lab/homelab/homeassistant/config/
```

If restoring a specific snapshot, replace `/backup/latest` with `/backup/snapshots/<SNAPSHOT_NAME>`.

---

## 3) Ownership + permissions

```bash
sudo chown -R mini-home-lab:mini-home-lab /home/mini-home-lab/.openclaw
sudo chown -R mini-home-lab:mini-home-lab /home/mini-home-lab/openclaw
sudo chown -R mini-home-lab:mini-home-lab /mithril-os
sudo chown -R mini-home-lab:mini-home-lab /home/mini-home-lab/homelab/homeassistant/config
```

---

## 4) Start services after restore

```bash
sudo systemctl start docker
cd /home/mini-home-lab/openclaw
docker compose up -d --force-recreate openclaw-gateway socat-proxy
```

---

## 5) OAuth/auth sanity (post-restore)

If model auth fails after restore, enforce correct home path and verify active auth store:

```bash
OPENCLAW_HOME=/home/mini-home-lab/.openclaw openclaw models auth login --provider openai-codex || true

test -f /home/mini-home-lab/.openclaw/agents/main/agent/auth-profiles.json && echo ok:auth-store
```

If nested path exists, merge profile into active auth store:

```bash
test -f /home/mini-home-lab/.openclaw/.openclaw/agents/main/agent/auth-profiles.json && echo warn:nested-auth-found
```

---

## 6) Post-restore validation

- [ ] OpenClaw + HA status
  ```bash
  curl -sS http://192.168.2.58:3001/api/status | jq .
  ```

- [ ] Backups API readable
  ```bash
  curl -sS http://192.168.2.58:3001/api/backups/status | jq .
  ```

- [ ] Verify compose mounts
  ```bash
  docker inspect openclaw-gateway --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
  ```

- [ ] Verify gateway port owner (no legacy user service conflict)
  ```bash
  lsof -i :18789 || true
  systemctl --user list-units | grep openclaw || true
  ```

---

## 7) Optional full restore (last resort)

```bash
sudo rsync -aHAX --delete /backup/latest/ /
```

Only use this when targeted restore is insufficient.
