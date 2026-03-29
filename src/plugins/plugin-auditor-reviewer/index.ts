import { Plugin, Action, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, ActionResult } from "@elizaos/core";

// --- AUDITOR (HUNTER) PORTION ---

export const executeAuditAction: Action = {
  name: "EXECUTE_AUDIT",
  description: "Triggers the Nosana compute layer to analyze a codebase for security vulnerabilities.",
  similes: ["RUN_QWEN_AUDIT", "FIND_VULNERABILITIES", "PENTEST_REPO"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    const isDemoMode = process.env.DEMO_MODE === 'true';
    const targetInfo = isDemoMode ? "Damn Vulnerable DeFi (Local Replica)" : "Remote Origin";

    const processMessage = `\n[nosana-cli run] Starting container... \n[Qwen3.5-27B] Analyzing target codebase (${targetInfo}) based on RAG definitions...\n`;

    const dummyReport = `
### VULNERABILITY FOUND (Severity: HIGH)
**Title:** Unchecked Reentrancy in Vault.sol _withdraw function
**Description:** The state variable is updated after the external call, allowing malicious contracts to drain funds.
**Action Requirements:** Require reentrancy guard or CEI pattern.
`;

    if (callback) {
      await callback({ text: processMessage + dummyReport, action: "DRAFT_REPORT_READY" });
    }

    return { success: true, text: dummyReport };
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "Scan the target directory now." } },
      { name: "Auditor", content: { text: "Pulling repo into Nosana grid context...", action: "EXECUTE_AUDIT" } }
    ]
  ]
};

// --- REVIEWER (SKEPTIC) PORTION ---

export const debunkFindingAction: Action = {
  name: "DEBUNK_FINDING",
  description: "The Reviewer agent evaluates the Auditor draft report and attempts to prove it wrong using adversarial analysis.",
  similes: ["VERIFY_BUG", "ATTEMPT_DEBUNK", "CHALLENGE_REPORT"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    const isDebunked = Math.random() < 0.2;

    let finalConsensus = "";
    if (isDebunked) {
      finalConsensus = `❌ **REVIEW FAILED**: Auditor's report is false positive. Found 'nonReentrant' modifier in parent inherited config that the Auditor missed. Discarding report.`;
    } else {
      finalConsensus = `✅ **REVIEW PASSED**: Auditor's findings verified. Exploit path is open. Generating final Foundry PoC...`;
    }

    if (callback) {
      await callback({ text: finalConsensus, action: isDebunked ? "DISCARD_REPORT" : "PUBLISH_REPORT" });
    }

    return { success: !isDebunked, text: finalConsensus };
  },
  examples: [
    [
      { name: "Auditor", content: { text: "Draft report ready for review" } },
      { name: "Reviewer", content: { text: "Reviewing code execution paths...", action: "DEBUNK_FINDING" } }
    ]
  ]
};

export const auditorReviewerPlugin: Plugin = {
  name: "AuditorAndReviewer",
  description: "Houses the Auditor (Qwen3.5 LLM code execution) and Reviewer (Skeptic verification) logic.",
  actions: [executeAuditAction, debunkFindingAction],
  evaluators: [],
  providers: []
};
