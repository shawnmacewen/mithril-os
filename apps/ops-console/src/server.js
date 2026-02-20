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
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || "/home/node/.openclaw/workspace";
const WORKSPACE_ROOT_FALLBACK = "/home/mini-home-lab/.openclaw/workspace";
const AGENT_ROUTING_CONFIG = process.env.AGENT_ROUTING_CONFIG || "/mithril-os/config/agent-routing.json";
const AGENT_ARTIFACTS_DIR = process.env.AGENT_ARTIFACTS_DIR || "/mithril-os/ops-artifacts";
const DELEGATIONS_FILE = process.env.DELEGATIONS_FILE || "/mithril-os/ops-artifacts/delegations.jsonl";

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

app.get("/api/agent-control/overview", async (_req, res) => {
  const agents = await getAgentMdIndex();
  const routing = await readRoutingConfig();
  const delegations = await readDelegations(200);

  const latestById = new Map();
  for (const row of delegations.rows || []) {
    if (!row?.id) continue;
    if (!latestById.has(row.id)) latestById.set(row.id, row);
  }
  const latest = [...latestById.values()];
  const counts = {
    queued: latest.filter((r) => r.status === "queued").length,
    running: latest.filter((r) => r.status === "running").length,
    blocked: latest.filter((r) => r.status === "blocked").length,
    needsReview: latest.filter((r) => r.status === "needs-review").length,
    done: latest.filter((r) => r.status === "done").length,
  };

  const now = Date.now();
  const staleRunning = latest.filter((r) => r.status === "running" && r.ts && (now - Date.parse(r.ts)) > (60 * 60 * 1000)).length;

  res.json({
    ok: true,
    routing: routing.parsed,
    agentIds: (agents.rows || []).map((r) => r.agentId),
    delegations: latest.slice(0, 25),
    counts,
    cadence: {
      staleRunning,
      reviewHint: staleRunning > 0 ? "Review running delegations older than 60 minutes." : "No stale running delegations.",
    },
  });
});

app.get("/api/delegations/health", async (_req, res) => {
  const delegations = await readDelegations(300);
  const latestById = new Map();
  for (const row of delegations.rows || []) {
    if (!row?.id) continue;
    if (!latestById.has(row.id)) latestById.set(row.id, row);
  }
  const latest = [...latestById.values()];
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

app.post("/api/delegations", async (req, res) => {
  const body = req.body || {};
  const id = `dlg_${Date.now()}`;
  const row = {
    id,
    ts: new Date().toISOString(),
    status: "queued",
    ownerAgentId: body.ownerAgentId || "main",
    assigneeAgentId: body.assigneeAgentId || "main",
    objective: body.objective || "",
    context: body.context || "",
    constraints: body.constraints || "",
    deliverable: body.deliverable || "",
    deliverableFormat: body.deliverableFormat || "",
    priority: body.priority || "normal",
    deadline: body.deadline || null,
    definitionOfDone: body.definitionOfDone || "",
    escalationRule: body.escalationRule || "",
    source: body.source || "coo-delegation",
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
  const row = {
    id,
    ts: new Date().toISOString(),
    event: "status-update",
    status: nextStatus,
    note: String(req.body?.note || ""),
    actorAgentId: String(req.body?.actorAgentId || "main"),
  };
  await appendDelegation(row);
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
    },
  });
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
  if (!entityId || !entityId.includes(".")) return res.status(400).json({ ok: false, error: "entity_id required" });

  const [domain] = entityId.split(".");
  let service = action;
  if (!["toggle", "turn_on", "turn_off"].includes(service)) service = "toggle";

  const body = { entity_id: entityId };
  if (domain === "light" && service === "turn_on" && Number.isFinite(brightnessPct)) {
    body.brightness_pct = Math.max(1, Math.min(100, Math.round(brightnessPct)));
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

app.get("/api/backups/status", async (_req, res) => {
  const latest = await shell("readlink -f /backup/latest || true", 2000);
  const timers = await shell("systemctl list-timers --all --no-pager | grep mithril-backup || true", 2500);
  const service = await shell("systemctl status mithril-backup.service --no-pager -n 40 || true", 3500);
  const snaps = await shell("find /backup/snapshots -mindepth 1 -maxdepth 1 -type d | wc -l", 2000);
  const usage = await shell("du -sh /backup 2>/dev/null || true", 2000);
  const list = await shell("find /backup/snapshots -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | head -n 40", 3000);
  const logs = await shell("journalctl -u mithril-backup.service -n 140 --no-pager || true", 4000);

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
  const sourceStatus = [
    {
      key: "openclaw",
      name: "OpenClaw",
      ok: logText.includes("ok: copied /home/mini-home-lab/.openclaw"),
      detail: logText.includes("ok: copied /home/mini-home-lab/.openclaw") ? "copied" : "not confirmed",
    },
    {
      key: "homeassistant",
      name: "Home Assistant",
      ok: logText.includes("ok: copied /home/mini-home-lab/homelab/homeassistant/config"),
      detail: logText.includes("ok: copied /home/mini-home-lab/homelab/homeassistant/config") ? "copied" : "not confirmed",
    },
    {
      key: "mithril",
      name: "Mithril-OS",
      ok: logText.includes("ok: copied /mithril-os"),
      detail: logText.includes("ok: copied /mithril-os") ? "copied" : "not confirmed",
    },
  ];

  res.json({
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
  });
});

app.post("/api/backups/run", async (_req, res) => {
  const run = await shell("sudo -n systemctl start mithril-backup.service || systemctl start mithril-backup.service", 8000);
  if (!run.ok) return res.status(500).json(run);
  const status = await shell("systemctl status mithril-backup.service --no-pager -n 30 || true", 3000);
  return res.json({ ok: true, run, status: status.stdout });
});

app.get("/api/scheduled-jobs", async (_req, res) => {
  const watchers = await getWatchersStatus();
  const timer = await shell("systemctl list-timers --all --no-pager | grep -E 'mithril-backup|NEXT|LEFT' || true", 3000);
  const backupService = await shell("systemctl is-active mithril-backup.service || true", 1500);

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
    ...watcherRows,
  ];

  if (cronRows.length) {
    for (const line of cronRows) {
      jobRows.push({ kind: "openclaw-cron", name: "cron", schedule: "cron", status: "configured", detail: line });
    }
  }

  res.json({ ok: true, rows: jobRows });
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
