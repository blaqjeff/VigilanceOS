'use client';

import React from "react";

// ---------------------------------------------------------------------------
// Types — mirrors backend AuditJob
// ---------------------------------------------------------------------------

type AuditJobState =
  | "submitted"
  | "pending_approval"
  | "approved"
  | "scanning"
  | "reviewing"
  | "published"
  | "discarded"
  | "failed";

type Target = {
  targetId: string;
  type: string;
  displayName: string;
  url?: string;
};

type EvidenceProofLevel =
  | "runnable_poc"
  | "guided_replay"
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
  type: "static_analysis" | "poc";
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
};

type ReviewerVerdict = {
  verdict: "publish" | "discard";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    case "runnable_poc":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "guided_replay":
      return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300";
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
  return proofLevel.replace(/_/g, " ");
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
  const isTerminal = ["published", "discarded", "failed"].includes(job.state);
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

// ---------------------------------------------------------------------------
// Job detail modal
// ---------------------------------------------------------------------------

function JobDetailPanel({
  job,
  onClose,
}: {
  job: AuditJob;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 shadow-2xl"
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
              <h3 className="text-lg font-semibold text-white">Audit Report</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${severityTone(job.report.severity)}`}>
                {job.report.severity}
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
              <h3 className="text-lg font-semibold text-white">Reviewer Verdict</h3>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-widest ${
                job.verdict.verdict === "publish"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/30 bg-red-500/10 text-red-300"
              }`}>
                {job.verdict.verdict}
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
                  job.verdict.verdict === "publish" ? "bg-emerald-400" : "bg-red-400"
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

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Home() {
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [jobs, setJobs] = React.useState<AuditJob[]>([]);
  const [stats, setStats] = React.useState<JobStats | null>(null);
  const [readiness, setReadiness] = React.useState<ReadinessSnapshot | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [selectedJob, setSelectedJob] = React.useState<AuditJob | null>(null);
  const roomId = "00000000-0000-0000-0000-000000000000";

  const refresh = React.useCallback(async () => {
    try {
      const [jobsRes, readinessRes] = await Promise.all([
        fetch("/api/vigilance/jobs?limit=50"),
        fetch("/api/vigilance/readiness"),
      ]);

      const jobsJson = await jobsRes.json().catch(() => null);
      const readinessJson = await readinessRes.json().catch(() => null);

      setJobs(jobsJson?.data?.jobs ?? []);
      setStats(jobsJson?.data?.stats ?? null);
      setReadiness(readinessJson?.data ?? null);
    } catch {
      setActionError("Operator console could not refresh backend state.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [refresh]);

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

  async function submitTarget() {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/vigilance/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, roomId }),
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
      setBusy(false);
    }
  }

  // ---- Computed ----

  const readinessItems = readiness ? Object.values(readiness.integrations) : [];
  const modelReadiness = readiness?.integrations?.model;
  const headerReady = readiness?.overallState === "ready";
  const headerTone = headerReady
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  // Group jobs
  const pendingJobs = jobs.filter((j) => j.state === "pending_approval");
  const approvedJobs = jobs.filter((j) => j.state === "approved");
  const activeJobs = jobs.filter((j) => j.state === "scanning" || j.state === "reviewing");
  const publishedJobs = jobs.filter((j) => j.state === "published");
  const discardedJobs = jobs.filter((j) => j.state === "discarded");
  const failedJobs = jobs.filter((j) => j.state === "failed");

  const pipelineJobs = [...pendingJobs, ...approvedJobs, ...activeJobs];

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_35%),linear-gradient(180deg,#020617_0%,#020617_45%,#111827_100%)] text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">

      {/* Selected job detail */}
      {selectedJob && (
        <JobDetailPanel job={selectedJob} onClose={() => setSelectedJob(null)} />
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
            </div>

            <div className="flex w-full flex-col gap-3 lg:max-w-xl lg:flex-row">
              <input
                id="target-input"
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && target.trim()) void submitTarget();
                }}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50"
                placeholder="github.com/org/repo or Immunefi project identifier"
              />
              <button
                id="submit-target-btn"
                disabled={busy || !target.trim()}
                onClick={() => void submitTarget()}
                className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                {busy ? "Working…" : "Queue Target"}
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
              Waiting for the backend readiness snapshot…
            </article>
          )}
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
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Findings</h2>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                {publishedJobs.length} published · {discardedJobs.length} discarded
              </p>
            </div>

            {publishedJobs.length > 0 ? (
              publishedJobs.slice(0, 8).map((job) => (
                <article
                  key={job.jobId}
                  className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30 cursor-pointer hover:border-emerald-400/20 transition"
                  onClick={() => setSelectedJob(job)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${severityTone(job.report?.severity ?? "high")}`}>
                        {job.report?.severity ?? "high"}
                      </span>
                      {job.report?.evidence && (
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${proofTone(job.report.evidence.proofLevel)}`}>
                          {proofLabel(job.report.evidence.proofLevel)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {job.report && typeof job.report.confidence === "number" && (
                        <span className="text-xs text-cyan-300">
                          auditor {formatPercent(job.report.confidence)}
                        </span>
                      )}
                      {job.verdict && (
                        <span className="text-xs text-emerald-400">
                          reviewer {formatPercent(job.verdict.confidence)}
                        </span>
                      )}
                      <span className="text-xs text-slate-500">{job.target.displayName}</span>
                    </div>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">
                    {job.report?.title ?? "Finding"}
                  </h3>
                  {job.report?.evidence && (
                    <p className="mt-3 text-xs uppercase tracking-[0.2em] text-cyan-300">
                      {job.report.evidence.summary}
                    </p>
                  )}
                  <p className="mt-3 text-sm leading-6 text-slate-400 line-clamp-3">
                    {job.report?.description ?? ""}
                  </p>
                  {job.verdict && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1 flex-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-400 transition-all duration-500"
                          style={{ width: `${Math.round(job.verdict.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500 whitespace-nowrap">
                        reviewer confidence
                      </span>
                    </div>
                  )}
                </article>
              ))
            ) : (
              <article className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">
                Published findings will appear here after a target completes the full golden path: submit → approve → audit → review.
              </article>
            )}

            {/* Discarded findings */}
            {discardedJobs.length > 0 && (
              <>
                <div className="flex items-center gap-3 mt-4">
                  <h3 className="text-base font-semibold text-slate-400">Discarded by Reviewer</h3>
                  <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                    {discardedJobs.length}
                  </span>
                </div>
                {discardedJobs.slice(0, 4).map((job) => (
                  <article
                    key={job.jobId}
                    className="rounded-2xl border border-white/5 bg-slate-900/50 p-4 cursor-pointer hover:border-white/10 transition opacity-70"
                    onClick={() => setSelectedJob(job)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-slate-300">
                          {job.report?.title ?? job.target.displayName}
                        </h4>
                        {job.report?.evidence && (
                          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                            {proofLabel(job.report.evidence.proofLevel)} evidence
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">
                          {job.verdict?.rationale?.slice(0, 100)}…
                        </p>
                      </div>
                      <span className="text-xs text-slate-600">
                        {job.verdict ? `${Math.round(job.verdict.confidence * 100)}%` : ""}
                      </span>
                    </div>
                  </article>
                ))}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
