# OpenClaw Upgrade Checklist (Docker Compose)

Use this checklist every time you upgrade OpenClaw from the Docker repo.

## Scope

- Host: mini-home-lab
- Compose project: `/home/mini-home-lab/openclaw`
- Mithril-OS repo: `/mithril-os`

---

## 1) Preflight (before upgrade)

- [ ] Confirm backup is recent
  ```bash
  sudo systemctl start mithril-backup.service
  curl -sS http://192.168.2.58:3001/api/backups/status | jq .
  ```

- [ ] Confirm services healthy
  ```bash
  docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
  curl -sS http://192.168.2.58:3001/api/status | jq .
  ```

- [ ] Confirm override file exists (local policy)
  ```bash
  test -f /home/mini-home-lab/openclaw/docker-compose.override.yml && echo "override present"
  ```

---

## 2) Required local mounts (must persist)

`docker-compose.override.yml` should include:

- `/home/mini-home-lab/openclaw:/host/openclaw`
- `/mithril-os:/mithril-os`
- `/home/mini-home-lab/.openclaw/workspace/work/bw-shell:/work/bw-shell`
- `/home/mini-home-lab/work/railfin.io:/work/railfin.io`
- `/home/mini-home-lab/homelab/homeassistant/config:/homeassistant/config`

Validate rendered compose:

```bash
cd /home/mini-home-lab/openclaw
docker compose config >/tmp/compose.rendered.yml && echo OK
```

---

## 3) Upgrade (safe path)

- [ ] Run safe upgrade script
  ```bash
  /home/mini-home-lab/openclaw/oc-upgrade-safe.sh
  ```

- [ ] If needed, force recreate
  ```bash
  cd /home/mini-home-lab/openclaw
  docker compose up -d --force-recreate openclaw-gateway socat-proxy
  ```

---

## 4) Post-upgrade validation

- [ ] Run automated checks
  ```bash
  /home/mini-home-lab/openclaw/oc-post-upgrade-check.sh
  ```

- [ ] Verify key mounts are active
  ```bash
  docker inspect openclaw-gateway --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}' | grep -E '/host/openclaw|/mithril-os|/\.openclaw/workspace/work/bw-shell|/work/railfin.io|/homeassistant/config'
  ```

- [ ] Verify API health
  ```bash
  curl -sS http://192.168.2.58:3001/api/status | jq .
  ```

---

## 5) GitHub auth recovery (if git breaks)

Symptoms: `fatal: Authentication failed` / `could not read Username`

- [ ] Re-sync container git auth
  ```bash
  export GITHUB_TOKEN='YOUR_TOKEN'
  /home/mini-home-lab/openclaw/oc-github-auth-sync.sh
  unset GITHUB_TOKEN
  ```

- [ ] Validate from container
  ```bash
  docker exec openclaw-gateway sh -lc 'git -C /home/node/.openclaw/workspace ls-remote origin refs/heads/main'
  ```

---

## 6) Gateway UI tunnel check (optional)

```bash
ssh -N -L 62000:127.0.0.1:18790 mini-home-lab@192.168.2.58
```
Open:

`http://127.0.0.1:62000/?token=<gateway-token>`

---

## 7) Common recovery commands

### Stuck Mithril deploy lock
```bash
sudo pkill -f '/mithril-os/scripts/deploy-ops-console.sh' || true
sudo pkill -f 'flock.*ops-console' || true
sudo rm -f /tmp/mithril-ops-console-deploy.lock /var/lock/mithril-ops-console-deploy.lock || true
/mithril-os/scripts/deploy-ops-console.sh
```

### Recreate gateway+socat after bad update
```bash
cd /home/mini-home-lab/openclaw
docker compose up -d --force-recreate openclaw-gateway socat-proxy
```

---

## 8) Policy notes

- Keep local customizations in `docker-compose.override.yml`.
- Avoid editing upstream compose structure unless necessary.
- Treat `/mithril-os` as the source of truth for live Mithril changes.
- Verify live page markers after deploy before calling a change complete.
