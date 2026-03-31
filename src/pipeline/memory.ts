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
    `Verdict: ${verdict.verdict}`,
    `Confidence: ${verdict.confidence}`,
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
