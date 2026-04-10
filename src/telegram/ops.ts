import { logger, type IAgentRuntime, type Memory, type TargetInfo } from "@elizaos/core";

import type { AuditJob } from "../pipeline/types.js";
import { getIntegrationReadiness } from "../readiness.js";

type ScoutDiscoveryAlertPayload = {
  projectKey?: string;
  commandRef?: string;
  projectName: string;
  categoryLabel?: string;
  rewardSummary?: unknown;
  scopeSummary?: unknown;
  maxBountyText?: unknown;
  githubRepositories?: unknown;
  assetCount?: unknown;
  impactCount?: unknown;
  resourceCount?: unknown;
  queueableChildCount?: unknown;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truncate(value: unknown, max = 280): string {
  const text = asText(value);
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function textList(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asText(item))
    .filter(Boolean)
    .slice(0, limit);
}

function formatPercent(value?: number): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }

  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function stateLabel(state: string): string {
  return state.replace(/_/g, " ");
}

function proofLabel(job: AuditJob): string {
  return job.report?.evidence?.proofLevel?.replace(/_/g, " ") ?? "n/a";
}

function commandText(message: Memory): string {
  return asText((message.content as any)?.text);
}

function recommendationLines(job: AuditJob, limit = 3): string[] {
  return (job.report?.recommendations ?? [])
    .slice(0, limit)
    .map((item, index) => `${index + 1}. ${truncate(item, 140)}`);
}

function fromScoutData(
  scoutData?: Record<string, unknown> | null
): { roomId?: string; channelId?: string } | null {
  if (!scoutData) return null;

  const roomId = asText((scoutData as any).telegramRoomId);
  const channelId =
    asText((scoutData as any).telegramChannelId) ||
    asText(process.env.TELEGRAM_ALERT_CHAT_ID);

  if (!roomId && !channelId) {
    return null;
  }

  return {
    roomId: roomId || undefined,
    channelId: channelId || undefined,
  };
}

function resolveTelegramChatId(
  scoutData?: Record<string, unknown> | null
): string {
  const target = fromScoutData(scoutData);
  return target?.channelId || target?.roomId || "";
}

export async function attachTelegramContext(
  runtime: IAgentRuntime,
  message: Memory,
  scoutData?: Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const merged = { ...(scoutData ?? {}) };
  if ((message.content as any)?.source !== "telegram") {
    return merged;
  }

  const roomId = asText((message as any).roomId);
  if (!roomId) {
    return merged;
  }

  merged.telegramRoomId = roomId;

  try {
    const room = await runtime.getRoom(roomId as any);
    if (room?.channelId) {
      merged.telegramChannelId = String(room.channelId);
    }
  } catch (error) {
    logger.warn(
      `[TelegramOps] Failed to resolve Telegram room metadata for ${roomId}: ${error}`
    );
  }

  return merged;
}

export async function sendTelegramAlert(
  runtime: IAgentRuntime,
  scoutData: Record<string, unknown> | null | undefined,
  text: string
): Promise<boolean> {
  const readiness = getIntegrationReadiness("telegram");
  if (!readiness.available) {
    return false;
  }

  const target = fromScoutData(scoutData);
  if (!target) {
    return false;
  }

  const directChatId = resolveTelegramChatId(scoutData);
  const botToken = asText(process.env.TELEGRAM_BOT_TOKEN);
  if (botToken && directChatId) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: directChatId,
          text,
        }),
      });

      if (response.ok) {
        logger.info(`[TelegramOps] Direct Telegram alert sent (chatId=${directChatId})`);
        return true;
      }

      const errorText = await response.text();
      logger.warn(
        `[TelegramOps] Direct Telegram send failed (chatId=${directChatId}, status=${response.status}): ${errorText}`
      );
    } catch (error) {
      logger.warn(`[TelegramOps] Direct Telegram send failed: ${error}`);
    }
  }

  const targetInfo: TargetInfo = {
    source: "telegram",
    roomId: target.roomId as any,
    channelId: target.channelId,
  };

  try {
    await ensureTelegramSendHandler(runtime);
    await runtime.sendMessageToTarget(targetInfo, { text });
    return true;
  } catch (error) {
    logger.warn(`[TelegramOps] Failed to send Telegram alert: ${error}`);
    return false;
  }
}

async function ensureTelegramSendHandler(runtime: IAgentRuntime): Promise<void> {
  const runtimeAny = runtime as any;
  const sendHandlers = runtimeAny?.sendHandlers;
  if (sendHandlers instanceof Map && sendHandlers.has("telegram")) {
    return;
  }

  const telegramService = await runtime.getService("telegram" as any);
  if (!telegramService) {
    logger.warn("[TelegramOps] Telegram service is not available on this runtime.");
    return;
  }

  const sendFn = (telegramService as any).handleSendMessage;
  if (typeof sendFn !== "function") {
    logger.warn("[TelegramOps] Telegram service does not expose a send handler.");
    return;
  }

  runtime.registerSendHandler("telegram", sendFn.bind(telegramService));
  logger.info("[TelegramOps] Registered Telegram send handler on demand.");
}

export function formatScoutDiscoveryAlert(
  discovery: ScoutDiscoveryAlertPayload,
  isNew: boolean
): string {
  const categoryLabel = truncate(discovery.categoryLabel, 120);
  const rewardSummary = textList(discovery.rewardSummary, 2).join(" | ");
  const scopeSummary = textList(discovery.scopeSummary, 2).join(" | ");
  const rewardLabel =
    rewardSummary || truncate(discovery.maxBountyText, 120);
  const repoList = Array.isArray(discovery.githubRepositories)
    ? (discovery.githubRepositories as string[])
    : [];
  const assetCount = Number(discovery.assetCount ?? 0);
  const impactCount = Number(discovery.impactCount ?? 0);
  const resourceCount = Number(discovery.resourceCount ?? 0);
  const queueableChildCount = Number(discovery.queueableChildCount ?? 0);
  const commandRef = asText(discovery.commandRef || discovery.projectKey);

  return [
    isNew ? "SCOUT ALERT: new project discovered" : "SCOUT ALERT: project scope refreshed",
    `Project: ${discovery.projectName}`,
    categoryLabel ? `Category: ${categoryLabel}` : "",
    assetCount > 0 || impactCount > 0 || repoList.length > 0 || resourceCount > 0
      ? `Project scope: ${assetCount} assets | ${impactCount} impacts | ${repoList.length} repos | ${resourceCount} resources`
      : "",
    queueableChildCount > 0
      ? `Queueable child targets: ${queueableChildCount}`
      : "",
    rewardLabel ? `Reward: ${rewardLabel}` : "",
    scopeSummary ? `Scope: ${truncate(scopeSummary, 160)}` : "",
    repoList.length > 0 ? `Repo: ${truncate(repoList[0], 120)}` : "",
    commandRef ? `Inspect scope: /scope ${commandRef}` : "",
    commandRef && queueableChildCount > 0 ? `Queue all: /queueall ${commandRef}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatApprovalRequestAlert(job: AuditJob): string {
  const scoutMode = asText((job.scoutData as any)?.scoutMode).toUpperCase();
  const heading =
    scoutMode === "CUSTOM"
      ? "CUSTOM TARGET QUEUED FOR APPROVAL"
      : "TARGET QUEUED FOR APPROVAL";

  const categoryLabel = truncate((job.scoutData as any)?.categoryLabel, 120);
  const repoList = Array.isArray((job.scoutData as any)?.githubRepositories)
    ? ((job.scoutData as any)?.githubRepositories as string[])
    : [];

  return [
    heading,
    `Target: ${job.target.displayName}`,
    `Job: ${job.jobId}`,
    categoryLabel ? `Category: ${categoryLabel}` : "",
    repoList.length > 0 ? `Repo: ${truncate(repoList[0], 120)}` : "",
    `Approve and run: /approve ${job.jobId}`,
    `Status: /status ${job.jobId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatAuditCompletionAlert(job: AuditJob): string {
  const headline =
    job.state === "published"
      ? "AUDIT COMPLETE: published"
      : job.state === "needs_human_review"
        ? "AUDIT COMPLETE: human review required"
        : job.state === "discarded"
          ? "AUDIT COMPLETE: discarded by reviewer"
          : job.state === "failed"
            ? "AUDIT COMPLETE: failed"
            : `AUDIT COMPLETE: ${stateLabel(job.state)}`;

  return [
    headline,
    `Target: ${job.target.displayName}`,
    `Job: ${job.jobId}`,
    job.report?.title ? `Finding: ${truncate(job.report.title, 140)}` : "",
    job.report?.severity ? `Severity: ${job.report.severity}` : "",
    job.report ? `Proof: ${proofLabel(job)}` : "",
    job.verdict
      ? `Reviewer: ${stateLabel(job.verdict.verdict)} (${formatPercent(job.verdict.confidence)})`
      : "",
    job.error ? `Error: ${truncate(job.error, 180)}` : "",
    `Report: /report ${job.jobId}`,
    `Status: /status ${job.jobId}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatJobStatusMessage(job: AuditJob): string {
  const lastTransition = job.stateHistory[job.stateHistory.length - 1];

  return [
    "AUDIT STATUS",
    `Target: ${job.target.displayName}`,
    `Job: ${job.jobId}`,
    `State: ${stateLabel(job.state)}`,
    lastTransition
      ? `Latest transition: ${stateLabel(lastTransition.from)} -> ${stateLabel(lastTransition.to)}`
      : "",
    job.report?.severity ? `Severity: ${job.report.severity}` : "",
    job.report ? `Auditor confidence: ${formatPercent(job.report.confidence)}` : "",
    job.verdict
      ? `Reviewer: ${stateLabel(job.verdict.verdict)} (${formatPercent(job.verdict.confidence)})`
      : "",
    job.error ? `Error: ${truncate(job.error, 180)}` : "",
    job.state === "pending_approval" ? `Approve and run: /approve ${job.jobId}` : "",
    job.report ? `Report: /report ${job.jobId}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatJobReportMessage(job: AuditJob): string {
  if (!job.report) {
    return formatJobStatusMessage(job);
  }

  const lines = [
    "AUDIT REPORT",
    `Target: ${job.target.displayName}`,
    `Job: ${job.jobId}`,
    `State: ${stateLabel(job.state)}`,
    `Title: ${truncate(job.report.title, 140)}`,
    `Severity: ${job.report.severity}`,
    `Auditor confidence: ${formatPercent(job.report.confidence)}`,
    `Proof: ${proofLabel(job)}`,
    job.verdict
      ? `Reviewer: ${stateLabel(job.verdict.verdict)} (${formatPercent(job.verdict.confidence)})`
      : "",
    `Summary: ${truncate(job.report.description, 340)}`,
    job.report.impact ? `Impact: ${truncate(job.report.impact, 220)}` : "",
  ];

  const recommendations = recommendationLines(job);
  if (recommendations.length > 0) {
    lines.push("Recommendations:");
    lines.push(...recommendations);
  }

  lines.push(`Status: /status ${job.jobId}`);
  return lines.filter(Boolean).join("\n");
}

export function formatFindingsDigest(
  published: AuditJob[],
  needsHumanReview: AuditJob[]
): string {
  const lines = ["FINDINGS DIGEST"];

  if (published.length === 0 && needsHumanReview.length === 0) {
    lines.push("No reviewed findings are available yet.");
    return lines.join("\n");
  }

  if (published.length > 0) {
    lines.push("Published:");
    for (const job of published.slice(0, 5)) {
      lines.push(
        `- ${job.jobId} | ${job.report?.severity ?? "unknown"} | ${truncate(job.report?.title ?? job.target.displayName, 80)} | /report ${job.jobId}`
      );
    }
  }

  if (needsHumanReview.length > 0) {
    lines.push("Needs human review:");
    for (const job of needsHumanReview.slice(0, 5)) {
      lines.push(
        `- ${job.jobId} | ${job.report?.severity ?? "unknown"} | ${truncate(job.report?.title ?? job.target.displayName, 80)} | /status ${job.jobId}`
      );
    }
  }

  return lines.join("\n");
}

export function parseCommandArgument(message: Memory, command: string): string {
  const text = commandText(message);
  return text.replace(new RegExp(`^/${command}(?:@\\w+)?`, "i"), "").trim();
}

export function matchesCommand(message: Memory, command: string): boolean {
  return new RegExp(`^/${command}(?:@\\w+)?(?:\\s|$)`, "i").test(commandText(message));
}
