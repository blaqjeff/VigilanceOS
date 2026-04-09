import { MemoryType, type IAgentRuntime, type UUID } from "@elizaos/core";
import type { AuditReport, ReviewerVerdict, Target } from "./types.js";

const DEFAULT_ROOM_ID = "00000000-0000-0000-0000-000000000000" as UUID;
const DEFAULT_ENTITY_ID = "00000000-0000-0000-0000-000000000001" as UUID;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuid(value: unknown, fallback: UUID): UUID {
  return typeof value === "string" && UUID_PATTERN.test(value) ? (value as UUID) : fallback;
}

type DocumentMemoryInput = {
  roomId?: unknown;
  userId?: unknown;
  text: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  unique?: boolean;
};

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function proofLabel(report: AuditReport): string {
  return report.evidence.proofLevel.replace(/_/g, " ");
}

function reproductionSummary(report: AuditReport): string {
  if (!report.evidence.reproduction.available || report.evidence.reproduction.steps.length === 0) {
    return "No guided reproduction steps are available yet.";
  }

  return report.evidence.reproduction.steps.slice(0, 3).join(" -> ");
}

function findingSummary(report: AuditReport): string {
  if (!report.findingCounts) {
    return "1 reviewed finding.";
  }

  return `${report.findingCounts.total} reviewed findings (${report.findingCounts.published} published, ${report.findingCounts.needsHumanReview} needs human review, ${report.findingCounts.discarded} discarded).`;
}

export async function createDocumentMemory(
  runtime: IAgentRuntime,
  input: DocumentMemoryInput
) {
  const runtimeAny = runtime as any;
  const agentId = asUuid(runtimeAny.agentId, DEFAULT_ENTITY_ID);
  const roomId = asUuid(input.roomId, DEFAULT_ROOM_ID);
  const entityId = asUuid(input.userId, agentId);

  return runtimeAny.createMemory(
    {
      entityId,
      agentId,
      roomId,
      content: {
        text: input.text,
        ...(input.content ?? {}),
      },
      metadata: {
        type: MemoryType.DOCUMENT,
        ...(input.metadata ?? {}),
      },
    },
    "messages",
    input.unique
  );
}

export async function writeTarget(
  runtime: IAgentRuntime,
  params: {
    roomId?: unknown;
    userId?: unknown;
    target: Target;
    scoutData?: Record<string, unknown> | null;
  }
) {
  const { roomId, userId, target, scoutData } = params;
  const text = [
    `SCOUT_REPORT TARGET_ID:${target.targetId}`,
    `Target: ${target.displayName}`,
    target.url ? `URL: ${target.url}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return createDocumentMemory(runtime, {
    roomId,
    userId,
    text,
    content: {
      target,
      scoutData: scoutData ?? null,
    },
    metadata: {
      stage: "scout",
      targetId: target.targetId,
      targetType: target.type,
    },
  });
}

export async function writeAudit(
  runtime: IAgentRuntime,
  params: {
    roomId?: unknown;
    userId?: unknown;
    target: Target;
    report: AuditReport;
    scoutData?: Record<string, unknown> | null;
  }
) {
  const { roomId, userId, target, report, scoutData } = params;
  const text = [
    `AUDIT_REPORT TARGET_ID:${target.targetId}`,
    `Target: ${target.displayName}`,
    `Title: ${report.title}`,
    `Severity: ${report.severity}`,
    `Auditor Confidence: ${formatPercent(report.confidence)}`,
    `Finding Summary: ${findingSummary(report)}`,
    `Proof Level: ${proofLabel(report)}`,
    `Evidence: ${report.evidence.summary}`,
    `Impact: ${report.impact}`,
    report.whyFlagged.length ? `Why Flagged: ${report.whyFlagged.join(" | ")}` : "",
    `Reproduction: ${reproductionSummary(report)}`,
    report.description,
  ].join("\n");

  return createDocumentMemory(runtime, {
    roomId,
    userId,
    text,
    content: {
      target,
      report,
      scoutData: scoutData ?? null,
    },
    metadata: {
      stage: "audit",
      targetId: target.targetId,
      severity: report.severity,
    },
  });
}

export async function writeReview(
  runtime: IAgentRuntime,
  params: {
    roomId?: unknown;
    userId?: unknown;
    target: Target;
    report: AuditReport;
    verdict: ReviewerVerdict;
  }
) {
  const { roomId, userId, target, report, verdict } = params;
  const text = [
    `REVIEW_REPORT TARGET_ID:${target.targetId}`,
    `Target: ${target.displayName}`,
    `Title: ${report.title}`,
    `Severity: ${report.severity}`,
    `Finding Summary: ${findingSummary(report)}`,
    `Proof Level: ${proofLabel(report)}`,
    `Verdict: ${verdict.verdict}`,
    `Reviewer Confidence: ${formatPercent(verdict.confidence)}`,
    verdict.rationale,
  ].join("\n");

  return createDocumentMemory(runtime, {
    roomId,
    userId,
    text,
    content: {
      target,
      report,
      verdict,
    },
    metadata: {
      stage: "review",
      targetId: target.targetId,
      verdict: verdict.verdict,
    },
  });
}

export async function writeFinding(
  runtime: IAgentRuntime,
  params: {
    roomId?: unknown;
    userId?: unknown;
    target: Target;
    report: AuditReport;
    verdict: ReviewerVerdict;
  }
) {
  const { roomId, userId, target, report, verdict } = params;
  const text = [
    `FINDING TARGET_ID:${target.targetId}`,
    `Target: ${target.displayName}`,
    `Title: ${report.title}`,
    `Severity: ${report.severity}`,
    `Auditor Confidence: ${formatPercent(report.confidence)}`,
    `Finding Summary: ${findingSummary(report)}`,
    `Reviewer Confidence: ${formatPercent(verdict.confidence)}`,
    `Proof Level: ${proofLabel(report)}`,
    `Evidence: ${report.evidence.summary}`,
    verdict.rationale,
  ].join("\n");

  return createDocumentMemory(runtime, {
    roomId,
    userId,
    text,
    content: {
      target,
      report,
      verdict,
    },
    metadata: {
      stage: "finding",
      targetId: target.targetId,
      severity: report.severity,
      verdict: verdict.verdict,
    },
  });
}
