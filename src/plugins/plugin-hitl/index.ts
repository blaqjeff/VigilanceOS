import { Plugin, Action, IAgentRuntime, Memory, State, HandlerCallback, HandlerOptions, ActionResult } from "@elizaos/core";

export const requestApprovalAction: Action = {
  name: "REQUEST_APPROVAL",
  description: "Triggers a Human-In-The-Loop gate by sending an alert to the user's Telegram and pausing execution until approved.",
  similes: ["ASK_USER", "AWAIT_APPROVAL", "PAUSE_AND_PING_USER"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    const targetDetails = (state as Record<string, unknown>)?.scoutData || message.content?.text || "Unknown Target";

    const alertMessage = `🚨 **Human Approval Required** 🚨\nTarget: ${targetDetails}\nType: Pending Review.\n\nReply with \`/approve\` to proceed with full auditor scan.`;

    if (callback) {
      await callback({ text: alertMessage, action: "WAITING_FOR_APPROVAL" });
    }

    return { success: true, text: alertMessage };
  },
  examples: [
    [
      { name: "Scout", content: { text: "I have identified a target." } },
      { name: "System", content: { text: "Requesting human approval...", action: "REQUEST_APPROVAL" } }
    ]
  ]
};

export const approveAction: Action = {
  name: "APPROVE_TARGET",
  description: "User issues approval to execute the auditor process.",
  similes: ["/approve", "PROCEED", "GO_AHEAD"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    const confMessage = `✅ **Approved**. Auditor agent is now spinning up Nosana Compute instance for deep code analysis...`;

    if (callback) {
      await callback({ text: confMessage, action: "START_AUDITOR" });
    }

    return { success: true, text: confMessage };
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "/approve" } },
      { name: "System", content: { text: "Approval received. Initializing sequence.", action: "APPROVE_TARGET" } }
    ]
  ]
};

export const hitlPlugin: Plugin = {
  name: "HumanInTheLoopGate",
  description: "HITL Gatekeeper requiring explicit Telegram approval to execute compute-heavy tasks.",
  actions: [requestApprovalAction, approveAction],
  evaluators: [],
  providers: []
};
