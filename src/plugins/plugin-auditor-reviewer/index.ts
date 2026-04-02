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

import { runAudit, runReview, targetFromInput } from "../../pipeline/audit.js";
import { ingestTarget, cleanupIngestion } from "../../pipeline/ingestion.js";
import { writeAudit, writeFinding, writeReview } from "../../pipeline/memory.js";
import { getIntegrationReadiness } from "../../readiness.js";
import type { IngestionResult } from "../../pipeline/types.js";
import {
  findApprovedJob,
  getJob,
  getJobByTargetId,
  transitionJob,
  updateJobData,
} from "../../pipeline/jobStore.js";

// ---------------------------------------------------------------------------
// EXECUTE_AUDIT — run audit through the full job lifecycle
// ---------------------------------------------------------------------------
export const executeAuditAction: Action = {
  name: "EXECUTE_AUDIT",
  description:
    "Triggers the Nosana compute layer to analyze a codebase for security vulnerabilities.",
  similes: ["RUN_QWEN_AUDIT", "FIND_VULNERABILITIES", "PENTEST_REPO"],
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
    const scoutData =
      (state as any)?.scoutData ??
      (state as any)?.values?.scoutData ??
      (state as any)?.data?.scoutData ??
      null;

    const targetInput: string = String(
      scoutData?.projectId ??
        scoutData?.projectName ??
        (message.content as any)?.text ??
        "Unknown Target"
    );
    const target = targetFromInput(targetInput);
    const roomId = (message as any).roomId;
    const userId = (message as any).userId;

    // Resolve the job — check by jobId from state, then by targetId
    const explicitJobId =
      (state as any)?.values?.jobId ?? (state as any)?.data?.jobId ?? scoutData?.jobId;
    let job = explicitJobId ? getJob(explicitJobId) : undefined;

    if (!job) {
      job = findApprovedJob(target.targetId);
    }

    if (!job) {
      // Fallback: look for any job for this target
      job = getJobByTargetId(target.targetId);
    }

    // Check approval state
    if (!job || (job.state !== "approved" && job.state !== "scanning")) {
      const waitText = [
        `⏸️ Auditor is waiting for human approval.`,
        `Target: ${target.displayName}`,
        job ? `Job: ${job.jobId} (state: ${job.state})` : "No job found.",
        `Reply with \`/approve\` in the HITL gate to proceed.`,
      ].join("\n");
      if (callback) await callback({ text: waitText, action: "WAITING_FOR_APPROVAL" });
      return { success: true, text: waitText } as any;
    }

    // Check model readiness
    const modelReadiness = getIntegrationReadiness("model");
    if (!modelReadiness.available) {
      const unavailableText = [
        "Audit cannot start because the primary model backend is unavailable.",
        modelReadiness.summary,
        modelReadiness.action ? `Action: ${modelReadiness.action}` : "",
      ]
        .filter(Boolean)
        .join(" ");

      try {
        transitionJob(job.jobId, "failed", {
          error: `Model unavailable: ${modelReadiness.summary}`,
        });
      } catch {
        // Job may already be in a terminal state
      }

      if (callback) await callback({ text: unavailableText, action: "AUDIT_UNAVAILABLE" });
      return { success: false, text: unavailableText } as any;
    }

    // Transition to scanning (skip if already scanning due to retry)
    if (job.state === "approved") {
      try {
        transitionJob(job.jobId, "scanning");
      } catch (e) {
        logger.warn(`[Auditor] Could not transition to scanning: ${e}`);
      }
    }

    const processMessage = `\n[Auditor] Target: ${target.displayName}\n[Auditor] Job: ${job.jobId}\n[Qwen3.5-27B-AWQ-4bit] Generating structured audit report...\n`;

    // --- INGESTION: clone repo or read local folder ---
    let ingestion: IngestionResult | undefined;
    try {
      if (job.target.type === "github" || job.target.type === "local") {
        ingestion = await ingestTarget(job.target);
        updateJobData(job.jobId, { ingestion });
      }
    } catch (ingestionErr: any) {
      logger.warn(`[Auditor] Ingestion failed: ${ingestionErr?.message}`);
    }

    // Run the audit
    let report;
    try {
      report = await runAudit(runtime, { target, scopeContext: scoutData, ingestion });
    } catch (auditErr: any) {
      if (ingestion) cleanupIngestion(ingestion);
      const errorMsg = `Audit engine error: ${auditErr?.message ?? auditErr}`;
      try {
        transitionJob(job.jobId, "failed", { error: errorMsg });
      } catch {
        // Ignore transition errors
      }
      if (callback) await callback({ text: errorMsg, action: "AUDIT_FAILED" });
      return { success: false, text: errorMsg } as any;
    }

    await writeAudit(runtime, { roomId, userId, target, report });

    // Transition to reviewing
    try {
      transitionJob(job.jobId, "reviewing", { report });
    } catch (e) {
      logger.warn(`[Auditor] Could not transition to reviewing: ${e}`);
    }

    const draftText = [
      `### VULNERABILITY (Severity: ${report.severity.toUpperCase()})`,
      `**Title:** ${report.title}`,
      `**Description:** ${report.description}`,
      report.recommendations?.length
        ? `**Recommendations:**\n- ${report.recommendations.join("\n- ")}`
        : "",
      report.poc?.text
        ? `\n**PoC (${report.poc.framework} skeleton):**\n\n\`\`\`\n${report.poc.text}\n\`\`\``
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (callback)
      await callback({
        text: processMessage + draftText,
        action: "DRAFT_REPORT_READY",
      });

    // Run reviewer
    let verdict;
    try {
      verdict = await runReview(runtime, { target, report, scopeContext: scoutData, ingestion });
    } catch (reviewErr: any) {
      if (ingestion) cleanupIngestion(ingestion);
      const errorMsg = `Review engine error: ${reviewErr?.message ?? reviewErr}`;
      try {
        transitionJob(job.jobId, "failed", { error: errorMsg });
      } catch {
        // Ignore
      }
      if (callback) await callback({ text: errorMsg, action: "REVIEW_FAILED" });
      return { success: false, text: errorMsg } as any;
    }

    // Cleanup cloned repos now that both audit + review are done
    if (ingestion) cleanupIngestion(ingestion);

    await writeReview(runtime, { roomId, userId, target, report, verdict });

    if (verdict.verdict === "publish") {
      try {
        transitionJob(job.jobId, "published", { verdict });
      } catch (e) {
        logger.warn(`[Auditor] Could not transition to published: ${e}`);
      }
      await writeFinding(runtime, { roomId, userId, target, report, verdict });

      const publishText = [
        `✅ **REVIEW PASSED** (${Math.round(verdict.confidence * 100)}%)`,
        `Job: ${job.jobId} → published`,
        verdict.rationale,
      ].join("\n");
      if (callback) await callback({ text: publishText, action: "PUBLISH_REPORT" });
      return {
        success: true,
        text: draftText,
        values: { report, verdict, target, jobId: job.jobId },
      } as any;
    }

    // Discarded
    try {
      transitionJob(job.jobId, "discarded", { verdict });
    } catch (e) {
      logger.warn(`[Auditor] Could not transition to discarded: ${e}`);
    }

    const discardText = [
      `❌ **REVIEW FAILED** (${Math.round(verdict.confidence * 100)}%)`,
      `Job: ${job.jobId} → discarded`,
      verdict.rationale,
    ].join("\n");
    if (callback) await callback({ text: discardText, action: "DISCARD_REPORT" });
    return {
      success: false,
      text: discardText,
      values: { report, verdict, target, jobId: job.jobId },
    } as any;
  },
  examples: [
    [
      { name: "{{user1}}", content: { text: "Scan the target directory now." } },
      {
        name: "Auditor",
        content: {
          text: "Pulling repo into Nosana grid context...",
          action: "EXECUTE_AUDIT",
        },
      },
    ],
  ],
};

// ---------------------------------------------------------------------------
// DEBUNK_FINDING — reviewer-only review of latest audit
// ---------------------------------------------------------------------------
export const debunkFindingAction: Action = {
  name: "DEBUNK_FINDING",
  description:
    "The Reviewer agent evaluates the Auditor draft report and attempts to prove it wrong using adversarial analysis.",
  similes: ["VERIFY_BUG", "ATTEMPT_DEBUNK", "CHALLENGE_REPORT"],
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
    const targetInput = String((message.content as any)?.text ?? "unknown");
    const target = targetFromInput(targetInput);
    const roomId = (message as any).roomId;
    const userId = (message as any).userId;

    // Find a job in reviewing state for this target
    const job = getJobByTargetId(target.targetId);

    if (!job || !job.report) {
      const noReport = "Reviewer could not find an audit report to review.";
      if (callback) await callback({ text: noReport, action: "DISCARD_REPORT" });
      return { success: false, text: noReport } as any;
    }

    const verdict = await runReview(runtime, {
      target,
      report: job.report,
      scopeContext: job.scoutData,
    });
    await writeReview(runtime, { roomId, userId, target, report: job.report, verdict });

    // Transition if job is still in reviewing state
    if (job.state === "reviewing") {
      try {
        if (verdict.verdict === "publish") {
          transitionJob(job.jobId, "published", { verdict });
          await writeFinding(runtime, {
            roomId,
            userId,
            target,
            report: job.report,
            verdict,
          });
        } else {
          transitionJob(job.jobId, "discarded", { verdict });
        }
      } catch (e) {
        logger.warn(`[Reviewer] Could not transition job: ${e}`);
      }
    }

    const finalConsensus =
      verdict.verdict === "discard"
        ? `❌ **REVIEW FAILED** (${Math.round(verdict.confidence * 100)}%): ${verdict.rationale}`
        : `✅ **REVIEW PASSED** (${Math.round(verdict.confidence * 100)}%): ${verdict.rationale}`;

    if (callback) {
      await callback({
        text: finalConsensus,
        action:
          verdict.verdict === "discard" ? "DISCARD_REPORT" : "PUBLISH_REPORT",
      });
    }

    return {
      success: verdict.verdict === "publish",
      text: finalConsensus,
      values: { verdict, jobId: job.jobId },
    } as any;
  },
  examples: [
    [
      { name: "Auditor", content: { text: "Draft report ready for review" } },
      {
        name: "Reviewer",
        content: {
          text: "Reviewing code execution paths...",
          action: "DEBUNK_FINDING",
        },
      },
    ],
  ],
};

export const auditorReviewerPlugin: Plugin = {
  name: "AuditorAndReviewer",
  description:
    "Houses the Auditor (Qwen3.5 LLM code execution) and Reviewer (Skeptic verification) logic. Uses the canonical JobStore lifecycle.",
  actions: [executeAuditAction, debunkFindingAction],
  evaluators: [],
  providers: [],
};
