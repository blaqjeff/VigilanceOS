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

function getBasePlugins() {
  const plugins = [bootstrapPlugin, openaiPlugin];

  if (process.env.ANTHROPIC_API_KEY) {
    plugins.push(anthropicPlugin);
  }

  return plugins;
}

const scoutPlugins = [
  ...getBasePlugins(),
  mcpPlugin,
  hitlPlugin,
  uiBridgePlugin,
  scoutPlugin,
];

if (process.env.TELEGRAM_BOT_TOKEN) {
  scoutPlugins.splice(2, 0, telegramPlugin);
}

const agents = [
  {
    character: await loadCharacter("scout.character.json"),
    plugins: scoutPlugins,
  },
  {
    character: await loadCharacter("auditor.character.json"),
    plugins: [...getBasePlugins(), mcpPlugin, auditorReviewerPlugin],
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

if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.warn(
    "[vigilance] TELEGRAM_BOT_TOKEN is not set; Scout approval remains available through the UI bridge."
  );
}

console.log(
  `[vigilance] ${mode} backend listening on http://127.0.0.1:${port}`
);
