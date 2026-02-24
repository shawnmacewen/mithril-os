import "dotenv/config";
import express from "express";
import fs from "fs/promises";
import path from "path";
import net from "net";
import { exec as execCb } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

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
const OPS_DATA_DIR = process.env.OPS_DATA_DIR || "/mithril-os/apps/ops-console/data";
const JOBS_LEDGER_FILE = process.env.JOBS_LEDGER_FILE || path.join(OPS_DATA_DIR, "jobs.jsonl");
const AGENTS_ROOT = process.env.AGENTS_ROOT || "/home/mini-home-lab/.openclaw/agents";
const AGENTS_ROOT_FALLBACK = "/home/node/.openclaw/agents";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/home/node/.openclaw/workspace";
const WORKSPACE_ROOT_FALLBACK = "/home/mini-home-lab/.openclaw/workspace";
const AGENT_ROUTING_CONFIG = process.env.AGENT_ROUTING_CONFIG || "/mithril-os/config/agent-routing.json";
const AGENT_ARTIFACTS_DIR = process.env.AGENT_ARTIFACTS_DIR || "/mithril-os/ops-artifacts";
const DELEGATIONS_FILE = process.env.DELEGATIONS_FILE || "/mithril-os/ops-artifacts/delegations.jsonl";
const COORDINATION_LOG_FILE = process.env.COORDINATION_LOG_FILE || "/mithril-os/ops-artifacts/coordination-log.jsonl";
const REVIEW_LOG_FILE = process.env.REVIEW_LOG_FILE || "/mithril-os/ops-artifacts/review-log.jsonl";
const ROUTING_INSIGHTS_FILE = process.env.ROUTING_INSIGHTS_FILE || "/mithril-os/ops-artifacts/routing-insights.json";
const PROJECTS_CONFIG_FILE = process.env.PROJECTS_CONFIG_FILE || "/mithril-os/config/projects-monitor.json";
const POLICIES_CONFIG_FILE = process.env.POLICIES_CONFIG_FILE || "/mithril-os/config/policies.json";

app.use((req, res, next) => {
  // Internal ops UI: prefer freshness over asset caching to avoid stale frontend state.
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(__dirname, "../public")));
app.use(express.json());

const API_CACHE = new Map();
function cacheGet(key) {
  const row = API_CACHE.get(key);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    API_CACHE.delete(key);
    return null;
  }
  return row.value;
}
function cacheSet(key, value, ttlMs) {
  API_CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function isoNow() {
  return new Date().toISOString();
}

async function appendJobEvent(event) {
  await ensureDir(path.dirname(JOBS_LEDGER_FILE));
  const line = JSON.stringify({ ...event, at: event.at || isoNow() });
  await fs.appendFile(JOBS_LEDGER_FILE, `${line}\n`, "utf8");
}

async function readJobLedger() {
  try {
    const raw = await fs.readFile(JOBS_LEDGER_FILE, "utf8");
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function foldJobs(events = []) {
  const byId = new Map();
  const sorted = [...events].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));

  for (const e of sorted) {
    const jobId = String(e.jobId || "").trim();
    if (!jobId) continue;
    const prev = byId.get(jobId) || {
      jobId,
      kind: e.kind || "job",
      sourceAgent: e.sourceAgent || "unknown",
      targetAgent: e.targetAgent || null,
      status: "queued",
      summary: e.summary || "",
      result: "",
      error: "",
      channelContext: e.channelContext || null,
      createdAt: e.at || null,
      startedAt: null,
      completedAt: null,
      updatedAt: e.at || null,
      events: [],
    };

    const type = String(e.event || "update").toLowerCase();
    if (type === "created") {
      prev.status = "queued";
      prev.createdAt = prev.createdAt || e.at || null;
    }
    if (type === "started") {
      prev.status = "started";
      prev.startedAt = prev.startedAt || e.at || null;
    }
    if (type === "blocked") prev.status = "blocked";
    if (type === "done") {
      prev.status = "done";
      prev.completedAt = e.at || prev.completedAt;
    }
    if (type === "failed") {
      prev.status = "failed";
      prev.completedAt = e.at || prev.completedAt;
    }

    if (e.kind) prev.kind = e.kind;
    if (e.sourceAgent) prev.sourceAgent = e.sourceAgent;
    if (e.targetAgent !== undefined) prev.targetAgent = e.targetAgent;
    if (e.summary) prev.summary = e.summary;
    if (e.result) prev.result = e.result;
    if (e.error) prev.error = e.error;
    if (e.channelContext) prev.channelContext = e.channelContext;
    prev.updatedAt = e.at || prev.updatedAt;
    prev.events.push({ at: e.at || null, event: type, note: e.note || "" });

    byId.set(jobId, prev);
  }

  return [...byId.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
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

const defaultRoutingConfig = {
  version: 1,
  cooAgentId: "main",
  policy: {
    defaultMode: "coo-routes",
    confidenceThreshold: 0.7,
    escalation: {
      onLowConfidence: "fallback",
      onMissingCategory: "coo",
    },
    directUserOverride: {
      enabled: true,
      behavior: "allow-direct-routing",
      note: "User can address any agent directly; COO keeps visibility but does not block.",
    },
  },
  taskRouting: [
    { category: "architecture", preferredAgentId: "koda", fallbackAgentId: "main" },
    { category: "ops", preferredAgentId: "main", fallbackAgentId: "main" },
    { category: "coding", preferredAgentId: "main", fallbackAgentId: "koda" },
    { category: "research", preferredAgentId: "main", fallbackAgentId: "main" },
  ],
};

async function readRoutingConfig() {
  try {
    const raw = await fs.readFile(AGENT_ROUTING_CONFIG, "utf8");
    return { ok: true, parsed: JSON.parse(raw), source: AGENT_ROUTING_CONFIG };
  } catch {
    return { ok: true, parsed: defaultRoutingConfig, source: "default" };
  }
}

async function writeRoutingConfig(nextConfig) {
  await fs.mkdir(path.dirname(AGENT_ROUTING_CONFIG), { recursive: true });
  await fs.writeFile(AGENT_ROUTING_CONFIG, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return { ok: true, path: AGENT_ROUTING_CONFIG };
}

async function readProjectsConfig() {
  try {
    const raw = await fs.readFile(PROJECTS_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed.projects) ? parsed.projects : [];
    return { ok: true, source: PROJECTS_CONFIG_FILE, projects: rows };
  } catch {
    return { ok: true, source: "default", projects: [] };
  }
}

async function readPoliciesConfig() {
  try {
    const raw = await fs.readFile(POLICIES_CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed.policies) ? parsed.policies : [];
    return { ok: true, source: POLICIES_CONFIG_FILE, policies: rows };
  } catch {
    return { ok: true, source: "default", policies: [] };
  }
}

async function getPolicyRowStatus(policy) {
  const row = {
    id: String(policy?.id || ""),
    title: String(policy?.title || "Untitled Policy"),
    path: String(policy?.path || ""),
    owner: String(policy?.owner || ""),
    scope: String(policy?.scope || ""),
    status: String(policy?.status || "active"),
    tags: Array.isArray(policy?.tags) ? policy.tags.map(String) : [],
    ok: false,
  };

  if (!row.path) return { ...row, error: "missing path" };

  try {
    const text = await fs.readFile(row.path, "utf8");
    const st = await fs.stat(row.path);
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return {
      ...row,
      ok: true,
      sizeBytes: st.size,
      modifiedAt: st.mtime.toISOString(),
      sha: hash,
      words,
      preview: text.slice(0, 420),
    };
  } catch (error) {
    return { ...row, ok: false, error: String(error.message || error) };
  }
}

async function getProjectRowStatus(project) {
  const name = String(project?.name || "Unnamed Project");
  const repoPath = String(project?.path || "").trim();
  if (!repoPath) return { name, path: "", ok: false, error: "missing path" };

  const status = await shell(`git -C ${JSON.stringify(repoPath)} status -sb 2>/dev/null || true`, 3000);
  const remotes = await shell(`git -C ${JSON.stringify(repoPath)} remote -v 2>/dev/null | head -n 2 || true`, 3000);
  const last = await shell(`git -C ${JSON.stringify(repoPath)} log -n 3 --pretty=format:'%h|%cI|%s' 2>/dev/null || true`, 3000);

  const statusText = (status.stdout || "").trim();
  const first = statusText.split("\n")[0] || "";
  const dirty = statusText.split("\n").length > 1;

  let branch = "unknown";
  let tracking = "";
  if (first.startsWith("##")) {
    const s = first.replace(/^##\s*/, "");
    const idx = s.indexOf("...");
    if (idx >= 0) {
      branch = s.slice(0, idx).trim();
      tracking = s.slice(idx + 3).trim();
    } else {
      branch = s.trim();
    }
  }

  const commits = (last.stdout || "").trim()
    ? (last.stdout || "").trim().split("\n").map((l) => {
        const [hash, date, subject] = l.split("|");
        return { hash, date, subject };
      })
    : [];

  return {
    name,
    path: repoPath,
    ok: Boolean(statusText),
    branch,
    tracking,
    dirty,
    statusLine: first || "unavailable",
    remotes: (remotes.stdout || "").trim() || "none",
    commits,
  };
}

async function readDelegations(limit = 200) {
  try {
    const raw = await fs.readFile(DELEGATIONS_FILE, "utf8");
    const rows = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    return { ok: true, rows: rows.slice(-limit).reverse() };
  } catch {
    return { ok: true, rows: [] };
  }
}

async function appendDelegation(row) {
  await fs.mkdir(AGENT_ARTIFACTS_DIR, { recursive: true });
  await fs.appendFile(DELEGATIONS_FILE, `${JSON.stringify(row)}\n`, "utf8");
}

async function appendCoordinationLog(row) {
  await fs.mkdir(AGENT_ARTIFACTS_DIR, { recursive: true });
  await fs.appendFile(COORDINATION_LOG_FILE, `${JSON.stringify(row)}\n`, "utf8");
}

async function readJsonl(filePath, limit = 200) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const rows = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
    return rows.slice(-limit).reverse();
  } catch {
    return [];
  }
}

async function appendReviewLog(row) {
  await fs.mkdir(AGENT_ARTIFACTS_DIR, { recursive: true });
  await fs.appendFile(REVIEW_LOG_FILE, `${JSON.stringify(row)}\n`, "utf8");
}

async function writeRoutingInsights(payload) {
  await fs.mkdir(AGENT_ARTIFACTS_DIR, { recursive: true });
  await fs.writeFile(ROUTING_INSIGHTS_FILE, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function latestDelegationStates(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    if (!row?.id) continue;
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function activeDelegations() {
  const data = await readDelegations(500);
  const latest = latestDelegationStates(data.rows || []);
  return latest.filter((r) => ["queued", "running", "needs-review"].includes(String(r.status || "")));
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

function normalizeSubsystem(rawSubsystem) {
  if (!rawSubsystem) return "core";
  if (typeof rawSubsystem !== "string") return String(rawSubsystem);
  const s = rawSubsystem.trim();
  if (s.startsWith("{") && s.includes("subsystem")) {
    try {
      const parsed = JSON.parse(s);
      if (parsed?.subsystem) return String(parsed.subsystem);
    } catch {
      // ignore
    }
  }
  return s;
}

function logTypeFromSubsystem(subsystem = "core") {
  const s = subsystem.toLowerCase();
  if (s.includes("discord")) return "discord";
  if (s.includes("telegram")) return "telegram";
  if (s.includes("whatsapp")) return "whatsapp";
  if (s.includes("signal")) return "signal";
  if (s.includes("agent")) return "agent";
  if (s.includes("diagnostic") || s.includes("gateway")) return "gateway";
  return "core";
}

function stripAnsi(text = "") {
  return String(text).replace(/\u001b\[[0-9;]*m/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function extractBracketParts(text = "") {
  const clean = stripAnsi(text);
  const tags = [...clean.matchAll(/\[([^\]]+)\]/g)].map((m) => String(m[1]).trim()).filter(Boolean);
  const timeTag = (clean.match(/\b\d{2}:\d{2}:\d{2}\b/) || [null])[0];
  return { clean, tags, timeTag };
}

function parseGatewayLogLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const obj = JSON.parse(trimmed);
    const timestamp = obj.time || obj._meta?.date || null;
    const level = String(obj._meta?.logLevelName || obj.level || "INFO").toUpperCase();

    const subsystemRaw = obj?.subsystem || obj?.[0] || obj?._meta?.name || "core";
    const subsystem = normalizeSubsystem(subsystemRaw);
    const type = logTypeFromSubsystem(subsystem);

    // OpenClaw log lines usually store human message in key "1"
    const message =
      (typeof obj?.[1] === "string" && obj[1]) ||
      obj?.message ||
      Object.entries(obj)
        .filter(([k]) => !k.startsWith("_") && k !== "0" && k !== "1")
        .map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v)))
        .join(" ");

    const { clean, tags, timeTag } = extractBracketParts(message || "");

    return {
      timestamp,
      level,
      subsystem,
      type,
      message: clean || "",
      text: clean || "",
      raw: trimmed,
      tags,
      timeTag,
    };
  } catch {
    const levelMatch = trimmed.match(/\b(ERROR|WARN|INFO|DEBUG)\b/i);
    const { clean, tags, timeTag } = extractBracketParts(trimmed);
    return {
      timestamp: null,
      level: (levelMatch?.[1] || "INFO").toUpperCase(),
      subsystem: tags.find((t) => /^[a-z0-9_\/-]+$/i.test(t)) || "core",
      type: "core",
      message: clean,
      text: clean,
      raw: trimmed,
      tags,
      timeTag,
    };
  }
}

async function getGatewayLogRows({ limit = 200, level = "", q = "" }) {
  const safeLimit = Math.max(20, Math.min(Number(limit) || 200, 1000));
  let source = "";
  let rawText = "";

  const filePath = await getGatewayLogPath();
  if (filePath) {
    const tailed = await shell(`tail -n ${safeLimit} ${JSON.stringify(filePath)}`, 2500);
    if (tailed.ok) {
      source = filePath;
      rawText = tailed.stdout;
    }
  }

  if (!rawText) {
    // Fallback for host-run deployments where /tmp/openclaw is unavailable in runtime context
    const dockerLogs = await shell(`docker logs --tail ${safeLimit} openclaw-gateway 2>&1`, 4000);
    if (dockerLogs.ok || dockerLogs.stdout) {
      source = "docker:openclaw-gateway";
      rawText = dockerLogs.stdout || dockerLogs.stderr || "";
    }
  }

  if (!rawText) return { ok: false, error: "No log source available", rows: [] };

  const rows = rawText
    .split("\n")
    .map(parseGatewayLogLine)
    .filter(Boolean)
    .filter((r) => (level ? r.level === level.toUpperCase() : true))
    .filter((r) => (q ? r.text.toLowerCase().includes(q.toLowerCase()) : true));

  return { ok: true, source, rows };
}

async function sendDiscordChannelMessage(channelId, content) {
  const cfg = await readConfig();
  if (!cfg.ok) return { ok: false, error: cfg.error || "config unreadable" };
  const token = cfg.parsed?.channels?.discord?.token;
  if (!token) return { ok: false, error: "Discord token missing in config" };
  const cid = String(channelId || "").trim();
  if (!cid) return { ok: false, error: "channelId is required" };

  try {
    const r = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(cid)}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: String(content || "") }),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) return { ok: false, status: r.status, error: `Discord API HTTP ${r.status}`, data };
    return { ok: true, status: r.status, data };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
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

  const values = Object.fromEntries(
    keys.map((k) => {
      const line = lines.find((l) => l.startsWith(`${k}=`));
      return [k, line ? line.slice(k.length + 1) : ""];
    }),
  );

  const present = Object.fromEntries(keys.map((k) => [k, Boolean(values[k]) || k === "OPENCLAW_LOG_FILE"]));

  const checks = [];
  checks.push({ key: "PORT", ok: /^\d+$/.test(values.PORT || ""), level: "error", hint: "Set PORT to a number (e.g. 3001)." });

  try {
    if (values.OPENCLAW_CONFIG) await fs.access(values.OPENCLAW_CONFIG);
    checks.push({ key: "OPENCLAW_CONFIG", ok: Boolean(values.OPENCLAW_CONFIG), level: "error", hint: "Path should point to openclaw.json" });
  } catch {
    checks.push({ key: "OPENCLAW_CONFIG", ok: false, level: "error", hint: `Config file not readable: ${values.OPENCLAW_CONFIG || "(empty)"}` });
  }

  try {
    if (values.WATCHERS_REGISTRY) await fs.access(values.WATCHERS_REGISTRY);
    checks.push({ key: "WATCHERS_REGISTRY", ok: Boolean(values.WATCHERS_REGISTRY), level: "warn", hint: "watchers.json should exist" });
  } catch {
    checks.push({ key: "WATCHERS_REGISTRY", ok: false, level: "warn", hint: `Registry missing: ${values.WATCHERS_REGISTRY || "(empty)"}` });
  }

  try {
    if (values.WATCHERS_STATE_DIR) await fs.access(values.WATCHERS_STATE_DIR);
    checks.push({ key: "WATCHERS_STATE_DIR", ok: Boolean(values.WATCHERS_STATE_DIR), level: "warn", hint: "state dir should exist" });
  } catch {
    checks.push({ key: "WATCHERS_STATE_DIR", ok: false, level: "warn", hint: `State dir missing: ${values.WATCHERS_STATE_DIR || "(empty)"}` });
  }

  checks.push({ key: "HA_URL", ok: /^https?:\/\//.test(values.HA_URL || ""), level: "error", hint: "Use full URL like http://host:8123" });
  checks.push({ key: "HA_TOKEN", ok: Boolean(values.HA_TOKEN), level: "error", hint: "Add Home Assistant long-lived token" });

  return {
    ok: true,
    envPath: OPS_ENV_FILE,
    present,
    values: { ...values, HA_TOKEN: values.HA_TOKEN ? "[SET]" : "" },
    missing: keys.filter((k) => !present[k]),
    checks,
    summary: {
      errors: checks.filter((c) => !c.ok && c.level === "error").length,
      warnings: checks.filter((c) => !c.ok && c.level === "warn").length,
      pass: checks.filter((c) => c.ok).length,
    },
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
          discovered[agentId] = { agentId, root, agentDir, files, workspaceFiles: [] };
        } else if (files.length > discovered[agentId].files.length) {
          discovered[agentId] = { agentId, root, agentDir, files, workspaceFiles: [] };
        }
      }
    } catch {
      // ignore missing roots
    }
  }

  // Ensure known binding agent IDs are represented even if no md files found yet.
  for (const agentId of bindingIds) {
    if (!discovered[agentId]) {
      discovered[agentId] = { agentId, root: null, agentDir: null, files: [], workspaceFiles: [] };
    }
  }

  // Main agent often uses workspace-level markdown docs (SOUL.md, USER.md, etc.)
  let workspaceRootUsed = WORKSPACE_ROOT;
  if (discovered.main) {
    const workspaceCandidates = [WORKSPACE_ROOT, WORKSPACE_ROOT_FALLBACK];
    for (const wsRoot of workspaceCandidates) {
      try {
        const wsKids = await fs.readdir(wsRoot, { withFileTypes: true });
        const files = wsKids
          .filter((k) => k.isFile() && k.name.toLowerCase().endsWith(".md"))
          .map((k) => k.name)
          .sort();
        if (files.length > 0) {
          discovered.main.workspaceFiles = files;
          workspaceRootUsed = wsRoot;
          break;
        }
      } catch {
        // try next candidate
      }
    }
  }

  return {
    ok: true,
    roots,
    workspaceRoot: workspaceRootUsed,
    rows: Object.values(discovered).sort((a, b) => a.agentId.localeCompare(b.agentId)),
  };
}

async function getCommitTimeline(limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100));

  // Best-effort refresh of remote refs so "github" state stays current.
  await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} fetch --all --prune`, 5000);

  const localOut = await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} log -n ${safeLimit * 3} --pretty=format:'%h|%H|%cI|%an|%s'`, 3000);
  if (!localOut.ok) return { ok: false, error: localOut.stderr, rows: [] };

  const upstreamRef = await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} rev-parse --abbrev-ref --symbolic-full-name @{u}`, 2000);
  const upstreamName = upstreamRef.ok ? upstreamRef.stdout.trim() : "";

  const remoteOut = upstreamName
    ? await shell(`git -C ${JSON.stringify(OPS_REPO_DIR)} log -n ${safeLimit * 3} ${JSON.stringify(upstreamName)} --pretty=format:'%h|%H|%cI|%an|%s'`, 3000)
    : { ok: false, stdout: "" };

  const parseRows = (text) =>
    String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [short, full, date, author, subject] = line.split("|");
        return { short, full, date, author, subject };
      });

  const localRows = parseRows(localOut.stdout);
  const remoteRows = remoteOut.ok ? parseRows(remoteOut.stdout) : [];

  const localSet = new Set(localRows.map((r) => r.full));
  const remoteSet = new Set(remoteRows.map((r) => r.full));

  const mergedMap = new Map();
  for (const r of [...localRows, ...remoteRows]) {
    if (!mergedMap.has(r.full)) mergedMap.set(r.full, r);
  }

  const mergedRows = [...mergedMap.values()]
    .map((r) => {
      const inLocal = localSet.has(r.full);
      const inRemote = remoteSet.has(r.full);
      let type = "LOCAL";
      if (inLocal && inRemote) type = "LOCAL+GITHUB";
      else if (!inLocal && inRemote) type = "GITHUB";

      return {
        ...r,
        type,
        pushed: inRemote,
      };
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, safeLimit);

  return { ok: true, rows: mergedRows, upstream: upstreamName || null };
}

function flattenObject(obj, prefix = "", out = []) {
  if (obj === null || obj === undefined) return out;
  if (typeof obj !== "object") {
    out.push({ path: prefix || "(root)", value: String(obj) });
    return out;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => flattenObject(v, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    flattenObject(v, next, out);
  }
  return out;
}

function redactConfigValue(path, value) {
  const p = path.toLowerCase();
  if (p.includes("token") || p.includes("secret") || p.includes("password") || p.includes("apikey") || p.includes("auth")) {
    return "[REDACTED]";
  }
  return value;
}

async function getOpenclawDeep() {
  const cfg = await readConfig();
  const status = await getStatusPayload();
  const docker = await dockerPs();

  const parsed = cfg.ok ? cfg.parsed : {};
  const bindings = parsed?.bindings || [];
  const channelsObj = parsed?.channels || {};

  const channelRows = Object.entries(channelsObj).map(([name, conf]) => ({
    channel: name,
    configured: true,
    summary: typeof conf === "object" ? Object.keys(conf || {}).join(", ") : String(conf),
  }));

  const bindingRows = bindings.map((b, i) => ({
    id: i + 1,
    channel: b.channel || b.provider || "n/a",
    chat: b.chat || b.chatId || b.target || "*",
    agentId: b.agentId || "main",
    note: b.requireMention === false ? "no-mention" : "",
  }));

  const toolPermissions = parsed?.tools || {};
  const execConf = parsed?.tools?.exec || {};

  const models = {
    primary: parsed?.agents?.defaults?.model?.primary || null,
    fallback: parsed?.agents?.defaults?.model?.fallback || null,
    connectedProfiles: Object.keys(parsed?.auth?.profiles || {}),
  };

  let gatewayUptime = "unknown";
  if (docker.ok) {
    const gw = docker.rows.find((r) => (r.name || "").includes("openclaw-gateway"));
    if (gw) gatewayUptime = gw.status;
  }

  // Queue monitor (best effort from recent gateway logs)
  const logs = await getGatewayLogRows({ limit: 120, level: "", q: "lane" });
  let queueHints = { active: null, waiting: null, queued: null, text: "n/a" };
  if (logs.ok && logs.rows?.length) {
    const line = [...logs.rows].reverse().find((r) => /active=|queued=|waiting=/.test(r.text || ""));
    if (line) {
      const t = line.text || "";
      const mA = t.match(/active=(\d+)/);
      const mW = t.match(/waiting=(\d+)/);
      const mQ = t.match(/queued=(\d+)/);
      queueHints = {
        active: mA ? Number(mA[1]) : null,
        waiting: mW ? Number(mW[1]) : null,
        queued: mQ ? Number(mQ[1]) : null,
        text: t,
      };
    }
  }

  const flat = flattenObject(parsed)
    .slice(0, 500)
    .map((r) => ({ path: r.path, value: redactConfigValue(r.path, r.value) }));

  return {
    ok: true,
    gateway: {
      tcpOk: status.openclaw.gatewayTcp18789?.ok || false,
      uptime: gatewayUptime,
      configReadable: status.openclaw.configReadable,
      configError: status.openclaw.configError || null,
      model: status.openclaw.model,
      channelsCount: Object.keys(channelsObj).length,
      bindingsCount: bindings.length,
    },
    channels: channelRows,
    bindings: bindingRows,
    tools: {
      execSecurity: execConf.security || "n/a",
      execAsk: execConf.ask || "n/a",
      available: Object.keys(toolPermissions || {}),
      raw: toolPermissions,
    },
    models,
    queue: queueHints,
    configFlat: flat,
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

app.get("/api/openclaw/deep", async (_req, res) => {
  const data = await getOpenclawDeep();
  if (!data.ok) return res.status(500).json(data);
  res.json(data);
});

app.get("/api/openclaw/usage", async (_req, res) => {
  // Preferred: read host-collected telemetry bridge file.
  const eventFiles = [
    "/backup/telemetry/openclaw-usage-events.jsonl",
    "/mithril-os/state/openclaw-usage-events.jsonl",
  ];

  for (const p of eventFiles) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const lines = raw.trim().split("\n").filter(Boolean);
      if (lines.length) {
        const parsed = JSON.parse(lines[lines.length - 1]);
        const usage = parsed.usage || parsed.session?.usage || parsed;
        return res.json({
          ok: Boolean(parsed.ok !== false),
          source: parsed.source || p,
          capturedAt: parsed.capturedAt || null,
          note: parsed.note || null,
          collector: parsed.collector || null,
          usage,
        });
      }
    } catch {
      // try next source
    }
  }

  const candidates = [
    "/backup/telemetry/openclaw-usage.json",
    "/mithril-os/state/openclaw-usage.json",
  ];

  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      const usage = parsed.usage || parsed.session?.usage || parsed;
      return res.json({
        ok: Boolean(parsed.ok !== false),
        source: parsed.source || p,
        capturedAt: parsed.capturedAt || null,
        note: parsed.note || null,
        collector: parsed.collector || null,
        usage,
      });
    } catch {
      // try next source
    }
  }

  // Fallback: local runtime CLI (often unavailable in host-deployed mode).
  const try1 = await shell("openclaw session status --json 2>/dev/null || true", 3000);
  let parsed = null;
  if (try1.ok && try1.stdout.trim()) {
    try { parsed = JSON.parse(try1.stdout); } catch {}
  }

  if (!parsed) {
    const try2 = await shell("openclaw status --json 2>/dev/null || true", 3000);
    if (try2.ok && try2.stdout.trim()) {
      try { parsed = JSON.parse(try2.stdout); } catch {}
    }
  }

  if (!parsed) {
    return res.json({ ok: false, error: "Session usage telemetry unavailable in this runtime context. Install host telemetry bridge service." });
  }

  const usage = parsed.usage || parsed.session?.usage || parsed;
  res.json({ ok: true, source: "runtime-cli", capturedAt: new Date().toISOString(), usage });
});

app.get("/api/openclaw/models", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const parsed = cfg.parsed;
  const connectedProfiles = Object.keys(parsed?.auth?.profiles || {});
  const primaryModel = parsed?.agents?.defaults?.model?.primary || null;

  const providerByProfile = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    xai: "xAI",
    perplexity: "Perplexity",
    openrouter: "OpenRouter",
    voyage: "Voyage",
  };

  const modelRows = [
    { name: "gpt-5.3-codex", company: "OpenAI", files: "text, code, json", version: "5.3", profile: "openai" },
    { name: "gpt-5.2-codex", company: "OpenAI", files: "text, code, json", version: "5.2", profile: "openai" },
    { name: "claude-sonnet-4.5", company: "Anthropic", files: "text, code, markdown", version: "4.5", profile: "anthropic" },
    { name: "gemini-2.5-pro", company: "Google", files: "text, code, multimodal", version: "2.5", profile: "google" },
    { name: "grok-4", company: "xAI", files: "text, code", version: "4", profile: "xai" },
  ].map((m) => ({
    ...m,
    connected: connectedProfiles.includes(m.profile),
    active: primaryModel === m.name,
  }));

  // Ensure currently configured model appears even if not in catalog list.
  if (primaryModel && !modelRows.find((m) => m.name === primaryModel)) {
    modelRows.unshift({
      name: primaryModel,
      company: providerByProfile[connectedProfiles[0]] || "Configured",
      files: "text, code",
      version: "unknown",
      profile: connectedProfiles[0] || "unknown",
      connected: true,
      active: true,
    });
  }

  res.json({
    ok: true,
    primaryModel,
    connectedProfiles,
    rows: modelRows,
  });
});

app.get("/api/agents", async (_req, res) => {
  const cfg = await readConfig();
  if (!cfg.ok) return res.status(500).json({ ok: false, error: cfg.error });

  const bindings = cfg.parsed?.bindings || [];
  const uniqueAgentIds = [...new Set(bindings.map((b) => b.agentId).filter(Boolean))];

  res.json({ ok: true, agentIds: uniqueAgentIds, bindings });
});

app.get("/api/agent-routing", async (_req, res) => {
  const routing = await readRoutingConfig();
  res.json({ ok: true, ...routing });
});

app.post("/api/agent-routing", async (req, res) => {
  const incoming = req.body || {};
  const merged = {
    ...defaultRoutingConfig,
    ...incoming,
    policy: {
      ...defaultRoutingConfig.policy,
      ...(incoming.policy || {}),
      escalation: {
        ...defaultRoutingConfig.policy.escalation,
        ...(incoming.policy?.escalation || {}),
      },
      directUserOverride: {
        ...defaultRoutingConfig.policy.directUserOverride,
        ...(incoming.policy?.directUserOverride || {}),
      },
    },
    taskRouting: Array.isArray(incoming.taskRouting) ? incoming.taskRouting : defaultRoutingConfig.taskRouting,
  };

  await writeRoutingConfig(merged);
  res.json({ ok: true, saved: true, path: AGENT_ROUTING_CONFIG, config: merged });
});

app.post("/api/agent-routing/recommend", async (req, res) => {
  const routing = await readRoutingConfig();
  const cfg = routing.parsed || defaultRoutingConfig;
  const body = req.body || {};

  const category = String(body.category || "").trim().toLowerCase();
  const confidence = Number(body.confidence);
  const urgent = Boolean(body.urgent);
  const directUserAgentId = body.directUserAgentId ? String(body.directUserAgentId) : null;

  if (cfg.policy?.directUserOverride?.enabled && directUserAgentId) {
    return res.json({
      ok: true,
      recommendedAgentId: directUserAgentId,
      reason: "direct-user-override",
      fallbackAgentId: cfg.cooAgentId || "main",
    });
  }

  if (urgent) {
    return res.json({
      ok: true,
      recommendedAgentId: cfg.cooAgentId || "main",
      reason: "urgent-default-coo",
      fallbackAgentId: cfg.cooAgentId || "main",
    });
  }

  const row = (cfg.taskRouting || []).find((r) => String(r.category || "").toLowerCase() === category);
  if (!row) {
    return res.json({
      ok: true,
      recommendedAgentId: cfg.cooAgentId || "main",
      reason: "missing-category",
      fallbackAgentId: cfg.cooAgentId || "main",
    });
  }

  const threshold = Number(cfg.policy?.confidenceThreshold ?? 0.7);
  if (Number.isFinite(confidence) && confidence < threshold) {
    return res.json({
      ok: true,
      recommendedAgentId: row.fallbackAgentId || cfg.cooAgentId || "main",
      reason: "low-confidence-fallback",
      fallbackAgentId: row.fallbackAgentId || cfg.cooAgentId || "main",
      threshold,
      confidence,
    });
  }

  return res.json({
    ok: true,
    recommendedAgentId: row.preferredAgentId || cfg.cooAgentId || "main",
    reason: "category-match",
    fallbackAgentId: row.fallbackAgentId || cfg.cooAgentId || "main",
    threshold,
    confidence: Number.isFinite(confidence) ? confidence : null,
  });
});

app.get("/api/delegations", async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const data = await readDelegations(limit);
  res.json({ ok: true, rows: data.rows });
});

app.get("/api/coordination/overview", async (_req, res) => {
  const agents = await getAgentMdIndex();
  const coordinationRows = await readJsonl(COORDINATION_LOG_FILE, 120);

  const memoryMap = (agents.rows || []).map((r) => ({
    agentId: r.agentId,
    agentMemoryPath: r.agentDir ? path.join(r.agentDir, "MEMORY.md") : null,
    dailyMemoryDir: r.agentDir ? path.join(r.agentDir, "memory") : null,
    sharedCoordinationLog: COORDINATION_LOG_FILE,
  }));

  res.json({
    ok: true,
    sharedWorkspace: AGENT_ARTIFACTS_DIR,
    sharedLogs: {
      delegations: DELEGATIONS_FILE,
      coordination: COORDINATION_LOG_FILE,
    },
    memoryMap,
    recentCoordination: coordinationRows,
  });
});

app.get("/api/agent-control/overview", async (_req, res) => {
  const agents = await getAgentMdIndex();
  const routing = await readRoutingConfig();
  const delegations = await readDelegations(400);

  const latest = latestDelegationStates(delegations.rows || []);
  const counts = {
    queued: latest.filter((r) => r.status === "queued").length,
    running: latest.filter((r) => r.status === "running").length,
    blocked: latest.filter((r) => r.status === "blocked").length,
    needsReview: latest.filter((r) => r.status === "needs-review").length,
    done: latest.filter((r) => r.status === "done").length,
  };

  const now = Date.now();
  const staleRunningRows = latest.filter((r) => r.status === "running" && r.ts && (now - Date.parse(r.ts)) > (60 * 60 * 1000));
  const blockedRows = latest.filter((r) => r.status === "blocked");

  const ids = new Set([...(agents.rows || []).map((r) => r.agentId), ...latest.map((r) => r.assigneeAgentId).filter(Boolean)]);
  const coo = routing.parsed?.cooAgentId || "main";

  const perAgent = [...ids].sort().map((agentId) => {
    const mine = latest.filter((r) => r.assigneeAgentId === agentId);
    const active = mine.filter((r) => ["queued", "running", "needs-review"].includes(String(r.status || "")));
    const blockers = mine.filter((r) => r.status === "blocked");
    const mostRecent = mine.sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))[0] || null;
    const current = active.sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0))[0] || null;

    return {
      agentId,
      role: agentId === coo ? "COO" : "specialist",
      activeCount: active.length,
      blockerCount: blockers.length,
      lastUpdateAt: mostRecent?.ts || null,
      currentTask: current ? (current.objective || current.note || "") : "idle",
      currentStatus: current?.status || "idle",
    };
  });

  // timeline grouped by delegation id
  const timelineMap = new Map();
  for (const row of (delegations.rows || []).slice().reverse()) {
    if (!row?.id) continue;
    if (!timelineMap.has(row.id)) timelineMap.set(row.id, []);
    timelineMap.get(row.id).push(row);
  }
  const timeline = [...timelineMap.entries()].slice(-25).reverse().map(([id, events]) => ({
    id,
    latestStatus: events[events.length - 1]?.status || "unknown",
    assigneeAgentId: events.find((e) => e.assigneeAgentId)?.assigneeAgentId || null,
    objective: events.find((e) => e.objective)?.objective || "",
    events,
  }));

  res.json({
    ok: true,
    routing: routing.parsed,
    agentIds: (agents.rows || []).map((r) => r.agentId),
    delegations: latest.slice(0, 25),
    timeline,
    perAgent,
    counts,
    cadence: {
      staleRunning: staleRunningRows.length,
      reviewHint: staleRunningRows.length > 0 ? "Review running delegations older than 60 minutes." : "No stale running delegations.",
    },
    blockers: blockedRows.slice(0, 20),
  });
});

app.get("/api/delegations/health", async (_req, res) => {
  const delegations = await readDelegations(300);
  const latest = latestDelegationStates(delegations.rows || []);
  const now = Date.now();

  const blocked = latest.filter((r) => r.status === "blocked");
  const staleRunning = latest.filter((r) => r.status === "running" && r.ts && (now - Date.parse(r.ts)) > (60 * 60 * 1000));

  res.json({
    ok: true,
    blockedCount: blocked.length,
    staleRunningCount: staleRunning.length,
    blocked: blocked.slice(0, 20),
    staleRunning: staleRunning.slice(0, 20),
    recommendation: blocked.length || staleRunning.length
      ? "COO review recommended: resolve blockers or re-scope tasks."
      : "Delegation queue healthy.",
  });
});

app.get("/api/agent-routing/insights", async (_req, res) => {
  const delegations = await readDelegations(1200);
  const latest = latestDelegationStates(delegations.rows || []);
  const done = latest.filter((r) => r.status === "done");
  const blocked = latest.filter((r) => r.status === "blocked");

  const byAssignee = {};
  for (const row of latest) {
    const k = row.assigneeAgentId || row.actorAgentId || "unknown";
    byAssignee[k] = byAssignee[k] || { total: 0, done: 0, blocked: 0, running: 0, queued: 0, needsReview: 0 };
    byAssignee[k].total += 1;
    const s = String(row.status || "");
    if (s === "done") byAssignee[k].done += 1;
    else if (s === "blocked") byAssignee[k].blocked += 1;
    else if (s === "running") byAssignee[k].running += 1;
    else if (s === "queued") byAssignee[k].queued += 1;
    else if (s === "needs-review") byAssignee[k].needsReview += 1;
  }

  const suggestions = Object.entries(byAssignee).map(([agentId, m]) => {
    const doneRate = m.total ? m.done / m.total : 0;
    const blockedRate = m.total ? m.blocked / m.total : 0;
    let recommendation = "keep";
    if (blockedRate >= 0.4 && m.total >= 3) recommendation = "decrease-routing";
    else if (doneRate >= 0.8 && m.total >= 3) recommendation = "increase-routing";
    return { agentId, ...m, doneRate, blockedRate, recommendation };
  });

  const payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    totals: { tasks: latest.length, done: done.length, blocked: blocked.length },
    suggestions,
    note: "Urgent tasks should remain COO-routed unless explicitly overridden.",
  };

  await writeRoutingInsights(payload);
  res.json(payload);
});

app.get("/api/delegations/reviews", async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const rows = await readJsonl(REVIEW_LOG_FILE, limit);
  res.json({ ok: true, rows });
});

app.post("/api/delegations/review/run", async (_req, res) => {
  const delegations = await readDelegations(600);
  const latest = latestDelegationStates(delegations.rows || []);
  const now = Date.now();

  const blocked = latest.filter((r) => r.status === "blocked");
  const staleRunning = latest.filter((r) => r.status === "running" && r.ts && (now - Date.parse(r.ts)) > (60 * 60 * 1000));
  const urgentAssignedAwayFromCoo = latest.filter((r) => {
    const p = String(r.priority || "").toLowerCase();
    return (p === "urgent" || p === "high") && String(r.assigneeAgentId || "") !== "main" && ["queued", "running", "needs-review"].includes(String(r.status || ""));
  });

  // Auto-close stale test/smoke delegations to keep queue clean.
  const staleQueuedTests = latest.filter((r) => {
    if (String(r.status || "") !== "queued") return false;
    const ageMs = r.ts ? (now - Date.parse(r.ts)) : 0;
    if (ageMs < (45 * 60 * 1000)) return false;
    const pr = String(r.priority || "normal").toLowerCase();
    if (!(["low", "normal", ""].includes(pr))) return false;
    const text = `${r.objective || ""} ${r.context || ""}`.toLowerCase();
    return /smoke|guardrail test|phase\d+.*test/.test(text);
  });

  for (const r of staleQueuedTests) {
    const ts = new Date().toISOString();
    const statusRow = {
      id: r.id,
      ts,
      event: "status-update",
      status: "done",
      note: "auto-closed stale test delegation by cadence review",
      actorAgentId: "main",
      output: {
        summary: "Auto-closed stale test delegation during cadence review.",
        evidence: ["Queued >45 minutes and matched test/smoke pattern"],
        nextActions: ["No action required"],
      },
    };
    await appendDelegation(statusRow);
    await appendCoordinationLog({
      ts,
      delegationId: r.id,
      agentId: "main",
      status: "done",
      summary: statusRow.output.summary,
      evidence: statusRow.output.evidence,
      nextActions: statusRow.output.nextActions,
    });
  }

  const review = {
    ts: new Date().toISOString(),
    blockedCount: blocked.length,
    staleRunningCount: staleRunning.length,
    urgentAssignedAwayFromCooCount: urgentAssignedAwayFromCoo.length,
    autoClosedStaleTestCount: staleQueuedTests.length,
    recommendation: (blocked.length || staleRunning.length)
      ? "COO follow-up required"
      : "Queue healthy",
    notes: [
      urgentAssignedAwayFromCoo.length
        ? "Urgent tasks currently assigned away from COO; verify specialist justification."
        : "Urgent-task SLA intact (COO-first).",
      staleQueuedTests.length
        ? `Auto-closed ${staleQueuedTests.length} stale test/smoke delegation(s).`
        : "No stale test/smoke delegations auto-closed.",
    ],
  };

  await appendReviewLog(review);
  res.json({ ok: true, review });
});

app.post("/api/delegations", async (req, res) => {
  const body = req.body || {};
  const objective = String(body.objective || "").trim();
  const assigneeAgentId = String(body.assigneeAgentId || "main");
  const allowParallel = Boolean(body.allowParallel);

  // Guardrails: prevent duplicate loops + enforce single active owner unless parallel is explicit.
  const active = await activeDelegations();
  const sameObjective = active.filter((r) => String(r.objective || "").trim() && String(r.objective || "").trim() === objective);

  if (!allowParallel) {
    const duplicate = sameObjective.find((r) => String(r.assigneeAgentId || "") === assigneeAgentId);
    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "Duplicate active delegation detected for same objective/assignee.",
        duplicate,
      });
    }

    const differentOwner = sameObjective.find((r) => String(r.assigneeAgentId || "") !== assigneeAgentId);
    if (differentOwner) {
      return res.status(409).json({
        ok: false,
        error: "Single-owner guardrail: objective already assigned to a different active agent.",
        activeOwner: differentOwner.assigneeAgentId,
        conflicting: differentOwner,
      });
    }
  }

  const id = `dlg_${Date.now()}`;
  const row = {
    id,
    ts: new Date().toISOString(),
    status: "queued",
    ownerAgentId: body.ownerAgentId || "main",
    assigneeAgentId,
    objective,
    context: body.context || "",
    constraints: body.constraints || "",
    deliverable: body.deliverable || "",
    deliverableFormat: body.deliverableFormat || "",
    priority: body.priority || "normal",
    deadline: body.deadline || null,
    definitionOfDone: body.definitionOfDone || "",
    escalationRule: body.escalationRule || "",
    source: body.source || "coo-delegation",
    allowParallel,
  };

  await appendDelegation(row);
  res.json({ ok: true, row });
});

app.post("/api/delegations/:id/status", async (req, res) => {
  const id = String(req.params.id || "");
  const nextStatus = String(req.body?.status || "").toLowerCase();
  if (!id || !["queued", "running", "done", "blocked", "needs-review"].includes(nextStatus)) {
    return res.status(400).json({ ok: false, error: "Invalid id/status" });
  }

  // Standard output envelope for delegated results.
  const envelope = {
    summary: String(req.body?.summary || ""),
    evidence: Array.isArray(req.body?.evidence) ? req.body.evidence.map(String) : [],
    nextActions: Array.isArray(req.body?.nextActions) ? req.body.nextActions.map(String) : [],
  };

  if (["done", "blocked", "needs-review"].includes(nextStatus)) {
    if (!envelope.summary.trim()) {
      return res.status(400).json({ ok: false, error: "summary is required for done|blocked|needs-review" });
    }
  }

  const row = {
    id,
    ts: new Date().toISOString(),
    event: "status-update",
    status: nextStatus,
    note: String(req.body?.note || ""),
    actorAgentId: String(req.body?.actorAgentId || "main"),
    output: envelope,
  };
  await appendDelegation(row);

  await appendCoordinationLog({
    ts: row.ts,
    delegationId: id,
    agentId: row.actorAgentId,
    status: nextStatus,
    summary: envelope.summary,
    evidence: envelope.evidence,
    nextActions: envelope.nextActions,
  });

  res.json({ ok: true, row });
});

app.get("/api/delegation-template", async (_req, res) => {
  res.json({
    ok: true,
    template: {
      ownerAgentId: "main",
      assigneeAgentId: "koda",
      objective: "",
      context: "",
      constraints: "",
      deliverable: "",
      deliverableFormat: "markdown-summary",
      priority: "normal",
      deadline: null,
      definitionOfDone: "",
      escalationRule: "If blocked >30 minutes, return to COO with blocker + options.",
      source: "coo-delegation",
      allowParallel: false,
    },
  });
});

app.post("/api/delegations/control/spawn", async (req, res) => {
  const task = String(req.body?.task || "").trim();
  const agentId = String(req.body?.agentId || "").trim() || undefined;
  const label = String(req.body?.label || "").trim() || undefined;
  const runTimeoutSeconds = Number(req.body?.runTimeoutSeconds || 1800);
  if (!task) return res.status(400).json({ ok: false, error: "task is required" });

  const cmd = [
    "openclaw", "sessions", "spawn",
    "--task", JSON.stringify(task),
    ...(agentId ? ["--agent", JSON.stringify(agentId)] : []),
    ...(label ? ["--label", JSON.stringify(label)] : []),
    "--run-timeout-seconds", String(runTimeoutSeconds),
  ].join(" ");

  const out = await shell(`${cmd} 2>/dev/null || true`, 12000);
  if (!out.stdout.trim()) {
    return res.status(500).json({ ok: false, error: "sessions_spawn unavailable from this runtime context", stderr: out.stderr || null });
  }
  return res.json({ ok: true, stdout: out.stdout.trim() });
});

app.get("/api/delegations/control/subagents", async (_req, res) => {
  const out = await shell("openclaw subagents list 2>/dev/null || true", 8000);
  if (!out.stdout.trim()) return res.status(500).json({ ok: false, error: "subagents list unavailable from this runtime context" });
  res.json({ ok: true, output: out.stdout.trim() });
});

app.post("/api/delegations/control/steer", async (req, res) => {
  const target = String(req.body?.target || "").trim();
  const message = String(req.body?.message || "").trim();
  if (!target || !message) return res.status(400).json({ ok: false, error: "target and message are required" });

  const out = await shell(`openclaw subagents steer --target ${JSON.stringify(target)} --message ${JSON.stringify(message)} 2>/dev/null || true`, 8000);
  if (!out.stdout.trim()) return res.status(500).json({ ok: false, error: "subagents steer unavailable from this runtime context" });
  res.json({ ok: true, output: out.stdout.trim() });
});

app.post("/api/delegations/control/kill", async (req, res) => {
  const target = String(req.body?.target || "").trim();
  if (!target) return res.status(400).json({ ok: false, error: "target is required" });

  const out = await shell(`openclaw subagents kill --target ${JSON.stringify(target)} 2>/dev/null || true`, 8000);
  if (!out.stdout.trim()) return res.status(500).json({ ok: false, error: "subagents kill unavailable from this runtime context" });
  res.json({ ok: true, output: out.stdout.trim() });
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
  const inAgentDir = row.files.includes(fileName);
  const inWorkspace = row.workspaceFiles?.includes(fileName);

  if (!inAgentDir && !inWorkspace) {
    return res.status(404).json({ ok: false, error: `${fileName} not found for ${agentId}` });
  }

  let workspaceRoot = WORKSPACE_ROOT;
  try {
    await fs.access(path.join(WORKSPACE_ROOT, fileName));
  } catch {
    workspaceRoot = WORKSPACE_ROOT_FALLBACK;
  }

  const fullPath = inAgentDir ? path.join(row.agentDir, fileName) : path.join(workspaceRoot, fileName);
  try {
    const text = await fs.readFile(fullPath, "utf8");
    return res.json({ ok: true, agentId, fileName, path: fullPath, source: inAgentDir ? "agent" : "workspace", text });
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

app.get("/api/changelog/public", async (_req, res) => {
  const candidates = [
    "/mithril-os/docs/CHANGELOG_PUBLIC.json",
    path.join(OPS_REPO_DIR, "docs/CHANGELOG_PUBLIC.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      return res.json({ ok: true, source: p, ...parsed });
    } catch {
      // try next
    }
  }
  return res.status(404).json({ ok: false, error: "Public changelog not found" });
});

app.get("/api/docs/openclaw-upgrade-checklist", async (_req, res) => {
  const candidates = [
    "/mithril-os/docs/OPENCLAW_UPGRADE_CHECKLIST.md",
    path.join(OPS_REPO_DIR, "docs/OPENCLAW_UPGRADE_CHECKLIST.md"),
  ];
  for (const p of candidates) {
    try {
      const content = await fs.readFile(p, "utf8");
      return res.json({ ok: true, source: p, content });
    } catch {
      // try next
    }
  }
  return res.status(404).json({ ok: false, error: "OpenClaw upgrade checklist not found" });
});

app.get("/api/docs/backup-restore-checklist", async (_req, res) => {
  const candidates = [
    "/mithril-os/docs/BACKUP_RESTORE_CHECKLIST.md",
    path.join(OPS_REPO_DIR, "docs/BACKUP_RESTORE_CHECKLIST.md"),
  ];
  for (const p of candidates) {
    try {
      const content = await fs.readFile(p, "utf8");
      return res.json({ ok: true, source: p, content });
    } catch {
      // try next
    }
  }
  return res.status(404).json({ ok: false, error: "Backup restore checklist not found" });
});

async function sendProjectsOverview(res) {
  const cfg = await readProjectsConfig();
  const rows = [];
  for (const p of cfg.projects || []) {
    rows.push(await getProjectRowStatus(p));
  }
  const healthy = rows.filter((r) => r.ok).length;
  const dirty = rows.filter((r) => r.dirty).length;
  res.json({
    ok: true,
    source: cfg.source,
    summary: {
      total: rows.length,
      healthy,
      dirty,
    },
    rows,
  });
}

app.get("/api/project-monitor/overview", async (_req, res) => {
  await sendProjectsOverview(res);
});

// Backward compatibility for previously shipped frontend path
app.get("/api/projects/overview", async (_req, res) => {
  await sendProjectsOverview(res);
});

app.get("/api/policies/overview", async (_req, res) => {
  const cfg = await readPoliciesConfig();
  const rows = [];
  for (const p of cfg.policies || []) {
    rows.push(await getPolicyRowStatus(p));
  }
  const active = rows.filter((r) => String(r.status || "").toLowerCase() === "active").length;
  const readable = rows.filter((r) => r.ok).length;
  res.json({
    ok: true,
    source: cfg.source,
    summary: {
      total: rows.length,
      active,
      readable,
    },
    rows,
  });
});

async function haRequest(pathname, opts = {}) {
  if (!HA_TOKEN) return { ok: false, error: "HA token missing" };
  try {
    const r = await fetch(`${HA_URL}${pathname}`, {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${HA_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

const HA_AREA_OVERRIDES = {
  "light.wiz_dimmable_white_a134db": "living_room",
  "light.wiz_dimmable_white_905fdd": "bedroom",
  "light.wiz_dimmable_white_8ffb36": "bedroom",
  "light.wiz_rgbw_tunable_b9eead": "dining_room",
  "light.wiz_rgbww_tunable_994a2a": "bedroom",
  "light.wiz_rgbw_tunable_3b5f12": "dining_room",
  "light.wiz_rgbw_tunable_ba35cf": "dining_room",
  "light.wiz_rgbw_tunable_b9e1f7": "dining_room",
  "switch.wiz_socket_e14f25": "office",
  "light.book_shelf_desk_light": "office",
  "light.book_shelf_whiskey_lights": "office",
  "light.tv_puck_lights": "office",
};

function inferArea(entity) {
  const id = entity.entity_id || "";
  if (HA_AREA_OVERRIDES[id]) return HA_AREA_OVERRIDES[id];
  const e = `${id} ${(entity.attributes?.friendly_name || "")}`.toLowerCase();
  if (e.includes("office")) return "office";
  if (e.includes("bedroom")) return "bedroom";
  if (e.includes("living")) return "living_room";
  if (e.includes("dining")) return "dining_room";
  return "other";
}

app.get("/api/ha/areas", async (_req, res) => {
  const states = await haRequest("/api/states");
  if (!states.ok) return res.status(500).json(states);

  const entities = (states.data || [])
    .filter((s) => s.entity_id?.startsWith("light.") || s.entity_id?.startsWith("switch."))
    .map((s) => {
      const domain = s.entity_id.split(".")[0];
      const brightness = domain === "light" && typeof s.attributes?.brightness === "number"
        ? Math.round((s.attributes.brightness / 255) * 100)
        : null;
      return {
        entity_id: s.entity_id,
        domain,
        area: inferArea(s),
        name: s.attributes?.friendly_name || s.entity_id,
        state: s.state,
        supportsBrightness: domain === "light",
        supportsColor: domain === "light" && Array.isArray(s.attributes?.supported_color_modes)
          ? s.attributes.supported_color_modes.some((m) => ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(String(m)))
          : false,
        hsColor: Array.isArray(s.attributes?.hs_color) ? s.attributes.hs_color : null,
        brightnessPct: brightness,
      };
    });

  const grouped = {
    office: entities.filter((e) => e.area === "office"),
    bedroom: entities.filter((e) => e.area === "bedroom"),
    living_room: entities.filter((e) => e.area === "living_room"),
    dining_room: entities.filter((e) => e.area === "dining_room"),
    other: entities.filter((e) => e.area === "other"),
  };

  res.json({ ok: true, grouped, total: entities.length, note: "Area inferred using explicit override map first, then friendly name/entity_id heuristics." });
});

app.post("/api/ha/entity/action", async (req, res) => {
  const entityId = String(req.body?.entity_id || "");
  const action = String(req.body?.action || "toggle");
  const brightnessPct = Number(req.body?.brightnessPct);
  const hue = Number(req.body?.hue);
  const saturation = Number(req.body?.saturation);
  if (!entityId || !entityId.includes(".")) return res.status(400).json({ ok: false, error: "entity_id required" });

  const [domain] = entityId.split(".");
  let service = action;
  if (!["toggle", "turn_on", "turn_off"].includes(service)) service = "toggle";

  const body = { entity_id: entityId };
  if (domain === "light" && service === "turn_on" && Number.isFinite(brightnessPct)) {
    body.brightness_pct = Math.max(1, Math.min(100, Math.round(brightnessPct)));
  }
  if (domain === "light" && service === "turn_on" && Number.isFinite(hue) && Number.isFinite(saturation)) {
    body.hs_color = [Math.max(0, Math.min(360, hue)), Math.max(0, Math.min(100, saturation))];
  }

  const result = await haRequest(`/api/services/${domain}/${service}`, { method: "POST", body });
  if (!result.ok) return res.status(500).json(result);

  res.json({ ok: true, result: result.data || null });
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

app.get("/api/git/commits", async (req, res) => {
  res.json(await getCommitTimeline(Number(req.query.limit || 20)));
});

app.get("/api/jobs", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit || 200), 2000));
  const kind = String(req.query.kind || "").toLowerCase();
  const status = String(req.query.status || "").toLowerCase();

  const events = await readJobLedger();
  let rows = foldJobs(events);
  if (kind) rows = rows.filter((r) => String(r.kind || "").toLowerCase() === kind);
  if (status) rows = rows.filter((r) => String(r.status || "").toLowerCase() === status);

  res.json({ ok: true, ledger: JOBS_LEDGER_FILE, count: rows.length, rows: rows.slice(0, limit) });
});

app.get("/api/jobs/summary", async (_req, res) => {
  const rows = foldJobs(await readJobLedger());
  const summary = {
    total: rows.length,
    queued: rows.filter((r) => r.status === "queued").length,
    started: rows.filter((r) => r.status === "started").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    done: rows.filter((r) => r.status === "done").length,
    failed: rows.filter((r) => r.status === "failed").length,
    delegation: rows.filter((r) => r.kind === "delegation").length,
    job: rows.filter((r) => r.kind !== "delegation").length,
  };
  res.json({ ok: true, summary, ledger: JOBS_LEDGER_FILE });
});

app.post("/api/jobs", async (req, res) => {
  const jobId = String(req.body?.jobId || "").trim();
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId is required" });

  const event = {
    jobId,
    event: "created",
    kind: String(req.body?.kind || "job").toLowerCase(),
    sourceAgent: String(req.body?.sourceAgent || "unknown"),
    targetAgent: req.body?.targetAgent ? String(req.body.targetAgent) : null,
    summary: String(req.body?.summary || ""),
    note: String(req.body?.note || ""),
    channelContext: req.body?.channelContext || null,
    at: req.body?.at || isoNow(),
  };

  await appendJobEvent(event);
  res.json({ ok: true, event, ledger: JOBS_LEDGER_FILE });
});

app.post("/api/jobs/:jobId/event", async (req, res) => {
  const jobId = String(req.params.jobId || "").trim();
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId is required" });

  const allowed = new Set(["created", "started", "blocked", "done", "failed", "updated"]);
  const ev = String(req.body?.event || "updated").toLowerCase();
  if (!allowed.has(ev)) return res.status(400).json({ ok: false, error: `Invalid event: ${ev}` });

  const event = {
    jobId,
    event: ev,
    kind: req.body?.kind ? String(req.body.kind).toLowerCase() : undefined,
    sourceAgent: req.body?.sourceAgent ? String(req.body.sourceAgent) : undefined,
    targetAgent: req.body?.targetAgent !== undefined ? String(req.body.targetAgent || "") : undefined,
    summary: req.body?.summary ? String(req.body.summary) : undefined,
    result: req.body?.result ? String(req.body.result) : undefined,
    error: req.body?.error ? String(req.body.error) : undefined,
    note: req.body?.note ? String(req.body.note) : undefined,
    channelContext: req.body?.channelContext || undefined,
    at: req.body?.at || isoNow(),
  };

  await appendJobEvent(event);
  res.json({ ok: true, event, ledger: JOBS_LEDGER_FILE });
});

app.post("/api/delegations/handoff/start", async (req, res) => {
  const targetAgent = String(req.body?.targetAgent || "").trim();
  const summary = String(req.body?.summary || "").trim();
  if (!targetAgent) return res.status(400).json({ ok: false, error: "targetAgent is required" });
  if (!summary) return res.status(400).json({ ok: false, error: "summary is required" });

  const requestedJobId = String(req.body?.jobId || "").trim();
  const stamp = new Date();
  const ymd = stamp.toISOString().slice(0, 10).replace(/-/g, "");
  const autoId = `DEL-${targetAgent.toUpperCase()}-${ymd}-${String(stamp.getTime()).slice(-6)}`;
  const jobId = requestedJobId || autoId;

  const sourceAgent = String(req.body?.sourceAgent || "oddeye").trim() || "oddeye";
  const channelContext = req.body?.channelContext || null;

  const created = {
    jobId,
    event: "created",
    kind: "delegation",
    sourceAgent,
    targetAgent,
    summary,
    note: String(req.body?.note || "").trim(),
    channelContext,
    at: req.body?.at || isoNow(),
  };
  const started = {
    jobId,
    event: "started",
    kind: "delegation",
    sourceAgent,
    targetAgent,
    summary,
    channelContext,
    at: req.body?.at || isoNow(),
  };

  await appendJobEvent(created);
  await appendJobEvent(started);

  const notify = req.body?.notify !== false;
  const notifyChannelId = String(req.body?.notifyChannelId || "1474209566437671096").trim();
  let notifyResult = null;
  if (notify && notifyChannelId) {
    const msg = [
      `👁️ #${sourceAgent}`,
      `Delegated to ${targetAgent}`,
      `Job ID: ${jobId}`,
      `Started: ${started.at}`,
      `Task: ${summary}`,
    ].join("\n");
    notifyResult = await sendDiscordChannelMessage(notifyChannelId, msg);
  }

  res.json({ ok: true, jobId, created, started, notifyResult, ledger: JOBS_LEDGER_FILE });
});

app.post("/api/delegations/handoff/complete", async (req, res) => {
  const jobId = String(req.body?.jobId || "").trim();
  if (!jobId) return res.status(400).json({ ok: false, error: "jobId is required" });

  const status = String(req.body?.status || "done").toLowerCase();
  const eventName = status === "failed" ? "failed" : "done";
  const event = {
    jobId,
    event: eventName,
    kind: "delegation",
    sourceAgent: req.body?.sourceAgent ? String(req.body.sourceAgent) : undefined,
    targetAgent: req.body?.targetAgent ? String(req.body.targetAgent) : undefined,
    summary: req.body?.summary ? String(req.body.summary) : undefined,
    result: req.body?.result ? String(req.body.result) : undefined,
    error: req.body?.error ? String(req.body.error) : undefined,
    note: req.body?.note ? String(req.body.note) : undefined,
    channelContext: req.body?.channelContext || undefined,
    at: req.body?.at || isoNow(),
  };

  await appendJobEvent(event);

  const sourceAgent = String(req.body?.sourceAgent || "oddeye");
  const targetAgent = String(req.body?.targetAgent || "koda");
  const notify = req.body?.notify !== false;
  const notifyChannelId = String(req.body?.notifyChannelId || "1474209566437671096").trim();
  let notifyResult = null;
  if (notify && notifyChannelId) {
    const statusWord = eventName === "done" ? "Completed" : "Failed";
    const details = eventName === "done" ? (event.result || event.summary || "No result summary provided") : (event.error || event.summary || "No failure detail provided");
    const msg = [
      `👁️ #${sourceAgent}`,
      `${statusWord} delegation for ${targetAgent}`,
      `Job ID: ${jobId}`,
      `${statusWord}: ${event.at}`,
      `Details: ${details}`,
    ].join("\n");
    notifyResult = await sendDiscordChannelMessage(notifyChannelId, msg);
  }

  res.json({ ok: true, jobId, event, notifyResult, ledger: JOBS_LEDGER_FILE });
});

app.get("/api/backups/status", async (_req, res) => {
  const cached = cacheGet("backups-status");
  if (cached) return res.json(cached);

  const latest = await shell("readlink -f /backup/latest || true", 2000);
  const timers = await shell("systemctl list-timers --all --no-pager | grep mithril-backup || true", 2500);
  const backupTimerDetail = await shell("systemctl show mithril-backup.timer -p NextElapseUSecRealtime -p LastTriggerUSec --value || true", 2500);
  const service = await shell("systemctl status mithril-backup.service --no-pager -n 40 || true", 3500);
  const snaps = await shell("find /backup/snapshots -mindepth 1 -maxdepth 1 -type d | wc -l", 2000);
  const usage = await shell("du -sh /backup 2>/dev/null || true", 2000);
  const list = await shell("find /backup/snapshots -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | head -n 40", 3000);
  const logs = await shell("journalctl -u mithril-backup.service -n 140 --no-pager || true", 4000);
  const offsiteLogs = await shell("tail -n 220 /backup/backup-history.log 2>/dev/null || true", 3000);
  const offsiteRoot = await shell("test -d /mnt/synology_backup/backups && echo yes || echo no", 1200);
  const offsiteTargets = await shell("for d in openclaw mithril-os bw-shell railfin-io homeassistant productivity-vault; do if [ -d \"/mnt/synology_backup/backups/$d/latest\" ]; then t=$(find \"/mnt/synology_backup/backups/$d/latest\" -type f -printf '%TY-%Tm-%Td %TH:%TM:%TS\\n' 2>/dev/null | sort -r | head -n1 | cut -d'.' -f1); echo \"$d|ok|${t:-unknown}\"; else echo \"$d|missing|-\"; fi; done", 5000);

  const snapshotNames = list.stdout.trim() ? list.stdout.trim().split("\n") : [];
  const snapshotRows = [];
  for (const s of snapshotNames) {
    const p = `/backup/snapshots/${s}`;
    const sizeOut = await shell(`du -sh ${JSON.stringify(p)} 2>/dev/null | awk '{print $1}'`, 2000);
    const countOut = await shell(`find ${JSON.stringify(p)} -type f | wc -l`, 2000);
    const shaOut = await shell(`[ -f ${JSON.stringify(p + "/sha256sums.txt")} ] && echo ok || echo missing`, 1000);
    snapshotRows.push({
      name: s,
      path: p,
      size: sizeOut.stdout.trim() || "?",
      fileCount: Number((countOut.stdout || "0").trim()) || 0,
      checksum: shaOut.stdout.trim() || "missing",
    });
  }

  const latestSnapshot = latest.stdout.trim() || null;
  const latestName = latestSnapshot ? latestSnapshot.split("/").pop() : null;
  const latestMeta = latestName ? (snapshotRows.find((r) => r.name === latestName) || null) : null;

  const serviceText = service.stdout || "";
  const failed = /Active:\s+failed/.test(serviceText) || /Result:\s+exit-code/.test(serviceText);

  const timerText = timers.stdout.trim() || "";
  const timerLooksPresent = timerText.length > 0;
  const snapshotCount = Number((snaps.stdout || "0").trim()) || 0;

  let health = "warning";
  let healthReason = "Waiting for first successful backup run.";
  if (failed) {
    health = "failed";
    healthReason = "Latest backup service run indicates failure.";
  } else if (timerLooksPresent && snapshotCount > 0) {
    health = "healthy";
    healthReason = "Timer is configured and at least one snapshot exists.";
  } else if (!timerLooksPresent && snapshotCount > 0) {
    health = "warning";
    healthReason = "Snapshots exist, but backup timer is not detected.";
  } else if (timerLooksPresent && snapshotCount === 0) {
    health = "warning";
    healthReason = "Timer detected, but no snapshots exist yet.";
  }

  const logText = logs.stdout || "";
  const offsiteHistoryText = offsiteLogs.stdout || "";
  const sourceLogText = `${logText}\n${offsiteHistoryText}`;

  const [srcOpenclaw, srcHA, srcMithril, srcBWShell, srcRailfin, srcObsidian] = await Promise.all([
    shell("test -d /home/mini-home-lab/.openclaw && echo yes || echo no", 800),
    shell("test -d /home/mini-home-lab/homelab/homeassistant/config && echo yes || echo no", 800),
    shell("test -d /mithril-os && echo yes || echo no", 800),
    shell("test -d '/home/mini-home-lab/.openclaw/workspace/work/bw-shell' && echo yes || echo no", 800),
    shell("test -d '/home/mini-home-lab/work/railfin.io' && echo yes || echo no", 800),
    shell("test -d '/home/mini-home-lab/.openclaw/workspace/productivity/Personal Assistant' && echo yes || echo no", 800),
  ]);

  const sourceExists = {
    openclaw: srcOpenclaw.stdout.trim() === "yes",
    homeassistant: srcHA.stdout.trim() === "yes",
    mithril: srcMithril.stdout.trim() === "yes",
    bwshell: srcBWShell.stdout.trim() === "yes",
    railfin: srcRailfin.stdout.trim() === "yes",
    obsidian: srcObsidian.stdout.trim() === "yes",
  };

  const statusFrom = (ok, exists) => {
    if (ok) return { ok: true, detail: "copied" };
    if (!exists) return { ok: false, detail: "missing source" };
    return { ok: false, detail: "empty source or not confirmed" };
  };

  const openclawState = statusFrom(sourceLogText.includes("ok: copied /home/mini-home-lab/.openclaw"), sourceExists.openclaw);
  const haState = statusFrom(sourceLogText.includes("ok: copied /home/mini-home-lab/homelab/homeassistant/config"), sourceExists.homeassistant);
  const mithrilState = statusFrom(sourceLogText.includes("ok: copied /mithril-os"), sourceExists.mithril);
  const bwState = statusFrom(sourceLogText.includes("ok: copied /home/mini-home-lab/.openclaw/workspace/work/bw-shell"), sourceExists.bwshell);
  const railfinState = statusFrom(sourceLogText.includes("ok: copied /home/mini-home-lab/work/railfin.io"), sourceExists.railfin);
  const obsidianCopied = /ok:\s+copied\s+obsidian\s+vault/i.test(sourceLogText);
  const obsidianState = statusFrom(obsidianCopied, sourceExists.obsidian);

  const sourceStatus = [
    { key: "openclaw", name: "OpenClaw", ...openclawState },
    { key: "homeassistant", name: "Home Assistant", ...haState },
    { key: "mithril", name: "Mithril-OS", ...mithrilState },
    { key: "bwshell", name: "BW-Shell", ...bwState },
    { key: "railfin", name: "Railfin", ...railfinState },
    { key: "obsidian", name: "Obsidian Vault", ...obsidianState },
  ];

  const timerValues = (backupTimerDetail.stdout || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const nextBackupAt = timerValues[0] || null;
  const lastBackupTriggerAt = timerValues[1] || null;
  const offsiteLastStartMatch = offsiteHistoryText.match(/\[(.*?)\]\s+offsite sync start \(smb\):.*$/gm);
  const offsiteLastDoneMatch = offsiteHistoryText.match(/\[(.*?)\]\s+offsite sync done.*$/gm);
  const parseBracketIso = (line) => {
    const m = String(line || "").match(/^\[([^\]]+)\]/);
    return m ? m[1] : null;
  };
  const offsiteLastStart = offsiteLastStartMatch?.length ? parseBracketIso(offsiteLastStartMatch[offsiteLastStartMatch.length - 1]) : null;
  const offsiteLastDone = offsiteLastDoneMatch?.length ? parseBracketIso(offsiteLastDoneMatch[offsiteLastDoneMatch.length - 1]) : null;

  const offsiteTargetRows = (offsiteTargets.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, status, lastSyncAt] = l.split("|");
      return { name, status, lastSyncAt };
    });

  const payload = {
    ok: true,
    latestSnapshot,
    latestSnapshotName: latestName,
    latestSnapshotMeta: latestMeta,
    snapshotCount,
    snapshotRows,
    timerLine: timers.stdout.trim() || null,
    backupUsage: usage.stdout.trim() || null,
    serviceStatusText: serviceText,
    backupHealth: health,
    backupHealthReason: healthReason,
    retention: { daily: 14, weekly: 8, monthly: 6 },
    sourceStatus,
    logsText: logText,
    nextBackupAt,
    lastBackupTriggerAt,
    offsite: {
      mode: "smb",
      mountReady: offsiteRoot.stdout.trim() === "yes",
      lastSyncStartAt: offsiteLastStart,
      lastSyncDoneAt: offsiteLastDone,
      targets: offsiteTargetRows,
      historyTail: offsiteHistoryText.split("\n").slice(-60).join("\n"),
    },
  };

  cacheSet("backups-status", payload, 20000);
  res.json(payload);
});

app.post("/api/backups/run", async (_req, res) => {
  const run = await shell("sudo -n systemctl start mithril-backup.service || systemctl start mithril-backup.service", 8000);
  if (!run.ok) return res.status(500).json(run);
  const status = await shell("systemctl status mithril-backup.service --no-pager -n 30 || true", 3000);
  API_CACHE.delete("backups-status");
  return res.json({ ok: true, run, status: status.stdout });
});

app.post("/api/backups/run-offsite", async (_req, res) => {
  const cmd = "sudo OFFSITE_SYNC=1 MODE=smb SMB_MOUNT=/mnt/synology_backup SMB_ROOT=backups /mithril-os/scripts/backup-offsite-synology.sh";
  const run = await shell(cmd, 120000);
  if (!run.ok) return res.status(500).json(run);
  const tail = await shell("tail -n 120 /backup/backup-history.log 2>/dev/null || true", 3000);
  API_CACHE.delete("backups-status");
  return res.json({ ok: true, run, history: tail.stdout || "" });
});

async function getScheduledJobsRows() {
  const watchers = await getWatchersStatus();
  const timer = await shell("systemctl list-timers --all --no-pager | grep -E 'mithril-backup|mithril-delegation-review|NEXT|LEFT' || true", 3000);
  const backupService = await shell("systemctl is-active mithril-backup.service || true", 1500);
  const reviewService = await shell("systemctl is-active mithril-delegation-review.service || true", 1500);

  let cronRows = [];
  const cronOut = await shell("openclaw cron list 2>/dev/null || true", 3000);
  if (cronOut.ok && cronOut.stdout.trim()) {
    cronRows = cronOut.stdout.trim().split("\n").slice(0, 20);
  }

  const watcherRows = (watchers.rows || []).map((w) => ({
    kind: "watcher",
    name: w.name || w.id,
    schedule: `interval ${w.effectiveIntervalSeconds || w.defaultIntervalSeconds || "?"}s`,
    status: w.running ? "running" : "stopped",
    detail: w.systemdService ? `service: ${w.systemdService} (${w.systemdActive})` : (w.processInfo || "process"),
  }));

  const jobRows = [
    {
      kind: "backup",
      name: "mithril-backup",
      schedule: "daily (systemd timer)",
      status: (backupService.stdout || "unknown").trim() || "unknown",
      detail: (timer.stdout || "timer info unavailable").trim() || "timer info unavailable",
    },
    {
      kind: "delegation-review",
      name: "mithril-delegation-review",
      schedule: "every 30m (systemd timer)",
      status: (reviewService.stdout || "unknown").trim() || "unknown",
      detail: (timer.stdout || "timer info unavailable").trim() || "timer info unavailable",
    },
    ...watcherRows,
  ];

  if (cronRows.length) {
    for (const line of cronRows) {
      jobRows.push({ kind: "openclaw-cron", name: "cron", schedule: "cron", status: "configured", detail: line });
    }
  }

  return jobRows;
}

app.get("/api/scheduled-jobs", async (_req, res) => {
  const rows = await getScheduledJobsRows();
  res.json({ ok: true, rows });
});

app.get("/api/work/overview", async (req, res) => {
  const type = String(req.query.type || "").toLowerCase();
  const statusFilter = String(req.query.status || "").toLowerCase();
  const limit = Math.max(1, Math.min(Number(req.query.limit || 300), 2000));

  const scheduledRows = await getScheduledJobsRows();
  const jobRows = foldJobs(await readJobLedger());

  const normalizedScheduled = scheduledRows
    .filter((r) => r.kind !== "watcher")
    .map((r) => ({
      id: `sched:${r.kind}:${r.name}`,
      type: "scheduled",
      source: r.kind,
      owner: "system",
      assignee: r.name,
      status: r.status || "unknown",
      task: r.name,
      whenText: r.schedule || "scheduled",
      summary: r.detail || "",
      updatedAt: null,
      details: r,
    }));

  const normalizedJobs = jobRows.map((r) => ({
    id: r.jobId,
    type: r.kind === "delegation" ? "delegation" : "job",
    source: r.kind || "job",
    owner: r.sourceAgent || "unknown",
    assignee: r.targetAgent || r.sourceAgent || "unknown",
    status: r.status === "started" ? "running" : (r.status || "queued"),
    task: r.summary || r.jobId,
    whenText: r.createdAt || r.updatedAt || "-",
    summary: r.result || r.error || r.summary || "",
    updatedAt: r.updatedAt || null,
    details: r,
  }));

  let rows = [...normalizedScheduled, ...normalizedJobs]
    .sort((a, b) => String(b.updatedAt || b.whenText || "").localeCompare(String(a.updatedAt || a.whenText || "")));

  if (type) rows = rows.filter((r) => r.type === type);
  if (statusFilter) rows = rows.filter((r) => String(r.status || "").toLowerCase() === statusFilter);

  const summary = {
    total: rows.length,
    scheduled: rows.filter((r) => r.type === "scheduled").length,
    running: rows.filter((r) => r.status === "running").length,
    queued: rows.filter((r) => r.status === "queued").length,
    blocked: rows.filter((r) => r.status === "blocked").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };

  res.json({ ok: true, summary, rows: rows.slice(0, limit) });
});

app.get("/api/deploy/center", async (_req, res) => {
  const [latestCommit, deployLogStat, procOps, procDeploy, deployLogTail] = await Promise.all([
    shell("git -C /mithril-os log -1 --pretty=format:'%h|%cI|%s'", 1500),
    shell("if [ -f /tmp/mithril-os-ops-console.log ]; then stat -c '%Y' /tmp/mithril-os-ops-console.log; fi", 1200),
    shell("ps -eo pid,etimes,cmd | grep -E 'node .*ops-console|npm run dev' | grep -v grep || true", 1500),
    shell("ps -eo pid,etimes,cmd | grep -E '/mithril-os/scripts/deploy-ops-console.sh|flock.*ops-console' | grep -v grep || true", 1500),
    shell("tail -n 30 /tmp/mithril-os-ops-console.log 2>/dev/null || true", 1200),
  ]);

  const [hash, time, subject] = String(latestCommit.stdout || "").split("|");
  const mtimeSec = Number((deployLogStat.stdout || "").trim() || 0);

  res.json({
    ok: true,
    latestCommit: hash ? { hash, time, subject } : null,
    deployLogMtime: mtimeSec ? new Date(mtimeSec * 1000).toISOString() : null,
    opsRunning: Boolean((procOps.stdout || "").trim()),
    activeDeployProcesses: (procDeploy.stdout || "").trim(),
    deployLogTail: (deployLogTail.stdout || "").trim(),
  });
});

app.get("/api/deploy/lock-status", async (_req, res) => {
  const lockPathA = "/tmp/mithril-ops-console-deploy.lock";
  const lockPathB = "/var/lock/mithril-ops-console-deploy.lock";
  const [a, b, proc] = await Promise.all([
    shell(`if [ -e ${JSON.stringify(lockPathA)} ]; then stat -c '%n|%Y|%s' ${JSON.stringify(lockPathA)}; fi`, 1200),
    shell(`if [ -e ${JSON.stringify(lockPathB)} ]; then stat -c '%n|%Y|%s' ${JSON.stringify(lockPathB)}; fi`, 1200),
    shell("ps -eo pid,etimes,cmd | grep -E '/mithril-os/scripts/deploy-ops-console.sh|flock.*ops-console' | grep -v grep || true", 1500),
  ]);

  const nowSec = Math.floor(Date.now() / 1000);
  const parseLock = (line) => {
    if (!line) return null;
    const [path, mtime, size] = String(line).trim().split("|");
    const mt = Number(mtime || 0);
    return {
      path,
      mtimeSec: mt || null,
      ageSec: mt ? Math.max(0, nowSec - mt) : null,
      size: Number(size || 0),
    };
  };

  const locks = [parseLock(a.stdout.trim()), parseLock(b.stdout.trim())].filter(Boolean);
  const lockPresent = locks.length > 0;
  res.json({ ok: true, lockPresent, locks, activeProcesses: proc.stdout.trim() || "" });
});

app.post("/api/actions/:action", async (req, res) => {
  const action = req.params.action;
  const confirm = String(req.body?.confirm || "").toLowerCase() === "yes";
  if (!confirm) return res.status(400).json({ ok: false, error: "Confirmation required: {confirm:'yes'}" });

  let result;
  if (action === "deploy-ops-console") {
    result = await shell("/mithril-os/scripts/deploy-ops-console.sh", 20000);
  } else if (action === "deploy-ops-console-unlock") {
    result = await shell("sudo pkill -f '/mithril-os/scripts/deploy-ops-console.sh' || true; sudo pkill -f 'flock.*ops-console' || true; sudo rm -f /tmp/mithril-ops-console-deploy.lock /var/lock/mithril-ops-console-deploy.lock || true; /mithril-os/scripts/deploy-ops-console.sh", 30000);
  } else if (action === "restart-ops-console") {
    result = await shell("pkill -f 'node src/server.js' || true; cd /mithril-os/apps/ops-console && nohup npm run dev >/tmp/mithril-os-ops-console.log 2>&1 &", 8000);
  } else if (action === "restart-watcher") {
    const stop = await runWatcherAction("ops-console-watcher", "stop");
    const start = await runWatcherAction("ops-console-watcher", "start");
    result = { ok: stop.ok && start.ok, stdout: JSON.stringify({ stop, start }), stderr: "" };
  } else if (action === "restart-homeassistant") {
    result = await shell("docker restart homeassistant", 15000);
  } else if (action === "restart-openclaw-gateway") {
    result = await shell("cd /home/mini-home-lab/openclaw && docker compose up -d --force-recreate openclaw-gateway socat-proxy", 120000);
  } else if (action === "update-openclaw-gateway") {
    result = await shell("/home/mini-home-lab/openclaw/oc-upgrade-safe.sh", 180000);
  } else if (action === "logs-openclaw-gateway") {
    result = await shell("docker logs --tail=120 openclaw-gateway", 15000);
  } else if (action === "postupdate-openclaw-check") {
    result = await shell("set -e; echo '== Compose working dir =='; docker inspect openclaw-gateway --format '{{ index .Config.Labels \"com.docker.compose.project.working_dir\" }}' || true; echo; echo '== Image =='; docker inspect openclaw-gateway --format '{{.Config.Image}}' || true; echo; echo '== Container status =='; docker ps --filter name=openclaw-gateway --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}'; echo; echo '== API status =='; curl -sS http://127.0.0.1:3001/api/status || true", 30000);  
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
