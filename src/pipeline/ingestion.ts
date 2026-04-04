import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { logger } from "@elizaos/core";
import type {
  IngestionResult,
  MaterializationAttempt,
  RepoHotspot,
  RepoHotspotKind,
  RepoImportEdge,
  RepoIndex,
  RepoNeighborhood,
  RepoSymbol,
  SourceFile,
  Target,
  TargetCategory,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max bytes per file before truncation */
const MAX_FILE_BYTES = 32_000;
/** Max total source files to include in the audit context */
const MAX_FILES_FOR_AUDIT = 40;
/** Max total bytes of source content to include */
const MAX_TOTAL_BYTES = 200_000;
/** Max bytes per file to parse while building the repo index */
const MAX_INDEX_FILE_BYTES = 64_000;
/** Max total bytes to read while building the repo index */
const MAX_INDEX_TOTAL_BYTES = 1_500_000;
/** Clone timeout for the first attempt */
const CLONE_TIMEOUT_MS = 90_000;
/** Longer timeout for retry strategies */
const CLONE_RETRY_TIMEOUT_MS = 180_000;
/** Limits to keep the repo index compact enough for jobs/UI storage */
const MAX_INDEX_SYMBOLS = 220;
const MAX_INDEX_IMPORTS = 220;
const MAX_INDEX_HOTSPOTS = 120;
/** Temporary clone directory */
const CLONE_BASE_DIR = path.join(
  process.env.VIGILANCE_WORK_DIR ?? path.resolve(".", ".vigilance-work")
);

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

const AUDIT_EXTENSIONS = new Set([
  ".sol",
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".move",
  ".toml",    // Cargo.toml, Anchor.toml
  ".json",    // package.json, foundry.json, etc.
  ".yaml",
  ".yml",
]);

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "target",
  "build",
  "dist",
  "out",
  ".next",
  "__pycache__",
  ".cache",
  "coverage",
  "artifacts",     // hardhat artifacts
  "typechain-types",
  "cache",
]);

const IGNORE_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
]);

const CONFIG_FILENAMES = new Set([
  "cargo.toml",
  "anchor.toml",
  "package.json",
  "foundry.toml",
  "hardhat.config.ts",
  "hardhat.config.js",
  "truffle-config.js",
  "remappings.txt",
]);

function classifyLanguage(
  filePath: string
): SourceFile["language"] {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".sol":
      return "solidity";
    case ".rs":
      return "rust";
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".py":
      return "python";
    case ".move":
      return "move";
    default:
      return "other";
  }
}

function isAuditRelevant(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  // Always include config files
  if (CONFIG_FILENAMES.has(base)) {
    return true;
  }

  return AUDIT_EXTENSIONS.has(ext) && !IGNORE_FILES.has(base);
}

// Priority scoring to select the most relevant files
function filePriority(relativePath: string): number {
  const lower = relativePath.toLowerCase();
  let score = 0;

  // Solidity contracts
  if (lower.includes("/contracts/") || lower.includes("/src/") && lower.endsWith(".sol")) score += 10;
  if (lower.endsWith(".sol")) score += 8;

  // Rust programs
  if (lower.includes("/programs/") && lower.endsWith(".rs")) score += 10;
  if (lower.includes("lib.rs") || lower.includes("processor.rs") || lower.includes("instruction.rs")) score += 8;
  if (lower.endsWith(".rs")) score += 6;

  // Config files to understand project structure
  if (lower.endsWith("cargo.toml") || lower.endsWith("anchor.toml")) score += 5;
  if (lower.endsWith("package.json") || lower.endsWith("foundry.toml")) score += 4;

  // Test files are lower priority but still useful
  if (lower.includes("/test/") || lower.includes("/tests/") || lower.includes(".test.")) score -= 2;

  // Web/app source
  if (lower.endsWith(".ts") || lower.endsWith(".js")) score += 2;

  // Deeply nested = slightly less relevant
  const depth = lower.split("/").length;
  score -= Math.min(depth, 5);

  return score;
}

function isComment(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function tailText(text: string | null | undefined, maxLines = 4): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\r?\n/).slice(-maxLines).join(" | ");
}

function summarizeSignature(line: string, max = 120): string {
  const compact = line.trim().replace(/\s+/g, " ");
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function isConfigFile(relativePath: string): boolean {
  return CONFIG_FILENAMES.has(path.basename(relativePath).toLowerCase());
}

function isTestFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith(".test.ts") ||
    lower.endsWith(".test.js") ||
    lower.endsWith(".spec.ts") ||
    lower.endsWith(".spec.js") ||
    lower.endsWith(".t.sol")
  );
}

function isEntryFile(relativePath: string, language: SourceFile["language"]): boolean {
  const lower = relativePath.toLowerCase();
  if (isConfigFile(relativePath)) return true;
  if (language === "solidity") {
    return lower.endsWith(".sol") && (lower.includes("/src/") || lower.includes("/contracts/"));
  }
  if (language === "rust") {
    return (
      lower.endsWith("/lib.rs") ||
      lower.endsWith("/processor.rs") ||
      lower.endsWith("/instruction.rs") ||
      lower.endsWith("/state.rs") ||
      lower.endsWith("/entrypoint.rs")
    );
  }
  if (language === "typescript" || language === "javascript") {
    return lower.includes("/src/") || lower.startsWith("src/");
  }
  return false;
}

// ---------------------------------------------------------------------------
// Walk directory
// ---------------------------------------------------------------------------

function walkDir(
  dir: string,
  rootDir: string,
  results: { relativePath: string; absolutePath: string }[]
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walkDir(fullPath, rootDir, results);
    } else if (entry.isFile()) {
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
      if (isAuditRelevant(fullPath)) {
        results.push({ relativePath, absolutePath: fullPath });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Classify target category
// ---------------------------------------------------------------------------

function classifyCategory(files: { relativePath: string }[]): {
  primary: TargetCategory;
  all: TargetCategory[];
} {
  let solidity = 0;
  let rust = 0;
  let web = 0;
  let hasAnchor = false;
  let hasFoundry = false;
  let hasHardhat = false;

  for (const { relativePath } of files) {
    const lower = relativePath.toLowerCase();
    const ext = path.extname(lower);

    if (ext === ".sol") solidity++;
    if (ext === ".rs") rust++;
    if (ext === ".ts" || ext === ".js" || ext === ".tsx" || ext === ".jsx") web++;
    if (lower.includes("anchor.toml")) hasAnchor = true;
    if (lower.includes("foundry.toml")) hasFoundry = true;
    if (lower.includes("hardhat.config")) hasHardhat = true;
  }

  const categories: TargetCategory[] = [];

  if (rust > 0 || hasAnchor) categories.push("solana_rust");
  if (solidity > 0 || hasFoundry || hasHardhat) categories.push("solidity_evm");
  if (web > 0 && solidity === 0 && rust === 0) categories.push("web_app");

  if (categories.length === 0) return { primary: "unknown", all: ["unknown"] };
  if (categories.length === 1) return { primary: categories[0], all: categories };
  return { primary: categories[0], all: categories };
}

// ---------------------------------------------------------------------------
// Build structure summary
// ---------------------------------------------------------------------------

function buildStructureSummary(
  files: { relativePath: string }[],
  category: TargetCategory
): string {
  const dirs = new Set<string>();
  const exts = new Map<string, number>();

  for (const { relativePath } of files) {
    const dir = path.dirname(relativePath);
    if (dir !== ".") dirs.add(dir);
    const ext = path.extname(relativePath);
    exts.set(ext, (exts.get(ext) ?? 0) + 1);
  }

  const topDirs = Array.from(dirs).sort().slice(0, 15);
  const extSummary = Array.from(exts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([ext, count]) => `${ext}: ${count}`)
    .join(", ");

  return [
    `Category: ${category}`,
    `Total files: ${files.length}`,
    `File types: ${extSummary}`,
    `Key directories: ${topDirs.join(", ") || "(root only)"}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Repo indexing
// ---------------------------------------------------------------------------

function extractImportEdges(
  relativePath: string,
  content: string,
  language: SourceFile["language"]
): RepoImportEdge[] {
  const edges: RepoImportEdge[] = [];
  const seen = new Set<string>();

  function pushTarget(target: string) {
    const normalized = target.trim();
    if (!normalized) return;
    const key = `${relativePath}:${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: relativePath, target: normalized });
  }

  if (language === "solidity") {
    const matches = content.matchAll(/^\s*import\s+[^'"]*["']([^"']+)["'];?/gm);
    for (const match of matches) pushTarget(match[1] ?? "");
  } else if (language === "rust") {
    const matches = content.matchAll(/^\s*use\s+([^;]+);/gm);
    for (const match of matches) pushTarget(match[1] ?? "");
  } else if (language === "typescript" || language === "javascript") {
    const importMatches = content.matchAll(
      /^\s*import(?:["'\s]*[\w*{}\n, ]+from\s*)?["']([^"']+)["'];?/gm
    );
    for (const match of importMatches) pushTarget(match[1] ?? "");
    const requireMatches = content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g);
    for (const match of requireMatches) pushTarget(match[1] ?? "");
  } else if (language === "python") {
    const pyImports = content.matchAll(/^\s*(?:from\s+([A-Za-z0-9_\.]+)\s+import|import\s+([A-Za-z0-9_\.]+))/gm);
    for (const match of pyImports) pushTarget(match[1] ?? match[2] ?? "");
  }

  return edges;
}

function createSymbolPusher(target: RepoSymbol[]) {
  const seen = new Set<string>();
  return (symbol: RepoSymbol) => {
    if (target.length >= MAX_INDEX_SYMBOLS) return;
    const key = `${symbol.kind}:${symbol.file}:${symbol.line}:${symbol.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push(symbol);
  };
}

function createHotspotPusher(target: RepoHotspot[]) {
  const seen = new Set<string>();
  return (hotspot: RepoHotspot) => {
    if (target.length >= MAX_INDEX_HOTSPOTS) return;
    const key = `${hotspot.kind}:${hotspot.file}:${hotspot.line}:${hotspot.reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.push(hotspot);
  };
}

function extractSolidityIndexData(
  relativePath: string,
  content: string,
  pushSymbol: (symbol: RepoSymbol) => void,
  pushHotspot: (hotspot: RepoHotspot) => void
): void {
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || isComment(trimmed)) continue;

    const contractMatch = trimmed.match(/\b(contract|library|interface)\s+([A-Za-z_]\w*)/);
    if (contractMatch) {
      const kind = contractMatch[1] as RepoSymbol["kind"];
      const name = contractMatch[2];
      pushSymbol({
        kind,
        name,
        file: relativePath,
        line: index + 1,
        signature: summarizeSignature(line),
      });
      pushHotspot({
        kind: "entrypoint",
        file: relativePath,
        line: index + 1,
        reason: `${kind} ${name} defines a primary Solidity audit surface.`,
        priority: 70,
        relatedSymbol: name,
      });
    }

    const modifierMatch = trimmed.match(/\bmodifier\s+([A-Za-z_]\w*)\s*\(/);
    if (modifierMatch) {
      const name = modifierMatch[1];
      pushSymbol({
        kind: "modifier",
        name,
        file: relativePath,
        line: index + 1,
        signature: summarizeSignature(line),
      });
      pushHotspot({
        kind: "auth",
        file: relativePath,
        line: index + 1,
        reason: `Modifier ${name} may gate privileged execution paths.`,
        priority: 85,
        relatedSymbol: name,
      });
    }

    const functionMatch = trimmed.match(/\bfunction\s+([A-Za-z_]\w*)\s*\(/);
    if (functionMatch) {
      const name = functionMatch[1];
      const tags = [
        /\bexternal\b/.test(trimmed) ? "external" : "",
        /\bpublic\b/.test(trimmed) ? "public" : "",
        /\bpayable\b/.test(trimmed) ? "payable" : "",
        /\bview\b/.test(trimmed) ? "view" : "",
      ].filter(Boolean);
      pushSymbol({
        kind: "function",
        name,
        file: relativePath,
        line: index + 1,
        signature: summarizeSignature(line),
        tags,
      });
    }

    if (/\b(onlyOwner|onlyRole|auth|requiresAuth|onlyThis)\b/.test(trimmed)) {
      pushHotspot({
        kind: "auth",
        file: relativePath,
        line: index + 1,
        reason: "Authorization guard or custom access-control pattern present.",
        priority: 90,
      });
    }

    if (/\b(latestRoundData|slot0|getReserves|observe)\b/.test(trimmed)) {
      pushHotspot({
        kind: "oracle",
        file: relativePath,
        line: index + 1,
        reason: "Oracle or pricing primitive detected.",
        priority: 95,
      });
    }

    if (/\b(initialize|initializer|upgradeTo|upgradeToAndCall|_authorizeUpgrade|delegatecall)\b/.test(trimmed)) {
      pushHotspot({
        kind: "upgradeability",
        file: relativePath,
        line: index + 1,
        reason: "Initializer, upgrade, or delegatecall path detected.",
        priority: 95,
      });
    }

    if (/\.(call|delegatecall|staticcall)\b|\.safeTransfer\(|\.transferFrom\(|\.approve\(/.test(trimmed)) {
      pushHotspot({
        kind: "external_call",
        file: relativePath,
        line: index + 1,
        reason: "External call or token-transfer surface detected.",
        priority: 88,
      });
    }

    if (/\b(balance|balances|reward|rewards|totalSupply|shares|debt|reserve)\b/.test(trimmed)) {
      pushHotspot({
        kind: "value_flow",
        file: relativePath,
        line: index + 1,
        reason: "Value-accounting state appears in this code path.",
        priority: 74,
      });
    }
  }
}

function extractRustIndexData(
  relativePath: string,
  content: string,
  pushSymbol: (symbol: RepoSymbol) => void,
  pushHotspot: (hotspot: RepoHotspot) => void
): void {
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || isComment(trimmed)) continue;

    const previous = lines[index - 1]?.trim() ?? "";

    const programMatch = trimmed.match(/\bpub\s+mod\s+([A-Za-z_]\w*)/);
    if (programMatch) {
      const name = programMatch[1];
      if (previous.includes("#[program]")) {
        pushSymbol({
          kind: "program",
          name,
          file: relativePath,
          line: index + 1,
          signature: summarizeSignature(line),
        });
        pushHotspot({
          kind: "entrypoint",
          file: relativePath,
          line: index + 1,
          reason: `Program module ${name} defines Solana instruction entrypoints.`,
          priority: 85,
          relatedSymbol: name,
        });
      }
    }

    const structMatch = trimmed.match(/\bpub\s+struct\s+([A-Za-z_]\w*)/);
    if (structMatch) {
      const name = structMatch[1];
      const kind = previous.includes("#[derive(Accounts)]")
        ? "account_struct"
        : previous.includes("#[account]")
          ? "state_struct"
          : null;
      if (kind) {
        pushSymbol({
          kind,
          name,
          file: relativePath,
          line: index + 1,
          signature: summarizeSignature(line),
        });
        pushHotspot({
          kind: kind === "account_struct" ? "account_validation" : "value_flow",
          file: relativePath,
          line: index + 1,
          reason:
            kind === "account_struct"
              ? `Accounts struct ${name} defines runtime validation boundaries.`
              : `State struct ${name} stores protocol state.`,
          priority: kind === "account_struct" ? 92 : 75,
          relatedSymbol: name,
        });
      }
    }

    const functionMatch = trimmed.match(/\b(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/);
    if (functionMatch) {
      const name = functionMatch[1];
      const kind = previous.includes("#[program]") || relativePath.endsWith("/lib.rs")
        ? "instruction"
        : "function";
      pushSymbol({
        kind,
        name,
        file: relativePath,
        line: index + 1,
        signature: summarizeSignature(line),
      });
      if (/(initialize|init|withdraw|deposit|transfer|mint|burn|redeem|close)/i.test(name)) {
        pushHotspot({
          kind: "value_flow",
          file: relativePath,
          line: index + 1,
          reason: `State- or funds-touching instruction/function ${name} detected.`,
          priority: 82,
          relatedSymbol: name,
        });
      }
    }

    if (/\b(invoke_signed|invoke|CpiContext::new)\b/.test(trimmed)) {
      pushHotspot({
        kind: "cpi",
        file: relativePath,
        line: index + 1,
        reason: "Cross-program invocation surface detected.",
        priority: 96,
      });
    }

    if (/\b(find_program_address|create_program_address|seeds\s*=)\b/.test(trimmed)) {
      pushHotspot({
        kind: "pda",
        file: relativePath,
        line: index + 1,
        reason: "PDA derivation or seed handling detected.",
        priority: 92,
      });
    }

    if (/\b(UncheckedAccount|AccountInfo)\b/.test(trimmed)) {
      pushHotspot({
        kind: "account_validation",
        file: relativePath,
        line: index + 1,
        reason: "Raw account handle detected and should be checked for validation boundaries.",
        priority: 94,
      });
    }

    if (/\b(Signer<'info>|authority|admin|owner)\b/.test(trimmed)) {
      pushHotspot({
        kind: "auth",
        file: relativePath,
        line: index + 1,
        reason: "Authority or signer-related logic detected.",
        priority: 84,
      });
    }

    if (/\b(pyth|switchboard|oracle|price)\b/i.test(trimmed)) {
      pushHotspot({
        kind: "oracle",
        file: relativePath,
        line: index + 1,
        reason: "Oracle or price-related logic detected.",
        priority: 93,
      });
    }
  }
}

function buildRepoIndex(
  files: { relativePath: string; absolutePath: string }[],
  category: TargetCategory
): RepoIndex {
  const dirCounts = new Map<string, number>();
  const extensionCounts = new Map<string, number>();
  const entryFiles = new Set<string>();
  const configFiles = new Set<string>();
  const testFiles = new Set<string>();
  const symbols: RepoSymbol[] = [];
  const imports: RepoImportEdge[] = [];
  const hotspots: RepoHotspot[] = [];
  const skippedIndexedFiles: string[] = [];
  const importSeen = new Set<string>();
  const pushSymbol = createSymbolPusher(symbols);
  const pushHotspot = createHotspotPusher(hotspots);

  const sortedFiles = [...files].sort((left, right) => {
    const priorityDelta = filePriority(right.relativePath) - filePriority(left.relativePath);
    if (priorityDelta !== 0) return priorityDelta;
    return left.relativePath.localeCompare(right.relativePath);
  });

  for (const file of files) {
    const dir = path.dirname(file.relativePath);
    if (dir !== ".") {
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }
    const ext = path.extname(file.relativePath) || "(none)";
    extensionCounts.set(ext, (extensionCounts.get(ext) ?? 0) + 1);

    const language = classifyLanguage(file.relativePath);
    if (isEntryFile(file.relativePath, language)) entryFiles.add(file.relativePath);
    if (isConfigFile(file.relativePath)) configFiles.add(file.relativePath);
    if (isTestFile(file.relativePath)) testFiles.add(file.relativePath);
  }

  let totalIndexedBytes = 0;
  let indexedFiles = 0;

  for (const file of sortedFiles) {
    let stat;
    try {
      stat = statSync(file.absolutePath);
    } catch {
      skippedIndexedFiles.push(file.relativePath);
      continue;
    }

    if (stat.size > MAX_INDEX_FILE_BYTES || totalIndexedBytes + stat.size > MAX_INDEX_TOTAL_BYTES) {
      skippedIndexedFiles.push(file.relativePath);
      continue;
    }

    try {
      const content = readFileSync(file.absolutePath, "utf8");
      totalIndexedBytes += content.length;
      indexedFiles += 1;
      const language = classifyLanguage(file.relativePath);

      for (const edge of extractImportEdges(file.relativePath, content, language)) {
        if (imports.length >= MAX_INDEX_IMPORTS) break;
        const key = `${edge.from}:${edge.target}`;
        if (importSeen.has(key)) continue;
        importSeen.add(key);
        imports.push(edge);
      }

      if (language === "solidity") {
        extractSolidityIndexData(file.relativePath, content, pushSymbol, pushHotspot);
      } else if (language === "rust") {
        extractRustIndexData(file.relativePath, content, pushSymbol, pushHotspot);
      }
    } catch {
      skippedIndexedFiles.push(file.relativePath);
    }
  }

  hotspots.sort((left, right) => {
    const priorityDelta = right.priority - left.priority;
    if (priorityDelta !== 0) return priorityDelta;
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    return left.line - right.line;
  });

  symbols.sort((left, right) => {
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    if (left.line !== right.line) return left.line - right.line;
    return left.name.localeCompare(right.name);
  });

  const topDirectories = Array.from(dirCounts.entries())
    .sort((left, right) => {
      const countDelta = right[1] - left[1];
      if (countDelta !== 0) return countDelta;
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 12)
    .map(([dir, count]) => `${dir} (${count})`);

  const symbolCounts: Record<string, number> = {};
  for (const symbol of symbols) {
    symbolCounts[symbol.kind] = (symbolCounts[symbol.kind] ?? 0) + 1;
  }

  const hotspotPreview = hotspots
    .slice(0, 8)
    .map((hotspot) => `${hotspot.kind}: ${hotspot.file}:${hotspot.line} - ${hotspot.reason}`);

  const summary = [
    "=== REPO INDEX ===",
    `Category: ${category}`,
    `Indexed files: ${indexedFiles}/${files.length}`,
    `Entry files: ${Array.from(entryFiles).slice(0, 10).join(", ") || "none"}`,
    `Configs: ${Array.from(configFiles).slice(0, 10).join(", ") || "none"}`,
    `Tests: ${Array.from(testFiles).slice(0, 10).join(", ") || "none"}`,
    `Symbol counts: ${
      Object.entries(symbolCounts)
        .sort((left, right) => right[1] - left[1])
        .map(([kind, count]) => `${kind}: ${count}`)
        .join(", ") || "none"
    }`,
    hotspotPreview.length > 0 ? `Top hotspots:\n- ${hotspotPreview.join("\n- ")}` : "Top hotspots: none",
  ].join("\n");

  return {
    indexedFiles,
    skippedIndexedFiles,
    topDirectories,
    extensionCounts: Object.fromEntries(extensionCounts.entries()),
    entryFiles: Array.from(entryFiles).sort().slice(0, 30),
    configFiles: Array.from(configFiles).sort().slice(0, 30),
    testFiles: Array.from(testFiles).sort().slice(0, 30),
    symbolCounts,
    symbols: symbols.slice(0, MAX_INDEX_SYMBOLS),
    imports: imports.slice(0, MAX_INDEX_IMPORTS),
    hotspots: hotspots.slice(0, MAX_INDEX_HOTSPOTS),
    summary,
  };
}

function neighborhoodRoot(relativePath: string, category: TargetCategory): string {
  const segments = relativePath.split("/");

  if (category === "solana_rust") {
    const programsIndex = segments.indexOf("programs");
    if (programsIndex >= 0 && segments.length > programsIndex + 1) {
      return segments.slice(0, programsIndex + 2).join("/");
    }
    if (segments[0] === "tests" || segments[0] === "test") return segments[0];
    if (segments[0] === "migrations") return "migrations";
  }

  if (category === "solidity_evm") {
    if ((segments[0] === "src" || segments[0] === "contracts") && segments.length >= 2) {
      return segments[1]?.endsWith(".sol") ? segments[0] : segments.slice(0, 2).join("/");
    }
    if ((segments[0] === "test" || segments[0] === "tests") && segments.length >= 2) {
      return segments.slice(0, 2).join("/");
    }
  }

  if (segments.length >= 2) return segments.slice(0, 2).join("/");
  return segments[0] ?? relativePath;
}

function resolveLocalImport(from: string, target: string): string | null {
  const cleaned = target.trim();
  if (!cleaned.startsWith(".")) return null;

  const fromDir = path.posix.dirname(from);
  let resolved = path.posix.normalize(path.posix.join(fromDir, cleaned));

  if (!path.posix.extname(resolved)) {
    const candidates = [
      `${resolved}.sol`,
      `${resolved}.rs`,
      `${resolved}.ts`,
      `${resolved}.tsx`,
      `${resolved}.js`,
      `${resolved}.jsx`,
      `${resolved}/index.ts`,
      `${resolved}/index.js`,
      `${resolved}/lib.rs`,
    ];
    return candidates[0] ?? null;
  }

  return resolved;
}

function buildNeighborhoods(
  files: { relativePath: string; absolutePath: string }[],
  repoIndex: RepoIndex,
  category: TargetCategory
): RepoNeighborhood[] {
  const allByPath = new Map(files.map((file) => [file.relativePath, file]));
  const groupedByRoot = new Map<string, Set<string>>();
  for (const file of files) {
    const root = neighborhoodRoot(file.relativePath, category);
    if (!groupedByRoot.has(root)) groupedByRoot.set(root, new Set());
    groupedByRoot.get(root)!.add(file.relativePath);
  }

  const seedRoots = new Map<string, { reason: string; priority: number; hotspots: RepoHotspot[] }>();

  for (const hotspot of repoIndex.hotspots.slice(0, 24)) {
    const root = neighborhoodRoot(hotspot.file, category);
    const current = seedRoots.get(root);
    if (!current || hotspot.priority > current.priority) {
      seedRoots.set(root, {
        reason: hotspot.reason,
        priority: hotspot.priority,
        hotspots: [hotspot],
      });
    } else {
      current.hotspots.push(hotspot);
    }
  }

  for (const entryFile of repoIndex.entryFiles.slice(0, 18)) {
    const root = neighborhoodRoot(entryFile, category);
    if (!seedRoots.has(root)) {
      seedRoots.set(root, {
        reason: "Primary entry file or config path.",
        priority: 60,
        hotspots: [],
      });
    }
  }

  const testSet = new Set(repoIndex.testFiles);
  const neighborhoods: RepoNeighborhood[] = [];

  for (const [root, seed] of Array.from(seedRoots.entries()).sort((left, right) => right[1].priority - left[1].priority)) {
    const filesInRoot = new Set(groupedByRoot.get(root) ?? []);
    const seedFiles = new Set<string>();

    for (const hotspot of seed.hotspots.slice(0, 8)) {
      seedFiles.add(hotspot.file);
      filesInRoot.add(hotspot.file);
    }

    for (const entryFile of repoIndex.entryFiles) {
      if (neighborhoodRoot(entryFile, category) === root) {
        seedFiles.add(entryFile);
        filesInRoot.add(entryFile);
      }
    }

    const currentFiles = Array.from(filesInRoot);
    for (const currentFile of currentFiles) {
      const importEdges = repoIndex.imports.filter((edge) => edge.from === currentFile);
      for (const edge of importEdges) {
        const resolved = resolveLocalImport(edge.from, edge.target);
        if (resolved && allByPath.has(resolved)) {
          filesInRoot.add(resolved);
        }
      }
    }

    const rootToken = path.posix.basename(root).toLowerCase();
    for (const testFile of testSet) {
      const testBase = path.posix.basename(testFile).toLowerCase();
      if (rootToken && (testBase.includes(rootToken) || testFile.toLowerCase().includes(rootToken))) {
        filesInRoot.add(testFile);
      }
    }

    const orderedFiles = Array.from(filesInRoot)
      .filter((file) => allByPath.has(file))
      .sort((left, right) => {
        const priorityDelta = filePriority(right) - filePriority(left);
        if (priorityDelta !== 0) return priorityDelta;
        return left.localeCompare(right);
      })
      .slice(0, 14);

    const hotspotSummary = seed.hotspots
      .slice(0, 4)
      .map((hotspot) => `${hotspot.kind}:${hotspot.file}:${hotspot.line}`)
      .join(", ");

    neighborhoods.push({
      id: `nh_${root.replace(/[^a-zA-Z0-9]+/g, "_")}`,
      label: root,
      root,
      reason: seed.reason,
      seedFiles: Array.from(seedFiles).sort(),
      files: orderedFiles,
      hotspots: seed.hotspots.slice(0, 8),
      summary: [
        `Neighborhood: ${root}`,
        `Reason: ${seed.reason}`,
        `Files: ${orderedFiles.join(", ") || "none"}`,
        hotspotSummary ? `Hotspots: ${hotspotSummary}` : "Hotspots: none",
      ].join("\n"),
    });
  }

  return neighborhoods.slice(0, 10);
}

// ---------------------------------------------------------------------------
// GitHub cloning
// ---------------------------------------------------------------------------

function normalizeGithubCloneUrl(url: string): string {
  let cleaned = url.trim().replace(/\/$/, "");
  // Remove fragments and query params
  cleaned = cleaned.split("#")[0].split("?")[0];
  // Remove /tree/... paths
  cleaned = cleaned.replace(/\/tree\/[^/]+.*$/, "");
  // Ensure .git suffix
  if (!cleaned.endsWith(".git")) cleaned += ".git";
  return cleaned;
}

function isMaterializedRepoUsable(localPath: string): boolean {
  if (!existsSync(localPath)) return false;

  try {
    if (!statSync(localPath).isDirectory()) return false;
    const entries = readdirSync(localPath, { withFileTypes: true }).filter(
      (entry) => entry.name !== ".git"
    );
    return entries.length > 0;
  } catch {
    return false;
  }
}

function runCloneAttempt(
  cloneUrl: string,
  tempDir: string,
  strategy: { name: string; args: string[]; timeoutMs: number }
): MaterializationAttempt {
  const startedAt = Date.now();
  const result = spawnSync("git", ["clone", ...strategy.args, cloneUrl, tempDir], {
    encoding: "utf8",
    timeout: strategy.timeoutMs,
    cwd: process.cwd(),
  });

  return {
    strategy: strategy.name,
    ok: !result.error && result.status === 0,
    timeoutMs: strategy.timeoutMs,
    durationMs: Date.now() - startedAt,
    exitCode: result.status,
    stdoutTail: tailText(result.stdout),
    stderrTail: tailText(result.stderr),
    error: result.error ? `Git clone spawn error: ${result.error.message}` : undefined,
  };
}

function cloneRepo(
  url: string,
  destDir: string
): {
  ok: boolean;
  cloneUrl: string;
  reusedExisting?: boolean;
  attempts: MaterializationAttempt[];
  error?: string;
} {
  const cloneUrl = normalizeGithubCloneUrl(url);
  const attempts: MaterializationAttempt[] = [];

  logger.info(`[Ingestion] Cloning ${cloneUrl} -> ${destDir}`);

  if (isMaterializedRepoUsable(destDir)) {
    attempts.push({
      strategy: "reuse_existing",
      ok: true,
      durationMs: 0,
    });
    return { ok: true, cloneUrl, reusedExisting: true, attempts };
  }

  if (existsSync(destDir)) {
    rmSync(destDir, { recursive: true, force: true });
  }

  mkdirSync(path.dirname(destDir), { recursive: true });

  const strategies = [
    {
      name: "shallow_clone",
      args: ["--depth", "1", "--single-branch", "--no-tags"],
      timeoutMs: CLONE_TIMEOUT_MS,
    },
    {
      name: "blobless_retry",
      args: ["--depth", "1", "--single-branch", "--no-tags", "--filter=blob:none"],
      timeoutMs: CLONE_RETRY_TIMEOUT_MS,
    },
  ];

  for (let index = 0; index < strategies.length; index++) {
    const strategy = strategies[index];
    const tempDir = `${destDir}.tmp-${Date.now()}-${index}`;

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    const attempt = runCloneAttempt(cloneUrl, tempDir, strategy);
    if (attempt.ok && !isMaterializedRepoUsable(tempDir)) {
      attempt.ok = false;
      attempt.error = "Clone command finished but the materialized repo looks incomplete.";
    }

    attempts.push(attempt);

    if (attempt.ok) {
      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true, force: true });
      }
      renameSync(tempDir, destDir);
      return { ok: true, cloneUrl, reusedExisting: false, attempts };
    }

    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  const error =
    lastAttempt?.error ||
    lastAttempt?.stderrTail ||
    "Git clone failed after all retry strategies.";
  return { ok: false, cloneUrl, attempts, error };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ingest a target — clone if GitHub, validate if local, extract source files.
 */
export async function ingestTarget(target: Target): Promise<IngestionResult> {
  let localPath: string;
  let cloned = false;
  let materialization: IngestionResult["materialization"];

  if (target.type === "github" && target.url) {
    mkdirSync(CLONE_BASE_DIR, { recursive: true });
    localPath = path.join(CLONE_BASE_DIR, target.targetId);
    const cloneResult = cloneRepo(target.url, localPath);
    if (!cloneResult.ok) {
      throw new Error(`Failed to clone ${target.url}: ${cloneResult.error}`);
    }
    cloned = true;
    materialization = {
      source: "github_clone",
      localPath,
      cloneUrl: cloneResult.cloneUrl,
      reusedExisting: cloneResult.reusedExisting ?? false,
      attempts: cloneResult.attempts,
    };
  } else if (target.type === "local" && target.localPath) {
    localPath = target.localPath;
    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }
    const stat = statSync(localPath);
    if (!stat.isDirectory()) {
      throw new Error(`Local path is not a directory: ${localPath}`);
    }
    materialization = {
      source: "local_path",
      localPath,
      attempts: [
        {
          strategy: "local_path",
          ok: true,
          durationMs: 0,
        },
      ],
    };
  } else if (target.type === "immunefi") {
    // For Immunefi targets, we need GitHub repos from scout data
    // This will be populated if the scout found repos
    throw new Error(
      "Immunefi targets require GitHub repositories from scout data. " +
        "Pass the GitHub URL directly instead."
    );
  } else {
    throw new Error(`Unsupported target type for ingestion: ${target.type}`);
  }

  // Walk and collect files
  const allFiles: { relativePath: string; absolutePath: string }[] = [];
  walkDir(localPath, localPath, allFiles);

  // Classify
  const { primary: category, all: categories } = classifyCategory(allFiles);
  const repoIndex = buildRepoIndex(allFiles, category);
  const neighborhoods = buildNeighborhoods(allFiles, repoIndex, category);

  const sorted = allFiles
    .map((f) => ({ ...f, priority: filePriority(f.relativePath) }))
    .sort((a, b) => b.priority - a.priority);

  const selectedPaths: string[] = [];
  const selectedSet = new Set<string>();

  for (const neighborhood of neighborhoods) {
    for (const file of neighborhood.files) {
      if (selectedPaths.length >= MAX_FILES_FOR_AUDIT) break;
      if (!selectedSet.has(file)) {
        selectedSet.add(file);
        selectedPaths.push(file);
      }
    }
    if (selectedPaths.length >= MAX_FILES_FOR_AUDIT) break;
  }

  for (const file of sorted) {
    if (selectedPaths.length >= MAX_FILES_FOR_AUDIT) break;
    if (!selectedSet.has(file.relativePath)) {
      selectedSet.add(file.relativePath);
      selectedPaths.push(file.relativePath);
    }
  }

  const selected = selectedPaths
    .map((relativePath) => allFiles.find((file) => file.relativePath === relativePath))
    .filter((file): file is { relativePath: string; absolutePath: string } => Boolean(file));

  const skippedFiles = sorted
    .map((file) => file.relativePath)
    .filter((relativePath) => !selectedSet.has(relativePath));

  // Read file contents
  let totalBytes = 0;
  const sourceFiles: SourceFile[] = [];

  for (const file of selected) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      skippedFiles.push(file.relativePath);
      continue;
    }

    try {
      const stat = statSync(file.absolutePath);
      const originalSize = stat.size;

      // Skip truly huge files
      if (originalSize > MAX_FILE_BYTES * 3) {
        skippedFiles.push(file.relativePath);
        continue;
      }

      let content = readFileSync(file.absolutePath, "utf8");
      let truncated = false;

      if (content.length > MAX_FILE_BYTES) {
        content = content.slice(0, MAX_FILE_BYTES) + "\n// ... [truncated]";
        truncated = true;
      }

      totalBytes += content.length;
      sourceFiles.push({
        relativePath: file.relativePath,
        content,
        originalSize,
        truncated,
        language: classifyLanguage(file.relativePath),
      });
    } catch {
      skippedFiles.push(file.relativePath);
    }
  }

  const structureSummary = buildStructureSummary(allFiles, category);

  logger.info(
    `[Ingestion] Ingested ${sourceFiles.length}/${allFiles.length} files ` +
      `(${Math.round(totalBytes / 1024)}KB) from ${target.displayName} - ` +
      `category: ${category}, repo index: ${repoIndex.indexedFiles} files / ${repoIndex.hotspots.length} hotspots / ${neighborhoods.length} neighborhoods`
  );

  return {
    localPath,
    cloned,
    materialization,
    category,
    categories,
    repoIndex,
    neighborhoods,
    sourceFiles,
    totalFilesFound: allFiles.length,
    structureSummary,
    skippedFiles,
  };
}

/**
 * Clean up a cloned repo from disk.
 */
export function cleanupIngestion(result: IngestionResult): void {
  if (result.cloned && result.localPath && existsSync(result.localPath)) {
    try {
      rmSync(result.localPath, { recursive: true, force: true });
      logger.info(`[Ingestion] Cleaned up ${result.localPath}`);
    } catch (e) {
      logger.warn(`[Ingestion] Cleanup failed for ${result.localPath}: ${e}`);
    }
  }
}
