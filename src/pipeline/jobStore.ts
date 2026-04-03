import { logger } from "@elizaos/core";
import type { AuditJob, AuditJobState, AuditReport, IngestionResult, ReviewerVerdict, Target } from "./types.js";
import { simpleHash, nowIso } from "./utils.js";

// ---------------------------------------------------------------------------
// Valid state transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<AuditJobState, AuditJobState[]> = {
  submitted: ["pending_approval", "failed"],
  pending_approval: ["approved", "failed"],
  approved: ["scanning", "failed"],
  scanning: ["reviewing", "failed"],
  reviewing: ["published", "needs_human_review", "discarded", "failed"],
  needs_human_review: ["published", "discarded", "failed"],
  published: [],
  discarded: [],
  failed: [],
};

function isValidTransition(from: AuditJobState, to: AuditJobState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const jobs = new Map<string, AuditJob>();

function generateJobId(target: Target): string {
  return `job_${simpleHash(`${target.targetId}_${Date.now()}_${Math.random()}`)}`;
}

function clone(job: AuditJob): AuditJob {
  return JSON.parse(JSON.stringify(job));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createJob(
  target: Target,
  scoutData?: Record<string, unknown> | null
): AuditJob {
  const now = nowIso();
  const job: AuditJob = {
    jobId: generateJobId(target),
    state: "submitted",
    target,
    createdAt: now,
    updatedAt: now,
    stateHistory: [],
    scoutData: scoutData ?? null,
  };
  jobs.set(job.jobId, job);
  logger.info(`[JobStore] Created job ${job.jobId} for target ${target.displayName} (state: submitted)`);
  return clone(job);
}

export type TransitionOptions = {
  ingestion?: IngestionResult;
  report?: AuditReport;
  verdict?: ReviewerVerdict;
  error?: string;
};

export function transitionJob(
  jobId: string,
  to: AuditJobState,
  options?: TransitionOptions
): AuditJob {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`[JobStore] Job not found: ${jobId}`);
  }

  if (!isValidTransition(job.state, to)) {
    throw new Error(
      `[JobStore] Invalid transition: ${job.state} → ${to} for job ${jobId}`
    );
  }

  const now = nowIso();
  job.stateHistory.push({ from: job.state, to, at: now });
  job.state = to;
  job.updatedAt = now;

  if (options?.ingestion) job.ingestion = options.ingestion;
  if (options?.report) job.report = options.report;
  if (options?.verdict) job.verdict = options.verdict;
  if (options?.error) job.error = options.error;

  logger.info(
    `[JobStore] Job ${jobId} transitioned to ${to}` +
      (options?.error ? ` (error: ${options.error})` : "")
  );
  return clone(job);
}

/**
 * Update data fields on a job without changing its state.
 * Useful for attaching ingestion results, etc. after a transition.
 */
export function updateJobData(
  jobId: string,
  data: Partial<Pick<AuditJob, "ingestion" | "report" | "verdict" | "error" | "scoutData">>
): AuditJob {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`[JobStore] Job not found: ${jobId}`);
  }

  if (data.ingestion !== undefined) job.ingestion = data.ingestion;
  if (data.report !== undefined) job.report = data.report;
  if (data.verdict !== undefined) job.verdict = data.verdict;
  if (data.error !== undefined) job.error = data.error;
  if (data.scoutData !== undefined) job.scoutData = data.scoutData;

  job.updatedAt = nowIso();
  return clone(job);
}

export function getJob(jobId: string): AuditJob | undefined {
  const job = jobs.get(jobId);
  return job ? clone(job) : undefined;
}

export function getJobByTargetId(targetId: string): AuditJob | undefined {
  // Return the most recent job for a given target
  let latest: AuditJob | undefined;
  for (const job of jobs.values()) {
    if (job.target.targetId === targetId) {
      if (!latest || job.createdAt > latest.createdAt) {
        latest = job;
      }
    }
  }
  return latest ? clone(latest) : undefined;
}

export function listJobs(filter?: {
  state?: AuditJobState;
  targetId?: string;
  limit?: number;
}): AuditJob[] {
  let result = Array.from(jobs.values());

  if (filter?.state) {
    result = result.filter((j) => j.state === filter.state);
  }
  if (filter?.targetId) {
    result = result.filter((j) => j.target.targetId === filter.targetId);
  }

  // Sort newest first
  result.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  if (filter?.limit && filter.limit > 0) {
    result = result.slice(0, filter.limit);
  }

  return result.map(clone);
}

/**
 * Find a job in `pending_approval` state for a given targetId.
 * Used by the HITL approval flow.
 */
export function findPendingJob(targetId: string): AuditJob | undefined {
  for (const job of jobs.values()) {
    if (
      job.target.targetId === targetId &&
      job.state === "pending_approval"
    ) {
      return clone(job);
    }
  }
  return undefined;
}

/**
 * Find a job in `approved` state for a given targetId.
 * Used by the auditor to check readiness.
 */
export function findApprovedJob(targetId: string): AuditJob | undefined {
  for (const job of jobs.values()) {
    if (
      job.target.targetId === targetId &&
      job.state === "approved"
    ) {
      return clone(job);
    }
  }
  return undefined;
}

/**
 * Count jobs grouped by state.
 */
export function jobStats(): Record<AuditJobState, number> {
  const stats: Record<string, number> = {
    submitted: 0,
    pending_approval: 0,
    approved: 0,
    scanning: 0,
    reviewing: 0,
    published: 0,
    needs_human_review: 0,
    discarded: 0,
    failed: 0,
  };
  for (const job of jobs.values()) {
    stats[job.state] = (stats[job.state] || 0) + 1;
  }
  return stats as Record<AuditJobState, number>;
}
