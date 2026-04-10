import type { Plugin, Route } from "@elizaos/core";
import { logger } from "@elizaos/core";
import {
  runAudit,
  runReviewFindings,
  summarizeReviewedReport,
  targetFromInput,
} from "../../pipeline/audit.js";
import { ingestTarget, cleanupIngestion } from "../../pipeline/ingestion.js";
import { writeAudit, writeFinding, writeReview, writeTarget } from "../../pipeline/memory.js";
import {
  getReadinessSnapshot,
  refreshModelReadinessSnapshot,
} from "../../readiness.js";
import { ensureScoutWatcher, getScoutWatcherSnapshot, refreshScoutWatcher } from "../../scout/watcher.js";
import type { IngestionResult } from "../../pipeline/types.js";
import {
  formatApprovalRequestAlert,
  formatAuditCompletionAlert,
  sendTelegramAlert,
} from "../../telegram/ops.js";
import {
  createJob,
  findApprovedJob,
  findPendingJob,
  getJob,
  getJobByTargetId,
  jobStats,
  listJobs,
  setJobArchived,
  transitionJob,
  updateJobData,
} from "../../pipeline/jobStore.js";

function json(res: any, status: number, body: any) {
  res.status(status);
  res.json(body);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

    const reviewOutcome = await runReviewFindings(runtime, {
      target: job.target,
      report,
      scopeContext: job.scoutData,
      ingestion,
    });
    const reviewedReport = reviewOutcome.report;
    const verdict = reviewOutcome.verdict;

    await persistCompatMemory("review", () =>
      writeReview(runtime, { roomId, userId, target: job.target, report: reviewedReport, verdict })
    );

    if (verdict.verdict === "publish") {
      const finalJob = transitionJob(job.jobId, "published", {
        report: reviewedReport,
        verdict,
      });
      await persistCompatMemory("finding", () =>
        writeFinding(runtime, {
          roomId,
          userId,
          target: job.target,
          report: reviewedReport,
          verdict,
        })
      );
      await sendTelegramAlert(
        runtime,
        finalJob.scoutData as any,
        formatAuditCompletionAlert(finalJob)
      );
      return;
    }

    if (verdict.verdict === "needs_human_review") {
      const finalJob = transitionJob(job.jobId, "needs_human_review", {
        report: reviewedReport,
        verdict,
      });
      await sendTelegramAlert(
        runtime,
        finalJob.scoutData as any,
        formatAuditCompletionAlert(finalJob)
      );
      return;
    }

    const finalJob = transitionJob(job.jobId, "discarded", {
      report: reviewedReport,
      verdict,
    });
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
      const requestedDisplayName = String(req.body?.displayName ?? "").trim();
      const requestedMetadata = isPlainObject(req.body?.metadata) ? req.body.metadata : undefined;

      const target = targetFromInput(input);
      if (requestedDisplayName) {
        target.displayName = requestedDisplayName;
      }
      if (requestedMetadata) {
        target.metadata = {
          ...(target.metadata ?? {}),
          ...requestedMetadata,
        };
      }
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

      await sendTelegramAlert(runtime, scoutData as any, formatApprovalRequestAlert(updatedJob));

      return json(res, 200, { success: true, data: { job: updatedJob, target } });
    } catch (e) {
      logger.error(`[UIBridge] create target failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /vigilance/jobs/:jobId/findings/:candidateId/resolve
// ---------------------------------------------------------------------------
const resolveFindingRoute: Route = {
  name: "vigilance-resolve-finding",
  path: "/vigilance/jobs/:jobId/findings/:candidateId/resolve",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const jobId = String(req.params?.jobId ?? "").trim();
      const candidateId = String(req.params?.candidateId ?? "").trim();
      const requestedAction = String(req.body?.action ?? "").trim().toLowerCase();
      const analystNote = String(req.body?.note ?? "").trim();
      const roomId = getRoomId(req);
      const userId = getUserId(req);

      if (!jobId || !candidateId) {
        return json(res, 400, {
          success: false,
          error: "jobId and candidateId are required",
        });
      }

      if (requestedAction !== "publish" && requestedAction !== "discard") {
        return json(res, 400, {
          success: false,
          error: "action must be 'publish' or 'discard'",
        });
      }
      const action = requestedAction as "publish" | "discard";

      const job = getJob(jobId);
      if (!job?.report?.candidateFindings?.length) {
        return json(res, 404, {
          success: false,
          error: "Job report or candidate findings were not found",
        });
      }

      let resolved = false;
      const nextCandidates = job.report.candidateFindings.map((candidate) => {
        if (candidate.candidateId !== candidateId) {
          return candidate;
        }
        resolved = true;

        const previousReview =
          candidate.review ??
          (job.verdict ?? {
            verdict: "needs_human_review",
            rationale: "",
            confidence: 0.5,
          });

        if (previousReview.verdict !== "needs_human_review") {
          throw new Error(`Candidate ${candidateId} is not awaiting human review`);
        }

        const operatorLabel =
          action === "publish"
            ? "Operator manually promoted this finding after human review."
            : "Operator manually discarded this finding after human review.";

        return {
          ...candidate,
          review: {
            verdict: action,
            confidence: Math.max(previousReview.confidence, action === "publish" ? 0.7 : 0.5),
            rationale: [previousReview.rationale, analystNote, operatorLabel]
              .filter(Boolean)
              .join(" ")
              .trim(),
          },
        };
      });

      if (!resolved) {
        return json(res, 404, {
          success: false,
          error: `Candidate ${candidateId} was not found on job ${jobId}`,
        });
      }

      const updatedReport = {
        ...job.report,
        candidateFindings: nextCandidates,
      };
      const summarized = summarizeReviewedReport(updatedReport, job.ingestion);

      updateJobData(job.jobId, {
        report: summarized.report,
        verdict: summarized.verdict,
      });

      let nextJob = getJob(job.jobId)!;
      if (
        nextJob.state === "needs_human_review" &&
        summarized.verdict.verdict === "publish"
      ) {
        nextJob = transitionJob(nextJob.jobId, "published", {
          report: summarized.report,
          verdict: summarized.verdict,
        });
        await persistCompatMemory("finding", () =>
          writeFinding(runtime, {
            roomId,
            userId,
            target: nextJob.target,
            report: summarized.report,
            verdict: summarized.verdict,
          })
        );
        await sendTelegramAlert(
          runtime,
          nextJob.scoutData as any,
          formatAuditCompletionAlert(nextJob)
        );
      } else if (
        nextJob.state === "needs_human_review" &&
        summarized.verdict.verdict === "discard"
      ) {
        nextJob = transitionJob(nextJob.jobId, "discarded", {
          report: summarized.report,
          verdict: summarized.verdict,
        });
        await sendTelegramAlert(
          runtime,
          nextJob.scoutData as any,
          formatAuditCompletionAlert(nextJob)
        );
      }

      return json(res, 200, {
        success: true,
        data: {
          job: nextJob,
          report: summarized.report,
          verdict: summarized.verdict,
        },
      });
    } catch (e: any) {
      logger.error(`[UIBridge] resolve finding failed: ${e}`);
      return json(res, 500, {
        success: false,
        error: e?.message ?? "internal error",
      });
    }
  },
};

// ---------------------------------------------------------------------------
// POST /vigilance/jobs/:jobId/archive
// ---------------------------------------------------------------------------
const archiveJobRoute: Route = {
  name: "vigilance-archive-job",
  path: "/vigilance/jobs/:jobId/archive",
  type: "POST",
  public: true,
  handler: async (req: any, res: any) => {
    try {
      const jobId = String(req.params?.jobId ?? "").trim();
      const archivedRaw = req.body?.archived;
      const archived = archivedRaw === undefined ? true : Boolean(archivedRaw);

      if (!jobId) {
        return json(res, 400, { success: false, error: "jobId is required" });
      }

      const job = getJob(jobId);
      if (!job) {
        return json(res, 404, { success: false, error: "Job not found" });
      }

      const terminalStates: Array<typeof job.state> = [
        "published",
        "needs_human_review",
        "discarded",
        "failed",
      ];
      if (!terminalStates.includes(job.state)) {
        return json(res, 409, {
          success: false,
          error: `Job ${job.jobId} is in state '${job.state}' and cannot be archived yet`,
        });
      }

      const updatedJob = setJobArchived(jobId, archived);
      return json(res, 200, { success: true, data: { job: updatedJob } });
    } catch (e) {
      logger.error(`[UIBridge] archive job failed: ${e}`);
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
      const includeArchived =
        String(req.query?.includeArchived ?? "false").toLowerCase() === "true";

      const validStates = [
        "submitted", "pending_approval", "approved", "scanning",
        "reviewing", "published", "needs_human_review", "discarded", "failed",
      ];
      const filterState =
        state && validStates.includes(state) ? (state as any) : undefined;

      const result = listJobs({ state: filterState, targetId, limit, includeArchived });
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
    archiveJobRoute,
    resolveFindingRoute,
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
