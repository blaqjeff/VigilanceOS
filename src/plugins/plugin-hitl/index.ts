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
import {
  createJob,
  findPendingJob,
  getJobByTargetId,
  transitionJob,
} from "../../pipeline/jobStore.js";

function extractScoutData(state?: State): any | null {
  const s = state as any;
  return s?.scoutData ?? s?.values?.scoutData ?? s?.data?.scoutData ?? null;
}

function resolveTargetInput(message: Memory, state?: State): string {
  const scoutData = extractScoutData(state);
  return String(
    scoutData?.projectId ??
      scoutData?.projectName ??
      (message.content as any)?.text ??
      "Unknown Target"
  );
}

// ---------------------------------------------------------------------------
// REQUEST_APPROVAL — create/advance job to pending_approval
// ---------------------------------------------------------------------------
export const requestApprovalAction: Action = {
  name: "REQUEST_APPROVAL",
  description:
    "Triggers a Human-In-The-Loop gate by sending an alert to the user's Telegram and pausing execution until approved.",
  similes: ["ASK_USER", "AWAIT_APPROVAL", "PAUSE_AND_PING_USER"],
  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    return true;
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const scoutData = extractScoutData(state);
    const targetInput = resolveTargetInput(message, state);
    const target = targetFromInput(targetInput);

    // Check if a job already exists for this target
    let job = getJobByTargetId(target.targetId);

    if (!job) {
      // Create a new job
      job = createJob(target, scoutData);
      job = transitionJob(job.jobId, "pending_approval");
    } else if (job.state === "submitted") {
      job = transitionJob(job.jobId, "pending_approval");
    } else {
      logger.info(
        `[HITL] Job ${job.jobId} already in state '${job.state}', skipping approval request.`
      );
    }

    const alertMessage = [
      `🚨 **Human Approval Required** 🚨`,
      `Target: ${target.displayName}`,
      `Job: ${job.jobId}`,
      ``,
      `Reply with \`/approve\` to proceed with full auditor scan.`,
    ].join("\n");

    if (callback) {
      await callback({ text: alertMessage, action: "WAITING_FOR_APPROVAL" });
    }

    return {
      success: true,
      text: alertMessage,
      values: { scoutData, targetId: target.targetId, jobId: job.jobId },
    } as any;
  },
  examples: [
    [
      { name: "Scout", content: { text: "I have identified a target." } },
      {
        name: "System",
        content: {
          text: "Requesting human approval...",
          action: "REQUEST_APPROVAL",
        },
      },
    ],
  ],
};

// ---------------------------------------------------------------------------
// APPROVE_TARGET — transition job from pending_approval → approved
// ---------------------------------------------------------------------------
export const approveAction: Action = {
  name: "APPROVE_TARGET",
  description: "User issues approval to execute the auditor process.",
  similes: ["/approve", "PROCEED", "GO_AHEAD"],
  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State
  ): Promise<boolean> => {
    return true;
  },
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const targetInput = resolveTargetInput(message, state);
    const target = targetFromInput(targetInput);

    // Find a pending job for this target
    let job = findPendingJob(target.targetId);

    if (!job) {
      // Maybe they passed a jobId explicitly
      const scoutData = extractScoutData(state);
      const explicitJobId = (scoutData as any)?.jobId;
      if (explicitJobId) {
        const { getJob } = await import("../../pipeline/jobStore.js");
        job = getJob(explicitJobId);
      }
    }

    if (!job) {
      const noJobText =
        "No pending job found to approve. Submit a target first.";
      if (callback) await callback({ text: noJobText, action: "NO_PENDING_JOB" });
      return { success: false, text: noJobText } as any;
    }

    if (job.state !== "pending_approval") {
      const wrongState = `Job ${job.jobId} is in state '${job.state}', not awaiting approval.`;
      if (callback) await callback({ text: wrongState, action: "WRONG_STATE" });
      return { success: false, text: wrongState } as any;
    }

    const updatedJob = transitionJob(job.jobId, "approved");

    const confMessage = [
      `✅ **Approved**. Auditor agent can now start deep code analysis.`,
      `Target: ${updatedJob.target.displayName}`,
      `Job: ${updatedJob.jobId} (state: ${updatedJob.state})`,
    ].join("\n");

    if (callback) {
      await callback({ text: confMessage, action: "START_AUDITOR" });
    }

    return {
      success: true,
      text: confMessage,
      values: {
        scoutData: updatedJob.scoutData,
        targetId: updatedJob.target.targetId,
        jobId: updatedJob.jobId,
      },
    } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "/approve" } },
      {
        name: "System",
        content: {
          text: "Approval received. Initializing sequence.",
          action: "APPROVE_TARGET",
        },
      },
    ],
  ],
};

export const hitlPlugin: Plugin = {
  name: "HumanInTheLoopGate",
  description:
    "HITL Gatekeeper requiring explicit approval to execute compute-heavy tasks. Uses the canonical JobStore lifecycle.",
  actions: [requestApprovalAction, approveAction],
  evaluators: [],
  providers: [],
};
