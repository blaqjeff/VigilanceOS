import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { logger } from "@elizaos/core";
import type { IngestionResult, SourceFile, Target, TargetCategory } from "./types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max bytes per file before truncation */
const MAX_FILE_BYTES = 32_000;
/** Max total source files to include in the audit context */
const MAX_FILES_FOR_AUDIT = 40;
/** Max total bytes of source content to include */
const MAX_TOTAL_BYTES = 200_000;
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
  if (["cargo.toml", "anchor.toml", "package.json", "foundry.toml", "hardhat.config.ts", "hardhat.config.js"].includes(base)) {
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

function cloneRepo(url: string, destDir: string): { ok: boolean; error?: string } {
  const cloneUrl = normalizeGithubCloneUrl(url);

  logger.info(`[Ingestion] Cloning ${cloneUrl} → ${destDir}`);

  const result = spawnSync("git", ["clone", "--depth", "1", cloneUrl, destDir], {
    encoding: "utf8",
    timeout: 60_000,
    cwd: process.cwd(),
  });

  if (result.error) {
    return { ok: false, error: `Git clone spawn error: ${result.error.message}` };
  }

  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim().split("\n").slice(-3).join(" | ");
    return { ok: false, error: `Git clone failed (exit ${result.status}): ${stderr}` };
  }

  return { ok: true };
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

  if (target.type === "github" && target.url) {
    // Clone the repo
    mkdirSync(CLONE_BASE_DIR, { recursive: true });
    localPath = path.join(CLONE_BASE_DIR, target.targetId);

    // If already cloned from a previous attempt, reuse it
    if (existsSync(localPath)) {
      logger.info(`[Ingestion] Reusing existing clone at ${localPath}`);
    } else {
      const cloneResult = cloneRepo(target.url, localPath);
      if (!cloneResult.ok) {
        throw new Error(`Failed to clone ${target.url}: ${cloneResult.error}`);
      }
      cloned = true;
    }
  } else if (target.type === "local" && target.localPath) {
    localPath = target.localPath;
    if (!existsSync(localPath)) {
      throw new Error(`Local path does not exist: ${localPath}`);
    }
    const stat = statSync(localPath);
    if (!stat.isDirectory()) {
      throw new Error(`Local path is not a directory: ${localPath}`);
    }
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

  // Sort by priority and select top files
  const sorted = allFiles
    .map((f) => ({ ...f, priority: filePriority(f.relativePath) }))
    .sort((a, b) => b.priority - a.priority);

  const selected = sorted.slice(0, MAX_FILES_FOR_AUDIT);
  const skippedFiles = sorted.slice(MAX_FILES_FOR_AUDIT).map((f) => f.relativePath);

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
      `(${Math.round(totalBytes / 1024)}KB) from ${target.displayName} — category: ${category}`
  );

  return {
    localPath,
    cloned,
    category,
    categories,
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
