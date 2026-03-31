import {
  Plugin,
  Action,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  HandlerOptions,
  ActionResult,
  MemoryType,
  logger,
} from "@elizaos/core";
import { createDocumentMemory } from "../../pipeline/memory.js";
import { getIntegrationReadiness } from "../../readiness.js";

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

export const scoutAction: Action = {
  name: "SCOUT_IMMUNEFI",
  description: "Scans Immunefi for bug bounty programs based on specified categories or projects.",
  similes: ["SCAN_BOUNTIES", "CHECK_IMMUNEFI", "FIND_TARGETS"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    // 1. Check for DEMO_MODE in environment
    const isDemoMode = process.env.DEMO_MODE === 'true';
    if (isDemoMode) {
      console.log("[Scout] DEMO MODE DETECTED: Utilizing Damn Vulnerable DeFi local target.");
      const scoutData: ScoutData = {
        scoutMode: "DEMO",
        query: message.content?.text || "DeFi protocols",
        projectName: "Damn Vulnerable DeFi",
        categoryTags: ["Smart Contract", "DeFi"],
        impactsInScope: ["Reentrancy", "Logic Errors", "Oracle Manipulation"],
        impactsOutOfScope: ["Phishing", "DDOS", "Front-end UX bugs"],
        rewards: { note: "High/Critical payouts valid (demo)" },
        maxBounty: "$200,000",
        githubRepositories: [],
      };

      const reportText = `SCOUT REPORT (DEMO): Found Immunefi-like scope for '${scoutData.projectName}'. High/Critical payouts valid. Injecting structured rules into RAG memory...`;

      // Persist structured context for HITL/Auditor downstream.
      try {
        await createDocumentMemory(runtime, {
          roomId: (message as any).roomId,
          userId: (message as any).userId,
          text: reportText,
          content: {
            scoutData,
          },
          metadata: {
            stage: "scout",
            scoutMode: scoutData.scoutMode,
            projectName: scoutData.projectName,
          },
        });
      } catch (e) {
        logger.warn(`[Scout] Failed to persist DEMO scout memory: ${e}`);
      }

      if (callback) await callback({ text: reportText, action: "SCOUT_COMPLETE" });
      return { success: true, text: reportText, values: { scoutData } } as any;
    }

    // 2. Attempt connection to infosec-us-team/immunefi-mcp (via the configured MCP plugin)
    const targetQuery = (message.content as any)?.text || "DeFi protocols";
    console.log(`[Scout] Engaging Immunefi MCP for target analysis: ${targetQuery}`);

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

    // MCP tools:
    // - search_program(query: str)
    // - get_impacts(project_ids: List[str])
    // - get_rewards(project_ids: List[str])
    // - get_max_bounty(project_ids: List[str])
    // - search_github_repos(project_ids: List[str])
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

    // Pull additional context for HITL + Auditor.
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

    // The MCP server returns { result: [...] } for these tools.
    const impactsEntry = impactsJson?.result?.[0];
    const rewardsEntry = rewardsJson?.result?.[0];
    const maxBountyEntry = maxBountyJson?.result?.[0];
    const reposEntry = reposJson?.result?.[0];

    const scoutData: ScoutData = {
      scoutMode: "LIVE",
      query: targetQuery,
      projectId: firstProjectId,
      projectName:
        firstProjectId,
      // Keep these as-is; downstream (UI/HITL) can format consistently.
      impactsInScope: impactsEntry?.impacts ?? impactsJson,
      impactsOutOfScope: undefined,
      rewards: rewardsEntry?.rewards ?? rewardsJson,
      maxBounty: maxBountyEntry?.max_bounty ?? maxBountyEntry?.maxBounty ?? maxBountyJson,
      githubRepositories: reposEntry?.github_repositories ?? reposEntry?.githubRepos ?? [],
    };

    const projectNameLabel = scoutData.projectId || scoutData.projectName;
    const rewardLabel =
      typeof scoutData.maxBounty === "string"
        ? scoutData.maxBounty
        : scoutData.maxBounty
          ? JSON.stringify(scoutData.maxBounty)
          : "unknown";

    const reportText = [
      "SCOUT REPORT:",
      `Target: ${projectNameLabel}`,
      `Scope extracted into memory (impacts + rewards).`,
      `Reward: ${rewardLabel}.`,
    ].join("\n");

    // Persist structured context for downstream agents.
    try {
      await createDocumentMemory(runtime, {
        roomId: (message as any).roomId,
        userId: (message as any).userId,
        text: reportText,
        content: {
          scoutData,
        },
        metadata: {
          stage: "scout",
          scoutMode: scoutData.scoutMode,
          projectId: scoutData.projectId,
          projectName: projectNameLabel,
        },
      });
    } catch (e) {
      logger.warn(`[Scout] Failed to persist LIVE scout memory: ${e}`);
    }

    if (callback) await callback({ text: reportText, action: "SCOUT_COMPLETE" });
    return { success: true, text: reportText, values: { scoutData } } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "Find me a new smart contract bounty on Immunefi." } },
      { name: "Scout", content: { text: "Scanning Immunefi for smart contract bounties...", action: "SCOUT_IMMUNEFI" } }
    ]
  ]
};

export const scoutPlugin: Plugin = {
  name: "ImmunefiScout",
  description: "Discovers and extracts rules for bug bounties from Immunefi.",
  actions: [scoutAction],
  evaluators: [],
  providers: []
};
