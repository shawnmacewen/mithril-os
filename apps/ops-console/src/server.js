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
  const service = await shell("systemctl status mithril-backup.service --no-pager -n 20 || true", 3000);
  const snaps = await shell("find /backup/snapshots -mindepth 1 -maxdepth 1 -type d | wc -l", 2000);
  const usage = await shell("du -sh /backup 2>/dev/null || true", 2000);

  res.json({
    ok: true,
    latestSnapshot: latest.stdout.trim() || null,
    snapshotCount: Number((snaps.stdout || "0").trim()) || 0,
    timerLine: timers.stdout.trim() || null,
    backupUsage: usage.stdout.trim() || null,
    serviceStatusText: service.stdout || "",
  });
});

app.post("/api/backups/run", async (_req, res) => {
  const run = await shell("sudo -n systemctl start mithril-backup.service || systemctl start mithril-backup.service", 8000);
  if (!run.ok) return res.status(500).json(run);
  const status = await shell("systemctl status mithril-backup.service --no-pager -n 30 || true", 3000);
  return res.json({ ok: true, run, status: status.stdout });
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
