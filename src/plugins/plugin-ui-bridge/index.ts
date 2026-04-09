import type { Plugin, Route } from "@elizaos/core";
import { logger } from "@elizaos/core";
import { runAudit, runReview, targetFromInput } from "../../pipeline/audit.js";
import { ingestTarget, cleanupIngestion } from "../../pipeline/ingestion.js";
import { writeAudit, writeFinding, writeReview, writeTarget } from "../../pipeline/memory.js";
import {
  getReadinessSnapshot,
  refreshModelReadinessSnapshot,
} from "../../readiness.js";
import { ensureScoutWatcher, getScoutWatcherSnapshot, refreshScoutWatcher } from "../../scout/watcher.js";
import type { IngestionResult } from "../../pipeline/types.js";
import { formatAuditCompletionAlert, sendTelegramAlert } from "../../telegram/ops.js";
import {
  createJob,
  findApprovedJob,
  findPendingJob,
  getJob,
  getJobByTargetId,
  jobStats,
  listJobs,
  transitionJob,
  updateJobData,
} from "../../pipeline/jobStore.js";

function json(res: any, status: number, body: any) {
  res.status(status);
  res.json(body);
}

function getRoomId(req: any): string {
  return String(req.body?.roomId ?? req.query?.roomId ?? "00000000-0000-0000-0000-000000000000");
}

function getUserId(req: any): string | undefined {
  const v = req.body?.userId ?? req.query?.userId;
  return v ? String(v) : undefined;
}

async function persistCompatMemory(task: string, writer: () => Promise<void>) {
  try {
    await writer();
  } catch (error) {
    logger.warn(`[UIBridge] ${task} memory persistence skipped: ${error}`);
  }
}

async function executeAuditLifecycle({
  runtime,
  roomId,
  userId,
  jobId,
}: {
  runtime: any;
  roomId: string;
  userId?: string;
  jobId: string;
}) {
  const job = getJob(jobId);
  if (!job) {
    logger.warn(`[UIBridge] audit lifecycle aborted: missing job ${jobId}`);
    return;
  }

  let ingestion: IngestionResult | undefined;

  try {
    if (job.target.type === "github" || job.target.type === "local") {
      ingestion = await ingestTarget(job.target);
      updateJobData(job.jobId, { ingestion });
    }
  } catch (ingestionErr: any) {
    logger.warn(
      `[UIBridge] Ingestion failed for ${job.target.displayName}: ${ingestionErr?.message}`
    );
  }

  try {
    const report = await runAudit(runtime, {
      target: job.target,
      scopeContext: job.scoutData,
      ingestion,
    });

    transitionJob(job.jobId, "reviewing", { report });
    await persistCompatMemory("audit", () =>
      writeAudit(runtime, { roomId, userId, target: job.target, report })
    );

    const verdict = await runReview(runtime, {
      target: job.target,
      report,
      scopeContext: job.scoutData,
      ingestion,
    });

    await persistCompatMemory("review", () =>
      writeReview(runtime, { roomId, userId, target: job.target, report, verdict })
    );

    if (verdict.verdict === "publish") {
      const finalJob = transitionJob(job.jobId, "published", { verdict });
      await persistCompatMemory("finding", () =>
        writeFinding(runtime, { roomId, userId, target: job.target, report, verdict })
      );
      await sendTelegramAlert(
        runtime,
        finalJob.scoutData as any,
        formatAuditCompletionAlert(finalJob)
      );
      return;
    }

    if (verdict.verdict === "needs_human_review") {
      const finalJob = transitionJob(job.jobId, "needs_human_review", { verdict });
      await sendTelegramAlert(
        runtime,
        finalJob.scoutData as any,
        formatAuditCompletionAlert(finalJob)
      );
      return;
    }

    const finalJob = transitionJob(job.jobId, "discarded", { verdict });
    await sendTelegramAlert(
      runtime,
      finalJob.scoutData as any,
      formatAuditCompletionAlert(finalJob)
    );
  } catch (error: any) {
    transitionJob(job.jobId, "failed", {
      error: `Audit lifecycle error: ${error?.message ?? error}`,
    });
    logger.error(`[UIBridge] audit lifecycle failed for ${job.jobId}: ${error}`);
  } finally {
    if (ingestion) cleanupIngestion(ingestion);
  }
}

// ---------------------------------------------------------------------------
// POST /vigilance/targets — submit a new target (creates job)
// ---------------------------------------------------------------------------
const createTargetRoute: Route = {
  name: "vigilance-create-target",
  path: "/vigilance/targets",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const input = String(req.body?.target ?? "").trim();
      if (!input) return json(res, 400, { success: false, error: "target is required" });

      const roomId = getRoomId(req);
      const userId = getUserId(req);

      const target = targetFromInput(input);
      const scoutData = {
        scoutMode: "CUSTOM",
        query: input,
        projectId: target.targetId,
        projectName: target.displayName,
        githubRepositories: target.url ? [target.url] : [],
      };

      // Create the canonical job
      const job = createJob(target, scoutData);
      // Immediately move to pending_approval
      const updatedJob = transitionJob(job.jobId, "pending_approval");

      // Preserve job-store success even if legacy memory persistence fails.
      await persistCompatMemory("target", () =>
        writeTarget(runtime, { roomId, userId, target, scoutData })
      );

      return json(res, 200, { success: true, data: { job: updatedJob, target } });
    } catch (e) {
      logger.error(`[UIBridge] create target failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /vigilance/approve — approve a pending target
// ---------------------------------------------------------------------------
const approveTargetRoute: Route = {
  name: "vigilance-approve-target",
  path: "/vigilance/approve",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, _runtime: any) => {
    try {
      const targetId = String(req.body?.targetId ?? "").trim();
      const jobId = String(req.body?.jobId ?? "").trim();
      if (!targetId && !jobId) {
        return json(res, 400, { success: false, error: "targetId or jobId is required" });
      }

      // Find the pending job
      let pending = jobId ? getJob(jobId) : undefined;
      if (!pending && targetId) {
        pending = findPendingJob(targetId);
      }

      if (!pending) {
        return json(res, 404, {
          success: false,
          error: "No pending job found for the given target/jobId",
        });
      }

      if (pending.state !== "pending_approval") {
        return json(res, 409, {
          success: false,
          error: `Job ${pending.jobId} is in state '${pending.state}', not 'pending_approval'`,
        });
      }

      const updatedJob = transitionJob(pending.jobId, "approved");
      return json(res, 200, { success: true, data: { job: updatedJob } });
    } catch (e) {
      logger.error(`[UIBridge] approve failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /vigilance/audit — run audit on an approved job
// ---------------------------------------------------------------------------
const runAuditRoute: Route = {
  name: "vigilance-run-audit",
  path: "/vigilance/audit",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const roomId = getRoomId(req);
      const userId = getUserId(req);
      const jobId = String(req.body?.jobId ?? "").trim();
      const targetId = String(req.body?.targetId ?? "").trim();
      const input = String(req.body?.target ?? "").trim();

      // Resolve the job
      let job = jobId ? getJob(jobId) : undefined;
      if (!job && targetId) {
        job = findApprovedJob(targetId);
      }
      if (!job && input) {
        const target = targetFromInput(input);
        job = findApprovedJob(target.targetId);
      }

      if (!job) {
        return json(res, 404, {
          success: false,
          error: "No approved job found. Submit and approve a target first.",
        });
      }

      if (job.state !== "approved") {
        return json(res, 409, {
          success: false,
          error: `Job ${job.jobId} is in state '${job.state}', expected 'approved'`,
        });
      }

      // Check model readiness
      const modelReadiness = (await refreshModelReadinessSnapshot()).integrations.model;
      if (!modelReadiness.available) {
        transitionJob(job.jobId, "failed", {
          error: `Model unavailable: ${modelReadiness.summary}`,
        });
        return json(res, 503, {
          success: false,
          error: "Model-backed auditing is unavailable",
          readiness: modelReadiness,
        });
      }

      const startedJob = transitionJob(job.jobId, "scanning");
      void executeAuditLifecycle({
        runtime,
        roomId,
        userId,
        jobId: job.jobId,
      });

      return json(res, 202, {
        success: true,
        data: {
          job: startedJob,
          accepted: true,
          message: "Audit accepted and running in the background.",
        },
      });
    } catch (e) {
      logger.error(`[UIBridge] audit failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/readiness
// ---------------------------------------------------------------------------
const readinessRoute: Route = {
  name: "vigilance-readiness",
  path: "/vigilance/readiness",
  type: "GET",
  public: true,
  handler: async (_req: any, res: any) => {
    try {
      await refreshModelReadinessSnapshot();
      return json(res, 200, { success: true, data: getReadinessSnapshot() });
    } catch (e) {
      logger.error(`[UIBridge] readiness failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/scout
// ---------------------------------------------------------------------------
const scoutRoute: Route = {
  name: "vigilance-scout-status",
  path: "/vigilance/scout",
  type: "GET",
  public: true,
  handler: async (_req: any, res: any, runtime: any) => {
    try {
      ensureScoutWatcher(runtime);
      return json(res, 200, { success: true, data: getScoutWatcherSnapshot() });
    } catch (e) {
      logger.error(`[UIBridge] scout snapshot failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /vigilance/scout/refresh
// ---------------------------------------------------------------------------
const scoutRefreshRoute: Route = {
  name: "vigilance-scout-refresh",
  path: "/vigilance/scout/refresh",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      ensureScoutWatcher(runtime);
      const result = await refreshScoutWatcher(runtime, {
        reason: "ui manual refresh",
        roomId: getRoomId(req),
        userId: getUserId(req),
      });

      const status = result.success ? 200 : result.blocked ? 503 : 500;
      return json(res, status, {
        success: result.success,
        blocked: result.blocked,
        message: result.message,
        data: result.snapshot,
      });
    } catch (e) {
      logger.error(`[UIBridge] scout refresh failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/jobs — list all jobs (optionally filtered by state)
// ---------------------------------------------------------------------------
const jobsListRoute: Route = {
  name: "vigilance-jobs-list",
  path: "/vigilance/jobs",
  type: "GET",
  public: true,
  handler: async (req: any, res: any) => {
    try {
      const state = req.query?.state as string | undefined;
      const targetId = req.query?.targetId as string | undefined;
      const limit = parseInt(req.query?.limit ?? "50", 10);

      const validStates = [
        "submitted", "pending_approval", "approved", "scanning",
        "reviewing", "published", "needs_human_review", "discarded", "failed",
      ];
      const filterState =
        state && validStates.includes(state) ? (state as any) : undefined;

      const result = listJobs({ state: filterState, targetId, limit });
      const stats = jobStats();
      return json(res, 200, { success: true, data: { jobs: result, stats } });
    } catch (e) {
      logger.error(`[UIBridge] jobs list failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/jobs/:jobId — single job detail
// ---------------------------------------------------------------------------
const jobDetailRoute: Route = {
  name: "vigilance-job-detail",
  path: "/vigilance/jobs/:jobId",
  type: "GET",
  public: true,
  handler: async (req: any, res: any) => {
    try {
      const jobId = req.params?.jobId ?? "";
      const job = getJob(jobId);
      if (!job) {
        return json(res, 404, { success: false, error: "Job not found" });
      }
      return json(res, 200, { success: true, data: { job } });
    } catch (e) {
      logger.error(`[UIBridge] job detail failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/feed — legacy feed (scouts + hitl from memory)
// ---------------------------------------------------------------------------
const feedRoute: Route = {
  name: "vigilance-feed",
  path: "/vigilance/feed",
  type: "GET",
  public: true,
  handler: async (req: any, res: any) => {
    try {
      // Return jobs grouped by lifecycle bucket instead of raw memory search
      const pending = listJobs({ state: "pending_approval", limit: 30 });
      const approved = listJobs({ state: "approved", limit: 30 });
      const scanning = listJobs({ state: "scanning", limit: 10 });
      const reviewing = listJobs({ state: "reviewing", limit: 10 });
      const needsHumanReview = listJobs({ state: "needs_human_review", limit: 10 });
      const stats = jobStats();

      return json(res, 200, {
        success: true,
        data: {
          pending,
          approved,
          scanning,
          reviewing,
          needsHumanReview,
          stats,
        },
      });
    } catch (e) {
      logger.error(`[UIBridge] feed failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// GET /vigilance/findings — completed findings
// ---------------------------------------------------------------------------
const findingsRoute: Route = {
  name: "vigilance-findings",
  path: "/vigilance/findings",
  type: "GET",
  public: true,
  handler: async (req: any, res: any) => {
    try {
      const published = listJobs({ state: "published", limit: 50 });
      const needsHumanReview = listJobs({ state: "needs_human_review", limit: 50 });
      const discarded = listJobs({ state: "discarded", limit: 50 });
      return json(res, 200, {
        success: true,
        data: { published, needsHumanReview, discarded },
      });
    } catch (e) {
      logger.error(`[UIBridge] findings failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------
export const uiBridgePlugin: Plugin = {
  name: "VigilanceUIBridge",
  description: "HTTP routes for UI-driven target assignment, job lifecycle, and results.",
  actions: [],
  evaluators: [],
  providers: [],
  routes: [
    createTargetRoute,
    approveTargetRoute,
    runAuditRoute,
    scoutRoute,
    scoutRefreshRoute,
    feedRoute,
    findingsRoute,
    readinessRoute,
    jobsListRoute,
    jobDetailRoute,
  ],
};
