import type { Plugin, Route } from "@elizaos/core";
import { MemoryType, logger } from "@elizaos/core";
import { runAudit, runReview, targetFromInput } from "../../pipeline/audit";
import { writeAudit, writeFinding, writeReview, writeTarget } from "../../pipeline/memory";

function json(res: any, status: number, body: any) {
  res.status(status);
  res.json(body);
}

function getRoomId(req: any): string {
  // UI will pass an explicit roomId; otherwise fall back to a stable default.
  return String(req.body?.roomId ?? req.query?.roomId ?? "00000000-0000-0000-0000-000000000000");
}

function getUserId(req: any): string | undefined {
  const v = req.body?.userId ?? req.query?.userId;
  return v ? String(v) : undefined;
}

async function findApproved(runtime: any, roomId: string, targetId: string): Promise<boolean> {
  const approvals: any[] = (await runtime.searchMemories?.({
    query: "HITL_STAGE:APPROVED",
    type: MemoryType.DOCUMENT,
    roomId,
    limit: 100,
  })) as any[];
  return (approvals || []).some((m) => {
    const text = m?.content?.text ?? m?.content?.[0]?.text ?? m?.text ?? "";
    return String(text).includes(`TARGET_ID:${targetId}`);
  });
}

async function listByStage(runtime: any, roomId: string, stage: string, limit: number) {
  const memories: any[] = (await runtime.searchMemories?.({
    query: `stage:${stage}`,
    type: MemoryType.DOCUMENT,
    roomId,
    limit,
  })) as any[];

  // searchMemories is fuzzy; fall back to broad query if empty
  if (!memories || memories.length === 0) {
    return (await runtime.searchMemories?.({
      query: stage.toUpperCase(),
      type: MemoryType.DOCUMENT,
      roomId,
      limit,
    })) as any[];
  }
  return memories;
}

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

      await writeTarget(runtime, { roomId, userId, target, scoutData });

      // Create a HITL pending record immediately so the UI can show status.
      await runtime.createMemory({
        type: MemoryType.DOCUMENT,
        roomId: roomId as any,
        userId: userId as any,
        content: {
          text: `HITL_STAGE:PENDING TARGET_ID:${target.targetId}\nTarget: ${target.displayName}\nType: Pending Review. Reply with /approve to proceed.`,
          scoutData,
        },
        metadata: { stage: "hitl", status: "PENDING", targetId: target.targetId },
      } as any);

      return json(res, 200, { success: true, data: { target } });
    } catch (e) {
      logger.error(`[UIBridge] create target failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

const approveTargetRoute: Route = {
  name: "vigilance-approve-target",
  path: "/vigilance/approve",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const roomId = getRoomId(req);
      const userId = getUserId(req);
      const targetId = String(req.body?.targetId ?? "").trim();
      const targetDisplay = String(req.body?.targetDisplayName ?? targetId);
      if (!targetId) return json(res, 400, { success: false, error: "targetId is required" });

      await runtime.createMemory({
        type: MemoryType.DOCUMENT,
        roomId: roomId as any,
        userId: userId as any,
        content: { text: `HITL_STAGE:APPROVED TARGET_ID:${targetId}\nTarget: ${targetDisplay}\nApproved by UI.` },
        metadata: { stage: "hitl", status: "APPROVED", targetId },
      } as any);

      return json(res, 200, { success: true });
    } catch (e) {
      logger.error(`[UIBridge] approve failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

const runAuditRoute: Route = {
  name: "vigilance-run-audit",
  path: "/vigilance/audit",
  type: "POST",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const roomId = getRoomId(req);
      const userId = getUserId(req);
      const input = String(req.body?.target ?? "").trim();
      const targetId = String(req.body?.targetId ?? "").trim();
      const target = targetId ? targetFromInput(targetId) : input ? targetFromInput(input) : null;
      if (!target) return json(res, 400, { success: false, error: "target or targetId is required" });

      const approved = await findApproved(runtime, roomId, target.targetId);
      if (!approved) return json(res, 403, { success: false, error: "Target not approved (HITL)" });

      const report = await runAudit(runtime, { target });
      const verdict = await runReview(runtime, { target, report });

      await writeAudit(runtime, { roomId, userId, target, report });
      await writeReview(runtime, { roomId, userId, target, report, verdict });
      if (verdict.verdict === "publish") {
        await writeFinding(runtime, { roomId, userId, target, report, verdict });
      }

      return json(res, 200, { success: true, data: { target, report, verdict } });
    } catch (e) {
      logger.error(`[UIBridge] audit failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

const feedRoute: Route = {
  name: "vigilance-feed",
  path: "/vigilance/feed",
  type: "GET",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const roomId = String(req.query?.roomId ?? "00000000-0000-0000-0000-000000000000");
      const scouts = await listByStage(runtime, roomId, "scout", 30);
      const hitl = await listByStage(runtime, roomId, "hitl", 30);
      return json(res, 200, { success: true, data: { scouts, hitl } });
    } catch (e) {
      logger.error(`[UIBridge] feed failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

const findingsRoute: Route = {
  name: "vigilance-findings",
  path: "/vigilance/findings",
  type: "GET",
  public: true,
  handler: async (req: any, res: any, runtime: any) => {
    try {
      const roomId = String(req.query?.roomId ?? "00000000-0000-0000-0000-000000000000");
      const findings = await listByStage(runtime, roomId, "finding", 30);
      return json(res, 200, { success: true, data: { findings } });
    } catch (e) {
      logger.error(`[UIBridge] findings failed: ${e}`);
      return json(res, 500, { success: false, error: "internal error" });
    }
  },
};

export const uiBridgePlugin: Plugin = {
  name: "VigilanceUIBridge",
  description: "HTTP routes for UI-driven target assignment and results.",
  actions: [],
  evaluators: [],
  providers: [],
  routes: [createTargetRoute, approveTargetRoute, runAuditRoute, feedRoute, findingsRoute],
};

