export type TargetType = "immunefi" | "github";

export type Target = {
  targetId: string;
  type: TargetType;
  displayName: string;
  url?: string;
  metadata?: Record<string, unknown>;
};

export type AuditReport = {
  reportId: string;
  targetId: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  affectedSurface?: string[];
  recommendations?: string[];
  poc?: {
    framework: "foundry" | "hardhat";
    text: string;
  };
};

export type ReviewerVerdict = {
  verdict: "publish" | "discard";
  rationale: string;
  confidence: number; // 0..1
};

// ---------------------------------------------------------------------------
// Audit Job Lifecycle
// ---------------------------------------------------------------------------

/**
 * Canonical lifecycle states for an audit job.
 *
 * submitted         – target has been registered, not yet approved
 * pending_approval  – HITL gate active, waiting for human approval
 * approved          – human approved, ready to start scanning
 * scanning          – audit engine is running
 * reviewing         – reviewer is evaluating the draft report
 * published         – finding passed review and is visible
 * discarded         – reviewer rejected the finding
 * failed            – unrecoverable error during scanning or reviewing
 */
export type AuditJobState =
  | "submitted"
  | "pending_approval"
  | "approved"
  | "scanning"
  | "reviewing"
  | "published"
  | "discarded"
  | "failed";

export type StateTransition = {
  from: AuditJobState;
  to: AuditJobState;
  at: string; // ISO timestamp
};

export type AuditJob = {
  jobId: string;
  state: AuditJobState;
  target: Target;
  createdAt: string;
  updatedAt: string;
  stateHistory: StateTransition[];

  // Populated during lifecycle
  report?: AuditReport;
  verdict?: ReviewerVerdict;
  error?: string;
  scoutData?: Record<string, unknown> | null;
};
