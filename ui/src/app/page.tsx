'use client';

import React from "react";

type Target = {
  targetId: string;
  type: string;
  displayName: string;
  url?: string;
};

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

function extractText(mem: any): string {
  return mem?.content?.text ?? mem?.content?.[0]?.text ?? mem?.text ?? "";
}

function extractStage(mem: any): string | undefined {
  return mem?.metadata?.stage;
}

function extractTarget(mem: any): Target | null {
  const t = mem?.content?.target;
  if (t?.targetId) return t as Target;
  const txt = extractText(mem);
  const match = txt.match(/TARGET_ID:([^\s]+)/);
  if (!match) return null;
  return { targetId: match[1], type: "unknown", displayName: match[1] };
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

export default function Home() {
  const [target, setTarget] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [scoutItems, setScoutItems] = React.useState<any[]>([]);
  const [hitlItems, setHitlItems] = React.useState<any[]>([]);
  const [findings, setFindings] = React.useState<any[]>([]);
  const [readiness, setReadiness] = React.useState<ReadinessSnapshot | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const roomId = "00000000-0000-0000-0000-000000000000";

  const refresh = React.useCallback(async () => {
    try {
      const [feedRes, findingsRes, readinessRes] = await Promise.all([
        fetch(`/api/vigilance/feed?roomId=${encodeURIComponent(roomId)}`),
        fetch(`/api/vigilance/findings?roomId=${encodeURIComponent(roomId)}`),
        fetch("/api/vigilance/readiness"),
      ]);

      const feedJson = await feedRes.json().catch(() => null);
      const findingsJson = await findingsRes.json().catch(() => null);
      const readinessJson = await readinessRes.json().catch(() => null);

      setScoutItems(feedJson?.data?.scouts ?? []);
      setHitlItems(feedJson?.data?.hitl ?? []);
      setFindings(findingsJson?.data?.findings ?? []);
      setReadiness(readinessJson?.data ?? null);
      setActionError(null);
    } catch {
      setActionError("Operator console could not refresh backend state.");
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 4000);
    return () => clearInterval(id);
  }, [refresh]);

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

  async function approveAndRunAudit(t: Target) {
    setBusy(true);
    setActionError(null);
    try {
      const approveRes = await fetch("/api/vigilance/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: t.targetId, targetDisplayName: t.displayName, roomId }),
      });
      const approveJson = await approveRes.json().catch(() => null);
      if (!approveRes.ok) {
        setActionError(approveJson?.error ?? "Approval failed.");
        await refresh();
        return;
      }

      const auditRes = await fetch("/api/vigilance/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: t.targetId, roomId }),
      });
      const auditJson = await auditRes.json().catch(() => null);
      if (!auditRes.ok) {
        setActionError(
          auditJson?.readiness?.summary ??
            auditJson?.error ??
            "Audit could not start."
        );
      }

      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const readinessItems = readiness ? Object.values(readiness.integrations) : [];
  const modelReadiness = readiness?.integrations?.model;
  const headerReady = readiness?.overallState === "ready";
  const headerTone = headerReady
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_35%),linear-gradient(180deg,#020617_0%,#020617_45%,#111827_100%)] text-gray-100 font-sans selection:bg-cyan-500 selection:text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/85 backdrop-blur-md">
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
            <div className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${headerTone}`}>
              {readiness ? readiness.overallState : "checking"}
            </div>
            <div className="hidden text-right md:block">
              <p className="text-sm text-slate-200">
                {readiness?.summary ?? "Checking backend integration readiness..."}
              </p>
              <p className="text-xs text-slate-500">
                {readiness?.checkedAt
                  ? `Last check ${new Date(readiness.checkedAt).toLocaleTimeString()}`
                  : "Waiting for first readiness snapshot"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-3xl border border-cyan-400/15 bg-slate-900/70 p-6 shadow-2xl shadow-cyan-950/20">
          <div className="absolute inset-y-0 right-0 w-72 bg-[radial-gradient(circle_at_center,_rgba(34,211,238,0.18),_transparent_65%)]" />
          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300">Golden Path Intake</p>
              <h2 className="mt-3 text-2xl font-semibold text-white">Submit a target, gate it, and only audit when the stack is truly ready.</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Manual GitHub and Immunefi-style targets stay available through the UI. Live Scout discovery, Telegram approvals,
                and model-backed auditing now reflect real backend readiness instead of static badges.
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 lg:max-w-xl lg:flex-row">
              <input
                type="text"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/50"
                placeholder="github.com/org/repo or Immunefi project identifier"
              />
              <button
                disabled={busy || !target.trim()}
                onClick={() => void submitTarget()}
                className="rounded-2xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Working..." : "Queue Target"}
              </button>
            </div>
          </div>
        </section>

        {actionError ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {actionError}
          </section>
        ) : null}

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

        <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Scout Feed</h2>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Queue and approval state</p>
            </div>

            {(scoutItems || []).length > 0 ? (
              (scoutItems || []).slice(0, 10).map((mem, idx) => {
                const targetRecord = extractTarget(mem);
                const text = extractText(mem);
                const hitlForTarget = (hitlItems || []).find((item) =>
                  extractText(item).includes(targetRecord?.targetId ? `TARGET_ID:${targetRecord.targetId}` : "__none__")
                );
                const hitlText = hitlForTarget ? extractText(hitlForTarget) : "";
                const status = hitlText.includes("APPROVED")
                  ? "Approved"
                  : hitlText.includes("PENDING")
                    ? "Awaiting approval"
                    : "New";
                const statusTone = hitlText.includes("APPROVED")
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300";

                return (
                  <article
                    key={idx}
                    className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 transition hover:border-cyan-400/20"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                            {targetRecord?.type ?? "target"}
                          </span>
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone}`}>
                            {status}
                          </span>
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-white">{targetRecord?.displayName ?? "Target"}</h3>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-400">{text}</p>
                        </div>
                      </div>

                      <div className="flex min-w-[180px] flex-col gap-3">
                        <p className="text-right text-xs uppercase tracking-[0.3em] text-slate-500">
                          {extractStage(mem) ?? "scout"}
                        </p>
                        {targetRecord?.targetId ? (
                          <button
                            disabled={busy || !modelReadiness?.available}
                            onClick={() => void approveAndRunAudit(targetRecord)}
                            className="rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                            title={!modelReadiness?.available ? modelReadiness?.summary : undefined}
                          >
                            {modelReadiness?.available ? "Approve + Run Audit" : "Audit Unavailable"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <article className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">
                No targets are queued yet. Submit a repository or Immunefi-style identifier above to start the approval flow.
              </article>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Reviewed Findings</h2>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Published output</p>
            </div>

            {(findings || []).length > 0 ? (
              (findings || []).slice(0, 6).map((mem, idx) => {
                const report = mem?.content?.report;
                const targetRecord = mem?.content?.target;
                const title = report?.title ?? "Finding";
                const severity = String(report?.severity ?? "high").toLowerCase();
                const severityTone =
                  severity === "critical"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : severity === "high"
                      ? "border-orange-500/30 bg-orange-500/10 text-orange-300"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-300";
                const description = report?.description ?? extractText(mem);

                return (
                  <article
                    key={idx}
                    className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${severityTone}`}>
                        {severity}
                      </span>
                      <span className="text-xs text-slate-500">{targetRecord?.displayName ?? ""}</span>
                    </div>
                    <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
                  </article>
                );
              })
            ) : (
              <article className="rounded-2xl border border-dashed border-white/10 bg-slate-900/50 p-6 text-sm text-slate-400">
                Published findings will appear here after approval, audit, and review all complete successfully.
              </article>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
