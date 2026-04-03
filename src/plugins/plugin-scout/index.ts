import {
  Plugin,
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  ActionResult,
  logger,
} from "@elizaos/core";
import { targetFromInput } from "../../pipeline/audit.js";
import { createDocumentMemory } from "../../pipeline/memory.js";
import { getIntegrationReadiness } from "../../readiness.js";
import {
  createJob,
  getJob,
  getJobByTargetId,
  transitionJob,
} from "../../pipeline/jobStore.js";
import {
  attachTelegramContext,
  formatScoutDiscoveryAlert,
  sendTelegramAlert,
} from "../../telegram/ops.js";

type ScoutData = {
  scoutMode: "DEMO" | "LIVE";
  query: string;
  projectId?: string;
  projectName: string;
  categoryTags?: string[];
  impactsInScope?: unknown;
  impactsOutOfScope?: unknown;
  rewards?: unknown;
  maxBounty?: unknown;
  githubRepositories?: string[];
  telegramRoomId?: string;
  telegramChannelId?: string;
};

function extractToolText(toolResult: unknown): string {
  const content = (toolResult as any)?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c?.text === "string" ? c.text : ""))
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

/**
 * Create or retrieve a job for a discovered target.
 */
function ensureJobForTarget(
  projectName: string,
  scoutData: ScoutData
): { jobId: string; isNew: boolean } {
  const target = targetFromInput(projectName);
  const existing = getJobByTargetId(target.targetId);
  if (existing) {
    return { jobId: existing.jobId, isNew: false };
  }

  const job = createJob(target, scoutData as Record<string, unknown>);
  // Move to pending_approval so it shows up in the HITL queue
  transitionJob(job.jobId, "pending_approval");
  return { jobId: job.jobId, isNew: true };
}

export const scoutAction: Action = {
  name: "SCOUT_IMMUNEFI",
  description: "Scans Immunefi for bug bounty programs based on specified categories or projects.",
  similes: ["SCAN_BOUNTIES", "CHECK_IMMUNEFI", "FIND_TARGETS"],
  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = (message as any).roomId;
    const userId = (message as any).userId;

    // 1. DEMO_MODE
    const isDemoMode = process.env.DEMO_MODE === "true";
    if (isDemoMode) {
      logger.info("[Scout] DEMO MODE DETECTED: Utilizing Damn Vulnerable DeFi local target.");
      const scoutData = await attachTelegramContext(runtime, message, {
        scoutMode: "DEMO",
        query: message.content?.text || "DeFi protocols",
        projectName: "Damn Vulnerable DeFi",
        categoryTags: ["Smart Contract", "DeFi"],
        impactsInScope: ["Reentrancy", "Logic Errors", "Oracle Manipulation"],
        impactsOutOfScope: ["Phishing", "DDOS", "Front-end UX bugs"],
        rewards: { note: "High/Critical payouts valid (demo)" },
        maxBounty: "$200,000",
        githubRepositories: [],
      }) as ScoutData;

      const { jobId, isNew } = ensureJobForTarget(scoutData.projectName, scoutData);
      const job = getJob(jobId);

      const reportText =
        job?.target ? formatScoutDiscoveryAlert(job, isNew) : `SCOUT ALERT\nJob: ${jobId}`;

      try {
        await createDocumentMemory(runtime, {
          roomId,
          userId,
          text: reportText,
          content: { scoutData },
          metadata: {
            stage: "scout",
            scoutMode: scoutData.scoutMode,
            projectName: scoutData.projectName,
            jobId,
          },
        });
      } catch (e) {
        logger.warn(`[Scout] Failed to persist DEMO scout memory: ${e}`);
      }

      if ((message.content as any)?.source !== "telegram") {
        await sendTelegramAlert(runtime, scoutData, reportText);
      }

      if (callback) await callback({ text: reportText, action: "SCOUT_COMPLETE" });
      return { success: true, text: reportText, values: { scoutData, jobId } } as any;
    }

    // 2. Live Immunefi MCP
    const targetQuery = (message.content as any)?.text || "DeFi protocols";
    logger.info(`[Scout] Engaging Immunefi MCP for target analysis: ${targetQuery}`);

    const immunefiReadiness = getIntegrationReadiness("immunefiMcp");
    if (!immunefiReadiness.available) {
      const errText = [
        "SCOUT REPORT: Live Immunefi Scout is unavailable.",
        immunefiReadiness.summary,
        immunefiReadiness.action ? `Action: ${immunefiReadiness.action}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      if (callback) await callback({ text: errText, action: "SCOUT_COMPLETE" });
      return { success: false, text: errText } as any;
    }

    const mcpService = runtime.getService?.("mcp") as any;
    if (!mcpService?.callTool) {
      const errText = "SCOUT REPORT: MCP service is not available in runtime.";
      if (callback) await callback({ text: errText, action: "SCOUT_COMPLETE" });
      return { success: false, text: errText } as any;
    }

    const searchRes = await mcpService.callTool("immunefi", "search_program", {
      query: targetQuery,
    });
    const searchText = extractToolText(searchRes);
    const searchJson = safeJsonParse<{
      result?: Array<{ id?: string }>;
      returned?: number;
      total_matching?: number;
      error?: string;
    }>(searchText);

    if (!searchJson || searchJson.error) {
      const errText = `SCOUT REPORT: Failed to query Immunefi MCP (${searchJson?.error || "unknown error"}).`;
      if (callback) await callback({ text: errText, action: "SCOUT_COMPLETE" });
      return { success: false, text: errText } as any;
    }

    const firstProjectId = searchJson.result?.[0]?.id;
    if (!firstProjectId) {
      const errText = "SCOUT REPORT: No Immunefi in-scope projects found for the given query.";
      if (callback) await callback({ text: errText, action: "SCOUT_COMPLETE" });
      return { success: false, text: errText } as any;
    }

    // Pull additional context
    const [impactsRes, rewardsRes, maxBountyRes, reposRes] = await Promise.all([
      mcpService.callTool("immunefi", "get_impacts", { project_ids: [firstProjectId] }),
      mcpService.callTool("immunefi", "get_rewards", { project_ids: [firstProjectId] }),
      mcpService.callTool("immunefi", "get_max_bounty", { project_ids: [firstProjectId] }),
      mcpService.callTool("immunefi", "search_github_repos", { project_ids: [firstProjectId] }),
    ]);

    const impactsJson = safeJsonParse<any>(extractToolText(impactsRes));
    const rewardsJson = safeJsonParse<any>(extractToolText(rewardsRes));
    const maxBountyJson = safeJsonParse<any>(extractToolText(maxBountyRes));
    const reposJson = safeJsonParse<any>(extractToolText(reposRes));

    const impactsEntry = impactsJson?.result?.[0];
    const rewardsEntry = rewardsJson?.result?.[0];
    const maxBountyEntry = maxBountyJson?.result?.[0];
    const reposEntry = reposJson?.result?.[0];

    const scoutData = (await attachTelegramContext(runtime, message, {
      scoutMode: "LIVE",
      query: targetQuery,
      projectId: firstProjectId,
      projectName: firstProjectId,
      impactsInScope: impactsEntry?.impacts ?? impactsJson,
      impactsOutOfScope: undefined,
      rewards: rewardsEntry?.rewards ?? rewardsJson,
      maxBounty:
        maxBountyEntry?.max_bounty ?? maxBountyEntry?.maxBounty ?? maxBountyJson,
      githubRepositories:
        reposEntry?.github_repositories ?? reposEntry?.githubRepos ?? [],
    })) as ScoutData;

    const { jobId, isNew } = ensureJobForTarget(
      scoutData.projectId || scoutData.projectName,
      scoutData
    );
    const job = getJob(jobId);

    const projectNameLabel = scoutData.projectId || scoutData.projectName;
    const reportText =
      job?.target
        ? formatScoutDiscoveryAlert(job, isNew)
        : ["SCOUT ALERT", `Target: ${projectNameLabel}`, `Job: ${jobId}`].join("\n");

    try {
      await createDocumentMemory(runtime, {
        roomId,
        userId,
        text: reportText,
        content: { scoutData },
        metadata: {
          stage: "scout",
          scoutMode: scoutData.scoutMode,
          projectId: scoutData.projectId,
          projectName: projectNameLabel,
          jobId,
        },
      });
    } catch (e) {
      logger.warn(`[Scout] Failed to persist LIVE scout memory: ${e}`);
    }

    if ((message.content as any)?.source !== "telegram") {
      await sendTelegramAlert(runtime, scoutData, reportText);
    }

    if (callback) await callback({ text: reportText, action: "SCOUT_COMPLETE" });
    return { success: true, text: reportText, values: { scoutData, jobId } } as any;
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Find me a new smart contract bounty on Immunefi." },
      },
      {
        name: "Scout",
        content: {
          text: "Scanning Immunefi for smart contract bounties...",
          action: "SCOUT_IMMUNEFI",
        },
      },
    ],
  ],
};

export const scoutPlugin: Plugin = {
  name: "ImmunefiScout",
  description:
    "Discovers and extracts rules for bug bounties from Immunefi. Creates jobs in the canonical JobStore.",
  actions: [scoutAction],
  evaluators: [],
  providers: [],
};
