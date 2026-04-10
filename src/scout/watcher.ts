import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";

import { createDocumentMemory } from "../pipeline/memory.js";
import { targetFromInput } from "../pipeline/audit.js";
import type { AuditJob } from "../pipeline/types.js";
import {
  createJob,
  getJob,
  getJobByTargetId,
  transitionJob,
  updateJobData,
} from "../pipeline/jobStore.js";
import { nowIso, simpleHash } from "../pipeline/utils.js";
import { getIntegrationReadiness } from "../readiness.js";
import {
  formatApprovalRequestAlert,
  formatScoutDiscoveryAlert,
  sendTelegramAlert,
} from "../telegram/ops.js";

const DEFAULT_ROOM_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_SCOUT_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PROJECTS_PER_CATEGORY = 2;
const RECENT_DISCOVERY_LIMIT = 12;
const PROJECT_RESOURCE_FIELDS = ["resources", "website", "url", "details"] as const;

export type ScoutMode = "DEMO" | "LIVE";
export type ScoutWatcherStatus = "idle" | "scheduled" | "running" | "blocked" | "error";
export type ScoutCategoryKey =
  | "blockchain_dlt"
  | "smart_contract"
  | "websites_apps";

export type ScoutCategoryConfig = {
  key: ScoutCategoryKey;
  label: string;
  queries: string[];
};

export type ScoutProjectAsset = {
  assetId: string;
  label: string;
  categoryLabel: string;
  url?: string;
  impactSummary: string[];
  tags: string[];
};

export type ScoutProjectResource = {
  label: string;
  url: string;
  sourceField?: string;
};

export type ScoutChildTargetKind =
  | "github_repo"
  | "web_asset"
  | "explorer_asset"
  | "resource";

export type ScoutChildTarget = {
  childId: string;
  kind: ScoutChildTargetKind;
  label: string;
  summary: string;
  sourceUrl?: string;
  tags: string[];
  queueable: boolean;
  auditTargetInput?: string;
  queuedJobId?: string;
  queuedJobState?: string;
};

export type ScoutData = {
  scoutMode: ScoutMode;
  query: string;
  projectId?: string;
  projectName: string;
  category: ScoutCategoryKey;
  categoryLabel: string;
  categoryTags: string[];
  impactsInScope?: unknown;
  impactsOutOfScope?: unknown;
  rewards?: unknown;
  rewardSummary: string[];
  scopeSummary: string[];
  maxBounty?: unknown;
  maxBountyText?: string;
  githubRepositories: string[];
  primaryRepository?: string;
  projectAssets: ScoutProjectAsset[];
  projectResources: ScoutProjectResource[];
  childTargets: ScoutChildTarget[];
  assetCount: number;
  impactCount: number;
  repositoryCount: number;
  resourceCount: number;
  queueableChildCount: number;
  telegramRoomId?: string;
  telegramChannelId?: string;
};

export type ScoutDiscovery = {
  projectKey: string;
  commandRef: string;
  projectId?: string;
  projectName: string;
  state: "discovered" | "partially_queued" | "queued";
  category: ScoutCategoryKey;
  categoryLabel: string;
  categoryTags: string[];
  githubRepositories: string[];
  primaryRepository?: string;
  projectAssets: ScoutProjectAsset[];
  projectResources: ScoutProjectResource[];
  childTargets: ScoutChildTarget[];
  assetCount: number;
  impactCount: number;
  repositoryCount: number;
  resourceCount: number;
  queueableChildCount: number;
  queuedChildCount: number;
  rewardSummary: string[];
  scopeSummary: string[];
  maxBountyText?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAlertedAt?: string;
  lastEvent: "new" | "updated" | "seen";
  refreshCount: number;
};

export type ScoutWatcherCategorySnapshot = {
  key: ScoutCategoryKey;
  label: string;
  queries: string[];
  discoveredCount: number;
  assetCount: number;
  repositoryCount: number;
  resourceCount: number;
  newDiscoveries: number;
  lastRunMatches: number;
  lastRunAt?: string;
};

export type ScoutWatcherSnapshot = {
  enabled: boolean;
  mode: ScoutMode;
  status: ScoutWatcherStatus;
  pollIntervalMs: number;
  startedAt?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  lastReason?: string;
  lastError?: string;
  totalRuns: number;
  totalTrackedTargets: number;
  totalNewDiscoveries: number;
  readiness: {
    available: boolean;
    state: string;
    summary: string;
    action?: string;
  };
  categories: ScoutWatcherCategorySnapshot[];
  recentDiscoveries: ScoutDiscovery[];
};

export type ScoutRefreshResult = {
  success: boolean;
  blocked: boolean;
  message: string;
  totalMatches: number;
  newDiscoveries: number;
  refreshed: number;
  snapshot: ScoutWatcherSnapshot;
};

type RawProject = {
  projectId?: string;
  projectName: string;
  category: ScoutCategoryKey;
  categoryLabel: string;
  categoryTags: string[];
};

type InternalDiscovery = ScoutDiscovery & {
  signature: string;
  scoutData: ScoutData;
};

type CategoryRunCounters = Record<
  ScoutCategoryKey,
  {
    lastRunMatches: number;
    newDiscoveries: number;
    lastRunAt?: string;
  }
>;

type ScoutPassOptions = {
  categories: ScoutCategoryConfig[];
  reason: string;
  roomId?: string;
  userId?: string;
  telegramContext?: Partial<Pick<ScoutData, "telegramRoomId" | "telegramChannelId">>;
  notifyTelegram?: boolean;
};

const SCOUT_CATEGORIES: ScoutCategoryConfig[] = [
  {
    key: "blockchain_dlt",
    label: "Blockchain / DLT",
    queries: ["Blockchain / DLT", "blockchain"],
  },
  {
    key: "smart_contract",
    label: "Smart Contract",
    queries: ["Smart Contract", "DeFi"],
  },
  {
    key: "websites_apps",
    label: "Websites and Applications",
    queries: ["Websites and Applications", "web application"],
  },
];

const DEMO_PROJECTS: Array<
  Omit<ScoutData, "query" | "telegramRoomId" | "telegramChannelId">
> = [
  {
    scoutMode: "DEMO",
    projectId: "demo-solana-watch",
    projectName: "Coral Sealevel Attacks",
    category: "blockchain_dlt",
    categoryLabel: "Blockchain / DLT",
    categoryTags: ["Blockchain / DLT", "Solana", "Rust"],
    impactsInScope: ["Account validation", "Signer misuse", "CPI privilege escalation"],
    rewards: { note: "Controlled demo target" },
    rewardSummary: ["Controlled demo target", "Focus on account validation and authority paths"],
    scopeSummary: ["Solana programs", "Rust instruction handlers", "Authority and CPI flows"],
    maxBounty: "Controlled demo target",
    maxBountyText: "Controlled demo target",
    githubRepositories: ["https://github.com/coral-xyz/sealevel-attacks"],
    primaryRepository: "https://github.com/coral-xyz/sealevel-attacks",
    projectAssets: [
      {
        assetId: "demo-solana-asset-1",
        label: "Sealevel attack programs",
        categoryLabel: "Blockchain / DLT",
        url: "https://github.com/coral-xyz/sealevel-attacks",
        impactSummary: ["Signer misuse", "PDA misuse", "CPI privilege escalation"],
        tags: ["Solana", "Rust"],
      },
    ],
    projectResources: [
      {
        label: "GitHub repository",
        url: "https://github.com/coral-xyz/sealevel-attacks",
        sourceField: "repo",
      },
    ],
    childTargets: [
      {
        childId: "demo-solana-child-1",
        kind: "github_repo",
        label: "coral-xyz/sealevel-attacks",
        summary: "Queue the Solana demo repository for audit.",
        sourceUrl: "https://github.com/coral-xyz/sealevel-attacks",
        tags: ["repo", "queueable"],
        queueable: true,
        auditTargetInput: "https://github.com/coral-xyz/sealevel-attacks",
      },
    ],
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
    queueableChildCount: 1,
  },
  {
    scoutMode: "DEMO",
    projectId: "demo-dvdefi",
    projectName: "Damn Vulnerable DeFi",
    category: "smart_contract",
    categoryLabel: "Smart Contract",
    categoryTags: ["Smart Contract", "DeFi", "EVM"],
    impactsInScope: ["Reentrancy", "Accounting errors", "Oracle manipulation"],
    rewards: { note: "Controlled demo target" },
    rewardSummary: ["Controlled demo target", "High-confidence Solidity exploit surface"],
    scopeSummary: ["Vault and lending contracts", "Token handling", "Oracle-sensitive flows"],
    maxBounty: "Controlled demo target",
    maxBountyText: "Controlled demo target",
    githubRepositories: ["https://github.com/theredguild/damn-vulnerable-defi"],
    primaryRepository: "https://github.com/theredguild/damn-vulnerable-defi",
    projectAssets: [
      {
        assetId: "demo-evm-asset-1",
        label: "Damn Vulnerable DeFi contracts",
        categoryLabel: "Smart Contract",
        url: "https://github.com/theredguild/damn-vulnerable-defi",
        impactSummary: ["Access control", "Oracle manipulation", "Accounting flaws"],
        tags: ["Solidity", "EVM"],
      },
    ],
    projectResources: [
      {
        label: "GitHub repository",
        url: "https://github.com/theredguild/damn-vulnerable-defi",
        sourceField: "repo",
      },
    ],
    childTargets: [
      {
        childId: "demo-evm-child-1",
        kind: "github_repo",
        label: "theredguild/damn-vulnerable-defi",
        summary: "Queue the EVM demo repository for audit.",
        sourceUrl: "https://github.com/theredguild/damn-vulnerable-defi",
        tags: ["repo", "queueable"],
        queueable: true,
        auditTargetInput: "https://github.com/theredguild/damn-vulnerable-defi",
      },
    ],
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
    queueableChildCount: 1,
  },
  {
    scoutMode: "DEMO",
    projectId: "demo-juice-shop",
    projectName: "OWASP Juice Shop",
    category: "websites_apps",
    categoryLabel: "Websites and Applications",
    categoryTags: ["Websites and Applications", "Web App", "Static Analysis"],
    impactsInScope: ["Auth flaws", "Secrets exposure", "Business logic abuse"],
    rewards: { note: "Controlled demo target" },
    rewardSummary: ["Controlled demo target", "Static repo analysis only for this surface"],
    scopeSummary: ["Web application codebase", "Authentication paths", "Secrets and unsafe flows"],
    maxBounty: "Controlled demo target",
    maxBountyText: "Controlled demo target",
    githubRepositories: ["https://github.com/juice-shop/juice-shop"],
    primaryRepository: "https://github.com/juice-shop/juice-shop",
    projectAssets: [
      {
        assetId: "demo-web-asset-1",
        label: "Juice Shop web application",
        categoryLabel: "Websites and Applications",
        url: "https://github.com/juice-shop/juice-shop",
        impactSummary: ["Auth flaws", "Secrets exposure", "Business logic abuse"],
        tags: ["Node.js", "Web App"],
      },
    ],
    projectResources: [
      {
        label: "GitHub repository",
        url: "https://github.com/juice-shop/juice-shop",
        sourceField: "repo",
      },
    ],
    childTargets: [
      {
        childId: "demo-web-child-1",
        kind: "github_repo",
        label: "juice-shop/juice-shop",
        summary: "Queue the web-app demo repository for audit.",
        sourceUrl: "https://github.com/juice-shop/juice-shop",
        tags: ["repo", "queueable"],
        queueable: true,
        auditTargetInput: "https://github.com/juice-shop/juice-shop",
      },
    ],
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
    queueableChildCount: 1,
  },
];

const discoveryMap = new Map<string, InternalDiscovery>();
let watcherRuntime: IAgentRuntime | null = null;
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let activeRefresh: Promise<ScoutRefreshResult> | null = null;

const categoryRunState: CategoryRunCounters = {
  blockchain_dlt: { lastRunMatches: 0, newDiscoveries: 0 },
  smart_contract: { lastRunMatches: 0, newDiscoveries: 0 },
  websites_apps: { lastRunMatches: 0, newDiscoveries: 0 },
};

const watcherState: Omit<ScoutWatcherSnapshot, "categories" | "recentDiscoveries" | "totalTrackedTargets"> =
  {
    enabled: false,
    mode: currentScoutMode(),
    status: "idle",
    pollIntervalMs: scoutPollIntervalMs(),
    totalRuns: 0,
    totalNewDiscoveries: 0,
    readiness: readinessSummary(),
  };

function runtimeHasMcpService(runtime: IAgentRuntime | null | undefined): boolean {
  if (!runtime?.getService) {
    return false;
  }

  try {
    return Boolean(runtime.getService("mcp" as any));
  } catch {
    return false;
  }
}

function adoptWatcherRuntime(candidate?: IAgentRuntime) {
  if (!candidate) {
    return;
  }

  if (!watcherRuntime) {
    watcherRuntime = candidate;
    return;
  }

  if (currentScoutMode() === "LIVE") {
    if (runtimeHasMcpService(watcherRuntime)) {
      return;
    }
    if (runtimeHasMcpService(candidate)) {
      watcherRuntime = candidate;
      return;
    }
  }

  watcherRuntime = candidate;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function currentScoutMode(): ScoutMode {
  return process.env.DEMO_MODE === "true" ? "DEMO" : "LIVE";
}

function scoutPollIntervalMs(): number {
  const parsed = Number(process.env.SCOUT_POLL_INTERVAL_MS ?? DEFAULT_SCOUT_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < 15_000) {
    return DEFAULT_SCOUT_POLL_INTERVAL_MS;
  }
  return parsed;
}

function scoutMaxProjectsPerCategory(): number {
  const parsed = Number(
    process.env.SCOUT_MAX_PROJECTS_PER_CATEGORY ?? DEFAULT_MAX_PROJECTS_PER_CATEGORY
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_PROJECTS_PER_CATEGORY;
  }
  return Math.floor(parsed);
}

function readinessSummary() {
  const readiness =
    currentScoutMode() === "DEMO"
      ? {
          available: true,
          state: "ready",
          summary: "Scout watcher is running in demo mode.",
          action: undefined,
        }
      : getIntegrationReadiness("immunefiMcp");

  return {
    available: readiness.available,
    state: readiness.state,
    summary: readiness.summary,
    action: readiness.action,
  };
}

function refreshWatcherConfig() {
  watcherState.enabled = true;
  watcherState.mode = currentScoutMode();
  watcherState.pollIntervalMs = scoutPollIntervalMs();
  watcherState.readiness = readinessSummary();
}

function scheduleNextRun() {
  watcherState.nextRunAt = new Date(Date.now() + watcherState.pollIntervalMs).toISOString();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  const base = value
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return base || "project";
}

function flattenText(value: unknown, limit = 12, depth = 0, acc: string[] = []): string[] {
  if (acc.length >= limit || depth > 4 || value == null) {
    return acc;
  }

  if (typeof value === "string") {
    const text = collapseWhitespace(value);
    if (text) {
      acc.push(text);
    }
    return acc;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      flattenText(item, limit, depth + 1, acc);
      if (acc.length >= limit) break;
    }
    return acc;
  }

  if (typeof value === "object") {
    for (const [_key, child] of Object.entries(value as Record<string, unknown>)) {
      if (acc.length >= limit) break;
      if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
        const text = collapseWhitespace(String(child));
        if (text) {
          acc.push(text);
        }
      } else {
        flattenText(child, limit, depth + 1, acc);
      }
    }
  }

  return acc;
}

function uniqueStrings(values: Array<string | undefined>, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const text = collapseWhitespace(value ?? "");
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }

  return out;
}

function shortList(value: unknown, limit = 4): string[] {
  return uniqueStrings(flattenText(value, limit * 3), limit);
}

function extractToolText(toolResult: unknown): string {
  const content = (toolResult as any)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof (toolResult as any)?.text === "string") return (toolResult as any).text;
  return "";
}

function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function categoryFromText(value: string): ScoutCategoryKey | null {
  const text = value.toLowerCase();
  if (
    text.includes("website") ||
    text.includes("web app") ||
    text.includes("application") ||
    text.includes("frontend") ||
    text.includes("mobile")
  ) {
    return "websites_apps";
  }
  if (
    text.includes("smart contract") ||
    text.includes("defi") ||
    text.includes("contract") ||
    text.includes("evm")
  ) {
    return "smart_contract";
  }
  if (
    text.includes("blockchain") ||
    text.includes("dlt") ||
    text.includes("rollup") ||
    text.includes("bridge") ||
    text.includes("solana") ||
    text.includes("chain")
  ) {
    return "blockchain_dlt";
  }
  return null;
}

function categoryLabel(key: ScoutCategoryKey): string {
  return SCOUT_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}

function classifyProject(entry: Record<string, unknown>, fallback: ScoutCategoryConfig): ScoutCategoryKey {
  const rawCategoryValues = flattenText(
    [
      entry.category,
      entry.categories,
      entry.tags,
      entry.type,
      entry.platforms,
      entry.project_type,
      entry.projectType,
    ],
    10
  );

  for (const value of rawCategoryValues) {
    const key = categoryFromText(value);
    if (key) return key;
  }

  const nameKey = categoryFromText(
    [entry.name, entry.project_name, entry.projectName, entry.title]
      .map(asText)
      .filter(Boolean)
      .join(" ")
  );
  return nameKey ?? fallback.key;
}

function inferQueryCategory(query: string): ScoutCategoryConfig {
  const inferred = categoryFromText(query);
  return (
    SCOUT_CATEGORIES.find((category) => category.key === inferred) ?? {
      key: "smart_contract",
      label: "Smart Contract",
      queries: [query],
    }
  );
}

function firstResultEntry(value: any, projectId?: string): any {
  const results = Array.isArray(value?.result)
    ? value.result
    : Array.isArray(value?.results)
      ? value.results
      : [];

  if (!projectId) {
    return results[0];
  }

  return (
    results.find((entry: any) =>
      [entry?.id, entry?.project_id, entry?.projectId, entry?.name]
        .map(asText)
        .includes(projectId)
    ) ?? results[0]
  );
}

function extractRepos(value: unknown): string[] {
  return uniqueStrings(
    flattenText(value, 20).filter(
      (item) =>
        /^https?:\/\/github\.com\//i.test(item) || /^[\w.-]+\/[\w.-]+$/.test(item)
    ),
    6
  );
}

function maxBountyText(value: unknown): string | undefined {
  return shortList(value, 1)[0];
}

function extractUrls(value: unknown, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const queue: unknown[] = [value];
  const urlPattern = /https?:\/\/[^\s"'<>]+/gi;

  while (queue.length > 0 && out.length < limit) {
    const current = queue.shift();
    if (current == null) continue;

    if (typeof current === "string") {
      const matches = current.match(urlPattern) ?? [];
      for (const match of matches) {
        const normalized = match.replace(/[),.;]+$/, "");
        if (!normalized || seen.has(normalized.toLowerCase())) continue;
        seen.add(normalized.toLowerCase());
        out.push(normalized);
        if (out.length >= limit) break;
      }
      continue;
    }

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    if (typeof current === "object") {
      queue.push(...Object.values(current as Record<string, unknown>));
    }
  }

  return out;
}

function isGithubUrl(value: string): boolean {
  return /^https?:\/\/github\.com\//i.test(value) || /^[\w.-]+\/[\w.-]+$/.test(value);
}

function normalizeGithubRepoUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }

  if (!/^https?:\/\/github\.com\//i.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    return `https://github.com/${parts[0]}/${parts[1]}`;
  } catch {
    return null;
  }
}

function isLikelyImageUrl(value: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|#|$)/i.test(value);
}

function isExplorerAssetUrl(value: string): boolean {
  return /(etherscan|basescan|arbiscan|optimistic\.etherscan|polygonscan|bscscan|snowtrace|snowscan|solscan|sonicscan|hyperevmscan|explorer\.)/i.test(
    value
  );
}

function extractResourceLinks(value: unknown, limit = 10): string[] {
  return uniqueStrings(
    extractUrls(value, limit * 3).filter(
      (item) => !isGithubUrl(item) && !isLikelyImageUrl(item)
    ),
    limit
  );
}

function projectAssetSummaries(value: unknown): ScoutProjectAsset[] {
  const assets = Array.isArray(value) ? value : [];
  const out: ScoutProjectAsset[] = [];

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index] as Record<string, unknown>;
    const categoryLabel =
      uniqueStrings(
        [
          ...shortList([asset.category, asset.type, asset.assetType, asset.platform], 2),
          "Asset",
        ],
        1
      )[0] ?? "Asset";
    const label =
      uniqueStrings(
        [
          asText(asset.name),
          asText(asset.title),
          asText(asset.asset),
          asText(asset.url),
          `${categoryLabel} ${index + 1}`,
        ],
        1
      )[0] ?? `${categoryLabel} ${index + 1}`;
    const url = uniqueStrings(extractUrls(asset, 3), 1)[0];

    out.push({
      assetId: simpleHash(JSON.stringify({ label, categoryLabel, url })),
      label,
      categoryLabel,
      url,
      impactSummary: shortList([asset.impacts, asset.impact, asset.bugTypes, asset.description], 3),
      tags: uniqueStrings(
        [
          ...shortList([asset.type, asset.category, asset.ecosystem, asset.language], 4),
        ],
        4
      ),
    });
  }

  return out;
}

async function getFieldValueResult(
  mcpService: any,
  projectIdentity: string,
  fieldName: string
): Promise<any> {
  const fieldRes = await mcpService.callTool("immunefi", "get_field_values", {
    project_ids: [projectIdentity],
    field_name: fieldName,
  });
  return safeJsonParse<any>(extractToolText(fieldRes));
}

function projectResourcesFromFields(
  fieldEntries: Array<{ fieldName: string; value: unknown }>,
  assets: ScoutProjectAsset[]
): ScoutProjectResource[] {
  const resources: ScoutProjectResource[] = [];
  const seen = new Set<string>();

  for (const entry of fieldEntries) {
    for (const url of extractResourceLinks(entry.value, 8)) {
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      resources.push({
        label: entry.fieldName.replace(/_/g, " "),
        url,
        sourceField: entry.fieldName,
      });
    }
  }

  for (const asset of assets) {
    if (!asset.url || isGithubUrl(asset.url)) continue;
    const key = asset.url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    resources.push({
      label: asset.label,
      url: asset.url,
      sourceField: "asset",
    });
  }

  return resources.slice(0, 12);
}

function deriveChildTargets(
  projectAssets: ScoutProjectAsset[],
  projectResources: ScoutProjectResource[],
  repos: string[]
): ScoutChildTarget[] {
  const childTargets: ScoutChildTarget[] = [];
  const seen = new Set<string>();

  function pushChild(child: ScoutChildTarget) {
    const key = `${child.kind}:${(child.auditTargetInput ?? child.sourceUrl ?? child.label).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    childTargets.push(child);
  }

  for (const repo of repos) {
    const normalizedRepo = normalizeGithubRepoUrl(repo) ?? repo;
    pushChild({
      childId: simpleHash(`repo:${normalizedRepo}`),
      kind: "github_repo",
      label: normalizedRepo.replace(/^https?:\/\//, ""),
      summary: "Queue this repository as a concrete audit target.",
      sourceUrl: normalizedRepo,
      tags: ["repo", "queueable"],
      queueable: true,
      auditTargetInput: normalizedRepo,
    });
  }

  for (const asset of projectAssets) {
    const normalizedRepo = asset.url ? normalizeGithubRepoUrl(asset.url) : null;
    if (normalizedRepo) {
      pushChild({
        childId: simpleHash(`repo-asset:${normalizedRepo}`),
        kind: "github_repo",
        label: asset.label,
        summary:
          asset.impactSummary[0] ??
          "Queue this GitHub-linked in-scope asset as an audit target.",
        sourceUrl: normalizedRepo,
        tags: uniqueStrings([...asset.tags, asset.categoryLabel, "queueable"], 5),
        queueable: true,
        auditTargetInput: normalizedRepo,
      });
      continue;
    }

    const kind: ScoutChildTargetKind = asset.url
      ? isExplorerAssetUrl(asset.url)
        ? "explorer_asset"
        : "web_asset"
      : "web_asset";

    pushChild({
      childId: simpleHash(`asset:${asset.assetId}`),
      kind,
      label: asset.label,
      summary:
        asset.impactSummary[0] ??
        `${asset.categoryLabel} asset discovered by Scout.`,
      sourceUrl: asset.url,
      tags: uniqueStrings([...asset.tags, asset.categoryLabel], 5),
      queueable: false,
    });
  }

  for (const resource of projectResources) {
    const normalizedRepo = normalizeGithubRepoUrl(resource.url);
    if (normalizedRepo) {
      pushChild({
        childId: simpleHash(`repo-resource:${normalizedRepo}`),
        kind: "github_repo",
        label: resource.label,
        summary: "Queue this repository-linked resource as an audit target.",
        sourceUrl: normalizedRepo,
        tags: uniqueStrings([resource.sourceField ?? "resource", "queueable"], 4),
        queueable: true,
        auditTargetInput: normalizedRepo,
      });
      continue;
    }

    pushChild({
      childId: simpleHash(`resource:${resource.url}`),
      kind: "resource",
      label: resource.label,
      summary: "Supporting scope resource discovered by Scout.",
      sourceUrl: resource.url,
      tags: uniqueStrings([resource.sourceField ?? "resource"], 4),
      queueable: false,
    });
  }

  return childTargets.slice(0, 50);
}

function projectCommandRef(projectId: string | undefined, projectName: string): string {
  return slugify(projectId || projectName);
}

function hydrateChildTarget(child: ScoutChildTarget): ScoutChildTarget {
  if (!child.queuedJobId) {
    return { ...child, queuedJobState: undefined };
  }

  const job = getJob(child.queuedJobId);
  if (!job || job.archivedAt) {
    return {
      ...child,
      queuedJobId: undefined,
      queuedJobState: undefined,
    };
  }

  return {
    ...child,
    queuedJobState: job.state,
  };
}

function summarizeDiscoveryQueueState(childTargets: ScoutChildTarget[]): {
  state: ScoutDiscovery["state"];
  queuedChildCount: number;
} {
  const queueableCount = childTargets.filter((child) => child.queueable).length;
  const queuedChildCount = childTargets.filter(
    (child) => child.queueable && Boolean(child.queuedJobId)
  ).length;

  if (queueableCount === 0 || queuedChildCount === 0) {
    return { state: "discovered", queuedChildCount };
  }

  if (queuedChildCount >= queueableCount) {
    return { state: "queued", queuedChildCount };
  }

  return { state: "partially_queued", queuedChildCount };
}

function extractProjects(searchJson: any, fallback: ScoutCategoryConfig): RawProject[] {
  const results = Array.isArray(searchJson?.result)
    ? searchJson.result
    : Array.isArray(searchJson?.results)
      ? searchJson.results
      : [];

  const maxProjects = scoutMaxProjectsPerCategory();
  const seen = new Set<string>();
  const out: RawProject[] = [];

  for (const rawEntry of results) {
    if (out.length >= maxProjects) break;
    const entry = (rawEntry ?? {}) as Record<string, unknown>;
    const projectId =
      asText(entry.id) ||
      asText(entry.project_id) ||
      asText(entry.projectId) ||
      asText(entry.slug);
    const projectName =
      asText(entry.project_name) ||
      asText(entry.projectName) ||
      asText(entry.name) ||
      asText(entry.title) ||
      projectId;

    if (!projectName) {
      continue;
    }

    const key = projectId || projectName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category = classifyProject(entry, fallback);
    const categoryTags = uniqueStrings(
      [
        ...flattenText([entry.category, entry.categories, entry.tags, entry.type], 8),
        categoryLabel(category),
      ],
      6
    );

    out.push({
      projectId: projectId || undefined,
      projectName,
      category,
      categoryLabel: categoryLabel(category),
      categoryTags,
    });
  }

  return out;
}

async function enrichProject(
  runtime: IAgentRuntime,
  project: RawProject,
  query: string,
  telegramContext?: Partial<Pick<ScoutData, "telegramRoomId" | "telegramChannelId">>
): Promise<ScoutData> {
  if (currentScoutMode() === "DEMO") {
    const demo =
      DEMO_PROJECTS.find(
        (entry) =>
          entry.projectId === project.projectId ||
          entry.projectName.toLowerCase() === project.projectName.toLowerCase()
      ) ?? DEMO_PROJECTS[0];

    return {
      ...demo,
      query,
      projectId: project.projectId ?? demo.projectId,
      projectName: project.projectName,
      category: project.category,
      categoryLabel: project.categoryLabel,
      categoryTags: uniqueStrings(
        [...project.categoryTags, ...demo.categoryTags],
        6
      ),
      childTargets: demo.childTargets.map((child) => ({ ...child })),
      queueableChildCount:
        demo.queueableChildCount ??
        demo.childTargets.filter((child) => child.queueable).length,
      telegramRoomId: telegramContext?.telegramRoomId,
      telegramChannelId: telegramContext?.telegramChannelId,
    };
  }

  const mcpService = runtime.getService?.("mcp") as any;
  if (!mcpService?.callTool) {
    throw new Error("MCP service is not available in runtime.");
  }

  const projectIdentity = project.projectId ?? project.projectName;
  const [impactsRes, rewardsRes, maxBountyRes, reposRes, assetsRes, tagsRes] = await Promise.all([
    mcpService.callTool("immunefi", "get_impacts", { project_ids: [projectIdentity] }),
    mcpService.callTool("immunefi", "get_rewards", { project_ids: [projectIdentity] }),
    mcpService.callTool("immunefi", "get_max_bounty", { project_ids: [projectIdentity] }),
    mcpService.callTool("immunefi", "search_github_repos", { project_ids: [projectIdentity] }),
    mcpService.callTool("immunefi", "get_program_assets", { project_ids: [projectIdentity] }),
    mcpService.callTool("immunefi", "get_tags", { project_ids: [projectIdentity] }),
  ]);

  const impactsJson = safeJsonParse<any>(extractToolText(impactsRes));
  const rewardsJson = safeJsonParse<any>(extractToolText(rewardsRes));
  const maxBountyJson = safeJsonParse<any>(extractToolText(maxBountyRes));
  const reposJson = safeJsonParse<any>(extractToolText(reposRes));
  const assetsJson = safeJsonParse<any>(extractToolText(assetsRes));
  const tagsJson = safeJsonParse<any>(extractToolText(tagsRes));

  const impactsEntry = firstResultEntry(impactsJson, projectIdentity);
  const rewardsEntry = firstResultEntry(rewardsJson, projectIdentity);
  const maxBountyEntry = firstResultEntry(maxBountyJson, projectIdentity);
  const reposEntry = firstResultEntry(reposJson, projectIdentity);
  const assetsEntry = firstResultEntry(assetsJson, projectIdentity);
  const tagsEntry = firstResultEntry(tagsJson, projectIdentity);

  const rawAssets = assetsEntry?.assets ?? [];
  const projectAssets = projectAssetSummaries(rawAssets);
  const repos = uniqueStrings(
    [
      ...extractRepos(
        reposEntry?.github_repositories ??
          reposEntry?.githubRepos ??
          reposJson?.github_repositories ??
          reposJson
      )
        .map((repo) => normalizeGithubRepoUrl(repo) ?? repo),
      ...projectAssets
        .map((asset) => asset.url)
        .map((assetUrl) => (assetUrl ? normalizeGithubRepoUrl(assetUrl) : null))
        .filter((assetUrl): assetUrl is string => Boolean(assetUrl)),
    ],
    12
  );
  const resourceFieldValues = await Promise.all(
    PROJECT_RESOURCE_FIELDS.map(async (fieldName) => ({
      fieldName,
      value: firstResultEntry(await getFieldValueResult(mcpService, projectIdentity, fieldName), projectIdentity)
        ?.value,
    }))
  );
  const projectResources = projectResourcesFromFields(resourceFieldValues, projectAssets);
  const mergedCategoryTags = uniqueStrings(
    [
      ...project.categoryTags,
      ...shortList(tagsEntry?.tags ?? tagsJson, 10),
    ],
    10
  );
  const impactsInScope = impactsEntry?.impacts ?? impactsJson;

  const rewardSummary = uniqueStrings(
    [
      maxBountyText(
        maxBountyEntry?.max_bounty ?? maxBountyEntry?.maxBounty ?? maxBountyJson
      ),
      ...shortList(rewardsEntry?.rewards ?? rewardsJson, 4),
    ],
    4
  );
  const childTargets = deriveChildTargets(projectAssets, projectResources, repos);

  return {
    scoutMode: "LIVE",
    query,
    projectId: project.projectId,
    projectName: project.projectName,
    category: project.category,
    categoryLabel: project.categoryLabel,
    categoryTags: mergedCategoryTags,
    impactsInScope,
    impactsOutOfScope: impactsEntry?.out_of_scope ?? impactsEntry?.outOfScope,
    rewards: rewardsEntry?.rewards ?? rewardsJson,
    rewardSummary,
    scopeSummary: uniqueStrings(
      [
        ...shortList(impactsInScope, 4),
        ...projectAssets.slice(0, 3).map((asset) => `${asset.categoryLabel}: ${asset.label}`),
      ],
      6
    ),
    maxBounty:
      maxBountyEntry?.max_bounty ?? maxBountyEntry?.maxBounty ?? maxBountyJson,
    maxBountyText: maxBountyText(
      maxBountyEntry?.max_bounty ?? maxBountyEntry?.maxBounty ?? maxBountyJson
    ),
    githubRepositories: repos,
    primaryRepository: repos[0],
    projectAssets,
    projectResources,
    childTargets,
    assetCount: projectAssets.length,
    impactCount: flattenText(impactsInScope, 100).length,
    repositoryCount: repos.length,
    resourceCount: projectResources.length,
    queueableChildCount: childTargets.filter((child) => child.queueable).length,
    telegramRoomId: telegramContext?.telegramRoomId,
    telegramChannelId: telegramContext?.telegramChannelId,
  };
}

function scoutIdentity(scoutData: ScoutData): string {
  return scoutData.projectId || scoutData.projectName;
}

function discoveryKey(scoutData: ScoutData): string {
  return projectCommandRef(scoutData.projectId, scoutData.projectName);
}

function discoverySignature(scoutData: ScoutData): string {
  return simpleHash(
    JSON.stringify({
      category: scoutData.category,
      tags: scoutData.categoryTags,
      scope: scoutData.scopeSummary,
      reward: scoutData.rewardSummary,
      maxBounty: scoutData.maxBountyText,
      repos: scoutData.githubRepositories,
      assets: scoutData.projectAssets.map((asset) => ({
        label: asset.label,
        category: asset.categoryLabel,
        url: asset.url,
      })),
      resources: scoutData.projectResources.map((resource) => resource.url),
    })
  );
}

function toPublicDiscovery(record: InternalDiscovery): ScoutDiscovery {
  const childTargets = record.childTargets.map(hydrateChildTarget);
  const { state, queuedChildCount } = summarizeDiscoveryQueueState(childTargets);

  return {
    projectKey: record.projectKey,
    commandRef: record.commandRef,
    projectId: record.projectId,
    projectName: record.projectName,
    state,
    category: record.category,
    categoryLabel: record.categoryLabel,
    categoryTags: [...record.categoryTags],
    githubRepositories: [...record.githubRepositories],
    primaryRepository: record.primaryRepository,
    projectAssets: clone(record.projectAssets),
    projectResources: clone(record.projectResources),
    childTargets,
    assetCount: record.assetCount,
    impactCount: record.impactCount,
    repositoryCount: record.repositoryCount,
    resourceCount: record.resourceCount,
    queueableChildCount: childTargets.filter((child) => child.queueable).length,
    queuedChildCount,
    rewardSummary: [...record.rewardSummary],
    scopeSummary: [...record.scopeSummary],
    maxBountyText: record.maxBountyText,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    lastAlertedAt: record.lastAlertedAt,
    lastEvent: record.lastEvent,
    refreshCount: record.refreshCount,
  };
}

function trackedDiscoveries(): ScoutDiscovery[] {
  return Array.from(discoveryMap.values())
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, RECENT_DISCOVERY_LIMIT)
    .map((record) => toPublicDiscovery(record));
}

function categorySnapshots(): ScoutWatcherCategorySnapshot[] {
  const publicDiscoveries = Array.from(discoveryMap.values()).map((record) =>
    toPublicDiscovery(record)
  );

  return SCOUT_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    queries: category.queries,
    discoveredCount: publicDiscoveries.filter((entry) => entry.category === category.key).length,
    assetCount: publicDiscoveries
      .filter((entry) => entry.category === category.key)
      .reduce((sum, entry) => sum + entry.assetCount, 0),
    repositoryCount: publicDiscoveries
      .filter((entry) => entry.category === category.key)
      .reduce((sum, entry) => sum + entry.repositoryCount, 0),
    resourceCount: publicDiscoveries
      .filter((entry) => entry.category === category.key)
      .reduce((sum, entry) => sum + entry.resourceCount, 0),
    newDiscoveries: categoryRunState[category.key].newDiscoveries,
    lastRunMatches: categoryRunState[category.key].lastRunMatches,
    lastRunAt: categoryRunState[category.key].lastRunAt,
  }));
}

export function getScoutWatcherSnapshot(): ScoutWatcherSnapshot {
  refreshWatcherConfig();
  return clone({
    ...watcherState,
    totalTrackedTargets: discoveryMap.size,
    categories: categorySnapshots(),
    recentDiscoveries: trackedDiscoveries(),
  });
}

async function persistDiscoveryMemory(
  runtime: IAgentRuntime,
  reportText: string,
  scoutData: ScoutData,
  projectKey: string,
  roomId?: string,
  userId?: string
) {
  try {
    await createDocumentMemory(runtime, {
      roomId: roomId ?? scoutData.telegramRoomId ?? DEFAULT_ROOM_ID,
      userId,
      text: reportText,
      content: { scoutData },
      metadata: {
        stage: "scout",
        scoutMode: scoutData.scoutMode,
        projectId: scoutData.projectId,
        projectName: scoutData.projectName,
        projectKey,
      },
    });
  } catch (error) {
    logger.warn(`[ScoutWatcher] Failed to persist scout memory: ${error}`);
  }
}

function updateDiscoveryTracking(scoutData: ScoutData) {
  const now = nowIso();
  const projectKey = discoveryKey(scoutData);
  const signature = discoverySignature(scoutData);
  const existing = discoveryMap.get(projectKey);
  const isNew = !existing;
  const changed = !existing || existing.signature !== signature;
  const lastEvent: ScoutDiscovery["lastEvent"] = isNew ? "new" : changed ? "updated" : "seen";
  const previousChildren = new Map(
    (existing?.childTargets ?? []).map((child) => [child.childId, child])
  );
  const mergedChildTargets = scoutData.childTargets.map((child) => ({
    ...child,
    queuedJobId: previousChildren.get(child.childId)?.queuedJobId,
    queuedJobState: previousChildren.get(child.childId)?.queuedJobState,
  }));
  const { state, queuedChildCount } = summarizeDiscoveryQueueState(mergedChildTargets);
  const commandRef = projectCommandRef(scoutData.projectId, scoutData.projectName);

  const record: InternalDiscovery = {
    projectKey,
    commandRef,
    projectId: scoutData.projectId,
    projectName: scoutData.projectName,
    state,
    category: scoutData.category,
    categoryLabel: scoutData.categoryLabel,
    categoryTags: scoutData.categoryTags,
    githubRepositories: scoutData.githubRepositories,
    primaryRepository: scoutData.primaryRepository,
    projectAssets: scoutData.projectAssets,
    projectResources: scoutData.projectResources,
    childTargets: mergedChildTargets,
    assetCount: scoutData.assetCount,
    impactCount: scoutData.impactCount,
    repositoryCount: scoutData.repositoryCount,
    resourceCount: scoutData.resourceCount,
    queueableChildCount: scoutData.queueableChildCount,
    queuedChildCount,
    rewardSummary: scoutData.rewardSummary,
    scopeSummary: scoutData.scopeSummary,
    maxBountyText: scoutData.maxBountyText,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastAlertedAt: existing?.lastAlertedAt,
    lastEvent,
    refreshCount: (existing?.refreshCount ?? 0) + 1,
    signature,
    scoutData: {
      ...scoutData,
      childTargets: mergedChildTargets,
      queueableChildCount: scoutData.queueableChildCount,
    },
  };

  discoveryMap.set(projectKey, record);
  return { record, isNew, changed };
}

function summaryMessage(
  mode: ScoutMode,
  discoveries: ScoutDiscovery[],
  newCount: number,
  refreshed: number,
  reason: string
): string {
  const headline = `${mode} scout ${reason}: ${discoveries.length} tracked, ${newCount} new, ${refreshed} refreshed`;
  if (discoveries.length === 0) {
    return `${headline}. No in-scope programs were discovered for the current sweep.`;
  }

  const highlights = discoveries
    .slice(0, 3)
    .map(
      (entry) =>
        `${entry.projectName} [${entry.categoryLabel}]${entry.maxBountyText ? ` - ${entry.maxBountyText}` : ""} (${entry.assetCount} assets, ${entry.repositoryCount} repos)`
    )
    .join("; ");

  return `${headline}. Highlights: ${highlights}`;
}

async function fetchLiveProjectsForCategory(
  runtime: IAgentRuntime,
  category: ScoutCategoryConfig
): Promise<Array<{ project: RawProject; query: string }>> {
  const mcpService = runtime.getService?.("mcp") as any;
  if (!mcpService?.callTool) {
    throw new Error("MCP service is not available in runtime.");
  }

  const deduped = new Map<string, { project: RawProject; query: string }>();
  for (const query of category.queries) {
    const searchRes = await mcpService.callTool("immunefi", "search_program", { query });
    const searchText = extractToolText(searchRes);
    const searchJson = safeJsonParse<any>(searchText);

    if (!searchJson) {
      logger.warn(`[ScoutWatcher] Could not parse Immunefi search response for query "${query}".`);
      continue;
    }
    if (searchJson.error) {
      logger.warn(
        `[ScoutWatcher] Immunefi search error for query "${query}": ${searchJson.error}`
      );
      continue;
    }

    for (const project of extractProjects(searchJson, category)) {
      const key = project.projectId || project.projectName.toLowerCase();
      if (!deduped.has(key)) {
        deduped.set(key, { project, query });
      }
      if (deduped.size >= scoutMaxProjectsPerCategory()) {
        break;
      }
    }

    if (deduped.size >= scoutMaxProjectsPerCategory()) {
      break;
    }
  }

  return Array.from(deduped.values());
}

async function demoProjectsForCategory(
  category: ScoutCategoryConfig
): Promise<Array<{ project: RawProject; query: string }>> {
  return DEMO_PROJECTS.filter((project) => project.category === category.key).map((project) => ({
    project: {
      projectId: project.projectId,
      projectName: project.projectName,
      category: project.category,
      categoryLabel: project.categoryLabel,
      categoryTags: project.categoryTags,
    },
    query: category.queries[0] ?? category.label,
  }));
}

async function runScoutPass(
  runtime: IAgentRuntime,
  options: ScoutPassOptions
): Promise<ScoutRefreshResult> {
  refreshWatcherConfig();
  const mode = watcherState.mode;
  const now = nowIso();

  if (mode === "LIVE" && !watcherState.readiness.available) {
    watcherState.status = "blocked";
    watcherState.lastRunAt = now;
    watcherState.lastReason = options.reason;
    watcherState.lastError = watcherState.readiness.summary;
    scheduleNextRun();
    return {
      success: false,
      blocked: true,
      message: watcherState.readiness.summary,
      totalMatches: 0,
      newDiscoveries: 0,
      refreshed: 0,
      snapshot: getScoutWatcherSnapshot(),
    };
  }

  const categoryMatches: Record<ScoutCategoryKey, number> = {
    blockchain_dlt: 0,
    smart_contract: 0,
    websites_apps: 0,
  };
  const seenProjectKeys = new Set<string>();

  let newCount = 0;
  let refreshed = 0;
  const touchedDiscoveries: ScoutDiscovery[] = [];

  for (const category of options.categories) {
    const entries =
      mode === "DEMO"
        ? await demoProjectsForCategory(category)
        : await fetchLiveProjectsForCategory(runtime, category);

    for (const entry of entries) {
      const passKey =
        (entry.project.projectId || entry.project.projectName).toLowerCase();
      if (seenProjectKeys.has(passKey)) {
        continue;
      }
      seenProjectKeys.add(passKey);
      categoryMatches[category.key] += 1;

      const scoutData = await enrichProject(
        runtime,
        entry.project,
        entry.query,
        options.telegramContext
      );
      const { record, isNew, changed } = updateDiscoveryTracking(scoutData);

      if (isNew) {
        newCount += 1;
        watcherState.totalNewDiscoveries += 1;
        categoryRunState[record.category].newDiscoveries += 1;
      } else {
        refreshed += 1;
      }

      const shouldAlert = isNew || changed;
      if (shouldAlert) {
        const publicRecord = toPublicDiscovery(record);
        const reportText = formatScoutDiscoveryAlert(
          {
            projectKey: publicRecord.projectKey,
            commandRef: publicRecord.commandRef,
            projectName: publicRecord.projectName,
            categoryLabel: publicRecord.categoryLabel,
            rewardSummary: publicRecord.rewardSummary,
            scopeSummary: publicRecord.scopeSummary,
            maxBountyText: publicRecord.maxBountyText,
            githubRepositories: publicRecord.githubRepositories,
            assetCount: publicRecord.assetCount,
            impactCount: publicRecord.impactCount,
            resourceCount: publicRecord.resourceCount,
            queueableChildCount: publicRecord.queueableChildCount,
          },
          isNew
        );

        await persistDiscoveryMemory(
          runtime,
          reportText,
          scoutData,
          publicRecord.projectKey,
          options.roomId,
          options.userId
        );

        if (options.notifyTelegram !== false) {
          const alerted = await sendTelegramAlert(runtime, scoutData, reportText);
          if (alerted) {
            discoveryMap.set(record.projectKey, {
              ...(discoveryMap.get(record.projectKey) as InternalDiscovery),
              lastAlertedAt: nowIso(),
            });
          }
        }
      }

      const latest = discoveryMap.get(record.projectKey);
      if (latest) {
        touchedDiscoveries.push(toPublicDiscovery(latest));
      }
    }
  }

  for (const category of options.categories) {
    categoryRunState[category.key].lastRunMatches = categoryMatches[category.key];
    categoryRunState[category.key].lastRunAt = now;
  }

  watcherState.lastRunAt = now;
  watcherState.lastSuccessAt = now;
  watcherState.lastReason = options.reason;
  watcherState.lastError = undefined;
  watcherState.status = "scheduled";
  scheduleNextRun();

  return {
    success: true,
    blocked: false,
    message: summaryMessage(mode, touchedDiscoveries, newCount, refreshed, options.reason),
    totalMatches: touchedDiscoveries.length,
    newDiscoveries: newCount,
    refreshed,
    snapshot: getScoutWatcherSnapshot(),
  };
}

function allDiscoveriesSorted(): InternalDiscovery[] {
  return Array.from(discoveryMap.values()).sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );
}

function matchesDiscoveryReference(discovery: InternalDiscovery, reference: string): boolean {
  const needle = collapseWhitespace(reference).toLowerCase();
  if (!needle) return false;

  return (
    discovery.projectKey.toLowerCase() === needle ||
    discovery.projectKey.toLowerCase().startsWith(needle) ||
    discovery.commandRef.toLowerCase() === needle ||
    discovery.commandRef.toLowerCase().startsWith(needle) ||
    (discovery.projectId ? discovery.projectId.toLowerCase() === needle : false) ||
    (discovery.projectId ? discovery.projectId.toLowerCase().startsWith(needle) : false) ||
    discovery.projectName.toLowerCase().includes(needle)
  );
}

function findInternalDiscovery(reference?: string): InternalDiscovery | undefined {
  const ordered = allDiscoveriesSorted();
  const needle = collapseWhitespace(reference ?? "");
  if (!needle) {
    return ordered[0];
  }

  return ordered.find((entry) => matchesDiscoveryReference(entry, needle));
}

function matchesChildReference(
  child: ScoutChildTarget,
  reference: string,
  index: number
): boolean {
  const needle = collapseWhitespace(reference).toLowerCase();
  if (!needle) return false;

  return (
    needle === String(index + 1) ||
    child.childId.toLowerCase() === needle ||
    child.childId.toLowerCase().startsWith(needle) ||
    child.label.toLowerCase().includes(needle) ||
    (child.auditTargetInput ?? "").toLowerCase().includes(needle) ||
    (child.sourceUrl ?? "").toLowerCase().includes(needle)
  );
}

function resolveChildSelection(
  discovery: InternalDiscovery,
  childRefs?: string[],
  queueAll?: boolean
): ScoutChildTarget[] {
  const hydratedChildren = discovery.childTargets.map(hydrateChildTarget);
  const queueableChildren = hydratedChildren.filter((child) => child.queueable);

  if (queueAll) {
    return queueableChildren;
  }

  if (!childRefs?.length) {
    return [];
  }

  const selected: ScoutChildTarget[] = [];
  const seen = new Set<string>();

  for (const ref of childRefs) {
    const match = hydratedChildren.find((child, index) =>
      matchesChildReference(child, ref, index)
    );
    if (!match || !match.queueable || seen.has(match.childId)) {
      continue;
    }
    seen.add(match.childId);
    selected.push(match);
  }

  return selected;
}

function buildScoutChildTargetJobPayload(
  discovery: InternalDiscovery,
  child: ScoutChildTarget
): {
  target: ReturnType<typeof targetFromInput>;
  scoutData: Record<string, unknown>;
} {
  const input =
    child.auditTargetInput ??
    child.sourceUrl ??
    discovery.primaryRepository ??
    discovery.githubRepositories[0] ??
    scoutIdentity(discovery.scoutData);
  const baseTarget = targetFromInput(input);
  const target = {
    ...baseTarget,
    displayName: child.label || baseTarget.displayName,
    metadata: {
      ...(baseTarget.metadata ?? {}),
      scoutProjectLevel: true,
      scoutProjectKey: discovery.projectKey,
      scoutProjectCommandRef: discovery.commandRef,
      scoutProjectName: discovery.projectName,
      scoutChildId: child.childId,
      scoutChildKind: child.kind,
      scoutChildLabel: child.label,
      scoutChildSourceUrl: child.sourceUrl,
    },
  };

  return {
    target,
    scoutData: {
      ...discovery.scoutData,
      projectKey: discovery.projectKey,
      commandRef: discovery.commandRef,
      selectedChildTarget: {
        childId: child.childId,
        kind: child.kind,
        label: child.label,
        summary: child.summary,
        sourceUrl: child.sourceUrl,
        tags: child.tags,
      },
      selectedChildTargetIds: [child.childId],
      selectedChildTargetCount: 1,
    },
  };
}

export function listScoutDiscoveries(): ScoutDiscovery[] {
  return trackedDiscoveries();
}

export function findScoutDiscovery(reference?: string): ScoutDiscovery | undefined {
  const discovery = findInternalDiscovery(reference);
  return discovery ? toPublicDiscovery(discovery) : undefined;
}

export type QueueScoutChildTargetsResult = {
  success: boolean;
  project?: ScoutDiscovery;
  createdJobs: AuditJob[];
  existingJobs: AuditJob[];
  selectedChildren: ScoutChildTarget[];
  skippedChildren: ScoutChildTarget[];
  message: string;
};

export async function queueScoutChildTargets(
  runtime: IAgentRuntime,
  options: {
    projectRef?: string;
    childRefs?: string[];
    queueAll?: boolean;
    roomId?: string;
    userId?: string;
  }
): Promise<QueueScoutChildTargetsResult> {
  const discovery = findInternalDiscovery(options.projectRef);
  if (!discovery) {
    return {
      success: false,
      createdJobs: [],
      existingJobs: [],
      selectedChildren: [],
      skippedChildren: [],
      message: "No matching Scout project was found.",
    };
  }

  const selectedChildren = resolveChildSelection(
    discovery,
    options.childRefs,
    options.queueAll
  );
  if (selectedChildren.length === 0) {
    return {
      success: false,
      project: toPublicDiscovery(discovery),
      createdJobs: [],
      existingJobs: [],
      selectedChildren: [],
      skippedChildren: discovery.childTargets.filter((child) => !child.queueable),
      message: options.queueAll
        ? "This Scout project does not have any queueable child targets yet."
        : "Select one or more queueable child targets first.",
    };
  }

  const createdJobs: AuditJob[] = [];
  const existingJobs: AuditJob[] = [];
  const nextChildren = discovery.childTargets.map((child) => ({ ...child }));

  for (const child of selectedChildren) {
    const childIndex = nextChildren.findIndex((entry) => entry.childId === child.childId);
    if (childIndex === -1 || !child.queueable) {
      continue;
    }

    const { target, scoutData } = buildScoutChildTargetJobPayload(discovery, child);
    const scopedScoutData = {
      ...scoutData,
      telegramRoomId:
        options.roomId ?? (scoutData as any).telegramRoomId ?? discovery.scoutData.telegramRoomId,
      telegramChannelId:
        (scoutData as any).telegramChannelId ?? discovery.scoutData.telegramChannelId,
    };
    const existing = getJobByTargetId(target.targetId);

    let job: AuditJob;
    let shouldSendApprovalAlert = false;

    if (existing) {
      job = updateJobData(existing.jobId, {
        target: {
          ...existing.target,
          displayName: target.displayName,
          url: existing.target.url ?? target.url,
          metadata: {
            ...(existing.target.metadata ?? {}),
            ...(target.metadata ?? {}),
          },
        },
        scoutData: {
          ...(existing.scoutData ?? {}),
          ...scopedScoutData,
        },
      });

      if (job.state === "submitted") {
        job = transitionJob(job.jobId, "pending_approval");
        shouldSendApprovalAlert = true;
      }

      existingJobs.push(job);
    } else {
      const created = createJob(target, scopedScoutData);
      job = transitionJob(created.jobId, "pending_approval");
      shouldSendApprovalAlert = true;
      createdJobs.push(job);
    }

    nextChildren[childIndex] = {
      ...nextChildren[childIndex],
      queuedJobId: job.jobId,
      queuedJobState: job.state,
    };

    if (shouldSendApprovalAlert) {
      await sendTelegramAlert(runtime, scopedScoutData, formatApprovalRequestAlert(job));
    }
  }

  const { state, queuedChildCount } = summarizeDiscoveryQueueState(nextChildren);
  const updated: InternalDiscovery = {
    ...discovery,
    state,
    queuedChildCount,
    childTargets: nextChildren,
    scoutData: {
      ...discovery.scoutData,
      childTargets: nextChildren,
      queueableChildCount: nextChildren.filter((child) => child.queueable).length,
    },
  };
  discoveryMap.set(updated.projectKey, updated);

  const skippedChildren = selectedChildren.filter((child) => !child.queueable);
  const queuedTotal = createdJobs.length + existingJobs.length;

  return {
    success: queuedTotal > 0,
    project: toPublicDiscovery(updated),
    createdJobs,
    existingJobs,
    selectedChildren,
    skippedChildren,
    message:
      queuedTotal > 0
        ? `Queued ${queuedTotal} child target${queuedTotal === 1 ? "" : "s"} from ${updated.projectName}.`
        : "No queueable child targets were queued.",
  };
}

export function ensureScoutWatcher(runtime: IAgentRuntime) {
  adoptWatcherRuntime(runtime);
  refreshWatcherConfig();

  if (!watcherState.startedAt) {
    watcherState.startedAt = nowIso();
  }

  if (watcherTimer) {
    return;
  }

  watcherState.status =
    watcherState.mode === "LIVE" && !watcherState.readiness.available
      ? "blocked"
      : "scheduled";
  scheduleNextRun();

  watcherTimer = setInterval(() => {
    if (!watcherRuntime) return;
    void refreshScoutWatcher(watcherRuntime, { reason: "scheduled" });
  }, watcherState.pollIntervalMs);

  if (watcherState.mode === "LIVE" && !runtimeHasMcpService(runtime)) {
    watcherState.status = "scheduled";
    watcherState.lastReason = "awaiting MCP warmup";
  } else {
    void refreshScoutWatcher(runtime, { reason: "startup" });
  }

  if (watcherState.mode === "LIVE" && watcherState.readiness.available) {
    [12_000, 24_000, 40_000].forEach((delayMs, index) => {
      setTimeout(() => {
        if (!watcherRuntime) return;
        void refreshScoutWatcher(watcherRuntime, {
          reason: index === 0 ? "warmup retry" : `warmup retry ${index + 1}`,
        });
      }, delayMs);
    });
  }
}

export async function refreshScoutWatcher(
  runtime?: IAgentRuntime,
  options?: Omit<ScoutPassOptions, "categories">
): Promise<ScoutRefreshResult> {
  adoptWatcherRuntime(runtime);

  if (!watcherRuntime) {
    throw new Error("Scout watcher has not been initialized with a runtime.");
  }

  if (activeRefresh) {
    return activeRefresh;
  }

  refreshWatcherConfig();
  watcherState.status = "running";
  watcherState.totalRuns += 1;

  activeRefresh = runScoutPass(watcherRuntime, {
    categories: SCOUT_CATEGORIES,
    reason: options?.reason ?? "manual",
    roomId: options?.roomId,
    userId: options?.userId,
    telegramContext: options?.telegramContext,
    notifyTelegram: options?.notifyTelegram,
  })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      watcherState.lastRunAt = nowIso();
      watcherState.lastReason = options?.reason ?? "manual";
      watcherState.lastError = message;
      watcherState.status = watcherState.readiness.available ? "error" : "blocked";
      scheduleNextRun();

      logger.error(`[ScoutWatcher] Refresh failed: ${message}`);
      return {
        success: false,
        blocked: watcherState.status === "blocked",
        message,
        totalMatches: 0,
        newDiscoveries: 0,
        refreshed: 0,
        snapshot: getScoutWatcherSnapshot(),
      };
    })
    .finally(() => {
      activeRefresh = null;
    });

  return activeRefresh;
}

export async function runAdHocScoutQuery(
  runtime: IAgentRuntime,
  query: string,
  options?: Omit<ScoutPassOptions, "categories">
): Promise<ScoutRefreshResult> {
  adoptWatcherRuntime(runtime);
  refreshWatcherConfig();

  if (activeRefresh) {
    return activeRefresh;
  }

  watcherState.status = "running";
  watcherState.totalRuns += 1;

  const category = inferQueryCategory(query);
  activeRefresh = runScoutPass(runtime, {
      categories: [{ ...category, queries: [query] }],
      reason: options?.reason ?? "manual query",
      roomId: options?.roomId,
      userId: options?.userId,
      telegramContext: options?.telegramContext,
      notifyTelegram: options?.notifyTelegram,
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      watcherState.lastRunAt = nowIso();
      watcherState.lastReason = options?.reason ?? "manual query";
      watcherState.lastError = message;
      watcherState.status = watcherState.readiness.available ? "error" : "blocked";
      scheduleNextRun();
      return {
        success: false,
        blocked: watcherState.status === "blocked",
        message,
        totalMatches: 0,
        newDiscoveries: 0,
        refreshed: 0,
        snapshot: getScoutWatcherSnapshot(),
      };
    })
    .finally(() => {
      activeRefresh = null;
    });

  return activeRefresh;
}
