export type TargetType = "immunefi" | "github" | "local";

export type FindingSeverity = "low" | "medium" | "high" | "critical";

export type PocFramework = "foundry" | "hardhat" | "anchor" | "generic";

export type Target = {
  targetId: string;
  type: TargetType;
  displayName: string;
  url?: string;
  localPath?: string;
  metadata?: Record<string, unknown>;
};

export type EvidenceProofLevel =
  | "runnable_poc"
  | "guided_replay"
  | "code_path"
  | "context_only";

export type EvidenceTrace = {
  vulnerabilityClass: string;
  severityHint: FindingSeverity;
  file: string;
  line: number;
  finding: string;
  confirmationHint: string;
  snippet?: string;
};

export type EvidenceArtifact = {
  type: "static_analysis" | "poc";
  label: string;
  description: string;
  location?: string;
};

export type ReproductionGuide = {
  available: boolean;
  framework?: PocFramework;
  steps: string[];
  notes?: string;
};

export type EvidenceBundle = {
  proofLevel: EvidenceProofLevel;
  meetsSeverityBar: boolean;
  summary: string;
  traces: EvidenceTrace[];
  artifacts: EvidenceArtifact[];
  reproduction: ReproductionGuide;
};

export type AuditReport = {
  reportId: string;
  targetId: string;
  title: string;
  severity: FindingSeverity;
  confidence: number; // auditor confidence, 0..1
  description: string;
  impact: string;
  whyFlagged: string[];
  affectedSurface?: string[];
  recommendations?: string[];
  evidence: EvidenceBundle;
  poc?: {
    framework: PocFramework;
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
