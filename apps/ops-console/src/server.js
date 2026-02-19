import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import path from "path";
import net from "net";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const exec = promisify(execCb);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const PORT = Number(process.env.PORT || 3001);
const OPENCLAW_CONFIG = process.env.OPENCLAW_CONFIG || "/home/mini-home-lab/.openclaw/openclaw.json";
const OPENCLAW_LOG_FILE = process.env.OPENCLAW_LOG_FILE || "";
const HA_URL = process.env.HA_URL || "http://192.168.2.58:8123";
const HA_TOKEN = process.env.HA_TOKEN || "";
const WATCHERS_REGISTRY = process.env.WATCHERS_REGISTRY || "/mithril-os/watchers/watchers.json";
const WATCHERS_STATE_DIR = process.env.WATCHERS_STATE_DIR || "/mithril-os/watchers/state";
const OPS_REPO_DIR = process.env.OPS_REPO_DIR || "/mithril-os";
const OPS_APP_DIR = process.env.OPS_APP_DIR || "/mithril-os/apps/ops-console";
const OPS_ENV_FILE = process.env.OPS_ENV_FILE || "/mithril-os/apps/ops-console/.env";
const AGENTS_ROOT = process.env.AGENTS_ROOT || "/home/mini-home-lab/.openclaw/agents";
const AGENTS_ROOT_FALLBACK = "/home/node/.openclaw/agents";

app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

function tcpCheck(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok, error = null) => {
      socket.destroy();
      resolve({ ok, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (e) => done(false, e.message));
    socket.connect(port, host);
  });
}

async function shell(command, timeout = 4000) {
  try {
    const { stdout, stderr } = await exec(command, { timeout });
    return { ok: true, stdout, stderr, command };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || "",
      stderr: error.stderr || String(error.message || error),
      command,
    };
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readConfig() {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG, "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, parsed };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function dockerPs() {
  const result = await shell("docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'", 3000);
  if (!result.ok) return { ok: false, error: result.stderr, rows: [] };

  const rows = result.stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, image, status, ports] = line.split("|");
      return { name, image, status, ports };
    });

  return { ok: true, rows };
}

async function getGatewayLogPath() {
  if (OPENCLAW_LOG_FILE) return OPENCLAW_LOG_FILE;
  try {
    const logDir = "/tmp/openclaw";
    const files = await fs.readdir(logDir);
    const logs = files.filter((f) => /^openclaw-\d{4}-\d{2}-\d{2}\.log/.test(f));
    logs.sort();
    if (!logs.length) return null;
    return path.join(logDir, logs[logs.length - 1]);
  } catch {
    return null;
  }
}

function parseGatewayLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    const ts = obj.time || obj._meta?.date || null;
    const level = obj._meta?.logLevelName || "INFO";
    const text = Object.entries(obj)
      .filter(([k]) => !k.startsWith("_"))
      .map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" ");
    return { timestamp: ts, level: String(level).toUpperCase(), text, raw: trimmed };
  } catch {
    const levelMatch = trimmed.match(/\b(ERROR|WARN|INFO|DEBUG)\b/i);
    return {
      timestamp: null,
      level: (levelMatch?.[1] || "INFO").toUpperCase(),
      text: trimmed,
      raw: trimmed,
    };
  }
}

async function getGatewayLogRows({ limit = 200, level = "", q = "" }) {
  const filePath = await getGatewayLogPath();
  if (!filePath) return { ok: false, error: "No log file path available", rows: [] };

  const safeLimit = Math.max(20, Math.min(Number(limit) || 200, 1000));
  const tailed = await shell(`tail -n ${safeLimit} ${JSON.stringify(filePath)}`, 2500);
  if (!tailed.ok) return { ok: false, error: tailed.stderr, rows: [] };

  const rows = tailed.stdout
    .split("\n")
    .map(parseGatewayLogLine)
    .filter(Boolean)
    .filter((r) => (level ? r.level === level.toUpperCase() : true))
    .filter((r) => (q ? r.text.toLowerCase().includes(q.toLowerCase()) : true));

  return { ok: true, filePath, rows };
}

async function getStatusPayload() {
  const cfg = await readConfig();
  const gw = await tcpCheck("127.0.0.1", 18789);

  let ha = { ok: false, http: null, error: "No token configured" };
  if (HA_TOKEN) {
    try {
      const r = await fetch(`${HA_URL}/api/`, {
        headers: { Authorization: `Bearer ${HA_TOKEN}` },
      });
      ha = { ok: r.ok, http: r.status, error: r.ok ? null : `HTTP ${r.status}` };
    } catch (e) {
      ha = { ok: false, http: null, error: String(e.message || e) };
    }
  }

  const model = cfg.ok ? cfg.parsed?.agents?.defaults?.model?.primary || null : null;
  const bindings = cfg.ok ? (cfg.parsed?.bindings || []).length : 0;
  const channels = cfg.ok ? Object.keys(cfg.parsed?.channels || {}) : [];

  return {
    timestamp: new Date().toISOString(),
    openclaw: {
      configPath: OPENCLAW_CONFIG,
      configReadable: cfg.ok,
      configError: cfg.ok ? null : cfg.error,
      gatewayTcp18789: gw,
      model,
      bindingCount: bindings,
      channels,
      execSecurity: cfg.ok ? cfg.parsed?.tools?.exec?.security || null : null,
      execAsk: cfg.ok ? cfg.parsed?.tools?.exec?.ask || null : null,
    },
    homeAssistant: {
      url: HA_URL,
      tokenConfigured: Boolean(HA_TOKEN),
      api: ha,
    },
  };
}

async function getWatchersStatus() {
  const registry = (await readJsonIfExists(WATCHERS_REGISTRY)) || [];
  const rows = [];

  for (const w of registry) {
    let running = false;
    let processInfo = "";

    const p = await shell(`pgrep -af ${JSON.stringify(w.script)} || true`, 1500);
    const lines = p.stdout.trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      running = true;
      processInfo = lines[0];
    }

    const statePath = path.join(WATCHERS_STATE_DIR, `${w.id}.json`);
    const state = await readJsonIfExists(statePath);

    let systemdActive = "unknown";
    if (w.systemdService) {
      const s = await shell(`systemctl is-active ${w.systemdService} || true`, 1500);
      systemdActive = s.stdout.trim() || "unknown";
    }

    rows.push({
      ...w,
      running,
      processInfo,
      systemdActive,
      state: state || null,
      effectiveIntervalSeconds: state?.intervalSeconds || w.defaultIntervalSeconds || null,
      lastUpdatedAt: state?.updatedAt || null,
    });
  }

  return { ok: true, rows, registryPath: WATCHERS_REGISTRY, stateDir: WATCHERS_STATE_DIR };
}

async function runWatcherAction(id, action) {
  const registry = (await readJsonIfExists(WATCHERS_REGISTRY)) || [];
  const watcher = registry.find((w) => w.id === id);
  if (!watcher) return { ok: false, error: `Watcher not found: ${id}` };

  const interval = watcher.defaultIntervalSeconds || 2;
  const quotedScript = JSON.stringify(watcher.script);

  if (watcher.systemdService) {
    const cmd =
      action === "start"
        ? `sudo -n systemctl start ${watcher.systemdService}`
        : action === "stop"
          ? `sudo -n systemctl stop ${watcher.systemdService}`
          : `sudo -n systemctl restart ${watcher.systemdService}`;

    const result = await shell(cmd, 8000);
    if (result.ok) return { ok: true, mode: "systemd", action, result };
  }

  if (action === "start") {
    await shell(`nohup ${watcher.script} ${interval} >/tmp/${id}.log 2>&1 &`, 2500);
  } else if (action === "stop") {
    await shell(`pkill -f '^bash ${watcher.script}' || true`, 2500);
    await shell(`pkill -f '^${watcher.script}' || true`, 2500);
    await shell(`pkill -f ${quotedScript} || true`, 2500);
  } else {
    await shell(`pkill -f '^bash ${watcher.script}' || true`, 2500);
    await shell(`pkill -f '^${watcher.script}' || true`, 2500);
    await shell(`pkill -f ${quotedScript} || true`, 2500);
    await shell(`nohup ${watcher.script} ${interval} >/tmp/${id}.log 2>&1 &`, 2500);
  }

  return { ok: true, mode: "process", action };
}

async function getServiceHealthTable() {
  const status = await getStatusPayload();
  const docker = await dockerPs();
  const watchers = await getWatchersStatus();

  const rows = [
    {
      service: "OpenClaw Gateway",
      status: status.openclaw.gatewayTcp18789.ok ? "healthy" : "down",
      detail: status.openclaw.gatewayTcp18789.ok ? "TCP 18789 reachable" : status.openclaw.gatewayTcp18789.error,
    },
    {
      service: "Home Assistant API",
      status: status.homeAssistant.api.ok ? "healthy" : "degraded",
      detail: status.homeAssistant.api.ok ? "API responding" : status.homeAssistant.api.error,
    },
    {
      service: "Ops Console",
      status: "healthy",
      detail: `Listening on :${PORT}`,
    },
    {
      service: "Watcher: ops-console",
      status: watchers.rows?.[0]?.running ? "healthy" : "down",
      detail: watchers.rows?.[0]?.running
        ? `interval=${watchers.rows?.[0]?.effectiveIntervalSeconds || "?"}s`
        : "not running",
    },
  ];

  return {
    ok: true,
    timestamp: new Date().toISOString(),
    rows,
    docker,
  };
}

async function getConfigDiagnostics() {
  const keys = [
    "PORT",
    "OPENCLAW_CONFIG",
    "OPENCLAW_LOG_FILE",
    "WATCHERS_REGISTRY",
    "WATCHERS_STATE_DIR",
    "HA_URL",
    "HA_TOKEN",
  ];

  let envRaw = "";
  try {
    envRaw = await fs.readFile(OPS_ENV_FILE, "utf8");
  } catch {
    return { ok: false, error: `.env not found at ${OPS_ENV_FILE}` };
  }

  const lines = envRaw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const present = Object.fromEntries(
    keys.map((k) => {
      const line = lines.find((l) => l.startsWith(`${k}=`));
      const value = line ? line.slice(k.length + 1) : "";
      return [k, Boolean(line && value.length > 0)];
    }),
  );

  return {
    ok: true,
    envPath: OPS_ENV_FILE,
    present,
    missing: keys.filter((k) => !present[k]),
  };
}

async function getAgentMdIndex() {
  const roots = [AGENTS_ROOT, AGENTS_ROOT_FALLBACK];
  const cfg = await readConfig();
  const bindingIds = cfg.ok ? [...new Set((cfg.parsed?.bindings || []).map((b) => b.agentId).filter(Boolean))] : [];

  const discovered = {};
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const agentId = entry.name;
        const agentDir = path.join(root, agentId, "agent");
        let files = [];
        try {
          const kids = await fs.readdir(agentDir, { withFileTypes: true });
          files = kids
            .filter((k) => k.isFile() && k.name.toLowerCase().endsWith(".md"))
            .map((k) => k.name)
            .sort();
        } catch {
          files = [];
        }

        if (!discovered[agentId]) {
          discovered[agentId] = { agentId, root, agentDir, files };
        } else if (files.length > discovered[agentId].files.length) {
          discovered[agentId] = { agentId, root, agentDir, files };
        }
      }
    } catch {
      // ignore missing roots
    }
  }

  // Ensure known binding agent IDs are represented even if no md files found yet.
  for (const agentId of bindingIds) {
    if (!discovered[agentId]) {
      discovered[agentId] = { agentId, root: null, agentDir: null, files: [] };
    }
  }

  return {
    ok: true,
    roots,
    rows: Object.values(discovered).sort((a, b) => a.agentId.localeCompare(b.agentId)),
  };
}

async function getAuditTrail() {
  const branch = await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} rev-parse --abbrev-ref HEAD`, 2000);
  const commit = await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} log -1 --pretty=format:'%H|%h|%s|%cI'`, 2000);
  const remote = await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} remote get-url origin`, 2000);

  let parsedCommit = null;
  if (commit.ok && commit.stdout.includes("|")) {
    const [full, short, message, iso] = commit.stdout.split("|");
    parsedCommit = { full, short, message, date: iso };
  }

  return {
    ok: true,
    repoDir: OPS_REPO_DIR,
    branch: branch.ok ? branch.stdout.trim() : null,
    remote: remote.ok ? remote.stdout.trim() : null,
    latestCommit: parsedCommit,
  };
}

app.get("/api/status", async (_req, res) => {
  res.json(await getStatusPayload());
});

app.get("/api/openclaw/overview", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const parsed = cfg.parsed;
  res.json({
    ok: true,
    model: parsed?.agents?.defaults?.model?.primary || null,
    channels: parsed?.channels || {},
    bindings: parsed?.bindings || [],
    gateway: parsed?.gateway || {},
    exec: parsed?.tools?.exec || {},
  });
});

app.get("/api/openclaw/models", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const parsed = cfg.parsed;
  const connectedProfiles = Object.keys(parsed?.auth?.profiles || {});
  res.json({
    ok: true,
    primaryModel: parsed?.agents?.defaults?.model?.primary || null,
    connectedProfiles,
  });
});

app.get("/api/agents", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const bindings = cfg.parsed?.bindings || [];
  const uniqueAgentIds = [...new Set(bindings.map((b) => b.agentId).filter(Boolean))];

  res.json({ ok: true, agentIds: uniqueAgentIds, bindings });
});

app.get("/api/agents/files", async (_req, res) => {
  res.json(await getAgentMdIndex());
});

app.get("/api/agents/:agentId/files/:fileName", async (req, res) => {
  const agentId = String(req.params.agentId || "");
  const fileName = String(req.params.fileName || "");

  if (!/^[a-zA-Z0-9._-]+$/.test(agentId)) {
    return res.status(400).json({ ok: false, error: "Invalid agentId" });
  }
  if (!/^[a-zA-Z0-9._-]+\.md$/i.test(fileName)) {
    return res.status(400).json({ ok: false, error: "Only .md files are allowed" });
  }

  const index = await getAgentMdIndex();
  const row = index.rows.find((r) => r.agentId === agentId);
  if (!row || !row.agentDir) {
    return res.status(404).json({ ok: false, error: `Agent path not found for ${agentId}` });
  }
  if (!row.files.includes(fileName)) {
    return res.status(404).json({ ok: false, error: `${fileName} not found for ${agentId}` });
  }

  const fullPath = path.join(row.agentDir, fileName);
  try {
    const text = await fs.readFile(fullPath, "utf8");
    return res.json({ ok: true, agentId, fileName, path: fullPath, text });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error.message || error) });
  }
});

app.get("/api/logs/gateway", async (req, res) => {
  const data = await getGatewayLogRows({
    limit: Number(req.query.limit || 250),
    level: String(req.query.level || ""),
    q: String(req.query.q || ""),
  });
  res.json(data);
});

app.get("/api/system/docker", async (_req, res) => {
  res.json(await dockerPs());
});

app.get("/api/watchers", async (_req, res) => {
  res.json(await getWatchersStatus());
});

app.post("/api/watchers/:id/action", async (req, res) => {
  const id = req.params.id;
  const action = String(req.body?.action || "").toLowerCase();
  if (!["start", "stop", "restart"].includes(action)) {
    return res.status(400).json({ ok: false, error: "Invalid action. Use start|stop|restart" });
  }

  const actionResult = await runWatcherAction(id, action);
  const current = await getWatchersStatus();
  res.json({ ok: actionResult.ok, actionResult, watchers: current.rows || [] });
});

app.get("/api/services/health", async (_req, res) => {
  res.json(await getServiceHealthTable());
});

app.get("/api/config/diagnostics", async (_req, res) => {
  res.json(await getConfigDiagnostics());
});

app.get("/api/audit/trail", async (_req, res) => {
  res.json(await getAuditTrail());
});

app.post("/api/actions/:action", async (req, res) => {
  const action = req.params.action;
  const confirm = String(req.body?.confirm || "").toLowerCase() === "yes";
  if (!confirm) return res.status(400).json({ ok: false, error: "Confirmation required: {confirm:'yes'}" });

  let result;
  if (action === "deploy-ops-console") {
    result = await shell("/mithril-os/scripts/deploy-ops-console.sh", 20000);
  } else if (action === "restart-ops-console") {
    result = await shell("pkill -f 'node src/server.js' || true; cd /mithril-os/apps/ops-console && nohup npm run dev >/tmp/mithril-os-ops-console.log 2>&1 &", 8000);
  } else if (action === "restart-watcher") {
    const stop = await runWatcherAction("ops-console-watcher", "stop");
    const start = await runWatcherAction("ops-console-watcher", "start");
    result = { ok: stop.ok && start.ok, stdout: JSON.stringify({ stop, start }), stderr: "" };
  } else if (action === "restart-homeassistant") {
    result = await shell("docker restart homeassistant", 15000);
  } else {
    return res.status(404).json({ ok: false, error: `Unknown action: ${action}` });
  }

  res.json(result);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Mithril-OS Ops Console listening on http://0.0.0.0:${PORT}`);
});
