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

import { runAudit, runReview, targetFromInput } from "../../pipeline/audit.js";
import { writeAudit, writeFinding, writeReview } from "../../pipeline/memory.js";

// --- AUDITOR (HUNTER) PORTION ---

export const executeAuditAction: Action = {
  name: "EXECUTE_AUDIT",
  description: "Triggers the Nosana compute layer to analyze a codebase for security vulnerabilities.",
  similes: ["RUN_QWEN_AUDIT", "FIND_VULNERABILITIES", "PENTEST_REPO"],
  validate: async (runtime: IAgentRuntime, message: Memory, state?: State): Promise<boolean> => {
    return true;
  },
  handler: async (runtime: IAgentRuntime, message: Memory, state?: State, options?: HandlerOptions, callback?: HandlerCallback): Promise<ActionResult> => {
    // HITL guard: block compute-heavy audit unless the user approved the pending target.
    const scoutData = (state as any)?.scoutData ?? (state as any)?.values?.scoutData ?? (state as any)?.data?.scoutData ?? null;
    const targetInput: string =
      String(scoutData?.projectId ?? scoutData?.projectName ?? (message.content as any)?.text ?? "Unknown Target");
    const target = targetFromInput(targetInput);
    const targetId = target.targetId;

    const roomId = (message as any).roomId;
    const approvalQuery = "HITL_STAGE:APPROVED";

    try {
      const approvals: any[] = (await (runtime as any).searchMemories?.({
        query: approvalQuery,
        type: MemoryType.DOCUMENT,
        roomId,
        limit: 30,
      })) as any[];

      const approvedMemory = (approvals || []).find((mem) => {
        const text = mem?.content?.text ?? mem?.content?.[0]?.text ?? mem?.text ?? "";
        const found = text?.includes(`TARGET_ID:${targetId}`);
        return targetId ? found : true;
      });

      if (!approvedMemory) {
        const waitText = `⏸️ Auditor is waiting for human approval.\nTarget: ${target.displayName}\nReply with \`/approve\` in the HITL gate to proceed.`;
        if (callback) await callback({ text: waitText, action: "WAITING_FOR_APPROVAL" });
        return { success: true, text: waitText } as any;
      }
    } catch (e) {
      logger.warn(`[HITL] Approval guard failed (fail-open disabled): ${e}`);
      const waitText = `⏸️ Auditor could not verify approval state. Please ensure HITL gate was completed (reply with /approve).`;
      if (callback) await callback({ text: waitText, action: "WAITING_FOR_APPROVAL" });
      return { success: true, text: waitText } as any;
    }

    const processMessage = `\n[Auditor] Target: ${target.displayName}\n[Qwen3.5-27B-AWQ-4bit] Generating structured audit report...\n`;

    const report = await runAudit(runtime, { target, scopeContext: scoutData });
    await writeAudit(runtime, { roomId, userId: (message as any).userId, target, report });

    const draftText = [
      `### VULNERABILITY (Severity: ${report.severity.toUpperCase()})`,
      `**Title:** ${report.title}`,
      `**Description:** ${report.description}`,
      report.recommendations?.length ? `**Recommendations:**\n- ${report.recommendations.join("\n- ")}` : "",
      report.poc?.text ? `\n**PoC (${report.poc.framework} skeleton):**\n\n\`\`\`\n${report.poc.text}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (callback) await callback({ text: processMessage + draftText, action: "DRAFT_REPORT_READY" });

    // Run reviewer consensus immediately for now.
    const verdict = await runReview(runtime, { target, report, scopeContext: scoutData });
    await writeReview(runtime, { roomId, userId: (message as any).userId, target, report, verdict });

    if (verdict.verdict === "publish") {
      await writeFinding(runtime, { roomId, userId: (message as any).userId, target, report, verdict });
      const publishText = `✅ **REVIEW PASSED** (${Math.round(verdict.confidence * 100)}%): Publishing finding for UI.\n${verdict.rationale}`;
      if (callback) await callback({ text: publishText, action: "PUBLISH_REPORT" });
      return { success: true, text: draftText, values: { report, verdict, target } } as any;
    }

    const discardText = `❌ **REVIEW FAILED** (${Math.round(verdict.confidence * 100)}%): Discarding report.\n${verdict.rationale}`;
    if (callback) await callback({ text: discardText, action: "DISCARD_REPORT" });
    return { success: false, text: discardText, values: { report, verdict, target } } as any;
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
    // This action is retained for manual Reviewer invocation but is now deterministic.
    // It will look for the latest AUDIT_REPORT in memory and produce a verdict.
    const roomId = (message as any).roomId;
    const audits: any[] = (await (runtime as any).searchMemories?.({
      query: "AUDIT_REPORT",
      type: MemoryType.DOCUMENT,
      roomId,
      limit: 10,
    })) as any[];

    const sorted = (audits || []).sort(
      (a, b) => (b?.createdAt?.getTime?.() ?? 0) - (a?.createdAt?.getTime?.() ?? 0)
    );
    const latest = sorted[0] as any | undefined;
    const report = latest?.content?.report;
    const target = latest?.content?.target ?? targetFromInput(String((message.content as any)?.text ?? "unknown"));

    if (!report) {
      const noReport = "Reviewer could not find an audit report to review.";
      if (callback) await callback({ text: noReport, action: "DISCARD_REPORT" });
      return { success: false, text: noReport } as any;
    }

    const verdict = await runReview(runtime, { target, report, scopeContext: latest?.content?.scoutData });
    await writeReview(runtime, { roomId, userId: (message as any).userId, target, report, verdict });

    const finalConsensus =
      verdict.verdict === "discard"
        ? `❌ **REVIEW FAILED** (${Math.round(verdict.confidence * 100)}%): ${verdict.rationale}`
        : `✅ **REVIEW PASSED** (${Math.round(verdict.confidence * 100)}%): ${verdict.rationale}`;

    if (callback) {
      await callback({ text: finalConsensus, action: verdict.verdict === "discard" ? "DISCARD_REPORT" : "PUBLISH_REPORT" });
    }

    return { success: verdict.verdict === "publish", text: finalConsensus, values: { verdict } } as any;
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
