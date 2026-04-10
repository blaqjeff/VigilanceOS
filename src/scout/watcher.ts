import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";

import { createDocumentMemory } from "../pipeline/memory.js";
import { targetFromInput } from "../pipeline/audit.js";
import { createJob, getJobByTargetId, transitionJob, updateJobData } from "../pipeline/jobStore.js";
import { nowIso, simpleHash } from "../pipeline/utils.js";
import { getIntegrationReadiness } from "../readiness.js";
import { formatScoutDiscoveryAlert, sendTelegramAlert } from "../telegram/ops.js";

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
  assetCount: number;
  impactCount: number;
  repositoryCount: number;
  resourceCount: number;
  telegramRoomId?: string;
  telegramChannelId?: string;
};

export type ScoutDiscovery = {
  projectKey: string;
  jobId: string;
  targetId: string;
  state: string;
  projectId?: string;
  projectName: string;
  category: ScoutCategoryKey;
  categoryLabel: string;
  categoryTags: string[];
  githubRepositories: string[];
  primaryRepository?: string;
  projectAssets: ScoutProjectAsset[];
  projectResources: ScoutProjectResource[];
  assetCount: number;
  impactCount: number;
  repositoryCount: number;
  resourceCount: number;
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
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
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
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
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
    assetCount: 1,
    impactCount: 3,
    repositoryCount: 1,
    resourceCount: 1,
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

function isLikelyImageUrl(value: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|ico)(\?|#|$)/i.test(value);
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
      ),
      ...projectAssets
        .map((asset) => asset.url)
        .filter((assetUrl): assetUrl is string => Boolean(assetUrl && isGithubUrl(assetUrl))),
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
    assetCount: projectAssets.length,
    impactCount: flattenText(impactsInScope, 100).length,
    repositoryCount: repos.length,
    resourceCount: projectResources.length,
    telegramRoomId: telegramContext?.telegramRoomId,
    telegramChannelId: telegramContext?.telegramChannelId,
  };
}

function scoutIdentity(scoutData: ScoutData): string {
  return scoutData.projectId || scoutData.projectName;
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

function trackedDiscoveries(): ScoutDiscovery[] {
  return Array.from(discoveryMap.values())
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, RECENT_DISCOVERY_LIMIT)
    .map(({ signature: _signature, ...rest }) => rest);
}

function categorySnapshots(): ScoutWatcherCategorySnapshot[] {
  return SCOUT_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    queries: category.queries,
    discoveredCount: Array.from(discoveryMap.values()).filter(
      (entry) => entry.category === category.key
    ).length,
    assetCount: Array.from(discoveryMap.values())
      .filter((entry) => entry.category === category.key)
      .reduce((sum, entry) => sum + entry.assetCount, 0),
    repositoryCount: Array.from(discoveryMap.values())
      .filter((entry) => entry.category === category.key)
      .reduce((sum, entry) => sum + entry.repositoryCount, 0),
    resourceCount: Array.from(discoveryMap.values())
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
  jobId: string,
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
        jobId,
      },
    });
  } catch (error) {
    logger.warn(`[ScoutWatcher] Failed to persist scout memory: ${error}`);
  }
}

function upsertJobForScoutData(scoutData: ScoutData) {
  const identity = scoutIdentity(scoutData);
  const baseTarget = targetFromInput(identity);
  const target = {
    ...baseTarget,
    displayName: scoutData.projectName,
    url: scoutData.primaryRepository ?? scoutData.githubRepositories[0] ?? baseTarget.url,
    metadata: {
      ...(baseTarget.metadata ?? {}),
      scoutProjectLevel: true,
      scoutCategory: scoutData.category,
      scoutCategoryLabel: scoutData.categoryLabel,
      scoutPrimaryRepository: scoutData.primaryRepository,
      scoutRepositoryCount: scoutData.repositoryCount,
      scoutAssetCount: scoutData.assetCount,
      scoutResourceCount: scoutData.resourceCount,
    },
  };

  const existing = getJobByTargetId(target.targetId);
  const firstSeenAt = asText((existing?.scoutData as any)?.firstSeenAt) || nowIso();
  const mergedScoutData = {
    ...(existing?.scoutData ?? {}),
    ...scoutData,
    firstSeenAt,
    lastSeenAt: nowIso(),
  };

  if (existing) {
    const updated = updateJobData(existing.jobId, {
      target: {
        ...existing.target,
        displayName: target.displayName,
        url: existing.target.url ?? target.url,
        metadata: {
          ...(existing.target.metadata ?? {}),
          ...(target.metadata ?? {}),
        },
      },
      scoutData: mergedScoutData,
    });
    return { job: updated, isNew: false };
  }

  const created = createJob(target, mergedScoutData);
  const pending = transitionJob(created.jobId, "pending_approval");
  return { job: pending, isNew: true };
}

function updateDiscoveryTracking(
  job: { jobId: string; state: string; target: { targetId: string } },
  scoutData: ScoutData
) {
  const now = nowIso();
  const projectKey = job.target.targetId;
  const signature = discoverySignature(scoutData);
  const existing = discoveryMap.get(projectKey);
  const isNew = !existing;
  const changed = !existing || existing.signature !== signature;
  const lastEvent: ScoutDiscovery["lastEvent"] = isNew ? "new" : changed ? "updated" : "seen";

  const record: InternalDiscovery = {
    projectKey,
    jobId: job.jobId,
    targetId: job.target.targetId,
    state: job.state,
    projectId: scoutData.projectId,
    projectName: scoutData.projectName,
    category: scoutData.category,
    categoryLabel: scoutData.categoryLabel,
    categoryTags: scoutData.categoryTags,
    githubRepositories: scoutData.githubRepositories,
    primaryRepository: scoutData.primaryRepository,
    projectAssets: scoutData.projectAssets,
    projectResources: scoutData.projectResources,
    assetCount: scoutData.assetCount,
    impactCount: scoutData.impactCount,
    repositoryCount: scoutData.repositoryCount,
    resourceCount: scoutData.resourceCount,
    rewardSummary: scoutData.rewardSummary,
    scopeSummary: scoutData.scopeSummary,
    maxBountyText: scoutData.maxBountyText,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    lastAlertedAt: existing?.lastAlertedAt,
    lastEvent,
    refreshCount: (existing?.refreshCount ?? 0) + 1,
    signature,
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
      const { job, isNew } = upsertJobForScoutData(scoutData);
      const { record, changed } = updateDiscoveryTracking(job, scoutData);

      if (isNew) {
        newCount += 1;
        watcherState.totalNewDiscoveries += 1;
        categoryRunState[record.category].newDiscoveries += 1;
      } else {
        refreshed += 1;
      }

      const shouldAlert = isNew || changed;
      if (shouldAlert) {
        const reportedJob = updateJobData(job.jobId, {
          scoutData: {
            ...(job.scoutData ?? {}),
            ...scoutData,
            firstSeenAt: record.firstSeenAt,
            lastSeenAt: record.lastSeenAt,
          },
        });
        const reportText = formatScoutDiscoveryAlert(reportedJob, isNew);

        await persistDiscoveryMemory(
          runtime,
          reportText,
          scoutData,
          reportedJob.jobId,
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
        const { signature: _signature, ...publicRecord } = latest;
        touchedDiscoveries.push(publicRecord);
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

  void refreshScoutWatcher(runtime, { reason: "startup" });
  if (watcherState.mode === "LIVE" && watcherState.readiness.available) {
    setTimeout(() => {
      if (!watcherRuntime) return;
      void refreshScoutWatcher(watcherRuntime, { reason: "warmup retry" });
    }, 12_000);
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
