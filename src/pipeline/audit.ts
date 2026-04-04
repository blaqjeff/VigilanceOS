import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type {
  AuditFindingCandidate,
  AuditReport,
  EvidenceArtifact,
  EvidenceBundle,
  EvidenceTrace,
  FindingSeverity,
  IngestionResult,
  PocFramework,
  ReviewerVerdict,
  SourceFile,
  Target,
  TargetCategory,
} from "./types.js";
import { analyzeSolanaRust, formatSignalsForPrompt } from "../analyzers/solana.js";
import type { SolanaAnalysisResult } from "../analyzers/solana.js";
import { generateSolanaPoC } from "../analyzers/solana-poc.js";
import { analyzeSolidityEvm, formatEvmSignalsForPrompt } from "../analyzers/evm.js";
import type { EvmAnalysisResult } from "../analyzers/evm.js";
import { generateEvmPoC } from "../analyzers/evm-poc.js";
import { simpleHash } from "./utils.js";

// ---------------------------------------------------------------------------
// Target creation from user input
// ---------------------------------------------------------------------------

function normalizeGithubUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return trimmed;
}

export function targetFromInput(input: string): Target {
  const raw = input.trim();

  // GitHub URL
  const isGithub =
    raw.includes("github.com/") || raw.startsWith("https://github.com/");
  if (isGithub) {
    const url = normalizeGithubUrl(raw);
    const targetId = `gh_${simpleHash(url)}`;
    const displayName = url.replace(/^https?:\/\//, "");
    return { targetId, type: "github", displayName, url };
  }

  // Local path (absolute path starting with / or drive letter)
  const isLocalPath =
    raw.startsWith("/") ||
    raw.startsWith("\\") ||
    /^[a-zA-Z]:[/\\]/.test(raw);
  if (isLocalPath) {
    const targetId = `local_${simpleHash(raw)}`;
    return { targetId, type: "local", displayName: raw, localPath: raw };
  }

  // Default to Immunefi-style identifier
  const targetId = `im_${simpleHash(raw)}`;
  return { targetId, type: "immunefi", displayName: raw };
}

// ---------------------------------------------------------------------------
// Code context builder — builds the source code context for LLM prompts
// ---------------------------------------------------------------------------

function buildCodeContext(ingestion: IngestionResult): string {
  if (ingestion.sourceFiles.length === 0) {
    return "[No source files were extracted from the target.]";
  }

  const sections: string[] = [];

  // Structure overview
  sections.push("=== REPOSITORY STRUCTURE ===");
  sections.push(ingestion.structureSummary);
  sections.push("");

  sections.push(ingestion.repoIndex.summary);
  sections.push("");

  if (ingestion.neighborhoods.length > 0) {
    sections.push(`=== SECURITY NEIGHBORHOODS (${ingestion.neighborhoods.length}) ===`);
    for (const neighborhood of ingestion.neighborhoods) {
      sections.push(neighborhood.summary);
      sections.push("");
    }
  }

  // Source files
  sections.push(`=== SOURCE FILES (${ingestion.sourceFiles.length} of ${ingestion.totalFilesFound} total) ===`);

  for (const file of ingestion.sourceFiles) {
    sections.push(`\n--- FILE: ${file.relativePath} (${file.language}, ${file.originalSize} bytes${file.truncated ? ", truncated" : ""}) ---`);
    sections.push(file.content);
  }

  if (ingestion.skippedFiles.length > 0) {
    sections.push(`\n--- SKIPPED FILES (${ingestion.skippedFiles.length}) ---`);
    sections.push(ingestion.skippedFiles.slice(0, 20).join("\n"));
    if (ingestion.skippedFiles.length > 20) {
      sections.push(`... and ${ingestion.skippedFiles.length - 20} more`);
    }
  }

  return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Category-aware audit prompt builder
// ---------------------------------------------------------------------------

function solanaRustAuditPrompt(): string {
  return [
    "You are an expert Solana / Anchor security auditor specializing in DeFi protocol vulnerabilities.",
    "You understand the Solana account model deeply: all data lives in accounts, programs are stateless,",
    "accounts must be explicitly passed and validated, and CPI (cross-program invocation) is the inter-program call mechanism.",
    "",
    "=== PRIMARY VULNERABILITY CLASSES (analyze in this priority order) ===",
    "",
    "1. ORACLE / PRICE / ACCOUNTING LOGIC FLAWS",
    "   Look for:",
    "   - Oracle reads without staleness checks (pyth, switchboard, chainlink — verify last_update_slot/timestamp)",
    "   - Oracle confidence interval not validated (wide confidence = manipulable price)",
    "   - Price calculations using integer division before multiplication (precision loss → extractable value)",
    "   - Unchecked arithmetic on balance/amount/supply fields (underflow wraps to u64::MAX)",
    "   - Share/LP token calculations with rounding exploits (first-depositor attack, inflation attack)",
    "   - Missing slippage protection on swap/trade amounts",
    "   - Flash loan attack vectors: any single-transaction price manipulation path",
    "",
    "2. ACCOUNT OWNERSHIP VALIDATION BUGS",
    "   Look for:",
    "   - UncheckedAccount or AccountInfo used without verify .owner == expected_program_id",
    "   - Account data deserialized (try_from_slice, unpack, deserialize) without prior owner check",
    "   - #[account(...)] annotations missing owner= constraint for data accounts",
    "   - Missing discriminator validation (attacker creates account with spoofed layout)",
    "   - Token accounts not validated as owned by spl_token program",
    "   - Mint accounts accepted without verifying they match the expected token",
    "",
    "3. SIGNER / AUTHORITY MISTAKES",
    "   Look for:",
    "   - State-mutating instructions (transfer, withdraw, update, close) without signer check",
    "   - Authority/admin fields stored in state but not validated via has_one= or constraint=",
    "   - #[account(mut)] on authority-like accounts without signer constraint",
    "   - Initialization functions where authority is set to the transaction sender without additional validation",
    "   - Missing multi-sig or timelock on high-impact admin operations",
    "",
    "4. PDA DERIVATION AND SEED MISUSE",
    "   Look for:",
    "   - create_program_address used instead of find_program_address (non-canonical bump attack)",
    "   - Bump seeds not stored in account state (re-derivation inconsistency)",
    "   - seeds= without bump= constraint in Anchor (implicit canonical but bump not persisted)",
    "   - PDA seeds using only static strings (seed collision → global singleton conflicts)",
    "   - User-controlled seed inputs that can collide with other users' PDAs",
    "",
    "5. CPI PRIVILEGE ESCALATION",
    "   Look for:",
    "   - invoke() / invoke_signed() with unvalidated target program ID (program substitution attack)",
    "   - PDA authority shared across multiple CPI targets (privilege bleed)",
    "   - CpiContext::new() where the program account is an unvalidated AccountInfo",
    "   - Signer seeds passed to invoke_signed where the PDA has overly broad authority",
    "   - Missing re-entrancy guards on CPI calls that modify shared state",
    "",
    "=== ADDITIONAL CHECKS ===",
    "- Reinitialization: init instructions callable more than once (state reset / authority hijack)",
    "- Integer overflow: u64/u128 arithmetic in release mode (Rust wraps by default)",
    "- Arbitrary account close: close instruction drains lamports without proper authority check",
    "- Unchecked CPI return values: invoke return data ignored → silent failure",
    "- Rent-exemption: accounts created with insufficient lamports → garbage collected",
    "- Type cosplay: two account types with the same layout exploitable via discriminator confusion",
    "",
    "=== EVIDENCE STANDARD ===",
    "Your finding MUST include:",
    "- The exact file path, function name, and line number of the vulnerability",
    "- The specific accounts, instructions, and data flows involved",
    "- A concrete attack scenario: step-by-step how an attacker exploits this",
    "- The impact: what an attacker gains (funds, authority, state corruption)",
    "- Conditions required: what permissions, timing, or state must exist",
    "- A PoC as an Anchor TypeScript test that demonstrates the exploit path",
  ].join("\n");
}

function solidityEvmAuditPrompt(): string {
  return [
    "You are an expert Solidity / EVM security auditor specializing in DeFi protocol vulnerabilities.",
    "You understand the EVM execution model deeply: contracts hold state in storage slots, external calls can",
    "trigger callbacks via fallback/receive, msg.sender changes on internal calls, and delegatecall preserves",
    "the caller's storage context.",
    "",
    "=== PRIMARY VULNERABILITY CLASSES (analyze in this priority order) ===",
    "",
    "1. ORACLE / PRICE MANIPULATION",
    "   Look for:",
    "   - Chainlink latestRoundData() without staleness check (updatedAt, answeredInRound)",
    "   - Uniswap slot0() used for pricing (manipulable via flash loan in a single tx)",
    "   - AMM getReserves() used for on-chain price calculation (flash loan manipulable)",
    "   - TWAP with too-short window (minutes instead of hours)",
    "   - Division before multiplication in price/share calculations (precision loss)",
    "   - Missing confidence interval validation on Chainlink prices",
    "   - Price feeds not validated for L2 sequencer uptime (Arbitrum, Optimism)",
    "",
    "2. ACCESS CONTROL AND AUTHORIZATION",
    "   Look for:",
    "   - External/public state-mutating functions without onlyOwner/onlyRole/require(msg.sender)",
    "   - tx.origin for authorization (phishing relay attack)",
    "   - Unprotected selfdestruct/suicide",
    "   - Missing access control on emergency/pause/upgrade functions",
    "   - Role assignment functions callable by non-admins",
    "   - Default admin role not properly secured in AccessControl",
    "",
    "3. ACCOUNTING AND INVARIANT VIOLATIONS",
    "   Look for:",
    "   - Share calculations without totalSupply == 0 check (first depositor / vault inflation attack)",
    "   - balanceOf() mixed with internal balance tracking (donation attack)",
    "   - State updates AFTER external calls (checks-effects-interactions violation)",
    "   - Custom mint/burn without totalSupply sync",
    "   - Rounding direction always favoring one party (attacker/protocol)",
    "   - Missing dead share / minimum deposit protections in vaults",
    "",
    "4. UPGRADEABILITY AND INITIALIZER MISTAKES",
    "   Look for:",
    "   - initialize() without OpenZeppelin's 'initializer' modifier (re-init attack)",
    "   - Constructors in upgradeable contracts (state only on implementation, not proxy)",
    "   - Unprotected _authorizeUpgrade / upgradeTo (anyone can change implementation)",
    "   - delegatecall to user-controlled address (arbitrary code execution)",
    "   - Storage slot collision between proxy and implementation",
    "   - Uninitialized implementation contracts behind proxies",
    "",
    "5. UNSAFE EXTERNAL CALLS / TOKEN HANDLING",
    "   Look for:",
    "   - Unchecked .call() return value (silent failure)",
    "   - ERC-20 .transfer()/.transferFrom() without SafeERC20 (USDT, BNB quirks)",
    "   - approve() without prior reset to 0 (approval front-running)",
    "   - Fee-on-transfer tokens: amount parameter trusted after transferFrom",
    "   - Rebasing tokens breaking balance assumptions",
    "   - ETH sent to contracts without receive/fallback (stuck funds)",
    "",
    "=== ADDITIONAL CHECKS ===",
    "- Reentrancy: external calls followed by state updates without nonReentrant (cross-function, cross-contract, read-only)",
    "- Front-running: deadline = block.timestamp (no deadline), amountOutMin = 0 (no slippage)",
    "- Integer: unchecked{} blocks on financial values in 0.8+, missing SafeMath in < 0.8",
    "- delegatecall in non-proxy context (storage corruption)",
    "- Missing event emissions for state changes (off-chain monitoring blind spots)",
    "",
    "=== EVIDENCE STANDARD ===",
    "Your finding MUST include:",
    "- The exact file path, contract name, function name, and line number",
    "- The specific attack scenario: step-by-step exploit flow",
    "- What an attacker gains (funds, authority, state corruption, DoS)",
    "- Conditions required (flash loan needed? specific token type? timing?)",
    "- A PoC as a Foundry test that demonstrates the exploit path",
  ].join("\n");
}

function webAppAuditPrompt(): string {
  return [
    "You are an expert web application security auditor performing static analysis.",
    "Focus your analysis on:",
    "1. Exposed secrets, API keys, or credentials in source code",
    "2. Authentication and authorization flaws",
    "3. SQL injection, XSS, CSRF, and other injection vulnerabilities",
    "4. Insecure data handling and validation",
    "5. Tenant isolation problems in multi-tenant systems",
    "6. Unsafe business logic flows",
  ].join("\n");
}

function getSpecialistPrompt(category: TargetCategory): string {
  switch (category) {
    case "solana_rust":
      return solanaRustAuditPrompt();
    case "solidity_evm":
      return solidityEvmAuditPrompt();
    case "web_app":
      return webAppAuditPrompt();
    default:
      return "You are a security auditor. Analyze the provided source code for vulnerabilities.";
  }
}

function getPocFramework(category: TargetCategory): PocFramework {
  switch (category) {
    case "solana_rust":
      return "anchor";
    case "solidity_evm":
      return "foundry";
    default:
      return "generic";
  }
}

type AnalyzerSignal = {
  vulnClass: string;
  severityHint: FindingSeverity;
  file: string;
  line: number;
  snippet: string;
  finding: string;
  confirmationHint: string;
};

const VULNERABILITY_LABELS: Record<string, string> = {
  oracle_accounting: "Oracle / accounting flaw",
  ownership_validation: "Ownership validation bug",
  signer_authority: "Signer / authority mistake",
  pda_misuse: "PDA derivation misuse",
  cpi_escalation: "CPI privilege escalation",
  reinitialization: "Reinitialization bug",
  integer_overflow: "Integer overflow risk",
  arbitrary_close: "Arbitrary close path",
  unchecked_return: "Unchecked return path",
  missing_constraint: "Missing account constraint",
  oracle_price: "Oracle / price manipulation",
  access_control: "Access control flaw",
  accounting_invariant: "Accounting / invariant violation",
  upgradeability: "Upgradeability flaw",
  unsafe_external: "Unsafe external call",
  reentrancy: "Reentrancy path",
  frontrunning: "Front-running / slippage issue",
  integer_issue: "Integer safety issue",
  unchecked_call: "Unchecked low-level call",
  token_handling: "Unsafe token handling",
};

function severityRank(severity: FindingSeverity): number {
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

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sanitizeConfidence(value: unknown, fallback: number): number {
  return typeof value === "number" ? Math.max(0, Math.min(1, value)) : fallback;
}

function friendlyVulnerabilityClass(vulnClass?: string): string {
  if (!vulnClass) return "Security finding";
  return VULNERABILITY_LABELS[vulnClass] ?? vulnClass.replace(/_/g, " ");
}

function collectEvidenceSignals(
  solanaAnalysis?: SolanaAnalysisResult,
  evmAnalysis?: EvmAnalysisResult
): AnalyzerSignal[] {
  const signals = [
    ...(solanaAnalysis?.signals ?? []),
    ...(evmAnalysis?.signals ?? []),
  ] as AnalyzerSignal[];

  return [...signals].sort((left, right) => {
    const severityDelta = severityRank(right.severityHint) - severityRank(left.severityHint);
    if (severityDelta !== 0) return severityDelta;
    if (left.file !== right.file) return left.file.localeCompare(right.file);
    return left.line - right.line;
  });
}

function buildWhyFlagged(signals: AnalyzerSignal[]): string[] {
  if (signals.length === 0) {
    return [
      "No grounded static-analysis signal was strong enough to auto-explain the finding.",
    ];
  }

  return uniqueStrings(signals.slice(0, 3).map((signal) => signal.finding));
}

function buildAffectedSurface(signals: AnalyzerSignal[]): string[] {
  return uniqueStrings(
    signals.slice(0, 6).flatMap((signal) => [
      `${signal.file}:${signal.line}`,
      signal.file,
    ])
  );
}

function buildImpact(topSignal?: AnalyzerSignal): string {
  switch (topSignal?.vulnClass) {
    case "oracle_accounting":
    case "oracle_price":
    case "accounting_invariant":
      return "An attacker may manipulate protocol accounting or pricing to extract value, mint excess shares, or trade at an unfair rate.";
    case "ownership_validation":
    case "signer_authority":
    case "access_control":
    case "upgradeability":
    case "pda_misuse":
    case "cpi_escalation":
      return "An attacker may gain unauthorized control over privileged actions, mutable state, or funds-moving operations.";
    case "reentrancy":
    case "unsafe_external":
    case "unchecked_call":
    case "token_handling":
      return "An attacker may abuse an unsafe external interaction to drain funds, bypass checks, or leave protocol state inconsistent.";
    default:
      return "The affected code path appears security-sensitive and could expose funds, authority, or critical application state if the suspicion is confirmed.";
  }
}

function hasSubstantialPocText(poc?: AuditReport["poc"]): boolean {
  return Boolean(poc?.text && poc.text.trim().length >= 120 && poc.framework !== "generic");
}

function buildReproductionGuide(
  target: Target,
  severity: FindingSeverity,
  poc: AuditReport["poc"],
  signals: AnalyzerSignal[]
): EvidenceBundle["reproduction"] {
  const topSignal = signals[0];

  if (hasSubstantialPocText(poc) && poc) {
    return {
      available: true,
      framework: poc.framework,
      steps: [
        `Materialize ${target.displayName} locally or on a disposable fork/test validator.`,
        `Run the ${poc.framework} PoC and drive execution through ${topSignal ? `${topSignal.file}:${topSignal.line}` : "the flagged code path"}.`,
        `Confirm the unauthorized state change or value extraction described in the report.`,
      ],
      notes: "The included PoC should be treated as replayable guidance and validated against the exact target revision.",
    };
  }

  if (signals.length > 0) {
    return {
      available: true,
      steps: [
        `Trace execution through ${topSignal?.file ?? "the flagged file"}${topSignal ? `:${topSignal.line}` : ""}.`,
        `Validate the missing guard or unsafe assumption described by the analyzer and report.`,
        `Create a minimal regression test around the affected path before publishing severity claims externally.`,
      ],
      notes: severityRank(severity) >= severityRank("high")
        ? "High-impact findings still need replayable proof before they should be treated as publishable."
        : "Medium/low findings can ship with code-path evidence when uncertainty is clearly labeled.",
    };
  }

  return {
    available: false,
    steps: [],
    notes: "No grounded reproduction path was derived from the current inputs.",
  };
}

function isReplayableGuide(
  reproduction: EvidenceBundle["reproduction"],
  poc: AuditReport["poc"]
): boolean {
  if (!reproduction.available || reproduction.steps.length === 0 || hasSubstantialPocText(poc)) {
    return false;
  }

  const normalizedSteps = reproduction.steps.join(" ").toLowerCase();
  const hasConcreteHarness =
    Boolean(reproduction.framework && reproduction.framework !== "generic") &&
    /(run|execute|replay|validator|fork|test)/.test(normalizedSteps);
  const hasConcreteReplaySequence =
    /(request sequence|transaction sequence|replay|broadcast|submit)/.test(normalizedSteps);

  return hasConcreteHarness || hasConcreteReplaySequence;
}

function buildEvidenceBundle(
  target: Target,
  severity: FindingSeverity,
  poc: AuditReport["poc"],
  signals: AnalyzerSignal[],
  whyFlagged: string[]
): EvidenceBundle {
  const traces: EvidenceTrace[] = signals.slice(0, 6).map((signal) => ({
    vulnerabilityClass: signal.vulnClass,
    severityHint: signal.severityHint,
    file: signal.file,
    line: signal.line,
    finding: signal.finding,
    confirmationHint: signal.confirmationHint,
    snippet: signal.snippet,
  }));

  const reproduction = buildReproductionGuide(target, severity, poc, signals);
  const proofLevel = hasSubstantialPocText(poc)
    ? "runnable_poc"
    : isReplayableGuide(reproduction, poc)
      ? "guided_replay"
      : traces.length > 0
        ? "code_path"
        : "context_only";

  const meetsSeverityBar =
    severityRank(severity) >= severityRank("high")
      ? proofLevel === "runnable_poc" || proofLevel === "guided_replay"
      : proofLevel !== "context_only";

  const artifacts: EvidenceArtifact[] = [];
  if (traces.length > 0) {
    artifacts.push({
      type: "static_analysis",
      label: `${traces.length} grounded signal${traces.length === 1 ? "" : "s"}`,
      description: whyFlagged[0] ?? "Static analysis produced grounded evidence for this finding.",
      location: `${traces[0].file}:${traces[0].line}`,
    });
  }
  if (poc?.text) {
    artifacts.push({
      type: "poc",
      label: `${poc.framework} reproduction artifact`,
      description: hasSubstantialPocText(poc)
        ? "PoC text is substantial enough to support replay-oriented validation."
        : "PoC text exists, but still needs expansion before it should be treated as strong proof.",
    });
  }

  const summary = traces.length > 0
    ? `${friendlyVulnerabilityClass(traces[0].vulnerabilityClass)} backed by ${traces.length} grounded trace${traces.length === 1 ? "" : "s"} and ${proofLevel.replace(/_/g, " ")} evidence.`
    : `Finding currently rests on ${proofLevel.replace(/_/g, " ")} evidence only.`;

  return {
    proofLevel,
    meetsSeverityBar,
    summary,
    traces,
    artifacts,
    reproduction,
  };
}

function defaultConfidenceForEvidence(evidence: EvidenceBundle): number {
  switch (evidence.proofLevel) {
    case "runnable_poc":
      return 0.78;
    case "guided_replay":
      return 0.64;
    case "code_path":
      return 0.48;
    default:
      return 0.3;
  }
}

function buildBaseTitle(target: Target, topSignal?: AnalyzerSignal): string {
  if (!topSignal) {
    return `Candidate security issue in ${target.displayName}`;
  }

  return `${friendlyVulnerabilityClass(topSignal.vulnClass)} in ${topSignal.file}:${topSignal.line}`;
}

function buildBaseDescription(topSignal?: AnalyzerSignal): string {
  if (!topSignal) {
    return "Automated review could not yet ground a concrete exploit path from the available context.";
  }

  return [
    `Static analysis flagged ${topSignal.file}:${topSignal.line} as suspicious.`,
    topSignal.finding,
    topSignal.confirmationHint,
  ].join(" ");
}

const MAX_CANDIDATE_FINDINGS = 5;

function selectCandidateSeeds(signals: AnalyzerSignal[]): AnalyzerSignal[] {
  const seeds: AnalyzerSignal[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    const key = `${signal.file}:${signal.line}:${signal.vulnClass}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push(signal);
    if (seeds.length >= MAX_CANDIDATE_FINDINGS) break;
  }

  return seeds;
}

function relatedSignalsForSeed(seed: AnalyzerSignal, signals: AnalyzerSignal[]): AnalyzerSignal[] {
  const sameFileAndClass = signals.filter(
    (signal) => signal.file === seed.file && signal.vulnClass === seed.vulnClass
  );
  if (sameFileAndClass.length > 0) return sameFileAndClass.slice(0, 6);

  const sameClass = signals.filter((signal) => signal.vulnClass === seed.vulnClass);
  if (sameClass.length > 0) return sameClass.slice(0, 6);

  return [seed];
}

function createPocForSeed(
  seed: AnalyzerSignal,
  pocFramework: PocFramework,
  solanaAnalysis?: SolanaAnalysisResult,
  evmAnalysis?: EvmAnalysisResult
): AuditReport["poc"] {
  if (solanaAnalysis) {
    return {
      framework: pocFramework,
      text: generateSolanaPoC(solanaAnalysis, seed.vulnClass as any),
    };
  }

  if (evmAnalysis) {
    return {
      framework: pocFramework,
      text: generateEvmPoC(evmAnalysis, seed.vulnClass as any),
    };
  }

  return {
    framework: pocFramework,
    text: `// PoC skeleton - framework: ${pocFramework}\n// TODO: implement against the target`,
  };
}

function buildCandidateFinding(
  target: Target,
  reportId: string,
  seed: AnalyzerSignal,
  signals: AnalyzerSignal[],
  poc: AuditReport["poc"]
): AuditFindingCandidate {
  const severity = seed.severityHint;
  const whyFlagged = buildWhyFlagged(signals);
  const evidence = buildEvidenceBundle(target, severity, poc, signals, whyFlagged);

  return {
    candidateId: `${reportId}_c_${simpleHash(`${seed.file}:${seed.line}:${seed.vulnClass}`)}`,
    title: buildBaseTitle(target, seed),
    severity,
    confidence: defaultConfidenceForEvidence(evidence),
    description: buildBaseDescription(seed),
    impact: buildImpact(seed),
    whyFlagged,
    affectedSurface: buildAffectedSurface(signals),
    recommendations: [
      "Confirm the issue is in-scope for the program (if applicable).",
      "Reproduce locally with the attached replay guidance or PoC.",
      "Add regression tests covering the affected code path.",
      "Apply the missing guard or invariant validation before publication.",
    ],
    evidence,
    poc,
  };
}

function reportFromPrimaryCandidate(
  reportId: string,
  targetId: string,
  primary: AuditFindingCandidate,
  candidates: AuditFindingCandidate[]
): AuditReport {
  return {
    reportId,
    targetId,
    title: primary.title,
    severity: primary.severity,
    confidence: primary.confidence,
    description: primary.description,
    impact: primary.impact,
    whyFlagged: primary.whyFlagged,
    affectedSurface: primary.affectedSurface,
    recommendations: primary.recommendations,
    evidence: primary.evidence,
    poc: primary.poc,
    candidateFindings: candidates,
  };
}

function proofRank(proofLevel: EvidenceBundle["proofLevel"]): number {
  switch (proofLevel) {
    case "runnable_poc":
      return 4;
    case "guided_replay":
      return 3;
    case "code_path":
      return 2;
    default:
      return 1;
  }
}

function candidateFingerprint(candidate: AuditFindingCandidate): string {
  const primaryTrace = candidate.evidence.traces[0];
  const normalizedTitle = candidate.title.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedSurface = (candidate.affectedSurface ?? [])
    .slice(0, 3)
    .map((value) => value.trim().toLowerCase())
    .join("|");

  return [
    primaryTrace?.vulnerabilityClass ?? "",
    primaryTrace?.file ?? "",
    primaryTrace?.line ?? "",
    normalizedSurface,
    normalizedTitle,
  ].join("::");
}

function rankCandidates(candidates: AuditFindingCandidate[]): AuditFindingCandidate[] {
  return [...candidates].sort((left, right) => {
    const severityDelta = severityRank(right.severity) - severityRank(left.severity);
    if (severityDelta !== 0) return severityDelta;

    const proofDelta =
      proofRank(right.evidence.proofLevel) - proofRank(left.evidence.proofLevel);
    if (proofDelta !== 0) return proofDelta;

    const confidenceDelta = right.confidence - left.confidence;
    if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;

    const traceDelta = right.evidence.traces.length - left.evidence.traces.length;
    if (traceDelta !== 0) return traceDelta;

    return left.title.localeCompare(right.title);
  });
}

function dedupeRankedCandidates(
  candidates: AuditFindingCandidate[]
): AuditFindingCandidate[] {
  const deduped: AuditFindingCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of rankCandidates(candidates)) {
    const fingerprint = candidateFingerprint(candidate);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    deduped.push(candidate);
    if (deduped.length >= MAX_CANDIDATE_FINDINGS) break;
  }

  return deduped;
}

function coerceAnalyzerSignalsFromCandidate(
  candidate: AuditFindingCandidate
): AnalyzerSignal[] {
  if (candidate.evidence.traces.length > 0) {
    return candidate.evidence.traces.map((trace) => ({
      vulnClass: trace.vulnerabilityClass,
      severityHint: trace.severityHint,
      file: trace.file,
      line: trace.line,
      snippet: trace.snippet ?? "",
      finding: trace.finding,
      confirmationHint: trace.confirmationHint,
    }));
  }

  return [
    {
      vulnClass: "candidate_finding",
      severityHint: candidate.severity,
      file: candidate.affectedSurface?.[0] ?? "unknown",
      line: 0,
      snippet: "",
      finding: candidate.whyFlagged[0] ?? candidate.description,
      confirmationHint: candidate.recommendations?.[0] ?? "Validate the affected path directly in code.",
    },
  ];
}

function normalizePoc(
  value: unknown,
  fallback: AuditFindingCandidate["poc"],
  pocFramework: PocFramework
): AuditFindingCandidate["poc"] {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const parsed = value as { framework?: unknown; text?: unknown };
  if (typeof parsed.text !== "string" || !parsed.text.trim()) {
    return fallback;
  }

  const framework = ["foundry", "hardhat", "anchor", "generic"].includes(
    String(parsed.framework)
  )
    ? (parsed.framework as PocFramework)
    : pocFramework;

  return {
    framework,
    text: parsed.text,
  };
}

function normalizeRecommendations(
  value: unknown,
  fallback?: string[]
): string[] | undefined {
  const normalized = Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : [];

  return normalized.length > 0 ? normalized : fallback;
}

function coerceParsedCandidates(parsed: unknown): Array<Record<string, unknown>> {
  if (!parsed || typeof parsed !== "object") return [];

  if (Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    return ((parsed as { candidates: unknown[] }).candidates)
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
      .slice(0, MAX_CANDIDATE_FINDINGS);
  }

  const legacy = parsed as Record<string, unknown>;
  if (
    typeof legacy.title === "string" ||
    typeof legacy.description === "string" ||
    typeof legacy.impact === "string"
  ) {
    return [legacy];
  }

  return [];
}

function mergeCandidateWithParsedResult(
  target: Target,
  baseCandidate: AuditFindingCandidate,
  parsedCandidate: Record<string, unknown> | undefined,
  pocFramework: PocFramework
): AuditFindingCandidate {
  if (!parsedCandidate) {
    return baseCandidate;
  }

  const severity = ["low", "medium", "high", "critical"].includes(
    String(parsedCandidate.severity)
  )
    ? (parsedCandidate.severity as FindingSeverity)
    : baseCandidate.severity;

  const whyFlagged = uniqueStrings(
    Array.isArray(parsedCandidate.whyFlagged)
      ? parsedCandidate.whyFlagged.map((reason) => String(reason))
      : baseCandidate.whyFlagged
  );
  const affectedSurface = uniqueStrings(
    Array.isArray(parsedCandidate.affectedSurface)
      ? parsedCandidate.affectedSurface.map((value) => String(value))
      : baseCandidate.affectedSurface ?? []
  );
  const poc = normalizePoc(parsedCandidate.poc, baseCandidate.poc, pocFramework);
  const evidenceSignals = coerceAnalyzerSignalsFromCandidate(baseCandidate);
  const evidence = buildEvidenceBundle(
    target,
    severity,
    poc,
    evidenceSignals,
    whyFlagged.length > 0 ? whyFlagged : baseCandidate.whyFlagged
  );

  return {
    ...baseCandidate,
    title:
      typeof parsedCandidate.title === "string" && parsedCandidate.title.trim()
        ? parsedCandidate.title
        : baseCandidate.title,
    severity,
    confidence: sanitizeConfidence(
      parsedCandidate.confidence,
      defaultConfidenceForEvidence(evidence)
    ),
    description:
      typeof parsedCandidate.description === "string" && parsedCandidate.description.trim()
        ? parsedCandidate.description
        : baseCandidate.description,
    impact:
      typeof parsedCandidate.impact === "string" && parsedCandidate.impact.trim()
        ? parsedCandidate.impact
        : baseCandidate.impact,
    whyFlagged: whyFlagged.length > 0 ? whyFlagged : baseCandidate.whyFlagged,
    affectedSurface:
      affectedSurface.length > 0 ? affectedSurface : baseCandidate.affectedSurface,
    recommendations: normalizeRecommendations(
      parsedCandidate.recommendations,
      baseCandidate.recommendations
    ),
    evidence,
    poc,
  };
}

function reviewThresholds(severity: FindingSeverity): {
  publish: number;
  humanReview: number;
} {
  return severityRank(severity) >= severityRank("high")
    ? { publish: 0.78, humanReview: 0.45 }
    : { publish: 0.55, humanReview: 0.35 };
}

function enforceReviewPolicy(
  report: AuditReport,
  verdict: ReviewerVerdict
): ReviewerVerdict {
  const thresholds = reviewThresholds(report.severity);
  const proofLabel = report.evidence.proofLevel.replace(/_/g, " ");
  const hasGroundedEvidence = report.evidence.proofLevel !== "context_only";

  if (!hasGroundedEvidence) {
    return {
      verdict: "discard",
      rationale: `${verdict.rationale} Reviewer policy discarded this finding because it never rose above context-only evidence.`.trim(),
      confidence: Math.min(verdict.confidence, 0.25),
    };
  }

  if (
    severityRank(report.severity) >= severityRank("high") &&
    !report.evidence.meetsSeverityBar
  ) {
    const heldForHuman =
      verdict.confidence >= thresholds.humanReview ? "needs_human_review" : "discard";
    const policyMessage = `Reviewer policy blocked auto-publication because ${report.severity} findings require replayable proof, but this report only has ${proofLabel} evidence.`;
    return {
      verdict: heldForHuman,
      rationale: `${verdict.rationale} ${policyMessage}`.trim(),
      confidence: heldForHuman === "discard" ? Math.min(verdict.confidence, 0.35) : verdict.confidence,
    };
  }

  if (verdict.verdict === "publish") {
    if (verdict.confidence >= thresholds.publish) {
      return verdict;
    }
    if (verdict.confidence >= thresholds.humanReview) {
      return {
        verdict: "needs_human_review",
        rationale: `${verdict.rationale} Reviewer policy held this out of the published gallery until a human validates the remaining uncertainty.`,
        confidence: verdict.confidence,
      };
    }
    return {
      verdict: "discard",
      rationale: `${verdict.rationale} Reviewer policy discarded this finding because review confidence never cleared the minimum threshold for human follow-up.`,
      confidence: Math.min(verdict.confidence, thresholds.humanReview - 0.01),
    };
  }

  if (verdict.verdict === "needs_human_review") {
    if (verdict.confidence >= thresholds.humanReview) {
      return verdict;
    }
    return {
      verdict: "discard",
      rationale: `${verdict.rationale} Reviewer policy discarded this finding because it remained too weak even for the human-review queue.`,
      confidence: Math.min(verdict.confidence, thresholds.humanReview - 0.01),
    };
  }

  if (verdict.confidence >= thresholds.humanReview) {
    return {
      verdict: "needs_human_review",
      rationale: `${verdict.rationale} Reviewer policy preserved this grounded finding for human review instead of discarding it outright.`,
      confidence: verdict.confidence,
    };
  }

  return verdict;
}

export async function runAudit(
  runtime: IAgentRuntime,
  opts: {
    target: Target;
    scopeContext?: unknown;
    ingestion?: IngestionResult;
  }
): Promise<AuditReport> {
  const { target, scopeContext, ingestion } = opts;
  const reportId = `r_${simpleHash(`${target.targetId}_${Date.now()}`)}`;
  const category = ingestion?.category ?? "unknown";
  const pocFramework = getPocFramework(category);
  const codeContext = ingestion
    ? buildCodeContext(ingestion)
    : "[No source code was ingested for this target.]";
  const hasCode = Boolean(ingestion && ingestion.sourceFiles.length > 0);

  let solanaAnalysis: SolanaAnalysisResult | undefined;
  let evmAnalysis: EvmAnalysisResult | undefined;
  let analysisContext = "";

  if (category === "solana_rust" && ingestion && hasCode) {
    solanaAnalysis = analyzeSolanaRust(ingestion.sourceFiles);
    analysisContext = formatSignalsForPrompt(solanaAnalysis);
    logger.info(
      `[Audit] Solana static analysis: ${solanaAnalysis.signals.length} signals ` +
        `(${solanaAnalysis.signals.filter((signal) => signal.severityHint === "critical").length} critical, ` +
        `${solanaAnalysis.signals.filter((signal) => signal.severityHint === "high").length} high)`
    );
  } else if (category === "solidity_evm" && ingestion && hasCode) {
    evmAnalysis = analyzeSolidityEvm(ingestion.sourceFiles);
    analysisContext = formatEvmSignalsForPrompt(evmAnalysis);
    logger.info(
      `[Audit] EVM static analysis: ${evmAnalysis.signals.length} signals ` +
        `(${evmAnalysis.signals.filter((signal) => signal.severityHint === "critical").length} critical, ` +
        `${evmAnalysis.signals.filter((signal) => signal.severityHint === "high").length} high)`
    );
  }

  const evidenceSignals = collectEvidenceSignals(solanaAnalysis, evmAnalysis);
  const topSignal = evidenceSignals[0];
  const candidateSeeds = selectCandidateSeeds(evidenceSignals);
  let baseCandidates: AuditFindingCandidate[] = [];

  if (candidateSeeds.length > 0) {
    baseCandidates = candidateSeeds.map((seed) =>
      buildCandidateFinding(
        target,
        reportId,
        seed,
        relatedSignalsForSeed(seed, evidenceSignals),
        createPocForSeed(seed, pocFramework, solanaAnalysis, evmAnalysis)
      )
    );
  }

  if (baseCandidates.length === 0) {
    const fallbackPoc: AuditReport["poc"] = {
      framework: pocFramework,
      text: `// PoC skeleton - framework: ${pocFramework}\n// TODO: implement against the target`,
    };
    const fallbackSeverity = topSignal?.severityHint ?? "medium";
    const fallbackWhyFlagged = buildWhyFlagged(evidenceSignals);
    const fallbackEvidence = buildEvidenceBundle(
      target,
      fallbackSeverity,
      fallbackPoc,
      evidenceSignals,
      fallbackWhyFlagged
    );
    baseCandidates = [
      {
        candidateId: `${reportId}_c_0`,
        title: buildBaseTitle(target, topSignal),
        severity: fallbackSeverity,
        confidence: defaultConfidenceForEvidence(fallbackEvidence),
        description: buildBaseDescription(topSignal),
        impact: buildImpact(topSignal),
        whyFlagged: fallbackWhyFlagged,
        affectedSurface: buildAffectedSurface(evidenceSignals),
        recommendations: [
          "Confirm the issue is in-scope for the program (if applicable).",
          "Reproduce locally with the attached replay guidance or PoC.",
          "Add regression tests covering the affected code path.",
          "Apply the missing guard or invariant validation before publication.",
        ],
        evidence: fallbackEvidence,
        poc: fallbackPoc,
      },
    ];
  }

  let base = reportFromPrimaryCandidate(
    reportId,
    target.targetId,
    baseCandidates[0],
    baseCandidates
  );

  try {
    const specialistPrompt = getSpecialistPrompt(category);
    const promptParts: string[] = [specialistPrompt, ""];

    if (analysisContext) {
      promptParts.push(
        "IMPORTANT: The following STATIC ANALYSIS has already been performed on the source code.",
        "These are GROUNDED evidence signals extracted by pattern analysis. USE THEM as the basis for your candidate findings.",
        "Preserve multiple plausible findings when the code supports them. Do NOT collapse everything into a single issue if distinct vulnerabilities exist.",
        "Do NOT ignore the static analysis to propose different, ungrounded hypotheses.",
        "",
        analysisContext,
        ""
      );
    }

    if (hasCode) {
      promptParts.push(
        "You also have the target's REAL source code below. Cross-reference the static analysis signals against the full code.",
        ""
      );
    } else {
      promptParts.push(
        "No source code is available. Propose a concrete vulnerability hypothesis based on the target type and metadata.",
        ""
      );
    }

    promptParts.push(
      `Produce up to ${MAX_CANDIDATE_FINDINGS} concrete vulnerability candidates ordered strongest-first.`,
      "Each candidate must include:",
      "- title: a specific, descriptive title referencing actual files/functions and the vulnerability class",
      "- severity: low | medium | high | critical",
      "- confidence: a number from 0.0 to 1.0 expressing the auditor's confidence",
      "- description: detailed explanation with the exact vulnerable code path and attack scenario",
      "- impact: what an attacker gains or what property breaks if this is exploited",
      "- whyFlagged: short grounded reasons tied to the evidence",
      "- affectedSurface: list of specific files, functions, accounts, or contracts affected",
      "- recommendations: specific, actionable remediation steps with code-level fixes",
      `- poc: { framework: '${pocFramework}', text: string } - a reproducible or replay-oriented proof artifact`,
      "",
      `Target: ${JSON.stringify({ targetId: target.targetId, type: target.type, displayName: target.displayName, url: target.url })}`,
      `Category: ${category}`
    );

    if (scopeContext) {
      promptParts.push(`ScopeContext: ${JSON.stringify(scopeContext)}`);
    }

    promptParts.push("", codeContext, "");
    promptParts.push(
      "Return STRICT JSON matching this TypeScript shape:",
      `{ candidates: Array<{ title: string, severity: 'low'|'medium'|'high'|'critical', confidence: number, description: string, impact: string, whyFlagged: string[], affectedSurface: string[], recommendations: string[], poc: { framework: '${pocFramework}', text: string } }> }`
    );

    const prompt = promptParts.filter(Boolean).join("\n");
    logger.info(
      `[Audit] Generating report for ${target.displayName} (category: ${category}, ` +
        `files: ${ingestion?.sourceFiles.length ?? 0}, prompt: ${Math.round(prompt.length / 1024)}KB)`
    );

    const result = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      maxTokens: 2200,
    });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const parsedCandidates = coerceParsedCandidates(parsed);

      if (parsedCandidates.length > 0) {
        const mergedCandidates = baseCandidates.map((candidate, index) =>
          mergeCandidateWithParsedResult(
            target,
            candidate,
            parsedCandidates[index],
            pocFramework
          )
        );
        const rankedCandidates = dedupeRankedCandidates(mergedCandidates);
        if (rankedCandidates.length > 0) {
          return reportFromPrimaryCandidate(
            reportId,
            target.targetId,
            rankedCandidates[0],
            rankedCandidates
          );
        }
      }
    }
  } catch (e) {
    logger.warn(`[Audit] LLM enrichment failed, falling back to base report: ${e}`);
  }

  return base;
}

export async function runReview(
  runtime: IAgentRuntime,
  opts: {
    target: Target;
    report: AuditReport;
    scopeContext?: unknown;
    ingestion?: IngestionResult;
  }
): Promise<ReviewerVerdict> {
  const { report, target, scopeContext, ingestion } = opts;
  const category = ingestion?.category ?? "unknown";
  const hasCode = Boolean(ingestion && ingestion.sourceFiles.length > 0);
  const fallback: ReviewerVerdict = {
    verdict: "needs_human_review",
    rationale:
      "No decisive counter-evidence was found in the provided context, but the finding should stay in the human-review queue until an operator confirms it.",
    confidence: 0.5,
  };

  const codeContext = ingestion
    ? buildCodeContext(ingestion)
    : "[No source code was available for independent review verification.]";

  let reviewAnalysisContext = "";
  if (category === "solana_rust" && ingestion && hasCode) {
    reviewAnalysisContext = formatSignalsForPrompt(analyzeSolanaRust(ingestion.sourceFiles));
  } else if (category === "solidity_evm" && ingestion && hasCode) {
    reviewAnalysisContext = formatEvmSignalsForPrompt(analyzeSolidityEvm(ingestion.sourceFiles));
  }

  try {
    const promptParts: string[] = [
      "You are an adversarial security reviewer whose job is to DISPROVE reported vulnerabilities.",
      "You should be STRICT for critical and high severity findings, and more tolerant for medium and low.",
      "You can return one of three dispositions:",
      "- publish: the finding is grounded and strong enough for the main gallery",
      "- needs_human_review: the finding is grounded enough to preserve, but too uncertain for auto-publication",
      "- discard: the finding is weak, contradicted, or not worth keeping",
      "",
    ];

    if (hasCode) {
      promptParts.push(
        "You have access to the actual source code. Verify the finding against the real code. Look for:"
      );
    } else {
      promptParts.push(
        "No source code is available. Evaluate the finding based on reasoning alone. Consider:"
      );
    }

    promptParts.push(
      "- Does the affected code path actually exist?",
      "- Are there existing protections the auditor missed?",
      "- Is the severity correctly assessed?",
      "- Could this be a false positive due to standard patterns?",
      "- Is the exploit path actually reachable?",
      ""
    );

    if (category === "solana_rust") {
      promptParts.push(
        "=== SOLANA-SPECIFIC FALSE POSITIVE CHECKS ===",
        "- Anchor typed #[account] fields already validate ownership; UncheckedAccount/AccountInfo do not.",
        "- init constraints prevent reinitialization when the PDA is already occupied.",
        "- Program<T> validates CPI program IDs; raw AccountInfo program handles do not.",
        "- find_program_address enforces canonical bumps; create_program_address does not.",
        "- has_one= and signer constraints may already close the path the auditor flagged.",
        ""
      );
    }

    if (category === "solidity_evm") {
      promptParts.push(
        "=== SOLIDITY/EVM-SPECIFIC FALSE POSITIVE CHECKS ===",
        "- Solidity >= 0.8 has built-in overflow checks outside unchecked{}.",
        "- ReentrancyGuard, SafeERC20, and Initializable materially change exploitability.",
        "- CEI-compliant state updates can neutralize apparent reentrancy signals.",
        "- Protected _authorizeUpgrade and initializer modifiers may invalidate upgrade findings.",
        ""
      );
    }

    promptParts.push(
      `Category: ${category}`,
      `Target: ${JSON.stringify({ targetId: target.targetId, type: target.type, displayName: target.displayName })}`,
      scopeContext ? `ScopeContext: ${JSON.stringify(scopeContext)}` : "",
      `Report: ${JSON.stringify(report)}`,
      ""
    );

    if (reviewAnalysisContext) {
      promptParts.push(
        "=== INDEPENDENT STATIC ANALYSIS (for cross-reference) ===",
        reviewAnalysisContext,
        ""
      );
    }

    promptParts.push(
      codeContext,
      "",
      "Return STRICT JSON: { verdict: 'publish'|'needs_human_review'|'discard', rationale: string, confidence: number }",
      "- confidence is 0.0 to 1.0 where 1.0 means the finding is certainly valid",
      "- For critical/high: only publish when replayable proof exists and confidence is very strong (> 0.78); otherwise prefer needs_human_review over publish",
      "- For medium/low: publish only when the code-path evidence is grounded and confidence is solid (> 0.55)",
      "- If the finding looks grounded but still uncertain, use needs_human_review instead of discard"
    );

    const prompt = promptParts.filter(Boolean).join("\n");
    logger.info(
      `[Review] Reviewing report for ${target.displayName} (severity: ${report.severity})`
    );

    const result = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      maxTokens: 900,
    });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const parsedVerdict =
        parsed.verdict === "discard"
          ? "discard"
          : parsed.verdict === "needs_human_review"
            ? "needs_human_review"
            : "publish";
      return enforceReviewPolicy(report, {
        verdict: parsedVerdict,
        rationale: String(parsed.rationale ?? fallback.rationale),
        confidence: sanitizeConfidence(parsed.confidence, fallback.confidence),
      });
    }
  } catch (e) {
    logger.warn(`[Review] LLM review failed, falling back to default verdict: ${e}`);
  }

  return enforceReviewPolicy(report, fallback);
}

// ---------------------------------------------------------------------------
// Run Audit — now with real code context
// ---------------------------------------------------------------------------

export async function runAuditLegacy(
  runtime: IAgentRuntime,
  opts: {
    target: Target;
    scopeContext?: unknown;
    ingestion?: IngestionResult;
  }
): Promise<AuditReport> {
  const { target, scopeContext, ingestion } = opts;
  const reportId = `r_${simpleHash(`${target.targetId}_${Date.now()}`)}`;
  const category = ingestion?.category ?? "unknown";
  const pocFramework = getPocFramework(category);
  const basePoc: AuditReport["poc"] = {
    framework: pocFramework,
    text: `// PoC skeleton - framework: ${pocFramework}\n// TODO: implement against the target`,
  };
  const baseEvidence = buildEvidenceBundle(target, "high", basePoc, [], [
    "Legacy compatibility path produced no grounded analyzer signal.",
  ]);

  // Base (fallback) report
  const base: AuditReport = {
    reportId,
    targetId: target.targetId,
    severity: "high",
    title: `Potential high-impact security issue in ${target.displayName}`,
    confidence: defaultConfidenceForEvidence(baseEvidence),
    description:
      "Automated review produced a candidate vulnerability. " +
      "This is a first-pass report and should be validated against the target's actual code paths and bounty scope.",
    impact:
      "This compatibility path does not yet establish grounded exploitability and should be replaced by the primary evidence-first audit flow.",
    whyFlagged: ["Legacy compatibility path produced no grounded analyzer signal."],
    affectedSurface: [],
    recommendations: [
      "Confirm the issue is in-scope for the program (if applicable).",
      "Reproduce locally with a minimal PoC.",
      "Add regression tests covering the exploit path.",
      "Apply standard mitigations.",
    ],
    evidence: baseEvidence,
    poc: {
      framework: pocFramework,
      text: `// PoC skeleton — framework: ${pocFramework}\n// TODO: implement against the target`,
    },
  };

  // Build context
  const codeContext = ingestion
    ? buildCodeContext(ingestion)
    : "[No source code was ingested for this target.]";

  const hasCode = ingestion && ingestion.sourceFiles.length > 0;

  // --- Run category-specific static analyzers ---
  let solanaAnalysis: SolanaAnalysisResult | undefined;
  let evmAnalysis: EvmAnalysisResult | undefined;
  let analysisContext = "";

  if (category === "solana_rust" && ingestion && hasCode) {
    solanaAnalysis = analyzeSolanaRust(ingestion.sourceFiles);
    analysisContext = formatSignalsForPrompt(solanaAnalysis);
    logger.info(
      `[Audit] Solana static analysis: ${solanaAnalysis.signals.length} signals ` +
        `(${solanaAnalysis.signals.filter((s) => s.severityHint === "critical").length} critical, ` +
        `${solanaAnalysis.signals.filter((s) => s.severityHint === "high").length} high)`
    );
  } else if (category === "solidity_evm" && ingestion && hasCode) {
    evmAnalysis = analyzeSolidityEvm(ingestion.sourceFiles);
    analysisContext = formatEvmSignalsForPrompt(evmAnalysis);
    logger.info(
      `[Audit] EVM static analysis: ${evmAnalysis.signals.length} signals ` +
        `(${evmAnalysis.signals.filter((s) => s.severityHint === "critical").length} critical, ` +
        `${evmAnalysis.signals.filter((s) => s.severityHint === "high").length} high)`
    );
  }

  // Generate a grounded PoC if we have analysis results
  let generatedPoC: string | null = null;
  if (solanaAnalysis && solanaAnalysis.signals.length > 0) {
    generatedPoC = generateSolanaPoC(solanaAnalysis);
  } else if (evmAnalysis && evmAnalysis.signals.length > 0) {
    generatedPoC = generateEvmPoC(evmAnalysis);
  }

  try {
    const specialistPrompt = getSpecialistPrompt(category);

    // Build prompt sections
    const promptParts: string[] = [
      specialistPrompt,
      "",
    ];

    // Static analysis evidence (highest priority context)
    if (analysisContext) {
      promptParts.push(
        "IMPORTANT: The following STATIC ANALYSIS has already been performed on the source code.",
        "These are GROUNDED evidence signals extracted by pattern analysis. USE THEM as the basis for your finding.",
        "Pick the MOST EXPLOITABLE signal and develop it into a complete, defensible vulnerability report.",
        "Do NOT ignore the static analysis to propose a different, ungrounded hypothesis.",
        "",
        analysisContext,
        ""
      );
    }

    if (hasCode) {
      promptParts.push(
        "You also have the target's REAL source code below. Cross-reference the static analysis signals against the full code.",
        ""
      );
    } else {
      promptParts.push(
        "No source code is available. Propose a concrete vulnerability hypothesis based on the target type and metadata.",
        ""
      );
    }

    promptParts.push(
      "Produce ONE concrete vulnerability finding with:",
      "- title: a specific, descriptive title referencing actual files/functions and the vulnerability class",
      "- severity: low | medium | high | critical",
      "- description: detailed explanation with:",
      "  * The exact vulnerable code path (file, function, line)",
      "  * Why this is exploitable (attack scenario)",
      "  * What an attacker gains (impact: fund loss, state corruption, privilege escalation)",
      "  * What conditions must be met for exploitation",
      "- affectedSurface: list of specific files, functions, and accounts affected",
      "- recommendations: specific, actionable remediation steps with code-level fixes",
      `- poc: { framework: '${pocFramework}', text: string } — a reproducible Anchor test harness`,
      "",
      `Target: ${JSON.stringify({ targetId: target.targetId, type: target.type, displayName: target.displayName, url: target.url })}`,
      `Category: ${category}`,
    );

    if (scopeContext) {
      promptParts.push(`ScopeContext: ${JSON.stringify(scopeContext)}`);
    }

    promptParts.push("", codeContext, "");

    promptParts.push(
      "Return STRICT JSON matching this TypeScript shape:",
      `{ title: string, severity: 'low'|'medium'|'high'|'critical', description: string, affectedSurface: string[], recommendations: string[], poc: { framework: '${pocFramework}', text: string } }`
    );

    const prompt = promptParts.filter(Boolean).join("\n");

    logger.info(
      `[Audit] Generating report for ${target.displayName} (category: ${category}, ` +
        `files: ${ingestion?.sourceFiles.length ?? 0}, prompt: ${Math.round(prompt.length / 1024)}KB)`
    );

    const result = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      maxTokens: 2000,
    });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));

      // Use the generated PoC if the LLM's PoC is generic/empty
      let poc = parsed.poc ?? base.poc;
      if (generatedPoC && (!poc?.text || poc.text.length < 50)) {
        poc = { framework: pocFramework, text: generatedPoC };
      }

      return {
        ...base,
        title: parsed.title ?? base.title,
        severity: parsed.severity ?? base.severity,
        description: parsed.description ?? base.description,
        affectedSurface: parsed.affectedSurface ?? base.affectedSurface,
        recommendations: parsed.recommendations ?? base.recommendations,
        poc,
      };
    }
  } catch (e) {
    logger.warn(`[Audit] LLM enrichment failed, falling back to base report: ${e}`);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Run Review — now with real code context
// ---------------------------------------------------------------------------

export async function runReviewLegacy(
  runtime: IAgentRuntime,
  opts: {
    target: Target;
    report: AuditReport;
    scopeContext?: unknown;
    ingestion?: IngestionResult;
  }
): Promise<ReviewerVerdict> {
  const { report, target, scopeContext, ingestion } = opts;
  const category = ingestion?.category ?? "unknown";
  const hasCode = ingestion && ingestion.sourceFiles.length > 0;

  const fallback: ReviewerVerdict = {
    verdict: "publish",
    rationale:
      "No counter-evidence found in the provided context; publish as a candidate finding pending reproduction.",
    confidence: 0.55,
  };

  const codeContext = ingestion
    ? buildCodeContext(ingestion)
    : "[No source code was available for independent review verification.]";

  // Run static analysis for the reviewer too (independent verification)
  let reviewAnalysisContext = "";
  if (category === "solana_rust" && ingestion && hasCode) {
    const reviewAnalysis = analyzeSolanaRust(ingestion.sourceFiles);
    reviewAnalysisContext = formatSignalsForPrompt(reviewAnalysis);
  } else if (category === "solidity_evm" && ingestion && hasCode) {
    const reviewAnalysis = analyzeSolidityEvm(ingestion.sourceFiles);
    reviewAnalysisContext = formatEvmSignalsForPrompt(reviewAnalysis);
  }

  try {
    const promptParts: string[] = [
      "You are an adversarial security reviewer whose job is to DISPROVE reported vulnerabilities.",
      "You should be STRICT for critical and high severity findings, and more tolerant for medium and low.",
      "",
    ];

    if (hasCode) {
      promptParts.push(
        "You have access to the actual source code. Verify the finding against the real code. Look for:"
      );
    } else {
      promptParts.push(
        "No source code is available. Evaluate the finding based on reasoning alone. Consider:"
      );
    }

    promptParts.push(
      "- Does the affected code path actually exist?",
      "- Are there existing protections the auditor missed?",
      "- Is the severity correctly assessed?",
      "- Could this be a false positive due to standard patterns?",
      "- Is the exploit path actually reachable?",
    );

    // Solana-specific review checks
    if (category === "solana_rust") {
      promptParts.push(
        "",
        "=== SOLANA-SPECIFIC FALSE POSITIVE CHECKS ===",
        "Before publishing, verify these Solana/Anchor-specific patterns:",
        "- Anchor automatically validates account ownership for #[account] typed accounts — only UncheckedAccount/AccountInfo need manual checks",
        "- Anchor's init constraint already prevents reinitialization (the PDA is derived deterministically)",
        "- #[account(mut, signer)] is equivalent to checking is_signer in native Solana",
        "- PDAs that use find_program_address always find the canonical bump — only create_program_address is vulnerable to non-canonical bumps",
        "- Anchor's Program<T> type automatically validates the program ID — CPI through Program<T> is safe",
        "- has_one= validates that the account field matches the expected value from the target account struct",
        "- Rust's debug builds DO panic on overflow; only release builds wrap. Check if [profile.release] overflow-checks = true in Cargo.toml",
        "- init_if_needed is different from init: it IS safe against reinitialization (it's a no-op if already initialized)",
      );
    }

    // Solidity/EVM-specific review checks
    if (category === "solidity_evm") {
      promptParts.push(
        "",
        "=== SOLIDITY/EVM-SPECIFIC FALSE POSITIVE CHECKS ===",
        "Before publishing, verify these EVM-specific patterns:",
        "- Solidity >= 0.8 has built-in overflow/underflow checks — unchecked{} blocks are the exception, not the rule",
        "- OpenZeppelin's ReentrancyGuard (nonReentrant modifier) prevents reentrancy — check if it's applied",
        "- SafeERC20 wraps .transfer()/.transferFrom()/.approve() with return-value checks — if used, token handling is safe",
        "- OpenZeppelin's Initializable contract prevents re-initialization when 'initializer' modifier is used",
        "- UUPS proxies with _authorizeUpgrade protected by onlyOwner are safe — check the modifier",
        "- Chainlink's latestRoundData returns (roundId, answer, startedAt, updatedAt, answeredInRound) — check which are validated",
        "- CEI pattern compliance: state updates before external calls prevent reentrancy even without nonReentrant",
        "- view/pure functions cannot modify state — they cannot be direct reentrancy entry points (but can return stale data)",
        "- Modifier ordering matters in Solidity — earlier modifiers run first",
        "- Private functions are only 'private' to the contract — not hidden from the blockchain (data is public)",
      );
    }

    promptParts.push(
      "",
      `Category: ${category}`,
      `Target: ${JSON.stringify({ targetId: target.targetId, type: target.type, displayName: target.displayName })}`,
    );

    if (scopeContext) {
      promptParts.push(`ScopeContext: ${JSON.stringify(scopeContext)}`);
    }

    promptParts.push(
      `Report: ${JSON.stringify(report)}`,
      "",
    );

    // Include static analysis for independent cross-reference
    if (reviewAnalysisContext) {
      promptParts.push(
        "=== INDEPENDENT STATIC ANALYSIS (for cross-reference) ===",
        reviewAnalysisContext,
        "",
      );
    }

    promptParts.push(codeContext, "");

    promptParts.push(
      "Return STRICT JSON: { verdict: 'publish'|'discard', rationale: string, confidence: number }",
      "- confidence is 0.0 to 1.0 where 1.0 means the finding is certainly valid",
      "- For critical/high: require strong evidence to publish (confidence > 0.7)",
      "- For medium/low: acceptable to publish with clear uncertainty labeling (confidence > 0.4)",
    );

    const prompt = promptParts.filter(Boolean).join("\n");

    logger.info(
      `[Review] Reviewing report for ${target.displayName} (severity: ${report.severity})`
    );

    const result = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      maxTokens: 800,
    });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");

    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      const verdict = parsed.verdict === "discard" ? "discard" : "publish";
      const confidence =
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : fallback.confidence;
      return {
        verdict,
        rationale: String(parsed.rationale ?? fallback.rationale),
        confidence,
      };
    }
  } catch (e) {
    logger.warn(`[Review] LLM review failed, falling back to default verdict: ${e}`);
  }

  return fallback;
}
