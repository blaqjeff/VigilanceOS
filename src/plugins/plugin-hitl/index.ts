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

function extractScoutData(state?: State): any | null {
  const s = state as any;
  return s?.scoutData ?? s?.values?.scoutData ?? s?.data?.scoutData ?? null;
}

function roomIdFromMessage(message: Memory): any {
  return (message as any).roomId;
}

function userIdFromMessage(message: Memory): any {
  return (message as any).userId;
}

function extractTargetIdFromText(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/TARGET_ID:([^\s]+)/);
  return match?.[1];
}

export const requestApprovalAction: Action = {
  name: "REQUEST_APPROVAL",
  description: "Triggers a Human-In-The-Loop gate by sending an alert to the user's Telegram and pausing execution until approved.",
  similes: ["ASK_USER", "AWAIT_APPROVAL", "PAUSE_AND_PING_USER"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    const scoutData = extractScoutData(state);
    const targetDetails =
      scoutData?.projectName ??
      scoutData?.projectId ??
      (state as Record<string, unknown>)?.scoutData ??
      (message.content as any)?.text ??
      "Unknown Target";
    const targetId = String(scoutData?.projectId ?? scoutData?.projectName ?? targetDetails);

    const pendingText = `HITL_STAGE:PENDING TARGET_ID:${targetId}\nTarget: ${targetDetails}\nType: Pending Review. Reply with /approve to proceed.`;

    try {
      await runtime.createMemory({
        type: MemoryType.DOCUMENT,
        content: {
          text: pendingText,
          scoutData,
        },
        roomId: roomIdFromMessage(message),
        userId: userIdFromMessage(message),
        metadata: {
          stage: "hitl",
          status: "PENDING",
          targetId,
        },
      } as any);
    } catch (e) {
      logger.warn(`[HITL] Failed to persist pending approval: ${e}`);
    }

    const alertMessage = `🚨 **Human Approval Required** 🚨\nTarget: ${targetDetails}\n\nReply with \`/approve\` to proceed with full auditor scan.`;

    if (callback) {
      await callback({ text: alertMessage, action: "WAITING_FOR_APPROVAL" });
    }

    return { success: true, text: alertMessage, values: { scoutData, targetId } } as any;
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
    const scoutData = extractScoutData(state);
    const targetDetails =
      scoutData?.projectName ??
      scoutData?.projectId ??
      (state as any)?.scoutData ??
      (message.content as any)?.text ??
      "Unknown Target";

    const explicitTargetId: string | undefined = scoutData?.projectId
      ? String(scoutData.projectId)
      : scoutData?.projectName
        ? String(scoutData.projectName)
        : undefined;

    const roomId = roomIdFromMessage(message);
    const userId = userIdFromMessage(message);

    // Find the latest pending approval in this room.
    const pendingQuery = "HITL_STAGE:PENDING";
    const pendingMemories: any[] = (await (runtime as any).searchMemories?.({
      query: pendingQuery,
      type: MemoryType.DOCUMENT,
      roomId,
      limit: 10,
    })) as any[];

    const sorted = (pendingMemories || []).sort(
      (a, b) => (b?.createdAt?.getTime?.() ?? 0) - (a?.createdAt?.getTime?.() ?? 0)
    );
    const bestPending = sorted[0] as any | undefined;
    const pendingText = bestPending?.content?.text ?? bestPending?.content?.[0]?.text ?? bestPending?.text;

    const foundTargetId = extractTargetIdFromText(pendingText) ?? explicitTargetId;
    const finalTargetId = foundTargetId ?? explicitTargetId ?? String(targetDetails);
    const finalScoutData = scoutData ?? bestPending?.content?.scoutData ?? null;

    try {
      await runtime.createMemory({
        type: MemoryType.DOCUMENT,
        content: {
          text: `HITL_STAGE:APPROVED TARGET_ID:${finalTargetId}\nTarget: ${targetDetails}\nApproved by user.`,
          scoutData: finalScoutData,
        },
        roomId,
        userId,
        metadata: {
          stage: "hitl",
          status: "APPROVED",
          targetId: finalTargetId,
        },
      } as any);
    } catch (e) {
      logger.warn(`[HITL] Failed to persist approval: ${e}`);
    }

    const confMessage = `✅ **Approved**. Auditor agent can now start deep code analysis for '${targetDetails}'.`;

    if (callback) {
      await callback({ text: confMessage, action: "START_AUDITOR" });
    }

    return { success: true, text: confMessage, values: { scoutData: finalScoutData, targetId: finalTargetId } } as any;
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
