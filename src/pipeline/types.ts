export type TargetType = "immunefi" | "github" | "local";

export type Target = {
  targetId: string;
  type: TargetType;
  displayName: string;
  url?: string;
  localPath?: string;
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
    framework: "foundry" | "hardhat" | "anchor" | "generic";
    text: string;
  };
};

export type ReviewerVerdict = {
  verdict: "publish" | "discard";
  rationale: string;
  confidence: number; // 0..1
};

// ---------------------------------------------------------------------------
// Target Ingestion
// ---------------------------------------------------------------------------

/**
 * Category classification for a target based on its source code.
 */
export type TargetCategory =
  | "solana_rust"
  | "solidity_evm"
  | "web_app"
  | "mixed"
  | "unknown";

/**
 * A single source file extracted from the target.
 */
export type SourceFile = {
  /** Relative path within the repo/folder */
  relativePath: string;
  /** File content (truncated if very large) */
  content: string;
  /** Size in bytes before truncation */
  originalSize: number;
  /** Whether the content was truncated */
  truncated: boolean;
  /** Language classification */
  language: "solidity" | "rust" | "typescript" | "javascript" | "python" | "move" | "other";
};

/**
 * Result of ingesting a target — the actual source code and metadata.
 */
export type IngestionResult = {
  /** Where the source was materialized on disk (for cleanup later) */
  localPath: string;
  /** Whether this was cloned (vs already local) */
  cloned: boolean;
  /** Primary category detected */
  category: TargetCategory;
  /** All detected categories (for mixed repos) */
  categories: TargetCategory[];
  /** Relevant source files extracted for auditing */
  sourceFiles: SourceFile[];
  /** Total number of source files found */
  totalFilesFound: number;
  /** Summary of the repo structure */
  structureSummary: string;
  /** Files that were identified but skipped (e.g. too large, binary) */
  skippedFiles: string[];
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
  ingestion?: IngestionResult;
  report?: AuditReport;
  verdict?: ReviewerVerdict;
  error?: string;
  scoutData?: Record<string, unknown> | null;
};
