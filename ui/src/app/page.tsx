'use client';

import React from "react";

// ---------------------------------------------------------------------------
// Types â€” mirrors backend AuditJob
// ---------------------------------------------------------------------------

type AuditJobState =
  | "submitted"
  | "pending_approval"
  | "approved"
  | "scanning"
  | "reviewing"
  | "published"
  | "needs_human_review"
  | "discarded"
  | "failed";

type Target = {
  targetId: string;
  type: string;
  displayName: string;
  url?: string;
};

type EvidenceProofLevel =
  | "executed_poc"
  | "validated_replay"
  | "guided_replay"
  | "template_only"
  | "code_path"
  | "context_only";

type EvidenceTrace = {
  vulnerabilityClass: string;
  severityHint: "low" | "medium" | "high" | "critical";
  file: string;
  line: number;
  finding: string;
  confirmationHint: string;
  snippet?: string;
};

type EvidenceArtifact = {
  type: "static_analysis" | "exploration" | "poc";
  label: string;
  description: string;
  location?: string;
};

type ReproductionGuide = {
  available: boolean;
  framework?: "foundry" | "hardhat" | "anchor" | "generic";
  steps: string[];
  notes?: string;
};

type EvidenceBundle = {
  proofLevel: EvidenceProofLevel;
  meetsSeverityBar: boolean;
  summary: string;
  traces: EvidenceTrace[];
  artifacts: EvidenceArtifact[];
  reproduction: ReproductionGuide;
};

type FindingOrigin = "analyzer" | "exploration" | "analyzer+exploration";

type AuditFindingCandidate = {
  candidateId: string;
  origin: FindingOrigin;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  description: string;
  impact?: string;
  whyFlagged: string[];
  originNotes?: string[];
  neighborhoodIds?: string[];
  affectedSurface?: string[];
  recommendations?: string[];
  evidence?: EvidenceBundle;
  poc?: { framework: string; text: string };
  review?: ReviewerVerdict;
};

type AuditReport = {
  reportId: string;
  targetId: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence?: number;
  description: string;
  impact?: string;
  whyFlagged?: string[];
  affectedSurface?: string[];
  recommendations?: string[];
  evidence?: EvidenceBundle;
  poc?: { framework: string; text: string };
  leadCandidateId?: string;
  candidateFindings?: AuditFindingCandidate[];
  findingCounts?: {
    total: number;
    published: number;
    needsHumanReview: number;
    discarded: number;
  };
};

type ReviewerVerdict = {
  verdict: "publish" | "needs_human_review" | "discard";
  rationale: string;
  confidence: number;
};

type StateTransition = {
  from: AuditJobState;
  to: AuditJobState;
  at: string;
};

type AuditJob = {
  jobId: string;
  state: AuditJobState;
  target: Target;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  stateHistory: StateTransition[];
  report?: AuditReport;
  verdict?: ReviewerVerdict;
  error?: string;
  scoutData?: Record<string, unknown> | null;
};

type JobStats = Record<AuditJobState, number>;

type ReadinessIntegration = {
  key: string;
  label: string;
  feature: string;
  state: string;
  available: boolean;
  summary: string;
  details: string[];
  action?: string;
  checkedAt: string;
};

type ReadinessSnapshot = {
  checkedAt: string;
  overallState: "ready" | "degraded";
  summary: string;
  integrations: Record<string, ReadinessIntegration>;
};

type ScoutWatcherStatus = "idle" | "scheduled" | "running" | "blocked" | "error";

type ScoutChildTarget = {
  childId: string;
  kind: "github_repo" | "web_asset" | "explorer_asset" | "resource";
  label: string;
  summary: string;
  sourceUrl?: string;
  tags: string[];
  queueable: boolean;
  auditTargetInput?: string;
  queuedJobId?: string;
  queuedJobState?: string;
};

type ScoutDiscovery = {
  projectKey: string;
  commandRef: string;
  state: "discovered" | "partially_queued" | "queued";
  projectId?: string;
  projectName: string;
  category: "blockchain_dlt" | "smart_contract" | "websites_apps";
  categoryLabel: string;
  categoryTags: string[];
  githubRepositories: string[];
  primaryRepository?: string;
  projectAssets: Array<{
    assetId: string;
    label: string;
    categoryLabel: string;
    url?: string;
    impactSummary: string[];
    tags: string[];
  }>;
  projectResources: Array<{
    label: string;
    url: string;
    sourceField?: string;
  }>;
  assetCount: number;
  impactCount: number;
  repositoryCount: number;
  resourceCount: number;
  childTargets: ScoutChildTarget[];
  queueableChildCount: number;
  queuedChildCount: number;
  rewardSummary: string[];
  scopeSummary: string[];
  maxBountyText?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAlertedAt?: string;
  lastEvent: "new" | "updated" | "seen";
  refreshCount: number;
};

type ScoutWatcherCategorySnapshot = {
  key: "blockchain_dlt" | "smart_contract" | "websites_apps";
  label: string;
  queries: string[];
  discoveredCount: number;
  assetCount: number;
  repositoryCount: number;
  resourceCount: number;
  newDiscoveries: number;
  lastRunMatches: number;
  lastRunAt?: string;
};

type ScoutWatcherSnapshot = {
  enabled: boolean;
  mode: "DEMO" | "LIVE";
  status: ScoutWatcherStatus;
  pollIntervalMs: number;
  startedAt?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  lastReason?: string;
  lastError?: string;
  totalRuns: number;
  totalTrackedTargets: number;
  totalNewDiscoveries: number;
  readiness: {
    available: boolean;
    state: string;
    summary: string;
    action?: string;
  };
  categories: ScoutWatcherCategorySnapshot[];
  recentDiscoveries: ScoutDiscovery[];
};

type IntakeMode = "github" | "local" | "immunefi";
type LocalIntakeMode = "path" | "upload";
type FindingRankMode = "severity_then_confidence" | "confidence" | "severity";
type UploadPhase = "idle" | "uploading" | "queueing";

type FindingFeedEntry = {
  key: string;
  job: AuditJob;
  candidate: AuditFindingCandidate;
  verdict: ReviewerVerdict;
  isLead: boolean;
};

const INTAKE_MODE_ORDER: IntakeMode[] = ["github", "local", "immunefi"];
const FINDING_RANK_OPTIONS: Array<{
  value: FindingRankMode;
  label: string;
}> = [
  { value: "severity_then_confidence", label: "Severity + confidence" },
  { value: "confidence", label: "Confidence" },
  { value: "severity", label: "Severity" },
];

const INTAKE_MODE_COPY: Record<
  IntakeMode,
  {
    label: string;
    placeholder: string;
    helper: string;
    detail: string;
  }
> = {
  github: {
    label: "GitHub Repo",
    placeholder: "github.com/org/repo or owner/repo",
    helper:
      "Best path for the hosted demo and public repos. The backend clones the repo directly.",
    detail:
      "Use this for the cleanest end-to-end operator flow during recording and on Nosana.",
  },
  local: {
    label: "Local Folder",
    placeholder: "C:\\VigilanceOS\\.demo-targets\\sealevel-attacks",
    helper:
      "Best demo path for controlled repos you already have on disk. The local backend reads the folder directly.",
    detail:
      "Use an absolute path only. This mode is for same-machine runs, not remote hosted uploads.",
  },
  immunefi: {
    label: "Immunefi Project",
    placeholder: "rootstocklabs",
    helper:
      "Queues an Immunefi project identifier directly when you want to test project-level intake without relying on Scout refresh timing.",
    detail:
      "Current Scout/Immunefi flow is still project-level. It does not yet explode every asset, repo, or document into separate queued targets.",
  },
};

const INTAKE_PRESETS: Array<{
  mode: IntakeMode;
  label: string;
  value: string;
}> = [
  {
    mode: "github",
    label: "EVM demo repo",
    value: "theredguild/damn-vulnerable-defi",
  },
  {
    mode: "local",
    label: "Solana demo folder",
    value: "C:\\VigilanceOS\\.demo-targets\\sealevel-attacks",
  },
  {
    mode: "local",
    label: "EVM local folder",
    value: "C:\\VigilanceOS\\.demo-targets\\damn-vulnerable-defi-shallow",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbsoluteLocalPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-zA-Z]:[/\\]/.test(value)
  );
}

function normalizeTargetInput(mode: IntakeMode, value: string): string {
  const trimmed = value.trim();
  if (mode !== "github") {
    return trimmed;
  }

  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith("github.com/")) {
    return trimmed;
  }

  if (trimmed.startsWith("https://github.com/")) {
    return trimmed.replace(/^https:\/\//, "");
  }

  if (trimmed.startsWith("http://github.com/")) {
    return trimmed.replace(/^http:\/\//, "");
  }

  return trimmed;
}

function validateTargetInput(mode: IntakeMode, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return "Enter a target before queueing it.";
  }

  if (mode === "local" && !isAbsoluteLocalPath(trimmed)) {
    return "Local folder mode requires an absolute path on this machine.";
  }

  if (
    mode === "github" &&
    !(
      /^[\w.-]+\/[\w.-]+$/.test(trimmed) ||
      trimmed.startsWith("github.com/") ||
      trimmed.startsWith("https://github.com/") ||
      trimmed.startsWith("http://github.com/")
    )
  ) {
    return "GitHub mode expects owner/repo or a github.com repo URL.";
  }

  return null;
}

function readinessTone(state?: string): string {
  switch (state) {
    case "ready":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "disabled":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
}

function stateTone(state: AuditJobState): string {
  switch (state) {
    case "submitted":
      return "border-slate-400/30 bg-slate-400/10 text-slate-300";
    case "pending_approval":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "approved":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "scanning":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
    case "reviewing":
      return "border-violet-400/30 bg-violet-400/10 text-violet-300";
    case "published":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "needs_human_review":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    case "discarded":
      return "border-slate-500/30 bg-slate-500/10 text-slate-400";
    case "failed":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-400";
  }
}

function stateLabel(state: AuditJobState): string {
  return state.replace(/_/g, " ");
}

function severityTone(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "high":
      return "border-orange-500/30 bg-orange-500/10 text-orange-300";
    case "medium":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-slate-400/30 bg-slate-400/10 text-slate-300";
  }
}

function proofTone(proofLevel: EvidenceProofLevel): string {
  switch (proofLevel) {
    case "executed_poc":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "validated_replay":
      return "border-teal-400/30 bg-teal-400/10 text-teal-300";
    case "guided_replay":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
    case "template_only":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    case "code_path":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.75) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (confidence >= 0.5) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  }
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

function proofLabel(proofLevel: EvidenceProofLevel): string {
  switch (proofLevel) {
    case "executed_poc":
      return "executed poc";
    case "validated_replay":
      return "validated replay";
    case "guided_replay":
      return "guided replay";
    case "template_only":
      return "template only";
    case "code_path":
      return "code path";
    default:
      return "context only";
  }
}

function originTone(origin: FindingOrigin): string {
  switch (origin) {
    case "analyzer":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "exploration":
      return "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300";
    default:
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
  }
}

function originLabel(origin: FindingOrigin): string {
  switch (origin) {
    case "analyzer":
      return "analyzer";
    case "exploration":
      return "exploration";
    default:
      return "analyzer + exploration";
  }
}

function verdictTone(verdict: ReviewerVerdict["verdict"]): string {
  switch (verdict) {
    case "publish":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "needs_human_review":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-red-500/30 bg-red-500/10 text-red-300";
  }
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
  } catch {
    return iso;
  }
}

function countArtifactEvidence(evidence?: EvidenceBundle): string | null {
  if (!evidence) return null;

  return `${evidence.traces.length} traces | ${evidence.artifacts.length} artifacts | ${evidence.reproduction.steps.length} replay steps`;
}

function candidateCount(report?: AuditReport): number {
  return report?.candidateFindings?.length ?? (report ? 1 : 0);
}

function leadCandidate(report?: AuditReport): AuditFindingCandidate | undefined {
  return (
    report?.candidateFindings?.find(
      (candidate) => candidate.candidateId === report.leadCandidateId
    ) ?? report?.candidateFindings?.[0]
  );
}

function fallbackLeadCandidate(report?: AuditReport): AuditFindingCandidate | undefined {
  if (!report) return undefined;
  if (report.candidateFindings?.length) return leadCandidate(report);

  return {
    candidateId: report.leadCandidateId ?? `${report.reportId}_lead`,
    origin: "analyzer",
    title: report.title,
    severity: report.severity,
    confidence: report.confidence ?? 0,
    description: report.description,
    impact: report.impact,
    whyFlagged: report.whyFlagged ?? [],
    affectedSurface: report.affectedSurface,
    recommendations: report.recommendations,
    evidence: report.evidence,
    poc: report.poc,
    review: undefined,
  };
}

function findingCounts(report?: AuditReport): AuditReport["findingCounts"] {
  if (report?.findingCounts) {
    return report.findingCounts;
  }

  const candidates = report?.candidateFindings ?? [];
  return {
    total: candidates.length,
    published: candidates.filter((candidate) => candidate.review?.verdict === "publish").length,
    needsHumanReview: candidates.filter(
      (candidate) => candidate.review?.verdict === "needs_human_review"
    ).length,
    discarded: candidates.filter((candidate) => candidate.review?.verdict === "discard").length,
  };
}

function candidateVerdict(
  job: AuditJob,
  candidate: AuditFindingCandidate
): ReviewerVerdict | undefined {
  if (candidate.review) {
    return candidate.review;
  }

  const lead = leadCandidate(job.report);
  if (lead && candidate.candidateId === lead.candidateId) {
    return job.verdict;
  }

  return undefined;
}

function findingEntries(job: AuditJob): FindingFeedEntry[] {
  const candidates =
    job.report?.candidateFindings?.length
      ? job.report.candidateFindings
      : fallbackLeadCandidate(job.report)
        ? [fallbackLeadCandidate(job.report)!]
        : [];
  const lead = leadCandidate(job.report) ?? fallbackLeadCandidate(job.report);

  return candidates
    .map((candidate) => {
      const verdict = candidateVerdict(job, candidate);
      if (!verdict) return null;

      return {
        key: `${job.jobId}:${candidate.candidateId}`,
        job,
        candidate,
        verdict,
        isLead: Boolean(lead && candidate.candidateId === lead.candidateId),
      } satisfies FindingFeedEntry;
    })
    .filter((entry): entry is FindingFeedEntry => Boolean(entry));
}

function severityValue(severity: AuditFindingCandidate["severity"]): number {
  switch (severity) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function sortFindingEntries(
  entries: FindingFeedEntry[],
  mode: FindingRankMode
): FindingFeedEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isLead !== right.isLead) {
      return left.isLead ? -1 : 1;
    }

    if (mode === "confidence") {
      const confidenceDelta = right.candidate.confidence - left.candidate.confidence;
      if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
      return severityValue(right.candidate.severity) - severityValue(left.candidate.severity);
    }

    if (mode === "severity") {
      const severityDelta =
        severityValue(right.candidate.severity) - severityValue(left.candidate.severity);
      if (severityDelta !== 0) return severityDelta;
      return right.candidate.confidence - left.candidate.confidence;
    }

    const severityDelta =
      severityValue(right.candidate.severity) - severityValue(left.candidate.severity);
    if (severityDelta !== 0) return severityDelta;
    const confidenceDelta = right.candidate.confidence - left.candidate.confidence;
    if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
    return right.verdict.confidence - left.verdict.confidence;
  });
}

function leadFindingLabel(entry: FindingFeedEntry): string | null {
  if (!entry.isLead) return null;
  if (severityValue(entry.candidate.severity) >= severityValue("high")) {
    return "most urgent";
  }
  if (entry.candidate.confidence >= 0.7) {
    return "highest confidence";
  }
  return "lead finding";
}

function clipSentence(value?: string, max = 180): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentence = normalized.match(/.+?[.!?](\s|$)/)?.[0]?.trim() ?? normalized;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}...` : sentence;
}

function outcomeDrivers(job: AuditJob): string[] {
  const drivers: string[] = [];
  const lead = leadCandidate(job.report);
  const counts = findingCounts(job.report);

  if (lead?.origin) {
    drivers.push(`Discovery source: ${originLabel(lead.origin)}.`);
  }

  if (job.report?.evidence) {
    if (job.report.evidence.meetsSeverityBar) {
      drivers.push(`Lead finding cleared the evidence bar with ${proofLabel(job.report.evidence.proofLevel)}.`);
    } else {
      drivers.push(
        `Lead finding is still below the evidence bar because proof is only ${proofLabel(job.report.evidence.proofLevel)}.`
      );
    }
  }

  if ((counts?.total ?? 0) > 0) {
    drivers.push(
      `${counts?.published ?? 0} published, ${counts?.needsHumanReview ?? 0} held for human review, ${counts?.discarded ?? 0} discarded.`
    );
  }

  if (job.verdict?.rationale) {
    const rationale = clipSentence(job.verdict.rationale, 220);
    if (job.state === "needs_human_review") {
      drivers.push(`Queued for analyst review: ${rationale}`);
    } else if (job.state === "discarded") {
      drivers.push(`Reviewer rejected it: ${rationale}`);
    } else if (job.state === "published") {
      drivers.push(`Reviewer allowed publication: ${rationale}`);
    }
  }

  return drivers.slice(0, 4);
}

function scoutStatusTone(status: ScoutWatcherStatus): string {
  switch (status) {
    case "scheduled":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "running":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
    case "blocked":
      return "border-red-500/30 bg-red-500/10 text-red-300";
    case "error":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function scoutEventTone(event: ScoutDiscovery["lastEvent"]): string {
  switch (event) {
    case "new":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "updated":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function scoutDiscoveryStateTone(state: ScoutDiscovery["state"]): string {
  switch (state) {
    case "queued":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "partially_queued":
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function scoutChildTone(kind: ScoutChildTarget["kind"]): string {
  switch (kind) {
    case "github_repo":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-200";
    case "web_asset":
      return "border-blue-400/30 bg-blue-400/10 text-blue-200";
    case "explorer_asset":
      return "border-violet-400/30 bg-violet-400/10 text-violet-200";
    default:
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
  }
}

function scoutChildKindLabel(kind: ScoutChildTarget["kind"]): string {
  switch (kind) {
    case "github_repo":
      return "repo";
    case "web_asset":
      return "web asset";
    case "explorer_asset":
      return "explorer asset";
    default:
      return "resource";
  }
}

function formatPollInterval(ms: number): string {
  if (ms < 60_000) {
    return `${Math.max(1, Math.round(ms / 1000))} sec`;
  }

  const minutes = Math.round(ms / 60_000);
  return `${minutes} min`;
}

function summaryLine(items: string[] | undefined, fallback: string): string {
  if (!items || items.length === 0) {
    return fallback;
  }

  return items.slice(0, 2).join(" | ");
}

function operatorStateCopy(state: AuditJobState): string {
  switch (state) {
    case "pending_approval":
      return "Approval is required before the deeper audit can begin.";
    case "approved":
      return "Approved and waiting for the operator to launch the audit.";
    case "scanning":
      return "The auditor is tracing code paths and assembling evidence.";
    case "reviewing":
      return "The reviewer is pressure-testing the finding before publication.";
    case "published":
      return "The finding cleared review and is ready for operator action.";
    case "needs_human_review":
      return "The finding is grounded, but an analyst should make the final call.";
    case "discarded":
      return "The reviewer rejected this finding as too weak or unsupported.";
    case "failed":
      return "The job failed before it could complete the review path.";
    default:
      return "The target has entered the queue and is being prepared.";
  }
}

// ---------------------------------------------------------------------------
// Lifecycle step indicator
// ---------------------------------------------------------------------------

const LIFECYCLE_STEPS: AuditJobState[] = [
  "submitted",
  "pending_approval",
  "approved",
  "scanning",
  "reviewing",
  "published",
];

const STEP_LABELS: Record<string, string> = {
  submitted: "Submitted",
  pending_approval: "Approval",
  approved: "Approved",
  scanning: "Scanning",
  reviewing: "Review",
  published: "Published",
};

function LifecycleBar({ job }: { job: AuditJob }) {
  const isTerminal = ["published", "needs_human_review", "discarded", "failed"].includes(job.state);
  const currentIdx = LIFECYCLE_STEPS.indexOf(job.state);

  return (
    <div className="flex items-center gap-1 mt-3">
      {LIFECYCLE_STEPS.map((step, idx) => {
        const isPast = idx < currentIdx || (isTerminal && step !== job.state);
        const isCurrent = step === job.state;
        const isFailed = job.state === "failed" && idx === currentIdx;
        const isDiscarded = job.state === "discarded";

        let dotClass =
          "h-2 w-2 rounded-full transition-all duration-300 ";
        if (isCurrent && !isDiscarded) {
          dotClass += "bg-cyan-400 ring-2 ring-cyan-400/30 scale-125";
        } else if (isFailed) {
          dotClass += "bg-red-400 ring-2 ring-red-400/30";
        } else if (isPast) {
          dotClass += "bg-emerald-400/60";
        } else {
          dotClass += "bg-slate-700";
        }

        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center gap-1 min-w-[3rem]">
              <div className={dotClass} />
              <span className={`text-[9px] uppercase tracking-wider ${
                isCurrent ? "text-cyan-300 font-semibold" : "text-slate-600"
              }`}>
                {STEP_LABELS[step] ?? step}
              </span>
            </div>
            {idx < LIFECYCLE_STEPS.length - 1 && (
              <div className={`flex-1 h-px min-w-2 ${
                isPast ? "bg-emerald-400/40" : "bg-slate-800"
              }`} />
            )}
          </React.Fragment>
        );
      })}

      {/* Terminal states */}
      {job.state === "discarded" && (
        <>
          <div className="flex-1 h-px min-w-2 bg-slate-700" />
          <div className="flex flex-col items-center gap-1 min-w-[3rem]">
            <div className="h-2 w-2 rounded-full bg-slate-500 ring-2 ring-slate-500/30 scale-125" />
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
              Discarded
            </span>
          </div>
        </>
      )}
      {job.state === "needs_human_review" && (
        <>
          <div className="flex-1 h-px min-w-2 bg-amber-500/30" />
          <div className="flex flex-col items-center gap-1 min-w-[3rem]">
            <div className="h-2 w-2 rounded-full bg-amber-400 ring-2 ring-amber-400/30 scale-125" />
            <span className="text-[9px] uppercase tracking-wider text-amber-300 font-semibold">
              Human Review
            </span>
          </div>
        </>
      )}
      {job.state === "failed" && (
        <>
          <div className="flex-1 h-px min-w-2 bg-red-500/30" />
          <div className="flex flex-col items-center gap-1 min-w-[3rem]">
            <div className="h-2 w-2 rounded-full bg-red-500 ring-2 ring-red-500/30 scale-125" />
            <span className="text-[9px] uppercase tracking-wider text-red-400 font-semibold">
              Failed
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function CandidateFindingCard({
  candidate,
  lead = false,
  review,
  leadLabel,
  busy = false,
  onResolve,
}: {
  candidate: AuditFindingCandidate;
  lead?: boolean;
  review?: ReviewerVerdict;
  leadLabel?: string | null;
  busy?: boolean;
  onResolve?: (action: "publish" | "discard") => void;
}) {
  const evidence = candidate.evidence;
  const counts = countArtifactEvidence(evidence);

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {lead && (
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
              {leadLabel ?? "lead finding"}
            </span>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${severityTone(candidate.severity)}`}>
            {candidate.severity}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${originTone(candidate.origin)}`}>
            {originLabel(candidate.origin)}
          </span>
          {evidence && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${proofTone(evidence.proofLevel)}`}>
              {proofLabel(evidence.proofLevel)}
            </span>
          )}
          {evidence && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${
                evidence.meetsSeverityBar
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}
            >
              {evidence.meetsSeverityBar ? "bar cleared" : "bar not cleared"}
            </span>
          )}
          {review && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${verdictTone(review.verdict)}`}>
              {review.verdict.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${confidenceTone(candidate.confidence)}`}>
            auditor {formatPercent(candidate.confidence)}
          </span>
          {review && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${confidenceTone(review.confidence)}`}>
              reviewer {formatPercent(review.confidence)}
            </span>
          )}
        </div>
      </div>

      <h4 className="mt-3 text-sm font-semibold text-slate-100">{candidate.title}</h4>
      <p className="mt-2 text-sm leading-6 text-slate-400">{candidate.description}</p>

      {counts && (
        <p className="mt-3 text-[10px] uppercase tracking-[0.2em] text-slate-500">{counts}</p>
      )}

      {candidate.originNotes && candidate.originNotes.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Origin Notes</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-400">
            {candidate.originNotes.slice(0, 2).map((note, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-fuchsia-400/50" />
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidate.whyFlagged.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Why This Candidate Survived</p>
          <ul className="mt-2 space-y-1 text-sm text-slate-400">
            {candidate.whyFlagged.slice(0, 3).map((reason, index) => (
              <li key={index} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400/50" />
                {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

        {review?.rationale && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Reviewer Outcome</p>
            <p className="mt-2 text-sm leading-6 text-slate-300">{review.rationale}</p>
          </div>
        )}

        {review?.verdict === "needs_human_review" && onResolve && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("publish")}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Publish
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResolve("discard")}
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-red-200 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        )}

        {(candidate.neighborhoodIds?.length || candidate.affectedSurface?.length) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {(candidate.neighborhoodIds ?? []).slice(0, 4).map((id) => (
            <span
              key={id}
              className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/10 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-fuchsia-200"
            >
              {id}
            </span>
          ))}
          {(candidate.affectedSurface ?? []).slice(0, 4).map((surface) => (
            <span
              key={surface}
              className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-300"
            >
              {surface}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

function FindingResultCard({
  entry,
  onOpen,
}: {
  entry: FindingFeedEntry;
  onOpen: (job: AuditJob) => void;
}) {
  const { job, candidate, verdict, isLead } = entry;
  const leadLabel = leadFindingLabel(entry);
  const evidenceSummary = countArtifactEvidence(candidate.evidence);

  return (
    <article
      className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30 cursor-pointer transition hover:border-cyan-400/20"
      onClick={() => onOpen(job)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isLead && leadLabel && (
            <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300">
              {leadLabel}
            </span>
          )}
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${severityTone(candidate.severity)}`}>
            {candidate.severity}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${verdictTone(verdict.verdict)}`}>
            {verdict.verdict.replace(/_/g, " ")}
          </span>
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${originTone(candidate.origin)}`}>
            {originLabel(candidate.origin)}
          </span>
          {candidate.evidence && (
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${proofTone(candidate.evidence.proofLevel)}`}>
              {proofLabel(candidate.evidence.proofLevel)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${confidenceTone(candidate.confidence)}`}>
            auditor {formatPercent(candidate.confidence)}
          </span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${confidenceTone(verdict.confidence)}`}>
            reviewer {formatPercent(verdict.confidence)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white">{candidate.title}</h3>
        <span className="text-xs text-slate-500">{job.target.displayName}</span>
      </div>

      {candidate.evidence && (
        <p className="mt-3 text-xs uppercase tracking-[0.2em] text-cyan-300">
          {candidate.evidence.summary}
        </p>
      )}
      {evidenceSummary && (
        <p className="mt-3 text-xs uppercase tracking-[0.2em] text-slate-500">
          {evidenceSummary}
        </p>
      )}
      <p className="mt-3 text-sm leading-6 text-slate-400 line-clamp-3">
        {candidate.description}
      </p>
      <p className="mt-3 text-xs leading-5 text-slate-500 line-clamp-3">
        {clipSentence(verdict.rationale, 220)}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Job detail modal
// ---------------------------------------------------------------------------

function JobDetailPanel({
  job,
  busy = false,
  onClose,
  onResolveFinding,
  onArchive,
}: {
  job: AuditJob;
  busy?: boolean;
  onClose: () => void;
  onResolveFinding?: (
    candidate: AuditFindingCandidate,
    action: "publish" | "discard"
  ) => void;
  onArchive?: () => void;
}) {
  const candidates =
    job.report?.candidateFindings?.length
      ? job.report.candidateFindings
      : fallbackLeadCandidate(job.report)
        ? [fallbackLeadCandidate(job.report)!]
        : [];
  const lead = leadCandidate(job.report) ?? fallbackLeadCandidate(job.report);
  const drivers = outcomeDrivers(job);
  const counts = findingCounts(job.report);
  const canArchive = ["published", "needs_human_review", "discarded", "failed"].includes(job.state);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-5xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-full border border-white/10 bg-slate-900 p-2 text-slate-400 hover:text-white transition"
        >
          ✕
        </button>

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
              Job {job.jobId}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              {job.target.displayName}
            </h2>
            {job.target.url && (
              <a
                href={job.target.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm text-cyan-400 hover:underline"
              >
                {job.target.url}
              </a>
            )}
          </div>
            <div className="flex flex-col items-end gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest ${stateTone(job.state)}`}>
                {stateLabel(job.state)}
              </span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              job.target.type === "github"
                ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
                : "border-violet-400/20 bg-violet-400/10 text-violet-200"
              }`}>
                {job.target.type}
              </span>
              {canArchive && onArchive && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={onArchive}
                  className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300 transition hover:border-cyan-400/30 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Archive
                </button>
              )}
            </div>
          </div>

        <LifecycleBar job={job} />

        {/* Error */}
        {job.error && (
          <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <strong>Error:</strong> {job.error}
          </div>
        )}

        {/* Report */}
        {job.report && (
          <div className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-semibold text-white">Lead Finding Summary</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${severityTone(job.report.severity)}`}>
                {job.report.severity}
              </span>
              {lead?.origin && (
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${originTone(lead.origin)}`}>
                  {originLabel(lead.origin)}
                </span>
              )}
              <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-slate-300">
                {candidateCount(job.report)} candidate{candidateCount(job.report) === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-slate-300">
                {counts?.published ?? 0} publish | {counts?.needsHumanReview ?? 0} review | {counts?.discarded ?? 0} discard
              </span>
              {typeof job.report.confidence === "number" && (
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${confidenceTone(job.report.confidence)}`}>
                  auditor {formatPercent(job.report.confidence)}
                </span>
              )}
              {job.report.evidence && (
                <>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${proofTone(job.report.evidence.proofLevel)}`}>
                    {proofLabel(job.report.evidence.proofLevel)}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${
                    job.report.evidence.meetsSeverityBar
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-red-500/30 bg-red-500/10 text-red-300"
                  }`}>
                    {job.report.evidence.meetsSeverityBar ? "meets evidence bar" : "below evidence bar"}
                  </span>
                </>
              )}
            </div>
            <h4 className="text-base font-medium text-slate-200">{job.report.title}</h4>
            <p className="text-sm leading-6 text-slate-400">{job.report.description}</p>

            {job.report.impact && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-500">Impact</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">{job.report.impact}</p>
              </div>
            )}

            {job.report.whyFlagged && job.report.whyFlagged.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Why Flagged</p>
                <ul className="space-y-2 text-sm text-slate-400">
                  {job.report.whyFlagged.map((reason, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400/50" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {drivers.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-widest text-slate-500">Outcome Drivers</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-300">
                  {drivers.map((driver, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400/50" />
                      {driver}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {job.report.evidence && (
              <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-widest text-slate-500">Evidence Summary</p>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${proofTone(job.report.evidence.proofLevel)}`}>
                    {proofLabel(job.report.evidence.proofLevel)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-300">{job.report.evidence.summary}</p>
              </div>
            )}

            {candidates.length > 0 && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-500">Candidate Findings</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Ranked candidates preserved by the auditor before the reviewer decided the final job outcome.
                    </p>
                  </div>
                  <span className="rounded-full border border-white/10 bg-slate-900 px-2.5 py-1 text-xs font-semibold uppercase tracking-widest text-slate-300">
                    {candidates.length} total
                  </span>
                </div>
                {candidates.some(
                  (candidate) => (candidate.review ?? job.verdict)?.verdict === "needs_human_review"
                ) && (
                  <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                    Analyst resolution is now per finding. Promote or discard only the findings that still need human review, and the aggregate job outcome will recompute automatically.
                  </div>
                )}
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  {candidates.map((candidate, index) => (
                    <CandidateFindingCard
                      key={candidate.candidateId ?? `${candidate.title}-${index}`}
                      candidate={candidate}
                      lead={candidate.candidateId === job.report?.leadCandidateId || (!job.report?.leadCandidateId && index === 0)}
                      leadLabel={
                        (candidate.candidateId === job.report?.leadCandidateId || (!job.report?.leadCandidateId && index === 0))
                          ? leadFindingLabel({
                              key: `${job.jobId}:${candidate.candidateId}`,
                              job,
                              candidate,
                              verdict: candidate.review ?? job.verdict ?? { verdict: "needs_human_review", rationale: "", confidence: 0.5 },
                              isLead: true,
                            })
                          : null
                      }
                      review={candidate.review ?? (candidate.candidateId === job.report?.leadCandidateId ? job.verdict : undefined)}
                      busy={busy}
                      onResolve={
                        onResolveFinding &&
                        (candidate.review ?? job.verdict)?.verdict === "needs_human_review"
                          ? (action) => onResolveFinding(candidate, action)
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {job.report.evidence && job.report.evidence.traces.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Grounded Traces</p>
                <div className="space-y-3">
                  {job.report.evidence.traces.map((trace, i) => (
                    <div key={`${trace.file}-${trace.line}-${i}`} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${severityTone(trace.severityHint)}`}>
                          {trace.severityHint}
                        </span>
                        <span className="rounded-full border border-white/10 bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">
                          {trace.vulnerabilityClass.replace(/_/g, " ")}
                        </span>
                        <span className="text-xs text-slate-500">{trace.file}:{trace.line}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{trace.finding}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{trace.confirmationHint}</p>
                      {trace.snippet && (
                        <pre className="mt-3 overflow-x-auto rounded-xl border border-white/5 bg-slate-950 p-3 text-xs leading-5 text-slate-300 font-mono whitespace-pre-wrap">
                          {trace.snippet}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {job.report.evidence && job.report.evidence.reproduction.steps.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Reproduction Guidance</p>
                <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                  {job.report.evidence.reproduction.framework && (
                    <p className="text-xs uppercase tracking-widest text-cyan-300">
                      {job.report.evidence.reproduction.framework}
                    </p>
                  )}
                  <ul className="mt-2 space-y-2 text-sm text-slate-400">
                    {job.report.evidence.reproduction.steps.map((step, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-0.5 text-cyan-400">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                  {job.report.evidence.reproduction.notes && (
                    <p className="mt-3 text-xs leading-5 text-slate-500">
                      {job.report.evidence.reproduction.notes}
                    </p>
                  )}
                </div>
              </div>
            )}

            {job.report.evidence && job.report.evidence.artifacts.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Artifacts</p>
                <div className="space-y-2">
                  {job.report.evidence.artifacts.map((artifact, i) => (
                    <div key={`${artifact.type}-${i}`} className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-widest text-slate-300">
                          {artifact.type.replace(/_/g, " ")}
                        </span>
                        <span className="text-sm font-medium text-slate-200">{artifact.label}</span>
                        {artifact.location && (
                          <span className="text-xs text-slate-500">{artifact.location}</span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-400">{artifact.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {job.report.affectedSurface && job.report.affectedSurface.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Affected Surface</p>
                <div className="flex flex-wrap gap-2">
                  {job.report.affectedSurface.map((s, i) => (
                    <span key={i} className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-300">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {job.report.recommendations && job.report.recommendations.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">Recommendations</p>
                <ul className="space-y-2 text-sm text-slate-400">
                  {job.report.recommendations.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-cyan-400/50" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {job.report.poc?.text && (
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">
                  PoC ({job.report.poc.framework})
                </p>
                <pre className="overflow-x-auto rounded-xl border border-white/5 bg-slate-900 p-4 text-xs leading-5 text-slate-300 font-mono">
                  {job.report.poc.text}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Verdict */}
        {job.verdict && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/80 p-5">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-lg font-semibold text-white">Aggregate Review Outcome</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${verdictTone(job.verdict.verdict)}`}>
                {job.verdict.verdict.replace(/_/g, " ")}
              </span>
              <span className="text-sm text-slate-400">
                {Math.round(job.verdict.confidence * 100)}% confidence
              </span>
            </div>
            <p className="text-sm leading-6 text-slate-400">{job.verdict.rationale}</p>

            {/* Confidence bar */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  job.verdict.verdict === "publish"
                    ? "bg-emerald-400"
                    : job.verdict.verdict === "needs_human_review"
                      ? "bg-amber-400"
                      : "bg-red-400"
                }`}
                style={{ width: `${Math.round(job.verdict.confidence * 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* State history */}
        {job.stateHistory.length > 0 && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-3">State History</p>
            <div className="space-y-2">
              {job.stateHistory.map((t, i) => (
                <div key={i} className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="font-mono text-slate-600">{formatTime(t.at)}</span>
                  <span className={`rounded px-1.5 py-0.5 ${stateTone(t.from)}`}>{stateLabel(t.from)}</span>
                  <span className="text-slate-700">→</span>
                  <span className={`rounded px-1.5 py-0.5 ${stateTone(t.to)}`}>{stateLabel(t.to)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 text-xs text-slate-600">
          Created: {formatDateTime(job.createdAt)} · Updated: {formatDateTime(job.updatedAt)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active job card (in pipeline)
// ---------------------------------------------------------------------------

function activeStateAnimation(state: AuditJobState): string {
  if (state === "scanning" || state === "reviewing") {
    return "animate-pulse";
  }
  return "";
}

function OperatorSummaryCard({
  title,
  count,
  tone,
  description,
  jobs,
  emptyLabel,
  onSelect,
}: {
  title: string;
  count: number;
  tone: string;
  description: string;
  jobs: AuditJob[];
  emptyLabel: string;
  onSelect: (job: AuditJob) => void;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Operations</p>
          <h3 className="mt-2 text-lg font-semibold text-white">{title}</h3>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${tone}`}>
          {count}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-300">{description}</p>
      {jobs.length > 0 ? (
        <div className="mt-4 space-y-2">
          {jobs.slice(0, 3).map((job) => (
            <button
              key={job.jobId}
              onClick={() => onSelect(job)}
              className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-left transition hover:border-cyan-400/20"
            >
              <span className="truncate text-sm text-slate-200">{job.target.displayName}</span>
              <span className={`ml-3 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${stateTone(job.state)}`}>
                {stateLabel(job.state)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-xs uppercase tracking-[0.2em] text-slate-600">{emptyLabel}</p>
      )}
    </article>
  );
}

function ScoutCategoryCard({
  category,
}: {
  category: ScoutWatcherCategorySnapshot;
}) {
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Scout Category</p>
          <h4 className="mt-2 text-sm font-semibold text-white">{category.label}</h4>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
          {category.discoveredCount} tracked
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
        <span>{category.lastRunMatches} seen last sweep</span>
        <span>{category.newDiscoveries} new total</span>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
          <p className="uppercase tracking-[0.18em] text-slate-500">Assets</p>
          <p className="mt-1 text-sm font-semibold text-white">{category.assetCount}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
          <p className="uppercase tracking-[0.18em] text-slate-500">Repos</p>
          <p className="mt-1 text-sm font-semibold text-white">{category.repositoryCount}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
          <p className="uppercase tracking-[0.18em] text-slate-500">Resources</p>
          <p className="mt-1 text-sm font-semibold text-white">{category.resourceCount}</p>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        Queries: {category.queries.join(" | ")}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const [target, setTarget] = React.useState("");
  const [targetMode, setTargetMode] = React.useState<IntakeMode>("github");
  const [localIntakeMode, setLocalIntakeMode] =
    React.useState<LocalIntakeMode>("path");
  const [uploadedFiles, setUploadedFiles] = React.useState<File[]>([]);
  const [uploadedFolderLabel, setUploadedFolderLabel] = React.useState("");
  const [uploadPhase, setUploadPhase] = React.useState<UploadPhase>("idle");
  const [busy, setBusy] = React.useState(false);
  const [scoutBusy, setScoutBusy] = React.useState(false);
  const [jobs, setJobs] = React.useState<AuditJob[]>([]);
  const [stats, setStats] = React.useState<JobStats | null>(null);
  const [readiness, setReadiness] = React.useState<ReadinessSnapshot | null>(null);
  const [scout, setScout] = React.useState<ScoutWatcherSnapshot | null>(null);
  const [expandedScoutProjects, setExpandedScoutProjects] = React.useState<Record<string, boolean>>({});
  const [selectedScoutChildren, setSelectedScoutChildren] = React.useState<Record<string, string[]>>({});
  const [scoutQueueBusyKey, setScoutQueueBusyKey] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [selectedJob, setSelectedJob] = React.useState<AuditJob | null>(null);
  const [findingRankMode, setFindingRankMode] =
    React.useState<FindingRankMode>("severity_then_confidence");
  const [lastRefreshedAt, setLastRefreshedAt] = React.useState<string | null>(null);
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  const roomId = "00000000-0000-0000-0000-000000000000";
  const intakeCopy = INTAKE_MODE_COPY[targetMode];

  const refresh = React.useCallback(async () => {
    try {
      const [jobsRes, readinessRes, scoutRes] = await Promise.all([
        fetch("/api/vigilance/jobs?limit=50"),
        fetch("/api/vigilance/readiness"),
        fetch("/api/vigilance/scout"),
      ]);

      const jobsJson = await jobsRes.json().catch(() => null);
      const readinessJson = await readinessRes.json().catch(() => null);
      const scoutJson = await scoutRes.json().catch(() => null);

      setJobs(jobsJson?.data?.jobs ?? []);
      setStats(jobsJson?.data?.stats ?? null);
      setReadiness(readinessJson?.data ?? null);
      setScout(scoutJson?.data ?? null);
      setLastRefreshedAt(new Date().toISOString());
    } catch {
      setActionError("Operator console could not refresh backend state.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

  React.useEffect(() => {
    if (!selectedJob) return;
    const refreshed = jobs.find((job) => job.jobId === selectedJob.jobId);
    if (refreshed) {
      setSelectedJob(refreshed);
    }
  }, [jobs, selectedJob]);

  // Also refresh selected job
  React.useEffect(() => {
    if (selectedJob) {
      const updated = jobs.find((j) => j.jobId === selectedJob.jobId);
      if (updated && updated.updatedAt !== selectedJob.updatedAt) {
        setSelectedJob(updated);
      }
    }
  }, [jobs, selectedJob]);

  // ---- Actions ----

  function handleFolderSelection(files: FileList | null) {
    const nextFiles = Array.from(files ?? []);
    setUploadedFiles(nextFiles);

    if (nextFiles.length === 0) {
      setUploadedFolderLabel("");
      return;
    }

    const firstRelativePath =
      ((nextFiles[0] as any).webkitRelativePath as string | undefined) ??
      nextFiles[0].name;
    const rootLabel =
      firstRelativePath.split(/[\\/]+/).filter(Boolean)[0] ?? nextFiles[0].name;
    setUploadedFolderLabel(rootLabel);
  }

  function resetUploadedFolder() {
    setUploadedFiles([]);
    setUploadedFolderLabel("");
    setUploadPhase("idle");
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  }

  async function submitTarget() {
    setBusy(true);
    setActionError(null);
    try {
      if (targetMode === "local" && localIntakeMode === "upload") {
        if (uploadedFiles.length === 0) {
          setActionError("Choose a folder to upload before queueing it.");
          return;
        }

        setUploadPhase("uploading");
        const form = new FormData();
        form.append("roomId", roomId);
        form.append("displayName", uploadedFolderLabel || "uploaded-folder");
        for (const file of uploadedFiles) {
          const relativePath =
            ((file as any).webkitRelativePath as string | undefined) ?? file.name;
          form.append("files", file);
          form.append("relativePaths", relativePath);
        }

        setUploadPhase("queueing");
        const uploadRes = await fetch("/api/vigilance/upload-folder", {
          method: "POST",
          body: form,
        });
        const uploadPayload = await uploadRes.json().catch(() => null);
        if (!uploadRes.ok) {
          setActionError(uploadPayload?.error ?? "Folder upload failed.");
        } else {
          resetUploadedFolder();
        }
        await refresh();
        return;
      }

      const validationError = validateTargetInput(targetMode, target);
      if (validationError) {
        setActionError(validationError);
        return;
      }

      const normalizedTarget = normalizeTargetInput(targetMode, target);
      const res = await fetch("/api/vigilance/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: normalizedTarget, roomId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Target submission failed.");
      } else {
        setTarget("");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approveJob(job: AuditJob) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/vigilance/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          targetId: job.target.targetId,
          roomId,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Approval failed.");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runAudit(job: AuditJob) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/vigilance/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          targetId: job.target.targetId,
          roomId,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(
          payload?.readiness?.summary ?? payload?.error ?? "Audit could not start."
        );
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approveAndRun(job: AuditJob) {
    setBusy(true);
    setActionError(null);
    try {
      // Step 1: Approve
      const approveRes = await fetch("/api/vigilance/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.jobId,
          targetId: job.target.targetId,
          roomId,
        }),
      });
      const approvePayload = await approveRes.json().catch(() => null);
      if (!approveRes.ok) {
        setActionError(approvePayload?.error ?? "Approval failed.");
        await refresh();
        return;
      }

      // Step 2: Run audit
      const resolvedJobId = approvePayload?.data?.job?.jobId ?? job.jobId;
      const auditRes = await fetch("/api/vigilance/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: resolvedJobId,
          targetId: job.target.targetId,
          roomId,
        }),
      });
      const auditPayload = await auditRes.json().catch(() => null);
      if (!auditRes.ok) {
        setActionError(
          auditPayload?.readiness?.summary ?? auditPayload?.error ?? "Audit could not start."
        );
      }
      await refresh();
    } finally {
      setUploadPhase("idle");
      setBusy(false);
    }
  }

  async function resolveFinding(
    job: AuditJob,
    candidate: AuditFindingCandidate,
    action: "publish" | "discard"
  ) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/vigilance/jobs/${job.jobId}/findings/${candidate.candidateId}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            roomId,
          }),
        }
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Finding resolution failed.");
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archiveJob(job: AuditJob) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/vigilance/jobs/${job.jobId}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.error ?? "Archive failed.");
      } else {
        setSelectedJob(null);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function refreshScoutNow() {
    setScoutBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/vigilance/scout/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.message ?? payload?.error ?? "Scout refresh failed.");
      }
      await refresh();
    } finally {
      setScoutBusy(false);
    }
  }

  function toggleScoutProject(projectKey: string) {
    setExpandedScoutProjects((current) => ({
      ...current,
      [projectKey]: !current[projectKey],
    }));
  }

  function toggleScoutChild(projectKey: string, childId: string) {
    setSelectedScoutChildren((current) => {
      const existing = current[projectKey] ?? [];
      const next = existing.includes(childId)
        ? existing.filter((value) => value !== childId)
        : [...existing, childId];

      return {
        ...current,
        [projectKey]: next,
      };
    });
  }

  function setScoutChildSelection(projectKey: string, childIds: string[]) {
    setSelectedScoutChildren((current) => ({
      ...current,
      [projectKey]: childIds,
    }));
  }

  async function queueScoutTargets(
    discovery: ScoutDiscovery,
    options: { childIds?: string[]; queueAll?: boolean }
  ) {
    setScoutQueueBusyKey(discovery.projectKey);
    setActionError(null);
    try {
      const res = await fetch("/api/vigilance/scout/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectRef: discovery.projectKey,
          childIds: options.childIds ?? [],
          queueAll: options.queueAll ?? false,
          roomId,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        setActionError(payload?.message ?? payload?.error ?? "Scout child queueing failed.");
      } else {
        const queuedJobs: AuditJob[] = [
          ...(payload?.data?.createdJobs ?? []),
          ...(payload?.data?.existingJobs ?? []),
        ];
        if (queuedJobs.length > 0) {
          setSelectedJob(queuedJobs[0]);
        }
        if (options.queueAll) {
          setScoutChildSelection(discovery.projectKey, []);
        } else if (options.childIds?.length) {
          setScoutChildSelection(
            discovery.projectKey,
            (selectedScoutChildren[discovery.projectKey] ?? []).filter(
              (childId) => !options.childIds?.includes(childId)
            )
          );
        }
      }
      await refresh();
    } finally {
      setScoutQueueBusyKey(null);
    }
  }

  // ---- Computed ----

  const readinessItems = readiness ? Object.values(readiness.integrations) : [];
  const modelReadiness = readiness?.integrations?.model;
  const headerReady = readiness?.overallState === "ready";
  const headerTone = headerReady
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";
  const scoutCategories = scout?.categories ?? [];
  const scoutDiscoveries = scout?.recentDiscoveries ?? [];
  const scoutHeaderTone = scoutStatusTone(scout?.status ?? "idle");

  // Group jobs
  const orderedJobs = [...jobs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  const pendingJobs = orderedJobs.filter((j) => j.state === "pending_approval");
  const approvedJobs = orderedJobs.filter((j) => j.state === "approved");
  const activeJobs = orderedJobs.filter((j) => j.state === "scanning" || j.state === "reviewing");
  const publishedJobs = orderedJobs.filter((j) => j.state === "published");
  const needsHumanReviewJobs = orderedJobs.filter((j) => j.state === "needs_human_review");
  const discardedJobs = orderedJobs.filter((j) => j.state === "discarded");
  const failedJobs = orderedJobs.filter((j) => j.state === "failed");
  const reviewedEntries = orderedJobs.flatMap((job) => findingEntries(job));
  const publishedFindings = sortFindingEntries(
    reviewedEntries.filter((entry) => entry.verdict.verdict === "publish"),
    findingRankMode
  );
  const needsHumanReviewFindings = sortFindingEntries(
    reviewedEntries.filter(
      (entry) => entry.verdict.verdict === "needs_human_review"
    ),
    findingRankMode
  );
  const discardedFindings = sortFindingEntries(
    reviewedEntries.filter((entry) => entry.verdict.verdict === "discard"),
    findingRankMode
  );

  const pipelineJobs = [...pendingJobs, ...approvedJobs, ...activeJobs];
  const recentTransitions = orderedJobs
    .flatMap((job) =>
      job.stateHistory.map((transition, index) => ({
        key: `${job.jobId}-${index}`,
        job,
        transition,
      }))
    )
    .sort(
      (a, b) =>
        new Date(b.transition.at).getTime() - new Date(a.transition.at).getTime()
    )
    .slice(0, 8);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_35%),linear-gradient(180deg,#020617_0%,#020617_45%,#111827_100%)] text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">

      {/* Selected job detail */}
      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          busy={busy}
          onClose={() => setSelectedJob(null)}
          onResolveFinding={(candidate, action) => void resolveFinding(selectedJob, candidate, action)}
          onArchive={() => void archiveJob(selectedJob)}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/85 backdrop-blur-md">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_32px_rgba(34,211,238,0.2)]">
              <div className="h-4 w-4 rounded-full bg-cyan-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-[0.25em] text-cyan-100">VIGILANCE</h1>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Operator Console</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Stats badges */}
            {stats && (
              <div className="hidden md:flex items-center gap-2">
                {stats.pending_approval > 0 && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    {stats.pending_approval} pending
                  </span>
                )}
                {(stats.scanning + stats.reviewing) > 0 && (
                  <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 animate-pulse">
                    {stats.scanning + stats.reviewing} active
                  </span>
                )}
                {stats.published > 0 && (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    {stats.published} published
                  </span>
                )}
                {stats.needs_human_review > 0 && (
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    {stats.needs_human_review} needs review
                  </span>
                )}
              </div>
            )}
            <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${headerTone}`}>
              {readiness ? readiness.overallState : "checking"}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">

        {/* Target intake */}
        <section className="relative overflow-hidden rounded-3xl border border-cyan-400/15 bg-slate-900/70 p-6 shadow-2xl shadow-cyan-950/20">
          <div className="absolute inset-y-0 right-0 w-72 bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.18),_transparent_65%)]" />
          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Golden Path Intake</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Submit → Approve → Audit → Review → Report
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Submit a target, approve it through the HITL gate, and let the auditor + reviewer pipeline produce a grounded report.
              </p>
              {needsHumanReviewJobs.length > 0 && (
                <p className="text-xs uppercase tracking-[0.3em] text-amber-300">
                  {needsHumanReviewJobs.length} awaiting analyst review
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                {INTAKE_MODE_ORDER.map((mode) => {
                  const active = mode === targetMode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setTargetMode(mode)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        active
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-white/10 bg-slate-950/40 text-slate-400 hover:border-cyan-400/20 hover:text-slate-200"
                      }`}
                    >
                      {INTAKE_MODE_COPY[mode].label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                {intakeCopy.helper}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {targetMode === "local" && localIntakeMode === "upload"
                  ? "Upload mode sends the folder contents to the server first, so it also works when the stack is hosted remotely."
                  : intakeCopy.detail}
              </p>
              {targetMode === "local" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {([
                    { value: "path", label: "Use local path" },
                    { value: "upload", label: "Upload folder" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLocalIntakeMode(option.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                        localIntakeMode === option.value
                          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                          : "border-white/10 bg-slate-950/40 text-slate-400 hover:border-cyan-400/20 hover:text-slate-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {INTAKE_PRESETS.filter(
                  (preset) => preset.mode === targetMode && !(targetMode === "local" && localIntakeMode === "upload")
                ).map((preset) => (
                  <button
                    key={`${preset.mode}-${preset.label}`}
                    type="button"
                    onClick={() => setTarget(preset.value)}
                    className="rounded-full border border-white/10 bg-slate-950/50 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-cyan-400/20 hover:text-white"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 lg:max-w-xl lg:flex-row">
              {targetMode === "local" && localIntakeMode === "upload" ? (
                <div className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white">
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    onChange={(e) => handleFolderSelection(e.target.files)}
                    className="hidden"
                    {...({ webkitdirectory: "", directory: "" } as any)}
                  />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                        Browser folder upload
                      </p>
                      <p className="mt-1 truncate text-sm text-slate-200">
                        {uploadedFiles.length > 0
                          ? `${uploadedFolderLabel || "folder"} · ${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"} selected`
                          : "Choose a repository folder from this machine"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:border-cyan-400/30 hover:text-cyan-200"
                      >
                        Choose folder
                      </button>
                      {uploadedFiles.length > 0 && (
                        <button
                          type="button"
                          onClick={resetUploadedFolder}
                          className="rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 transition hover:border-red-500/30 hover:text-red-200"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {uploadPhase !== "idle" && (
                    <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-3 w-3">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75"></span>
                          <span className="relative inline-flex h-3 w-3 rounded-full bg-cyan-500"></span>
                        </span>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-200">
                            {uploadPhase === "uploading" ? "Uploading folder" : "Queueing target"}
                          </p>
                          <p className="mt-1 text-xs text-slate-300">
                            {uploadPhase === "uploading"
                              ? `Sending ${uploadedFiles.length} file${uploadedFiles.length === 1 ? "" : "s"} to the server.`
                              : "Materializing the uploaded folder into a local audit target."}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                        <div className="h-full w-1/2 animate-pulse rounded-full bg-cyan-400" />
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <input
                  id="target-input"
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && target.trim()) void submitTarget();
                  }}
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50"
                  placeholder={intakeCopy.placeholder}
                />
              )}
              <button
                id="submit-target-btn"
                disabled={
                  busy ||
                  (targetMode === "local" && localIntakeMode === "upload"
                    ? uploadedFiles.length === 0
                    : !target.trim())
                }
                onClick={() => void submitTarget()}
                className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                {busy
                  ? targetMode === "local" && localIntakeMode === "upload"
                    ? uploadPhase === "uploading"
                      ? "Uploading..."
                      : "Queueing..."
                    : "Working..."
                  : targetMode === "local" && localIntakeMode === "upload"
                    ? "Upload + Queue"
                    : "Queue Target"}
              </button>
            </div>
          </div>
        </section>

        {/* Error banner */}
        {actionError && (
          <section className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100 flex items-center justify-between">
            <span>{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="ml-4 text-red-400 hover:text-white transition text-xs"
            >
              dismiss
            </button>
          </section>
        )}

        {/* Integration readiness */}
        <section className="grid gap-4 lg:grid-cols-3">
          {readinessItems.length > 0 ? (
            readinessItems.map((integration) => (
              <article
                key={integration.key}
                className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-500">{integration.feature}</p>
                    <h3 className="mt-2 text-lg font-semibold text-white">{integration.label}</h3>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${readinessTone(integration.state)}`}>
                    {integration.state}
                  </span>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-300">{integration.summary}</p>
                {integration.details?.length ? (
                  <div className="mt-4 space-y-2 text-xs text-slate-500">
                    {integration.details.map((detail, index) => (
                      <p key={`${integration.key}-${index}`}>{detail}</p>
                    ))}
                  </div>
                ) : null}
                {integration.action ? (
                  <p className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-400/5 px-3 py-2 text-xs text-cyan-100">
                    {integration.action}
                  </p>
                ) : null}
              </article>
            ))
          ) : (
            <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 text-sm text-slate-400 lg:col-span-3">
              Waiting for the backend readiness snapshot...
            </article>
          )}
        </section>

        {/* Operations overview */}
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-500">Operations Snapshot</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Queue Overview</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Auto-sync runs every 3 seconds, and this panel shows what needs action now:
                  approvals, audits ready to launch, active analysis, and uncertain findings awaiting an analyst.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Last Synced</p>
                  <p className="mt-1 text-sm text-slate-300">
                    {lastRefreshedAt ? formatDateTime(lastRefreshedAt) : "Waiting for backend sync"}
                  </p>
                </div>
                <button
                  onClick={() => void refresh()}
                  className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-slate-200 transition hover:border-cyan-400/30 hover:text-cyan-200"
                >
                  Sync State
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <OperatorSummaryCard
                title="Awaiting Approval"
                count={pendingJobs.length}
                tone="border-amber-500/30 bg-amber-500/10 text-amber-300"
                description="Targets paused at the human approval gate before deeper audit can begin."
                jobs={pendingJobs}
                emptyLabel="No targets need approval"
                onSelect={setSelectedJob}
              />
              <OperatorSummaryCard
                title="Approved To Run"
                count={approvedJobs.length}
                tone="border-blue-500/30 bg-blue-500/10 text-blue-300"
                description="Targets already approved and ready for the next audit run when the model is available."
                jobs={approvedJobs}
                emptyLabel="No approved targets are waiting"
                onSelect={setSelectedJob}
              />
              <OperatorSummaryCard
                title="Active Analysis"
                count={activeJobs.length}
                tone="border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                description="Jobs currently scanning or reviewing with live pipeline visibility."
                jobs={activeJobs}
                emptyLabel="No active audits right now"
                onSelect={setSelectedJob}
              />
              <OperatorSummaryCard
                title="Needs Human Review"
                count={needsHumanReviewJobs.length}
                tone="border-amber-500/30 bg-amber-500/10 text-amber-300"
                description="Grounded findings the reviewer preserved for analyst judgment instead of auto-publishing."
                jobs={needsHumanReviewJobs}
                emptyLabel="No findings are waiting on analyst review"
                onSelect={setSelectedJob}
              />
            </div>
          </div>

          <div className="space-y-4">
            <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Scout Watch</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">Scheduled Monitoring</h3>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] ${scoutHeaderTone}`}>
                  {scout?.status ?? "idle"}
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                Scout polls across Blockchain / DLT, Smart Contract, and Websites and Applications, then keeps project-level queue context warm with deduped targets, scoped assets, repo coverage, and linked resources.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Tracked</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{scout?.totalTrackedTargets ?? 0}</p>
                  <p className="mt-1 text-xs text-slate-500">{scout?.mode ?? "LIVE"} mode</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">Runs</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{scout?.totalRuns ?? 0}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Every {formatPollInterval(scout?.pollIntervalMs ?? 0)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                  <p className="text-[11px] uppercase tracking-[0.25em] text-slate-500">New Discoveries</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{scout?.totalNewDiscoveries ?? 0}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {scout?.lastRunAt ? `Last run ${formatTime(scout.lastRunAt)}` : "Awaiting first sweep"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="text-sm text-slate-400">
                  <p>
                    Last success: {scout?.lastSuccessAt ? formatDateTime(scout.lastSuccessAt) : "Not yet"}
                  </p>
                  <p className="mt-1">
                    Next run: {scout?.nextRunAt ? formatDateTime(scout.nextRunAt) : "Waiting"}
                  </p>
                </div>
                <button
                  onClick={() => void refreshScoutNow()}
                  disabled={scoutBusy}
                  className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scoutBusy ? "Refreshing..." : "Refresh Scout"}
                </button>
              </div>

              {scout?.readiness?.summary && (
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${
                  scout?.readiness?.available
                    ? "border-cyan-400/20 bg-cyan-400/5 text-cyan-100"
                    : "border-red-500/20 bg-red-500/10 text-red-100"
                }`}>
                  <p>{scout.readiness.summary}</p>
                  {scout.readiness.action ? (
                    <p className="mt-2 text-xs text-slate-300">{scout.readiness.action}</p>
                  ) : null}
                </div>
              )}

              <div className="mt-4 grid gap-3 xl:grid-cols-3">
                {scoutCategories.length > 0 ? (
                  scoutCategories.map((category) => (
                    <ScoutCategoryCard key={category.key} category={category} />
                  ))
                ) : (
                  <p className="rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-4 py-6 text-sm text-slate-500 xl:col-span-3">
                    Scout categories will populate after the watcher finishes its first sweep.
                  </p>
                )}
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent Discoveries</p>
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-600">
                    {scoutDiscoveries.length} visible
                  </span>
                </div>
                {scoutDiscoveries.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {scoutDiscoveries.slice(0, 6).map((discovery) => {
                      const isExpanded = Boolean(expandedScoutProjects[discovery.projectKey]);
                      const scoutQueueBusy = scoutQueueBusyKey === discovery.projectKey;
                      const queueableChildren = discovery.childTargets.filter((child) => child.queueable);
                      const selectedIds = selectedScoutChildren[discovery.projectKey] ?? [];
                      const selectedQueueableIds = queueableChildren
                        .filter((child) => selectedIds.includes(child.childId))
                        .map((child) => child.childId);

                      return (
                        <div
                          key={discovery.projectKey}
                          className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/10 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                                  {discovery.categoryLabel}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${scoutEventTone(discovery.lastEvent)}`}>
                                  {discovery.lastEvent}
                                </span>
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] ${scoutDiscoveryStateTone(discovery.state)}`}>
                                  {discovery.state.replace(/_/g, " ")}
                                </span>
                              </div>
                              <p className="mt-3 truncate text-sm font-medium text-white">{discovery.projectName}</p>
                              <p className="mt-2 text-xs text-cyan-200">
                                {summaryLine(discovery.rewardSummary, discovery.maxBountyText ?? "Reward context pending")}
                              </p>
                              <p className="mt-1 text-xs text-slate-400">
                                {summaryLine(discovery.scopeSummary, "Scope context pending")}
                              </p>
                              <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-5">
                                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2">
                                  <p className="uppercase tracking-[0.16em] text-slate-500">Assets</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{discovery.assetCount}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2">
                                  <p className="uppercase tracking-[0.16em] text-slate-500">Impacts</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{discovery.impactCount}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2">
                                  <p className="uppercase tracking-[0.16em] text-slate-500">Repos</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{discovery.repositoryCount}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2">
                                  <p className="uppercase tracking-[0.16em] text-slate-500">Resources</p>
                                  <p className="mt-1 text-sm font-semibold text-white">{discovery.resourceCount}</p>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-slate-900/70 px-2.5 py-2">
                                  <p className="uppercase tracking-[0.16em] text-slate-500">Queueable</p>
                                  <p className="mt-1 text-sm font-semibold text-white">
                                    {discovery.queuedChildCount}/{discovery.queueableChildCount}
                                  </p>
                                </div>
                              </div>
                              <p className="mt-2 text-[11px] text-slate-500">
                                Telegram ref: {discovery.commandRef}
                              </p>
                              {discovery.primaryRepository && (
                                <p className="mt-1 truncate text-[11px] text-slate-500">
                                  Primary repo: {discovery.primaryRepository}
                                </p>
                              )}
                            </div>
                            <div className="text-right text-xs text-slate-500">
                              <p>{formatTime(discovery.lastSeenAt)}</p>
                              <p className="mt-1">{discovery.refreshCount} sweeps</p>
                            </div>
                          </div>

                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => toggleScoutProject(discovery.projectKey)}
                              className="rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-cyan-400/30 hover:text-white"
                            >
                              {isExpanded ? "Hide scope" : "Expand scope"}
                            </button>
                            <button
                              onClick={() =>
                                void queueScoutTargets(discovery, { queueAll: true })
                              }
                              disabled={
                                scoutQueueBusy ||
                                busy ||
                                discovery.queueableChildCount === 0
                              }
                              className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {scoutQueueBusy ? "Queueing..." : "Queue all queueable"}
                            </button>
                            <button
                              onClick={() =>
                                void queueScoutTargets(discovery, {
                                  childIds: selectedQueueableIds,
                                })
                              }
                              disabled={
                                scoutQueueBusy ||
                                busy ||
                                selectedQueueableIds.length === 0
                              }
                              className="rounded-xl border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-xs font-medium text-blue-100 transition hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Queue selected
                            </button>
                          </div>

                          {isExpanded && (
                            <div className="mt-4 space-y-3">
                              {queueableChildren.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() =>
                                      setScoutChildSelection(
                                        discovery.projectKey,
                                        queueableChildren.map((child) => child.childId)
                                      )
                                    }
                                    className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-cyan-400/30 hover:text-white"
                                  >
                                    Select all queueable
                                  </button>
                                  <button
                                    onClick={() =>
                                      setScoutChildSelection(discovery.projectKey, [])
                                    }
                                    className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-cyan-400/30 hover:text-white"
                                  >
                                    Clear selection
                                  </button>
                                </div>
                              )}

                              <div className="space-y-2">
                                {discovery.childTargets.map((child, index) => {
                                  const linkedJob =
                                    (child.queuedJobId
                                      ? jobs.find((job) => job.jobId === child.queuedJobId)
                                      : undefined) ?? null;
                                  const childSelected = selectedIds.includes(child.childId);

                                  return (
                                    <div
                                      key={child.childId}
                                      className="rounded-2xl border border-white/10 bg-slate-900/70 p-3"
                                    >
                                      <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[11px] font-semibold text-slate-500">
                                              {index + 1}.
                                            </span>
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${scoutChildTone(child.kind)}`}>
                                              {scoutChildKindLabel(child.kind)}
                                            </span>
                                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                                              child.queueable
                                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                                : "border-slate-500/30 bg-slate-500/10 text-slate-300"
                                            }`}>
                                              {child.queueable ? "queueable" : "context only"}
                                            </span>
                                            {child.queuedJobState && (
                                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${stateTone(child.queuedJobState as AuditJobState)}`}>
                                                {child.queuedJobState.replace(/_/g, " ")}
                                              </span>
                                            )}
                                          </div>
                                          <p className="mt-2 text-sm font-medium text-white">{child.label}</p>
                                          <p className="mt-1 text-xs text-slate-400">{child.summary}</p>
                                          {child.sourceUrl && (
                                            <p className="mt-2 truncate text-[11px] text-slate-500">{child.sourceUrl}</p>
                                          )}
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                          {child.queueable && (
                                            <label className="flex items-center gap-2 text-[11px] text-slate-300">
                                              <input
                                                type="checkbox"
                                                checked={childSelected}
                                                onChange={() =>
                                                  toggleScoutChild(discovery.projectKey, child.childId)
                                                }
                                                className="h-3.5 w-3.5 rounded border-white/20 bg-slate-950 text-cyan-400 focus:ring-cyan-400"
                                              />
                                              select
                                            </label>
                                          )}
                                          {child.queueable && (
                                            <button
                                              onClick={() =>
                                                void queueScoutTargets(discovery, {
                                                  childIds: [child.childId],
                                                })
                                              }
                                              disabled={scoutQueueBusy || busy}
                                              className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                              Queue
                                            </button>
                                          )}
                                          {linkedJob && (
                                            <button
                                              onClick={() => setSelectedJob(linkedJob)}
                                              className="rounded-lg border border-white/10 bg-slate-950/70 px-3 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-cyan-400/30 hover:text-white"
                                            >
                                              Open job
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-4 py-6 text-sm text-slate-500">
                    Recent Scout discoveries will appear here once monitoring finds in-scope programs.
                  </p>
                )}
              </div>
            </article>

            <article className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Recent Activity</p>
                  <h3 className="mt-2 text-lg font-semibold text-white">Latest Transitions</h3>
                </div>
                <span className="rounded-full border border-white/10 bg-slate-950/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                  {orderedJobs.length} tracked
                </span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-400">
                The newest state changes appear here so an operator can confirm movement through approval, audit, review, and publication without reading backend logs.
              </p>

              {recentTransitions.length > 0 ? (
                <div className="mt-4 space-y-3">
                  {recentTransitions.map(({ key, job, transition }) => (
                    <button
                      key={key}
                      onClick={() => setSelectedJob(job)}
                      className="w-full rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left transition hover:border-cyan-400/20"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-white">{job.target.displayName}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${stateTone(transition.from)}`}>
                              {stateLabel(transition.from)}
                            </span>
                            <span className="text-xs text-slate-600">-&gt;</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${stateTone(transition.to)}`}>
                              {stateLabel(transition.to)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <p>{formatTime(transition.at)}</p>
                          <p className="mt-1 font-mono text-slate-600">{job.jobId.slice(0, 8)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-4 py-6 text-sm text-slate-500">
                  State transitions will appear here as soon as jobs move through the pipeline.
                </p>
              )}
            </article>
          </div>
        </section>

        {/* Pipeline + Findings grid */}
        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">

          {/* Pipeline (queue + active) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Audit Pipeline</h2>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                {pipelineJobs.length} in pipeline
              </p>
            </div>

            {pipelineJobs.length > 0 ? (
              pipelineJobs.map((job) => (
                <article
                  key={job.jobId}
                  className={`rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-cyan-400/20 cursor-pointer ${activeStateAnimation(job.state)}`}
                  onClick={() => setSelectedJob(job)}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                          job.target.type === "github"
                            ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
                            : "border-violet-400/20 bg-violet-400/10 text-violet-200"
                        }`}>
                          {job.target.type}
                        </span>
                        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${stateTone(job.state)}`}>
                          {stateLabel(job.state)}
                        </span>
                        {(job.state === "scanning" || job.state === "reviewing") && (
                          <span className="flex items-center gap-1.5 text-xs text-cyan-400">
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                            </span>
                            processing
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-semibold text-white truncate">{job.target.displayName}</h3>
                      <p className="text-sm leading-6 text-slate-400">{operatorStateCopy(job.state)}</p>
                      <LifecycleBar job={job} />
                    </div>

                    <div className="flex flex-col items-end gap-2 min-w-[160px]">
                      <p className="text-xs text-slate-600">{formatTime(job.updatedAt)}</p>

                      {/* Action buttons */}
                      {job.state === "pending_approval" && (
                        <div className="flex gap-2">
                          <button
                            id={`approve-btn-${job.jobId}`}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void approveJob(job);
                            }}
                            className="rounded-xl border border-blue-400/30 bg-blue-400/10 px-3 py-2 text-sm font-medium text-blue-200 transition hover:bg-blue-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            id={`approve-run-btn-${job.jobId}`}
                            disabled={busy || !modelReadiness?.available}
                            onClick={(e) => {
                              e.stopPropagation();
                              void approveAndRun(job);
                            }}
                            className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title={!modelReadiness?.available ? modelReadiness?.summary : "Approve and immediately start auditing"}
                          >
                            {modelReadiness?.available ? "Approve + Run" : "Model Offline"}
                          </button>
                        </div>
                      )}
                      {job.state === "approved" && (
                        <button
                          id={`run-btn-${job.jobId}`}
                          disabled={busy || !modelReadiness?.available}
                          onClick={(e) => {
                            e.stopPropagation();
                            void runAudit(job);
                          }}
                          className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                          title={!modelReadiness?.available ? modelReadiness?.summary : "Start the audit"}
                        >
                          {modelReadiness?.available ? "▶ Run Audit" : "Model Offline"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <article className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">
                No targets are queued yet. Submit a repository or Immunefi identifier above to start the golden path.
              </article>
            )}

            {/* Failed jobs */}
            {failedJobs.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-4">
                  <h3 className="text-base font-semibold text-red-300">Failed</h3>
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-300">
                    {failedJobs.length}
                  </span>
                </div>
                {failedJobs.slice(0, 5).map((job) => (
                  <article
                    key={job.jobId}
                    className="rounded-2xl border border-red-500/15 bg-slate-900/70 p-4 cursor-pointer hover:border-red-500/30 transition"
                    onClick={() => setSelectedJob(job)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-white">{job.target.displayName}</h4>
                        <p className="mt-1 text-xs text-red-400">{job.error ?? "Unknown error"}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${stateTone("failed")}`}>
                        failed
                      </span>
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>

          {/* Results column */}
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Findings</h2>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {publishedFindings.length} published · {needsHumanReviewFindings.length} human review · {discardedFindings.length} discarded
                </p>
              </div>
              <label className="flex flex-col gap-2 text-right">
                <span className="text-[11px] uppercase tracking-[0.25em] text-slate-500">
                  Rank by
                </span>
                <select
                  value={findingRankMode}
                  onChange={(e) => setFindingRankMode(e.target.value as FindingRankMode)}
                  className="rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.15em] text-slate-200 outline-none transition focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50"
                >
                  {FINDING_RANK_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-3 text-xs uppercase tracking-[0.25em] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {reviewedEntries.length} reviewed findings across {publishedJobs.length + needsHumanReviewJobs.length + discardedJobs.length} completed jobs
              </span>
              <span className="text-slate-600">Open any finding to drill into the full job, ranked candidates, proof state, and reviewer reasoning</span>
            </div>

            {publishedFindings.length > 0 ? (
              publishedFindings.slice(0, 10).map((entry) => (
                <FindingResultCard key={entry.key} entry={entry} onOpen={setSelectedJob} />
              ))
            ) : (
              <article className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">
                Published findings will appear here after a target completes the full golden path: submit → approve → audit → review.
              </article>
            )}

            {needsHumanReviewFindings.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-4">
                  <h3 className="text-base font-semibold text-amber-300">Needs Human Review</h3>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    {needsHumanReviewFindings.length}
                  </span>
                </div>
                {needsHumanReviewFindings.slice(0, 8).map((entry) => (
                  <FindingResultCard key={entry.key} entry={entry} onOpen={setSelectedJob} />
                ))}
              </>
            )}

            {discardedFindings.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-4">
                  <h3 className="text-base font-semibold text-slate-400">Discarded by Reviewer</h3>
                  <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                    {discardedFindings.length}
                  </span>
                </div>
                {discardedFindings.slice(0, 6).map((entry) => (
                  <FindingResultCard key={entry.key} entry={entry} onOpen={setSelectedJob} />
                ))}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
