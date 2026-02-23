# Backup Restore Checklist (Mithril-OS)

Use this checklist when restoring from backup after a bad deploy, failed upgrade, or data drift.

## Scope

- Host: mini-home-lab
- Backup root: `/backup/snapshots`
- Latest symlink: `/backup/latest`
- OpenClaw data: `/home/mini-home-lab/.openclaw`
- Mithril repo: `/mithril-os`
- Home Assistant config: `/home/mini-home-lab/homelab/homeassistant/config`

---

## 1) Pre-restore safety

- [ ] Identify exact snapshot to restore
  ```bash
  ls -lah /backup/snapshots
  readlink -f /backup/latest
  ```

- [ ] Decide restore mode
  - Targeted restore (recommended)
  - Full filesystem restore (last resort)

- [ ] Stop services before file restore
  ```bash
  sudo systemctl stop openclaw-gateway.service || true
  sudo systemctl stop mithril-ops-console.service || true
  sudo systemctl stop docker || true
  ```

---

## 2) Targeted restore (recommended)

Restore only critical paths:

```bash
sudo rsync -aHAX --delete /backup/latest/home/mini-home-lab/.openclaw/ /home/mini-home-lab/.openclaw/
sudo rsync -aHAX --delete /backup/latest/mithril-os/ /mithril-os/
sudo rsync -aHAX --delete /backup/latest/home/mini-home-lab/homelab/homeassistant/config/ /home/mini-home-lab/homelab/homeassistant/config/
```

If restoring a specific snapshot, replace `/backup/latest` with `/backup/snapshots/<SNAPSHOT_NAME>`.

---

## 3) Ownership + permissions

```bash
sudo chown -R mini-home-lab:mini-home-lab /home/mini-home-lab/.openclaw
sudo chown -R mini-home-lab:mini-home-lab /mithril-os
sudo chown -R mini-home-lab:mini-home-lab /home/mini-home-lab/homelab/homeassistant/config
```

---

## 4) Start services after restore

```bash
sudo systemctl start docker
sudo systemctl start openclaw-gateway.service || true
sudo systemctl start mithril-ops-console.service || true
```

If using compose-managed gateway:

```bash
cd /home/mini-home-lab/openclaw
docker compose up -d --force-recreate openclaw-gateway socat-proxy
```

---

## 5) Post-restore validation

- [ ] OpenClaw + HA status
  ```bash
  curl -sS http://192.168.2.58:3001/api/status | jq .
  ```

- [ ] Backups page/API still readable
  ```bash
  curl -sS http://192.168.2.58:3001/api/backups/status | jq .
  ```

- [ ] Verify compose mounts (if dockerized gateway)
  ```bash
  docker inspect openclaw-gateway --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
  ```

- [ ] Verify git auth in container (if needed)
  ```bash
  docker exec openclaw-gateway sh -lc 'git -C /home/node/.openclaw/workspace ls-remote origin refs/heads/main'
  ```

---

## 6) Optional full restore (last resort)

```bash
sudo rsync -aHAX --delete /backup/latest/ /
```

Only use this when targeted restore is insufficient.

---

## 7) Optional offsite replication (Synology)

One trigger, separate target folders:

```bash
OFFSITE_SYNC=1 \
SYN_HOST=<synology-ip> \
SYN_USER=<backup-user> \
SYN_ROOT=/volume1/backups \
/mithril-os/scripts/backup-mithril.sh
```

This calls:
- `/mithril-os/scripts/backup-offsite-synology.sh`

Targets are independent under Synology root:
- `openclaw/`
- `mithril-os/`
- `bw-shell/`
- `railfin-io/`
- `homeassistant/`
- `productivity-vault/`

## 8) Common recovery commands

### Stuck Mithril deploy lock
```bash
sudo pkill -f '/mithril-os/scripts/deploy-ops-console.sh' || true
sudo pkill -f 'flock.*ops-console' || true
sudo rm -f /tmp/mithril-ops-console-deploy.lock /var/lock/mithril-ops-console-deploy.lock || true
/mithril-os/scripts/deploy-ops-console.sh
```

### Re-sync GitHub auth in container
```bash
export GITHUB_TOKEN='YOUR_TOKEN'
/home/mini-home-lab/openclaw/oc-github-auth-sync.sh
unset GITHUB_TOKEN
```
