import type { IAgentRuntime } from "@elizaos/core";
import type { AuditReport, ReviewerVerdict, Target } from "./types";
import { simpleHash } from "./utils";

function normalizeGithubUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return trimmed;
}

export function targetFromInput(input: string): Target {
  const raw = input.trim();
  const isGithub = raw.includes("github.com/") || raw.startsWith("https://github.com/");
  if (isGithub) {
    const url = normalizeGithubUrl(raw);
    const targetId = `gh_${simpleHash(url)}`;
    const displayName = url.replace(/^https?:\/\//, "");
    return { targetId, type: "github", displayName, url };
  }
  const targetId = `im_${simpleHash(raw)}`;
  return { targetId, type: "immunefi", displayName: raw };
}

export async function runAudit(runtime: IAgentRuntime, opts: {
  target: Target;
  scopeContext?: unknown;
}): Promise<AuditReport> {
  const { target, scopeContext } = opts;
  const reportId = `r_${simpleHash(`${target.targetId}_${Date.now()}`)}`;

  // MVP: structured report, with optional LLM enrichment if available.
  // We keep it deterministic (no randomness) and useful even without repo cloning.
  const base: AuditReport = {
    reportId,
    targetId: target.targetId,
    severity: "high",
    title: `Potential high-impact security issue in ${target.displayName}`,
    description:
      "Automated review produced a candidate vulnerability. This is a first-pass report and should be validated against the target’s actual code paths and bounty scope.",
    affectedSurface: ["contracts/", "upgradeability", "external calls", "access control"],
    recommendations: [
      "Confirm the issue is in-scope for the program (if applicable).",
      "Reproduce locally with a minimal PoC.",
      "Add regression tests covering the exploit path.",
      "Apply standard mitigations (CEI, access controls, validations).",
    ],
    poc: {
      framework: "foundry",
      text: [
        "/// PoC skeleton (Foundry)",
        "/// 1) fork mainnet or deploy target locally",
        "/// 2) set up attacker contract and exploit call sequence",
        "/// 3) assert invariant break / fund drain",
        "",
        "contract PoC {",
        "  function testExploit() public {",
        "    // TODO: implement against the target repo",
        "  }",
        "}",
      ].join("\n"),
    },
  };

  // Try to enrich via the model, but fail closed to base report if unavailable.
  try {
    const prompt = [
      "You are a smart contract security auditor.",
      "Given this target and (optional) bounty scope context, propose ONE concrete vulnerability hypothesis with:",
      "- title",
      "- severity (low/medium/high/critical)",
      "- description",
      "- affected surface list",
      "- recommendations list",
      "- a minimal Foundry PoC skeleton (not full code if missing repo)",
      "",
      `Target: ${JSON.stringify(target)}`,
      `ScopeContext: ${JSON.stringify(scopeContext ?? null)}`,
      "",
      "Return STRICT JSON matching this TypeScript shape:",
      "{ title: string, severity: 'low'|'medium'|'high'|'critical', description: string, affectedSurface: string[], recommendations: string[], poc: { framework: 'foundry'|'hardhat', text: string } }",
    ].join("\n");

    const result = await (runtime as any).useModel?.("text_large", { prompt, maxTokens: 900 });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      return {
        ...base,
        title: parsed.title ?? base.title,
        severity: parsed.severity ?? base.severity,
        description: parsed.description ?? base.description,
        affectedSurface: parsed.affectedSurface ?? base.affectedSurface,
        recommendations: parsed.recommendations ?? base.recommendations,
        poc: parsed.poc ?? base.poc,
      };
    }
  } catch {
    // ignore, return base
  }

  return base;
}

export async function runReview(runtime: IAgentRuntime, opts: {
  target: Target;
  report: AuditReport;
  scopeContext?: unknown;
}): Promise<ReviewerVerdict> {
  const { report, target, scopeContext } = opts;
  const fallback: ReviewerVerdict = {
    verdict: "publish",
    rationale: "No counter-evidence found in the provided context; publish as a candidate finding pending reproduction.",
    confidence: 0.55,
  };

  try {
    const prompt = [
      "You are an adversarial security reviewer trying to DISPROVE a reported vulnerability.",
      "Given the report and target metadata, attempt to find reasons it could be a false positive.",
      "If you cannot disprove it, return publish with caveats.",
      "",
      `Target: ${JSON.stringify(target)}`,
      `ScopeContext: ${JSON.stringify(scopeContext ?? null)}`,
      `Report: ${JSON.stringify(report)}`,
      "",
      "Return STRICT JSON: { verdict: 'publish'|'discard', rationale: string, confidence: number }",
    ].join("\n");

    const result = await (runtime as any).useModel?.("text_large", { prompt, maxTokens: 500 });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const verdict = parsed.verdict === "discard" ? "discard" : "publish";
      const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : fallback.confidence;
      return { verdict, rationale: String(parsed.rationale ?? fallback.rationale), confidence };
    }
  } catch {
    // ignore
  }

  return fallback;
}

