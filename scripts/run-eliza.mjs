import "dotenv/config";

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentServer, jsonToCharacter } from "@elizaos/server";
import anthropicPlugin from "@elizaos/plugin-anthropic";
import bootstrapPlugin from "@elizaos/plugin-bootstrap";
import mcpPlugin from "@elizaos/plugin-mcp";
import openaiPlugin from "@elizaos/plugin-openai";
import telegramPlugin from "@elizaos/plugin-telegram";

import {
  auditorReviewerPlugin,
  hitlPlugin,
  scoutPlugin,
  uiBridgePlugin,
} from "../dist/index.js";
import {
  createReadinessSnapshot,
  formatReadinessLines,
  setReadinessSnapshot,
} from "../dist/readiness.js";

const mode = process.argv[2];

if (!mode || !["dev", "start"].includes(mode)) {
  console.error('Usage: node ./scripts/run-eliza.mjs <dev|start>');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const port = 3001;
process.env.SERVER_PORT = String(port);
process.env.PORT = String(port);

function firstCommandPath(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  return (
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function resolvePythonCommand() {
  const explicit = process.env.IMMUNEFI_PYTHON_CMD;
  if (explicit) {
    return explicit;
  }

  if (process.platform === "win32") {
    return (
      firstCommandPath("py") ||
      firstCommandPath("python") ||
      firstCommandPath("python3")
    );
  }

  return (
    firstCommandPath("python3") ||
    firstCommandPath("python") ||
    firstCommandPath("py")
  );
}

function resolveConfigPath(sourceDir, value) {
  if (typeof value !== "string" || !value.startsWith(".")) {
    return value;
  }

  const fromCharacterDir = path.resolve(sourceDir, value);
  if (existsSync(fromCharacterDir)) {
    return fromCharacterDir;
  }

  const fromProjectRoot = path.resolve(projectRoot, value);
  if (existsSync(fromProjectRoot)) {
    return fromProjectRoot;
  }

  return value;
}

function buildReadinessResult({
  key,
  label,
  feature,
  state,
  available,
  summary,
  details = [],
  action,
}) {
  return {
    key,
    label,
    feature,
    state,
    available,
    summary,
    details,
    action,
    checkedAt: new Date().toISOString(),
  };
}

function tailText(value, fallback) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.slice(-3).join(" | ") || fallback;
}

function joinUrl(base, suffix) {
  return `${String(base).replace(/\/+$/, "")}/${String(suffix).replace(/^\/+/, "")}`;
}

async function diagnoseImmunefiReadiness() {
  if (process.env.DEMO_MODE === "true") {
    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "disabled",
      available: false,
      summary: "DEMO_MODE is enabled, so live Immunefi discovery is skipped.",
      action: "Unset DEMO_MODE to exercise the live Scout workflow.",
    });
  }

  const sourcePath = path.join(projectRoot, "characters", "scout.character.json");
  const normalizedCharacter = normalizeCharacter(sourcePath);
  const serverConfig = normalizedCharacter.settings?.mcp?.servers?.immunefi;
  const pythonCommand = resolvePythonCommand();
  const requirementsPath = path.join(projectRoot, "mcp-servers", "immunefi", "requirements.txt");
  const installHint = existsSync(requirementsPath)
    ? `Run "${pythonCommand || "python"} -m pip install -r mcp-servers/immunefi/requirements.txt".`
    : "Install the Python packages required by the Immunefi MCP server.";

  if (!serverConfig || typeof serverConfig !== "object") {
    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "blocked",
      available: false,
      summary: "Scout character is missing the Immunefi MCP server configuration.",
      action: "Restore the immunefi server entry in characters/scout.character.json.",
    });
  }

  const scriptArg = Array.isArray(serverConfig.args) ? serverConfig.args[0] : null;
  const scriptPath =
    typeof scriptArg === "string"
      ? path.isAbsolute(scriptArg)
        ? scriptArg
        : path.resolve(projectRoot, scriptArg)
      : null;

  if (!scriptPath || !existsSync(scriptPath)) {
    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "blocked",
      available: false,
      summary: "The configured Immunefi MCP server script could not be found.",
      details: scriptPath ? [`Script: ${scriptPath}`] : [],
      action: "Restore mcp-servers/immunefi/immunefi.py or fix the Scout character path.",
    });
  }

  if (!pythonCommand) {
    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "blocked",
      available: false,
      summary: "Python could not be resolved for the Immunefi MCP server.",
      details: [`Script: ${path.relative(projectRoot, scriptPath)}`],
      action: "Install Python 3 or set IMMUNEFI_PYTHON_CMD to a working interpreter.",
    });
  }

  const importCheck = spawnSync(
    pythonCommand,
    [
      "-c",
      "import importlib.util, sys; modules=['mcp','httpx','pydantic']; missing=[name for name in modules if importlib.util.find_spec(name) is None]; print(','.join(missing)); raise SystemExit(1 if missing else 0)",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
    }
  );

  if (importCheck.error) {
    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "blocked",
      available: false,
      summary: "Python could not execute the Immunefi dependency probe.",
      details: [tailText(importCheck.error.message, "Unknown Python execution error.")],
      action: installHint,
    });
  }

  if (importCheck.status !== 0) {
    const missing = (importCheck.stdout || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);

    return buildReadinessResult({
      key: "immunefiMcp",
      label: "Immunefi MCP",
      feature: "Live Scout discovery",
      state: "blocked",
      available: false,
      summary:
        missing.length > 0
          ? `Missing Python packages for Immunefi MCP: ${missing.join(", ")}.`
          : "The Immunefi MCP Python dependency probe failed.",
      details: [
        `Python: ${pythonCommand}`,
        `Script: ${path.relative(projectRoot, scriptPath)}`,
        tailText(importCheck.stderr, "No additional Python error details were emitted."),
      ],
      action: installHint,
    });
  }

  return buildReadinessResult({
    key: "immunefiMcp",
    label: "Immunefi MCP",
    feature: "Live Scout discovery",
    state: "ready",
    available: true,
    summary: "Python dependencies for the Immunefi MCP server are installed.",
    details: [
      `Python: ${pythonCommand}`,
      `Script: ${path.relative(projectRoot, scriptPath)}`,
    ],
  });
}

async function diagnoseModelReadiness() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const apiUrl = String(
    process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || ""
  ).trim();
  const modelName = String(process.env.MODEL_NAME || "configured default").trim();

  if (!apiUrl) {
    return buildReadinessResult({
      key: "model",
      label: "OpenAI-Compatible Model",
      feature: "LLM-backed audit and review",
      state: "blocked",
      available: false,
      summary: "OPENAI_API_URL is not set.",
      action: "Set OPENAI_API_URL to a reachable OpenAI-compatible endpoint.",
    });
  }

  if (!apiKey) {
    return buildReadinessResult({
      key: "model",
      label: "OpenAI-Compatible Model",
      feature: "LLM-backed audit and review",
      state: "blocked",
      available: false,
      summary: "OPENAI_API_KEY is not set.",
      action: "Set OPENAI_API_KEY before running LLM-backed audits.",
    });
  }

  const probeUrl = joinUrl(apiUrl, "models");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (response.ok) {
      return buildReadinessResult({
        key: "model",
        label: "OpenAI-Compatible Model",
        feature: "LLM-backed audit and review",
        state: "ready",
        available: true,
        summary: "Model endpoint accepted the readiness probe.",
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
      });
    }

    if (response.status === 401 || response.status === 403) {
      return buildReadinessResult({
        key: "model",
        label: "OpenAI-Compatible Model",
        feature: "LLM-backed audit and review",
        state: "blocked",
        available: false,
        summary: `Model endpoint rejected authentication (${response.status} ${response.statusText}).`,
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
        action: "Update OPENAI_API_KEY or point OPENAI_API_URL at a valid endpoint.",
      });
    }

    if (response.status === 404) {
      return buildReadinessResult({
        key: "model",
        label: "OpenAI-Compatible Model",
        feature: "LLM-backed audit and review",
        state: "degraded",
        available: true,
        summary: "Model endpoint is reachable, but the /models readiness probe returned 404.",
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
        action: "Verify that OPENAI_API_URL points at the API root expected by the OpenAI plugin.",
      });
    }

    return buildReadinessResult({
      key: "model",
      label: "OpenAI-Compatible Model",
      feature: "LLM-backed audit and review",
      state: "degraded",
      available: false,
      summary: `Model endpoint readiness probe failed with ${response.status} ${response.statusText}.`,
      details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
      action: "Check endpoint availability and credentials before relying on model-backed audits.",
    });
  } catch (error) {
    return buildReadinessResult({
      key: "model",
      label: "OpenAI-Compatible Model",
      feature: "LLM-backed audit and review",
      state: "degraded",
      available: false,
      summary: "Model endpoint could not be reached during readiness probing.",
      details: [`Endpoint: ${probeUrl}`, tailText(error?.message, "Unknown model probe error.")],
      action: "Verify network access and the OPENAI_API_URL value.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function diagnoseTelegramReadiness() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();

  if (!token) {
    return buildReadinessResult({
      key: "telegram",
      label: "Telegram",
      feature: "Telegram alerts and approval controls",
      state: "disabled",
      available: false,
      summary: "TELEGRAM_BOT_TOKEN is not set.",
      action: "Set TELEGRAM_BOT_TOKEN to enable Telegram alerts and /approve controls.",
    });
  }

  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return buildReadinessResult({
      key: "telegram",
      label: "Telegram",
      feature: "Telegram alerts and approval controls",
      state: "blocked",
      available: false,
      summary: "TELEGRAM_BOT_TOKEN is present but does not match the expected bot token format.",
      action: "Replace TELEGRAM_BOT_TOKEN with a valid token from BotFather.",
    });
  }

  return buildReadinessResult({
    key: "telegram",
    label: "Telegram",
    feature: "Telegram alerts and approval controls",
    state: "ready",
    available: true,
    summary: "Telegram bot token is configured.",
  });
}

async function collectReadinessSnapshot() {
  const integrations = {
    immunefiMcp: await diagnoseImmunefiReadiness(),
    model: await diagnoseModelReadiness(),
    telegram: diagnoseTelegramReadiness(),
  };
  const snapshot = createReadinessSnapshot(integrations);
  setReadinessSnapshot(snapshot);
  return snapshot;
}

function normalizeCharacter(sourcePath) {
  const sourceDir = path.dirname(sourcePath);
  const character = JSON.parse(readFileSync(sourcePath, "utf8"));
  const normalized = { ...character };

  if (Array.isArray(normalized.lore) && normalized.lore.length > 0) {
    const bio = Array.isArray(normalized.bio)
      ? normalized.bio
      : normalized.bio
        ? [normalized.bio]
        : [];

    normalized.bio = [...new Set([...bio, ...normalized.lore])];
  }

  delete normalized.clients;
  delete normalized.modelProvider;
  delete normalized.lore;
  delete normalized.plugins;

  const pythonCommand = resolvePythonCommand();
  const mcpServers = normalized.settings?.mcp?.servers;
  if (mcpServers && typeof mcpServers === "object") {
    for (const serverConfig of Object.values(mcpServers)) {
      if (
        pythonCommand &&
        serverConfig &&
        typeof serverConfig === "object" &&
        serverConfig.command === "python"
      ) {
        serverConfig.command = pythonCommand;
      }

      if (Array.isArray(serverConfig?.args)) {
        serverConfig.args = serverConfig.args.map((arg) =>
          resolveConfigPath(sourceDir, arg)
        );
      }
    }
  }

  return normalized;
}

async function loadCharacter(filename) {
  const sourcePath = path.join(projectRoot, "characters", filename);
  return jsonToCharacter(normalizeCharacter(sourcePath));
}

const readinessSnapshot = await collectReadinessSnapshot();
for (const line of formatReadinessLines(readinessSnapshot)) {
  const isHealthy = line.includes(": ready") || line.includes("overall=ready");
  console[isHealthy ? "log" : "warn"](line);
}

function getBasePlugins() {
  const plugins = [bootstrapPlugin];

  if (
    String(process.env.OPENAI_API_KEY || "").trim() &&
    String(process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || "").trim()
  ) {
    plugins.push(openaiPlugin);
  }

  if (process.env.ANTHROPIC_API_KEY) {
    plugins.push(anthropicPlugin);
  }

  return plugins;
}

const scoutPlugins = [
  ...getBasePlugins(),
  hitlPlugin,
  uiBridgePlugin,
  scoutPlugin,
];

if (readinessSnapshot.integrations.telegram.available) {
  scoutPlugins.splice(1, 0, telegramPlugin);
}

if (readinessSnapshot.integrations.immunefiMcp.available) {
  scoutPlugins.splice(
    readinessSnapshot.integrations.telegram.available ? 2 : 1,
    0,
    mcpPlugin
  );
}

const agents = [
  {
    character: await loadCharacter("scout.character.json"),
    plugins: scoutPlugins,
  },
  {
    character: await loadCharacter("auditor.character.json"),
    plugins: [
      ...getBasePlugins(),
      ...(readinessSnapshot.integrations.immunefiMcp.available ? [mcpPlugin] : []),
      auditorReviewerPlugin,
    ],
  },
  {
    character: await loadCharacter("reviewer.character.json"),
    plugins: [...getBasePlugins(), auditorReviewerPlugin],
  },
];

const server = new AgentServer();
await server.start({
  port,
  agents,
});

console.log(
  `[vigilance] ${mode} backend listening on http://127.0.0.1:${port}`
);
