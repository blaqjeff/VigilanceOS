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
import type { AuditJob, AuditJobState } from "../../pipeline/types.js";
import {
  createJob,
  findPendingJob,
  getJobByTargetId,
  listJobs,
  transitionJob,
} from "../../pipeline/jobStore.js";
import { executeAuditAction } from "../plugin-auditor-reviewer/index.js";
import {
  attachTelegramContext,
  formatFindingsDigest,
  formatJobReportMessage,
  formatJobStatusMessage,
  matchesCommand,
  parseCommandArgument,
} from "../../telegram/ops.js";
import {
  findScoutDiscovery,
  listScoutDiscoveries,
  queueScoutChildTargets,
} from "../../scout/watcher.js";

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

function messageRoomId(message: Memory): string | undefined {
  const roomId = (message as any).roomId;
  return roomId ? String(roomId) : undefined;
}

function sortByUpdated(jobs: AuditJob[]): AuditJob[] {
  return [...jobs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

function roomScopedJobs(jobs: AuditJob[], roomId?: string): AuditJob[] {
  if (!roomId) {
    return jobs;
  }

  const scoped = jobs.filter(
    (job) => String((job.scoutData as any)?.telegramRoomId ?? "") === roomId
  );
  return scoped.length > 0 ? scoped : jobs;
}

function jobMatchesReference(job: AuditJob, reference: string): boolean {
  const needle = reference.trim().toLowerCase();
  if (!needle) {
    return false;
  }

  return (
    job.jobId.toLowerCase() === needle ||
    job.jobId.toLowerCase().startsWith(needle) ||
    job.target.targetId.toLowerCase() === needle ||
    job.target.displayName.toLowerCase().includes(needle)
  );
}

function findJobReference(jobs: AuditJob[], reference?: string): AuditJob | undefined {
  const ref = String(reference ?? "").trim();
  if (!ref) {
    return jobs[0];
  }

  return jobs.find((job) => jobMatchesReference(job, ref));
}

function resolveJobForCommand(
  roomId: string | undefined,
  states: AuditJobState[],
  reference?: string,
  options?: { requireReport?: boolean }
): AuditJob | undefined {
  let jobs = sortByUpdated(listJobs({ limit: 200 })).filter((job) =>
    states.includes(job.state)
  );

  if (options?.requireReport) {
    jobs = jobs.filter((job) => Boolean(job.report));
  }

  const preferred = roomScopedJobs(jobs, roomId);
  return (
    findJobReference(preferred, reference) ??
    (preferred === jobs ? undefined : findJobReference(jobs, reference))
  );
}

function buildAuditState(state: State | undefined, job: AuditJob): State {
  const next = { ...((state as any) ?? {}) } as any;
  next.values = {
    ...(next.values ?? {}),
    scoutData: job.scoutData,
    jobId: job.jobId,
  };
  next.data = {
    ...(next.data ?? {}),
    scoutData: job.scoutData,
    jobId: job.jobId,
  };
  return next as State;
}

function noJobText(kind: "approve" | "report" | "status"): string {
  if (kind === "approve") {
    return "No pending approval job was found. Scout a target first or pass a job id to /approve.";
  }

  if (kind === "report") {
    return "No audit report was found yet. Try /status to inspect the latest job.";
  }

  return "No matching audit job was found. Try /findings for recent reviewed jobs.";
}

function projectScopeText(
  discovery:
    | ReturnType<typeof findScoutDiscovery>
    | undefined
): string {
  if (!discovery) {
    const recent = listScoutDiscoveries().slice(0, 5);
    if (recent.length === 0) {
      return "No Scout projects are tracked yet. Refresh Scout first or wait for the next sweep.";
    }

    return [
      "SCOUT PROJECTS",
      ...recent.map(
        (entry) =>
          `- ${entry.commandRef} | ${entry.projectName} | ${entry.queueableChildCount} queueable child targets | /scope ${entry.commandRef}`
      ),
    ].join("\n");
  }

  const lines = [
    "SCOUT PROJECT SCOPE",
    `Project: ${discovery.projectName}`,
    `Ref: ${discovery.commandRef}`,
    `State: ${discovery.state}`,
    `Scope: ${discovery.assetCount} assets | ${discovery.impactCount} impacts | ${discovery.repositoryCount} repos | ${discovery.resourceCount} resources`,
  ];

  if (discovery.childTargets.length === 0) {
    lines.push("No child targets are available yet.");
    return lines.join("\n");
  }

  lines.push("Child targets:");
  discovery.childTargets.slice(0, 12).forEach((child, index) => {
    const parts = [
      `${index + 1}. ${child.label}`,
      child.kind,
      child.queueable ? "queueable" : "context only",
      child.queuedJobId ? `job ${child.queuedJobId}` : "",
    ].filter(Boolean);
    lines.push(parts.join(" | "));
  });

  if (discovery.childTargets.length > 12) {
    lines.push(`...and ${discovery.childTargets.length - 12} more child targets`);
  }

  if (discovery.queueableChildCount > 0) {
    lines.push(`Queue all: /queueall ${discovery.commandRef}`);
    lines.push(`Queue one or more: /queue ${discovery.commandRef} 1,2`);
  }

  return lines.join("\n");
}

function parseQueueCommand(argument: string): { projectRef?: string; childRefs: string[] } {
  const trimmed = argument.trim();
  if (!trimmed) {
    return { childRefs: [] };
  }

  const [projectRef, ...rest] = trimmed.split(/\s+/);
  const childRefs = rest.join(" ")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    projectRef,
    childRefs,
  };
}

const JOB_STATES_FOR_STATUS: AuditJobState[] = [
  "pending_approval",
  "approved",
  "scanning",
  "reviewing",
  "needs_human_review",
  "published",
  "discarded",
  "failed",
];

// ---------------------------------------------------------------------------
// REQUEST_APPROVAL — create/advance job to pending_approval
// ---------------------------------------------------------------------------
export const requestApprovalAction: Action = {
  name: "REQUEST_APPROVAL",
  description:
    "Triggers a Human-In-The-Loop gate by sending an approval request and pausing execution until approved.",
  similes: ["ASK_USER", "AWAIT_APPROVAL", "PAUSE_AND_PING_USER"],
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
    const scoutData = await attachTelegramContext(runtime, message, extractScoutData(state));
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

    const resolvedAlertMessage = [
      "APPROVAL REQUIRED",
      `Target: ${target.displayName}`,
      `Job: ${job.jobId}`,
      `Approve and run: /approve ${job.jobId}`,
      `Status: /status ${job.jobId}`,
    ].join("\n");

    if (callback) {
      await callback({ text: resolvedAlertMessage, action: "WAITING_FOR_APPROVAL" });
    }

    return {
      success: true,
      text: resolvedAlertMessage,
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
  description: "Approves a pending job and starts the audit flow for Telegram operators.",
  similes: ["/approve", "PROCEED", "GO_AHEAD", "APPROVE_AND_RUN"],
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
    options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = messageRoomId(message);
    const reference = parseCommandArgument(message, "approve");

    let resolvedJob =
      resolveJobForCommand(roomId, ["pending_approval"], reference) ??
      (() => {
        const target = targetFromInput(resolveTargetInput(message, state));
        return findPendingJob(target.targetId);
      })();

    if (!resolvedJob) {
      const text = noJobText("approve");
      if (callback) await callback({ text, action: "NO_PENDING_JOB" });
      return { success: false, text } as any;
    }

    if (resolvedJob.state !== "pending_approval") {
      const text = `Job ${resolvedJob.jobId} is in state '${resolvedJob.state}', not awaiting approval.`;
      if (callback) await callback({ text, action: "WRONG_STATE" });
      return { success: false, text } as any;
    }

    const approvedJob = transitionJob(resolvedJob.jobId, "approved");
    const approvedText = [
      "APPROVED",
      `Target: ${approvedJob.target.displayName}`,
      `Job: ${approvedJob.jobId}`,
      "Starting audit now.",
    ].join("\n");

    if (callback) {
      await callback({ text: approvedText, action: "START_AUDITOR" });
    }

    const auditState = buildAuditState(state, approvedJob);
    const auditMessage = {
      ...message,
      content: {
        ...(message.content as any),
        text: approvedJob.target.displayName,
      },
    } as Memory;

    return (await executeAuditAction.handler(
      runtime,
      auditMessage,
      auditState,
      options,
      callback
    )) as ActionResult;

    /*

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
    */
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

export const reportAction: Action = {
  name: "GET_AUDIT_REPORT",
  description: "Returns the latest audit report, or a specific report when given a job id.",
  similes: ["/report", "SHOW_REPORT", "GET_REPORT"],
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => matchesCommand(message, "report"),
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = messageRoomId(message);
    const reference = parseCommandArgument(message, "report");

    let job = resolveJobForCommand(roomId, JOB_STATES_FOR_STATUS, reference, {
      requireReport: !reference,
    });
    if (!job) {
      job = resolveJobForCommand(roomId, JOB_STATES_FOR_STATUS, reference);
    }

    if (!job) {
      const text = noJobText("report");
      if (callback) await callback({ text, action: "REPORT_NOT_FOUND" });
      return { success: false, text } as any;
    }

    const text = formatJobReportMessage(job);
    if (callback) await callback({ text, action: "REPORT_READY" });
    return { success: true, text, values: { jobId: job.jobId } } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "/report job_123" } },
      {
        name: "System",
        content: {
          text: "Returning the requested report.",
          action: "GET_AUDIT_REPORT",
        },
      },
    ],
  ],
};

export const scopeAction: Action = {
  name: "GET_SCOUT_SCOPE",
  description:
    "Shows the latest Scout projects or the child targets under one specific project.",
  similes: ["/scope", "SCOUT_SCOPE", "SHOW_SCOPE"],
  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> =>
    matchesCommand(message, "scope"),
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const reference = parseCommandArgument(message, "scope");
    const discovery = findScoutDiscovery(reference || undefined);
    const text = projectScopeText(discovery);
    if (callback) await callback({ text, action: "SCOUT_SCOPE_READY" });
    return { success: true, text } as any;
  },
};

export const queueScoutChildrenAction: Action = {
  name: "QUEUE_SCOUT_CHILDREN",
  description:
    "Queues one or more Scout child targets into real audit jobs waiting for approval.",
  similes: ["/queue", "QUEUE_SCOUT_TARGET", "QUEUE_SCOUT_CHILD"],
  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> =>
    matchesCommand(message, "queue"),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const { projectRef, childRefs } = parseQueueCommand(parseCommandArgument(message, "queue"));
    const result = await queueScoutChildTargets(runtime, {
      projectRef,
      childRefs,
      queueAll: false,
      roomId: messageRoomId(message),
    });

    const lines = [result.message];
    for (const job of [...result.createdJobs, ...result.existingJobs].slice(0, 8)) {
      lines.push(`- ${job.jobId} | ${job.target.displayName} | /approve ${job.jobId}`);
    }
    if (callback) {
      await callback({
        text: lines.join("\n"),
        action: result.success ? "SCOUT_CHILDREN_QUEUED" : "SCOUT_QUEUE_FAILED",
      });
    }
    return { success: result.success, text: lines.join("\n") } as any;
  },
};

export const queueAllScoutChildrenAction: Action = {
  name: "QUEUE_ALL_SCOUT_CHILDREN",
  description: "Queues all queueable child targets for a Scout project.",
  similes: ["/queueall", "QUEUE_ALL_SCOUT_TARGETS", "QUEUE_SCOUT_ALL"],
  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> =>
    matchesCommand(message, "queueall"),
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const projectRef = parseCommandArgument(message, "queueall");
    const result = await queueScoutChildTargets(runtime, {
      projectRef: projectRef || undefined,
      queueAll: true,
      roomId: messageRoomId(message),
    });

    const lines = [result.message];
    for (const job of [...result.createdJobs, ...result.existingJobs].slice(0, 8)) {
      lines.push(`- ${job.jobId} | ${job.target.displayName} | /approve ${job.jobId}`);
    }
    if (callback) {
      await callback({
        text: lines.join("\n"),
        action: result.success ? "SCOUT_CHILDREN_QUEUED" : "SCOUT_QUEUE_FAILED",
      });
    }
    return { success: result.success, text: lines.join("\n") } as any;
  },
};

export const findingsAction: Action = {
  name: "LIST_FINDINGS",
  description: "Lists recent published findings and the analyst-review queue.",
  similes: ["/findings", "SHOW_FINDINGS", "LIST_FINDINGS"],
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => matchesCommand(message, "findings"),
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = messageRoomId(message);
    const published = roomScopedJobs(
      sortByUpdated(listJobs({ state: "published", limit: 50 })),
      roomId
    );
    const needsHumanReview = roomScopedJobs(
      sortByUpdated(listJobs({ state: "needs_human_review", limit: 50 })),
      roomId
    );

    const text = formatFindingsDigest(published, needsHumanReview);
    if (callback) await callback({ text, action: "FINDINGS_READY" });
    return { success: true, text } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "/findings" } },
      {
        name: "System",
        content: {
          text: "Returning recent findings.",
          action: "LIST_FINDINGS",
        },
      },
    ],
  ],
};

export const statusAction: Action = {
  name: "GET_AUDIT_STATUS",
  description: "Returns the latest pipeline state for a job, or the freshest job when none is specified.",
  similes: ["/status", "CHECK_STATUS", "JOB_STATUS"],
  validate: async (
    _runtime: IAgentRuntime,
    message: Memory
  ): Promise<boolean> => matchesCommand(message, "status"),
  handler: async (
    _runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    const roomId = messageRoomId(message);
    const reference = parseCommandArgument(message, "status");
    const job = resolveJobForCommand(roomId, JOB_STATES_FOR_STATUS, reference);

    if (!job) {
      const text = noJobText("status");
      if (callback) await callback({ text, action: "STATUS_NOT_FOUND" });
      return { success: false, text } as any;
    }

    const text = formatJobStatusMessage(job);
    if (callback) await callback({ text, action: "STATUS_READY" });
    return { success: true, text, values: { jobId: job.jobId } } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "/status job_123" } },
      {
        name: "System",
        content: {
          text: "Returning job status.",
          action: "GET_AUDIT_STATUS",
        },
      },
    ],
  ],
};

export const hitlPlugin: Plugin = {
  name: "HumanInTheLoopGate",
  description:
    "Telegram-facing HITL controls for Scout scope inspection, queueing child targets, approval, status, reports, and findings over the canonical JobStore lifecycle.",
  actions: [
    requestApprovalAction,
    approveAction,
    reportAction,
    scopeAction,
    queueScoutChildrenAction,
    queueAllScoutChildrenAction,
    findingsAction,
    statusAction,
  ],
  evaluators: [],
  providers: [],
};
