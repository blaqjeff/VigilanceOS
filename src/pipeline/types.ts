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
  | "executed_poc"
  | "validated_replay"
  | "guided_replay"
  | "template_only"
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
  type: "static_analysis" | "exploration" | "poc";
  label: string;
  description: string;
  location?: string;
};

export type FindingOrigin = "analyzer" | "exploration" | "analyzer+exploration";

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
  candidateFindings?: AuditFindingCandidate[];
};

export type AuditFindingCandidate = {
  candidateId: string;
  origin: FindingOrigin;
  title: string;
  severity: FindingSeverity;
  confidence: number;
  description: string;
  impact: string;
  whyFlagged: string[];
  originNotes?: string[];
  neighborhoodIds?: string[];
  affectedSurface?: string[];
  recommendations?: string[];
  evidence: EvidenceBundle;
  poc?: {
    framework: PocFramework;
    text: string;
  };
};

export type ReviewerVerdict = {
  verdict: "publish" | "needs_human_review" | "discard";
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
 * Repo-wide symbol extracted during indexing.
 */
export type RepoSymbolKind =
  | "contract"
  | "library"
  | "interface"
  | "modifier"
  | "function"
  | "program"
  | "instruction"
  | "account_struct"
  | "state_struct";

export type RepoSymbol = {
  kind: RepoSymbolKind;
  name: string;
  file: string;
  line: number;
  signature?: string;
  tags?: string[];
};

export type RepoHotspotKind =
  | "entrypoint"
  | "auth"
  | "oracle"
  | "external_call"
  | "value_flow"
  | "upgradeability"
  | "cpi"
  | "pda"
  | "account_validation";

export type RepoHotspot = {
  kind: RepoHotspotKind;
  file: string;
  line: number;
  reason: string;
  priority: number;
  relatedSymbol?: string;
};

export type RepoImportEdge = {
  from: string;
  target: string;
};

export type RepoIndex = {
  indexedFiles: number;
  skippedIndexedFiles: string[];
  topDirectories: string[];
  extensionCounts: Record<string, number>;
  entryFiles: string[];
  configFiles: string[];
  testFiles: string[];
  symbolCounts: Record<string, number>;
  symbols: RepoSymbol[];
  imports: RepoImportEdge[];
  hotspots: RepoHotspot[];
  summary: string;
};

export type RepoNeighborhood = {
  id: string;
  label: string;
  root: string;
  reason: string;
  seedFiles: string[];
  files: string[];
  hotspots: RepoHotspot[];
  summary: string;
};

export type MaterializationAttempt = {
  strategy: string;
  ok: boolean;
  timeoutMs?: number;
  durationMs?: number;
  exitCode?: number | null;
  stdoutTail?: string;
  stderrTail?: string;
  error?: string;
};

export type MaterializationInfo = {
  source: "github_clone" | "local_path";
  localPath: string;
  cloneUrl?: string;
  reusedExisting?: boolean;
  attempts: MaterializationAttempt[];
};

/**
 * Result of ingesting a target — the actual source code and metadata.
 */
export type IngestionResult = {
  /** Where the source was materialized on disk (for cleanup later) */
  localPath: string;
  /** Whether this is a system-managed clone that can be cleaned up after auditing */
  cloned: boolean;
  /** How the target was materialized on disk */
  materialization: MaterializationInfo;
  /** Primary category detected */
  category: TargetCategory;
  /** All detected categories (for mixed repos) */
  categories: TargetCategory[];
  /** Repo-wide index used by later retrieval passes */
  repoIndex: RepoIndex;
  /** Focused audit neighborhoods derived from repo-wide awareness */
  neighborhoods: RepoNeighborhood[];
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
  | "needs_human_review"
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
