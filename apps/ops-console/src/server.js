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

app.use(express.static(path.join(__dirname, "../public")));

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
  try {
    const { stdout } = await exec("docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'", { timeout: 2500 });
    const rows = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, image, status, ports] = line.split("|");
        return { name, image, status, ports };
      });
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, error: String(error.message || error), rows: [] };
  }
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

async function tailFile(filePath, lines = 120) {
  if (!filePath) return { ok: false, error: "No log file path available", lines: [] };
  try {
    const { stdout } = await exec(`tail -n ${Math.max(10, Math.min(lines, 500))} ${JSON.stringify(filePath)}`, { timeout: 2000 });
    return { ok: true, filePath, text: stdout };
  } catch (error) {
    return { ok: false, filePath, error: String(error.message || error), text: "" };
  }
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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function getWatchersStatus() {
  const registry = (await readJsonIfExists(WATCHERS_REGISTRY)) || [];
  const rows = [];

  for (const w of registry) {
    let running = false;
    let processInfo = "";

    try {
      const { stdout } = await exec(`pgrep -af ${JSON.stringify(w.script)} || true`, { timeout: 1500 });
      const lines = stdout.trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        running = true;
        processInfo = lines[0];
      }
    } catch {
      // ignore
    }

    const statePath = path.join(WATCHERS_STATE_DIR, `${w.id}.json`);
    const state = await readJsonIfExists(statePath);

    let systemdActive = "unknown";
    if (w.systemdService) {
      try {
        const { stdout } = await exec(`systemctl is-active ${w.systemdService} || true`, { timeout: 1500 });
        systemdActive = stdout.trim() || "unknown";
      } catch {
        systemdActive = "unknown";
      }
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

app.get("/api/status", async (_req, res) => {
  res.json(await getStatusPayload());
});

app.get("/api/openclaw/overview", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const parsed = cfg.parsed;
  const data = {
    ok: true,
    model: parsed?.agents?.defaults?.model?.primary || null,
    channels: parsed?.channels || {},
    bindings: parsed?.bindings || [],
    gateway: parsed?.gateway || {},
    exec: parsed?.tools?.exec || {},
  };
  res.json(data);
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

  res.json({
    ok: true,
    agentIds: uniqueAgentIds,
    bindings,
  });
});

app.get("/api/logs/gateway", async (req, res) => {
  const lines = Number(req.query.lines || 120);
  const filePath = await getGatewayLogPath();
  const tailed = await tailFile(filePath, lines);
  res.json(tailed);
});

app.get("/api/system/docker", async (_req, res) => {
  const ps = await dockerPs();
  res.json(ps);
});

app.get("/api/watchers", async (_req, res) => {
  const data = await getWatchersStatus();
  res.json(data);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.listen(PORT, () => {
  console.log(`Mithril-OS Ops Console listening on http://0.0.0.0:${PORT}`);
});
