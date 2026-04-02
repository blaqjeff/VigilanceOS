/**
 * Vigilance-OS — Plugin Registry
 *
 * This file re-exports all custom Trinity Pipeline plugins
 * so they can be referenced from character files.
 */

export { scoutPlugin } from "./plugins/plugin-scout/index.js";
export { hitlPlugin } from "./plugins/plugin-hitl/index.js";
export { auditorReviewerPlugin } from "./plugins/plugin-auditor-reviewer/index.js";
export { uiBridgePlugin } from "./plugins/plugin-ui-bridge/index.js";

// Pipeline modules
export * from "./pipeline/types.js";
export * from "./pipeline/jobStore.js";
