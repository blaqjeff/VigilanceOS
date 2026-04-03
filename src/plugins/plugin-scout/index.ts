import type {
  Action,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  Plugin,
  State,
} from "@elizaos/core";

import { attachTelegramContext } from "../../telegram/ops.js";
import {
  ensureScoutWatcher,
  refreshScoutWatcher,
  runAdHocScoutQuery,
} from "../../scout/watcher.js";

export const scoutAction: Action = {
  name: "SCOUT_IMMUNEFI",
  description: "Scans Immunefi for bug bounty programs based on specified categories or projects.",
  similes: ["SCAN_BOUNTIES", "CHECK_IMMUNEFI", "FIND_TARGETS"],
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
    _state?: State,
    _options?: HandlerOptions,
    callback?: HandlerCallback
  ): Promise<ActionResult> => {
    ensureScoutWatcher(runtime);

    const query = String((message.content as any)?.text ?? "").trim();
    const source = (message.content as any)?.source;
    const roomId = (message as any).roomId;
    const userId = (message as any).userId;
    const telegramContext = await attachTelegramContext(runtime, message, {});

    const result = query
      ? await runAdHocScoutQuery(runtime, query, {
          reason: "manual query",
          roomId,
          userId,
          telegramContext: {
            telegramRoomId: telegramContext.telegramRoomId as string | undefined,
            telegramChannelId: telegramContext.telegramChannelId as string | undefined,
          },
          notifyTelegram: source !== "telegram",
        })
      : await refreshScoutWatcher(runtime, {
          reason: "manual refresh",
          roomId,
          userId,
          telegramContext: {
            telegramRoomId: telegramContext.telegramRoomId as string | undefined,
            telegramChannelId: telegramContext.telegramChannelId as string | undefined,
          },
          notifyTelegram: source !== "telegram",
        });

    const text = result.success ? result.message : `SCOUT REPORT: ${result.message}`;
    if (callback) {
      await callback({ text, action: "SCOUT_COMPLETE" });
    }

    return {
      success: result.success,
      text,
      values: {
        blocked: result.blocked,
        newDiscoveries: result.newDiscoveries,
        refreshed: result.refreshed,
        snapshot: result.snapshot,
      },
    } as ActionResult;
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: { text: "Find me a new smart contract bounty on Immunefi." },
      },
      {
        name: "Scout",
        content: {
          text: "Scanning Immunefi for smart contract bounties...",
          action: "SCOUT_IMMUNEFI",
        },
      },
    ],
  ],
};

export const scoutPlugin: Plugin = {
  name: "ImmunefiScout",
  description:
    "Runs the scheduled Scout watcher and supports manual Immunefi discovery refreshes.",
  init: async (_config, runtime) => {
    ensureScoutWatcher(runtime);
  },
  actions: [scoutAction],
  evaluators: [],
  providers: [],
};
