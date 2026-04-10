import type { IAgentRuntime } from "@elizaos/core";
import { logger, ModelType } from "@elizaos/core";
import type {
  AuditFindingCandidate,
  AuditReport,
  EvidenceArtifact,
  EvidenceBundle,
  EvidenceTrace,
  FindingOrigin,
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
import { generateSolanaPoC } from "../analyzers/solana-guided-poc.js";
import { analyzeSolidityEvm, formatEvmSignalsForPrompt } from "../analyzers/evm.js";
import type { EvmAnalysisResult } from "../analyzers/evm.js";
import { generateEvmPoC } from "../analyzers/evm-guided-poc.js";
import { simpleHash } from "./utils.js";

// ---------------------------------------------------------------------------
// Target creation from user input
// ---------------------------------------------------------------------------

function normalizeGithubUrl(input: string): string {
  const trimmed = input.trim();
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("github.com/")) return `https://${trimmed}`;
  return trimmed;
}

export function targetFromInput(input: string): Target {
  const raw = input.trim();

  // GitHub URL
  const isGithub =
    raw.includes("github.com/") ||
    raw.startsWith("https://github.com/") ||
    raw.startsWith("http://github.com/") ||
    /^[\w.-]+\/[\w.-]+$/.test(raw);
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

function buildSourceFileContext(
  files: SourceFile[],
  label = "SOURCE FILES"
): string {
  if (files.length === 0) {
    return "[No source files were extracted from the target.]";
  }

  const sections: string[] = [`=== ${label} (${files.length}) ===`];
  for (const file of files) {
    sections.push(
      `\n--- FILE: ${file.relativePath} (${file.language}, ${file.originalSize} bytes${
        file.truncated ? ", truncated" : ""
      }) ---`
    );
    sections.push(file.content);
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

type ExploratoryLead = {
  neighborhoodId: string;
  label: string;
  severityHint: FindingSeverity;
  vulnerabilityClass: string;
  rationale: string;
  affectedFiles: string[];
};

type CounterEvidenceAssessment = {
  counterEvidence: string[];
  survivingRisks: string[];
  protections: string[];
  reachability: "blocked" | "uncertain" | "reachable";
  confidence: number;
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
  return Boolean(poc?.text && poc.text.trim().length >= 120);
}

function normalizedPocText(poc?: AuditReport["poc"]): string {
  return poc?.text?.trim().toLowerCase() ?? "";
}

function looksLikeTemplatePoc(poc?: AuditReport["poc"]): boolean {
  const text = normalizedPocText(poc);
  if (!text) return false;

  return (
    /(^|\W)todo(\W|$)/.test(text) ||
    text.includes("poc skeleton") ||
    text.includes("implement against target") ||
    text.includes("replace with actual") ||
    text.includes("adapt the instruction") ||
    text.includes("adapt the target") ||
    text.includes("import the target contract") ||
    text.includes("import the target program") ||
    text.includes("declare target contract") ||
    text.includes("declare target program") ||
    text.includes("mocked multi-candidate response")
  );
}

function hasVerificationMarker(
  poc: AuditReport["poc"],
  marker: "validated_replay" | "executed_poc"
): boolean {
  return normalizedPocText(poc).includes(`[evidence:${marker}]`);
}

function hasConcreteReplayArtifact(poc?: AuditReport["poc"]): boolean {
  return hasSubstantialPocText(poc) && !looksLikeTemplatePoc(poc);
}

function buildReproductionGuide(
  target: Target,
  severity: FindingSeverity,
  poc: AuditReport["poc"],
  signals: AnalyzerSignal[]
): EvidenceBundle["reproduction"] {
  const topSignal = signals[0];

  if (hasConcreteReplayArtifact(poc) && poc) {
    return {
      available: true,
      framework: poc.framework !== "generic" ? poc.framework : undefined,
      steps: [
        `Materialize ${target.displayName} locally or on a disposable fork/test validator.`,
        `Run the draft replay artifact and drive execution through ${topSignal ? `${topSignal.file}:${topSignal.line}` : "the flagged code path"}.`,
        `Confirm the unauthorized state change or value extraction described in the report.`,
      ],
      notes: "The included artifact looks replay-oriented, but it has not been validated or executed against the exact target revision yet.",
    };
  }

  if (looksLikeTemplatePoc(poc) && poc?.text) {
    return {
      available: true,
      framework: poc.framework !== "generic" ? poc.framework : undefined,
      steps: [
        `Replace the TODO placeholders in the draft ${poc.framework} harness with real imports, addresses, accounts, and function names from ${target.displayName}.`,
        `Bind the harness to ${topSignal ? `${topSignal.file}:${topSignal.line}` : "the flagged code path"} and run it locally.`,
        "Convert the draft harness into a validated replay before treating it as publishable proof.",
      ],
      notes: "A target-adaptation template exists, but it is still a draft rather than validated exploit evidence.",
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
  if (!reproduction.available || reproduction.steps.length === 0 || looksLikeTemplatePoc(poc)) {
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
  const hasGroundedCodePath = traces.length > 0;
  const proofLevel = hasVerificationMarker(poc, "executed_poc")
    ? "executed_poc"
    : hasVerificationMarker(poc, "validated_replay")
      ? "validated_replay"
      : hasConcreteReplayArtifact(poc) || isReplayableGuide(reproduction, poc)
        ? "guided_replay"
        : looksLikeTemplatePoc(poc)
          ? "template_only"
          : hasGroundedCodePath
            ? "code_path"
            : "context_only";

  const meetsSeverityBar =
    severityRank(severity) >= severityRank("high")
      ? proofLevel === "validated_replay" || proofLevel === "executed_poc"
      : hasGroundedCodePath ||
        proofLevel === "guided_replay" ||
        proofLevel === "validated_replay" ||
        proofLevel === "executed_poc";

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
      description:
        proofLevel === "executed_poc"
          ? "The artifact is marked as executed proof."
          : proofLevel === "validated_replay"
            ? "The artifact is marked as a validated replay."
            : proofLevel === "guided_replay"
              ? "The artifact looks replay-oriented, but it is still unvalidated guidance."
              : proofLevel === "template_only"
                ? "The artifact is a draft template with placeholders and must not be treated as validated proof."
                : "A PoC artifact exists, but it is not strong enough to upgrade the finding beyond code-path evidence.",
    });
  }

  const summary = hasGroundedCodePath
    ? `${friendlyVulnerabilityClass(traces[0].vulnerabilityClass)} backed by ${traces.length} grounded trace${traces.length === 1 ? "" : "s"} with ${proofLevel.replace(/_/g, " ")} proof state.`
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
    case "executed_poc":
      return 0.86;
    case "validated_replay":
      return 0.74;
    case "guided_replay":
      return 0.6;
    case "template_only":
      return 0.38;
    case "code_path":
      return 0.48;
    default:
      return 0.25;
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
const MAX_EXPLORATORY_LEADS = 3;

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

function exploratorySeverityFromPriority(priority: number): FindingSeverity {
  if (priority >= 94) return "high";
  if (priority >= 84) return "medium";
  return "low";
}

function exploratoryVulnerabilityClassForNeighborhood(
  category: TargetCategory,
  neighborhood: IngestionResult["neighborhoods"][number]
): string {
  const topHotspot = neighborhood.hotspots[0];
  switch (topHotspot?.kind) {
    case "oracle":
      return category === "solidity_evm" ? "oracle_price" : "oracle_accounting";
    case "auth":
      return category === "solidity_evm" ? "access_control" : "signer_authority";
    case "cpi":
      return "cpi_escalation";
    case "pda":
      return "pda_misuse";
    case "account_validation":
      return category === "solidity_evm" ? "access_control" : "ownership_validation";
    case "upgradeability":
      return "upgradeability";
    case "external_call":
      return category === "solidity_evm" ? "unsafe_external" : "cpi_escalation";
    case "value_flow":
      return category === "solidity_evm" ? "accounting_invariant" : "oracle_accounting";
    default:
      return category === "solidity_evm" ? "accounting_invariant" : "signer_authority";
  }
}

function findNeighborhoodIdsForFiles(
  ingestion: IngestionResult | undefined,
  files: string[]
): string[] {
  if (!ingestion || files.length === 0) return [];

  const fileSet = new Set(files.filter(Boolean));
  return ingestion.neighborhoods
    .filter((neighborhood) =>
      neighborhood.files.some((file) => fileSet.has(file)) ||
      neighborhood.seedFiles.some((file) => fileSet.has(file))
    )
    .map((neighborhood) => neighborhood.id);
}

function variantKindForPath(path: string): "safe" | "risky" | "neutral" {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => variantSegmentKind(segment))
    .find((value) => value !== "neutral") ?? "neutral";
}

function pathsAreOppositeVariants(left: string, right: string): boolean {
  const leftKind = variantKindForPath(left);
  const rightKind = variantKindForPath(right);
  if (leftKind === "neutral" || rightKind === "neutral" || leftKind === rightKind) {
    return false;
  }

  return normalizeVariantPath(left) === normalizeVariantPath(right);
}

function relatedSignalsForSeed(seed: AnalyzerSignal, signals: AnalyzerSignal[]): AnalyzerSignal[] {
  const sameFileAndClass = signals.filter(
    (signal) => signal.file === seed.file && signal.vulnClass === seed.vulnClass
  );
  if (sameFileAndClass.length > 0) return sameFileAndClass.slice(0, 6);

  const sameClass = signals.filter(
    (signal) =>
      signal.vulnClass === seed.vulnClass &&
      !pathsAreOppositeVariants(seed.file, signal.file)
  );
  if (sameClass.length > 0) return sameClass.slice(0, 6);

  return [seed];
}

function createPocForSeed(
  target: Target,
  seed: AnalyzerSignal,
  pocFramework: PocFramework,
  ingestion?: IngestionResult,
  solanaAnalysis?: SolanaAnalysisResult,
  evmAnalysis?: EvmAnalysisResult
): AuditReport["poc"] {
  if (solanaAnalysis) {
    return {
      framework: pocFramework,
      text: generateSolanaPoC(solanaAnalysis, seed.vulnClass as any, {
        targetName: target.displayName,
        seed: seed as any,
        repoIndex: ingestion?.repoIndex,
        neighborhoods: ingestion?.neighborhoods,
        sourceFiles: ingestion?.sourceFiles,
      }),
    };
  }

  if (evmAnalysis) {
    return {
      framework: pocFramework,
      text: generateEvmPoC(evmAnalysis, seed.vulnClass as any, {
        targetName: target.displayName,
        seed: seed as any,
        repoIndex: ingestion?.repoIndex,
        neighborhoods: ingestion?.neighborhoods,
        sourceFiles: ingestion?.sourceFiles,
      }),
    };
  }

  return {
    framework: pocFramework,
    text: `// PoC skeleton - framework: ${pocFramework}\n// TODO: implement against the target`,
  };
}

async function runExploratoryNeighborhoodPass(
  runtime: IAgentRuntime,
  target: Target,
  category: TargetCategory,
  ingestion?: IngestionResult
): Promise<ExploratoryLead[]> {
  if (!ingestion || ingestion.neighborhoods.length === 0) {
    return [];
  }

  const neighborhoodSummaries = ingestion.neighborhoods
    .slice(0, 12)
    .map((neighborhood) =>
      [
        `NeighborhoodId: ${neighborhood.id}`,
        `Label: ${neighborhood.label}`,
        `Root: ${neighborhood.root}`,
        `Reason: ${neighborhood.reason}`,
        `Seed files: ${neighborhood.seedFiles.slice(0, 4).join(", ") || "none"}`,
        `Files: ${neighborhood.files.slice(0, 6).join(", ") || "none"}`,
        neighborhood.hotspots.length > 0
          ? `Hotspots: ${neighborhood.hotspots
              .slice(0, 4)
              .map(
                (hotspot) =>
                  `${hotspot.kind} ${hotspot.file}:${hotspot.line} (${hotspot.reason})`
              )
              .join(" | ")}`
          : "Hotspots: none",
      ].join("\n")
    )
    .join("\n\n");

  const prompt = [
    "You are a security reconnaissance planner for blockchain code audits.",
    "Your job is NOT to write final findings yet.",
    "Based only on the repo index and neighborhood summaries, nominate suspicious neighborhoods that deserve deeper auditing even if deterministic analyzers were silent.",
    "Prefer neighborhoods involving auth boundaries, value flow, oracles, upgradeability, external calls, CPI, PDA handling, or account validation.",
    `Return up to ${MAX_EXPLORATORY_LEADS} exploratory leads.`,
    "",
    `Target: ${JSON.stringify({ targetId: target.targetId, displayName: target.displayName, type: target.type })}`,
    `Category: ${category}`,
    "",
    ingestion.repoIndex.summary,
    "",
    "=== CANDIDATE NEIGHBORHOODS ===",
    neighborhoodSummaries,
    "",
    "Return STRICT JSON:",
    `{ leads: Array<{ neighborhoodId: string, label: string, severityHint: 'low'|'medium'|'high'|'critical', vulnerabilityClass: string, rationale: string, affectedFiles: string[] }> }`,
  ].join("\n");

  try {
    const result = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt,
      maxTokens: 900,
    });
    const text = typeof result === "string" ? result : result?.text ?? "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      return [];
    }

    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
      leads?: Array<Record<string, unknown>>;
    };

    if (!Array.isArray(parsed.leads)) {
      return [];
    }

    const neighborhoodMap = new Map(
      ingestion.neighborhoods.map((neighborhood) => [neighborhood.id, neighborhood] as const)
    );

    const leads: ExploratoryLead[] = [];
    for (const rawLead of parsed.leads.slice(0, MAX_EXPLORATORY_LEADS)) {
      const neighborhoodId = typeof rawLead.neighborhoodId === "string" ? rawLead.neighborhoodId : "";
      const neighborhood = neighborhoodMap.get(neighborhoodId);
      if (!neighborhood) continue;

      const severityHint = ["low", "medium", "high", "critical"].includes(
        String(rawLead.severityHint)
      )
        ? (rawLead.severityHint as FindingSeverity)
        : exploratorySeverityFromPriority(neighborhood.hotspots[0]?.priority ?? 80);
      const vulnerabilityClass =
        typeof rawLead.vulnerabilityClass === "string" && rawLead.vulnerabilityClass.trim()
          ? rawLead.vulnerabilityClass.trim()
          : exploratoryVulnerabilityClassForNeighborhood(category, neighborhood);
      const affectedFiles = uniqueStrings(
        Array.isArray(rawLead.affectedFiles)
          ? rawLead.affectedFiles.map((value) => String(value))
          : neighborhood.files.slice(0, 4)
      );

      leads.push({
        neighborhoodId,
        label:
          typeof rawLead.label === "string" && rawLead.label.trim()
            ? rawLead.label.trim()
            : neighborhood.label,
        severityHint,
        vulnerabilityClass,
        rationale:
          typeof rawLead.rationale === "string" && rawLead.rationale.trim()
            ? rawLead.rationale.trim()
            : neighborhood.reason,
        affectedFiles: affectedFiles.length > 0 ? affectedFiles : neighborhood.files.slice(0, 4),
      });
    }

    return leads;
  } catch (error) {
    logger.warn(`[Audit] Exploratory neighborhood pass failed: ${error}`);
    return [];
  }
}

function exploratorySignalFromLead(
  category: TargetCategory,
  ingestion: IngestionResult,
  lead: ExploratoryLead
): AnalyzerSignal {
  const neighborhood = ingestion.neighborhoods.find(
    (candidate) => candidate.id === lead.neighborhoodId
  );
  const topHotspot = neighborhood?.hotspots[0];
  const file = topHotspot?.file ?? lead.affectedFiles[0] ?? neighborhood?.root ?? "unknown";
  const line = topHotspot?.line ?? 1;
  const vulnerabilityClass =
    lead.vulnerabilityClass || exploratoryVulnerabilityClassForNeighborhood(category, neighborhood!);

  return {
    vulnClass: vulnerabilityClass,
    severityHint: lead.severityHint,
    file,
    line,
    snippet: "",
    finding: lead.rationale,
    confirmationHint: `Inspect neighborhood ${lead.label} (${lead.neighborhoodId}) and confirm whether the suspicious subsystem forms a reachable exploit path.`,
  };
}

function mergeFindingOrigin(
  left: FindingOrigin,
  right: FindingOrigin
): FindingOrigin {
  if (left === right) return left;
  if (left === "analyzer+exploration" || right === "analyzer+exploration") {
    return "analyzer+exploration";
  }
  return "analyzer+exploration";
}

function uniqueArtifacts(artifacts: EvidenceArtifact[]): EvidenceArtifact[] {
  const seen = new Set<string>();
  const merged: EvidenceArtifact[] = [];
  for (const artifact of artifacts) {
    const key = `${artifact.type}:${artifact.label}:${artifact.location ?? ""}:${artifact.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(artifact);
  }
  return merged;
}

function uniqueTraces(traces: EvidenceTrace[]): EvidenceTrace[] {
  const seen = new Set<string>();
  const merged: EvidenceTrace[] = [];
  for (const trace of traces) {
    const key = `${trace.vulnerabilityClass}:${trace.file}:${trace.line}:${trace.finding}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(trace);
  }
  return merged;
}

function buildCandidateFinding(
  target: Target,
  reportId: string,
  seed: AnalyzerSignal,
  signals: AnalyzerSignal[],
  poc: AuditReport["poc"],
  options?: {
    origin?: FindingOrigin;
    originNotes?: string[];
    neighborhoodIds?: string[];
    extraArtifacts?: EvidenceArtifact[];
  }
): AuditFindingCandidate {
  const severity = seed.severityHint;
  const whyFlagged = buildWhyFlagged(signals);
  const evidence = buildEvidenceBundle(target, severity, poc, signals, whyFlagged);
  if (options?.extraArtifacts?.length) {
    evidence.artifacts = uniqueArtifacts([...evidence.artifacts, ...options.extraArtifacts]);
  }

  return {
    candidateId: `${reportId}_c_${simpleHash(`${seed.file}:${seed.line}:${seed.vulnClass}`)}`,
    origin: options?.origin ?? "analyzer",
    title: buildBaseTitle(target, seed),
    severity,
    confidence: defaultConfidenceForEvidence(evidence),
    description: buildBaseDescription(seed),
    impact: buildImpact(seed),
    whyFlagged,
    originNotes: options?.originNotes,
    neighborhoodIds: options?.neighborhoodIds,
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

function mergeDuplicateCandidates(
  preferred: AuditFindingCandidate,
  duplicate: AuditFindingCandidate
): AuditFindingCandidate {
  const mergedOriginNotes = uniqueStrings([
    ...(preferred.originNotes ?? []),
    ...(duplicate.originNotes ?? []),
  ]);
  const mergedNeighborhoodIds = uniqueStrings([
    ...(preferred.neighborhoodIds ?? []),
    ...(duplicate.neighborhoodIds ?? []),
  ]);
  const mergedWhyFlagged = uniqueStrings([
    ...preferred.whyFlagged,
    ...duplicate.whyFlagged,
  ]);
  const mergedAffectedSurface = uniqueStrings([
    ...(preferred.affectedSurface ?? []),
    ...(duplicate.affectedSurface ?? []),
  ]);
  const mergedRecommendations = uniqueStrings([
    ...(preferred.recommendations ?? []),
    ...(duplicate.recommendations ?? []),
  ]);
  const mergedArtifacts = uniqueArtifacts([
    ...preferred.evidence.artifacts,
    ...duplicate.evidence.artifacts,
  ]);
  const mergedTraces = uniqueTraces([
    ...preferred.evidence.traces,
    ...duplicate.evidence.traces,
  ]);

  return {
    ...preferred,
    origin: mergeFindingOrigin(preferred.origin, duplicate.origin),
    originNotes: mergedOriginNotes.length > 0 ? mergedOriginNotes : undefined,
    neighborhoodIds: mergedNeighborhoodIds.length > 0 ? mergedNeighborhoodIds : undefined,
    whyFlagged: mergedWhyFlagged,
    affectedSurface: mergedAffectedSurface.length > 0 ? mergedAffectedSurface : undefined,
    recommendations: mergedRecommendations.length > 0 ? mergedRecommendations : undefined,
    evidence: {
      ...preferred.evidence,
      artifacts: mergedArtifacts,
      traces: mergedTraces,
    },
  };
}

function findingCountsFromCandidates(
  candidates: AuditFindingCandidate[]
): AuditReport["findingCounts"] {
  const counts = {
    total: candidates.length,
    published: 0,
    needsHumanReview: 0,
    discarded: 0,
  };

  for (const candidate of candidates) {
    if (candidate.review?.verdict === "publish") {
      counts.published += 1;
    } else if (candidate.review?.verdict === "needs_human_review") {
      counts.needsHumanReview += 1;
    } else if (candidate.review?.verdict === "discard") {
      counts.discarded += 1;
    }
  }

  return counts;
}

function candidateReviewRank(candidate: AuditFindingCandidate): number {
  switch (candidate.review?.verdict) {
    case "publish":
      return 3;
    case "needs_human_review":
      return 2;
    case "discard":
      return 1;
    default:
      return 0;
  }
}

function compareCandidatePriority(
  left: AuditFindingCandidate,
  right: AuditFindingCandidate,
  ingestion?: IngestionResult
): number {
  const severityDelta = severityRank(right.severity) - severityRank(left.severity);
  if (severityDelta !== 0) return severityDelta;

  const proofDelta =
    proofRank(right.evidence.proofLevel) - proofRank(left.evidence.proofLevel);
  if (proofDelta !== 0) return proofDelta;

  const variantDelta =
    candidateVariantBias(right, ingestion) - candidateVariantBias(left, ingestion);
  if (variantDelta !== 0) return variantDelta;

  const confidenceDelta = right.confidence - left.confidence;
  if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;

  const traceDelta = right.evidence.traces.length - left.evidence.traces.length;
  if (traceDelta !== 0) return traceDelta;

  return left.title.localeCompare(right.title);
}

function rankCandidates(
  candidates: AuditFindingCandidate[],
  ingestion?: IngestionResult
): AuditFindingCandidate[] {
  return [...candidates].sort((left, right) =>
    compareCandidatePriority(left, right, ingestion)
  );
}

function rankReviewedCandidates(
  candidates: AuditFindingCandidate[],
  ingestion?: IngestionResult
): AuditFindingCandidate[] {
  return [...candidates].sort((left, right) => {
    const reviewDelta = candidateReviewRank(right) - candidateReviewRank(left);
    if (reviewDelta !== 0) return reviewDelta;
    return compareCandidatePriority(left, right, ingestion);
  });
}

function reportFromLeadCandidate(
  reportId: string,
  targetId: string,
  candidates: AuditFindingCandidate[],
  ingestion?: IngestionResult
): AuditReport {
  const orderedCandidates =
    candidates.some((candidate) => candidate.review) &&
    candidates.some((candidate) => candidate.review?.verdict)
      ? rankReviewedCandidates(candidates, ingestion)
      : rankCandidates(candidates, ingestion);
  const lead = orderedCandidates[0];

  return {
    reportId,
    targetId,
    title: lead.title,
    severity: lead.severity,
    confidence: lead.confidence,
    description: lead.description,
    impact: lead.impact,
    whyFlagged: lead.whyFlagged,
    affectedSurface: lead.affectedSurface,
    recommendations: lead.recommendations,
    evidence: lead.evidence,
    poc: lead.poc,
    leadCandidateId: lead.candidateId,
    candidateFindings: orderedCandidates,
    findingCounts: findingCountsFromCandidates(orderedCandidates),
  };
}

function reportFromSingleCandidate(
  reportId: string,
  targetId: string,
  candidate: AuditFindingCandidate
): AuditReport {
  return reportFromLeadCandidate(reportId, targetId, [candidate]);
}

function proofRank(proofLevel: EvidenceBundle["proofLevel"]): number {
  switch (proofLevel) {
    case "executed_poc":
      return 6;
    case "validated_replay":
      return 5;
    case "guided_replay":
      return 4;
    case "code_path":
      return 3;
    case "template_only":
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

function candidatesShareNeighborhood(
  left: AuditFindingCandidate,
  right: AuditFindingCandidate
): boolean {
  const leftIds = new Set(left.neighborhoodIds ?? []);
  return (right.neighborhoodIds ?? []).some((id) => leftIds.has(id));
}

function primaryVulnerabilityClass(
  candidate: AuditFindingCandidate
): string | undefined {
  return candidate.evidence.traces[0]?.vulnerabilityClass;
}

function candidatesRepresentOppositeVariants(
  left: AuditFindingCandidate,
  right: AuditFindingCandidate
): boolean {
  const leftFiles = candidatePrimaryFiles(left);
  const rightFiles = candidatePrimaryFiles(right);

  return leftFiles.some((leftFile) =>
    rightFiles.some((rightFile) => pathsAreOppositeVariants(leftFile, rightFile))
  );
}

function candidatesShouldMerge(
  left: AuditFindingCandidate,
  right: AuditFindingCandidate
): boolean {
  if (candidatesRepresentOppositeVariants(left, right)) {
    return false;
  }

  if (candidateFingerprint(left) === candidateFingerprint(right)) {
    return true;
  }

  const leftClass = primaryVulnerabilityClass(left);
  const rightClass = primaryVulnerabilityClass(right);
  return Boolean(
    leftClass &&
      rightClass &&
      leftClass === rightClass &&
      candidatesShareNeighborhood(left, right)
  );
}

function candidatePrimaryFiles(candidate: AuditFindingCandidate): string[] {
  return uniqueStrings([
    ...candidate.evidence.traces.map((trace) => trace.file),
    ...(candidate.affectedSurface ?? []).map((surface) =>
      surface.includes(":") ? surface.split(":")[0] : surface
    ),
  ]).filter((value) => /\.[a-z0-9]+$/i.test(value));
}

function variantSegmentKind(
  value: string
): "safe" | "risky" | "neutral" {
  const segment = value.trim().toLowerCase();
  if (
    ["secure", "recommended", "patched", "fixed", "good"].includes(segment)
  ) {
    return "safe";
  }

  if (
    ["insecure", "unsafe", "vulnerable", "exploit", "attacks", "attack"].includes(
      segment
    )
  ) {
    return "risky";
  }

  return "neutral";
}

function normalizeVariantPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) =>
      variantSegmentKind(segment) === "neutral" ? segment.toLowerCase() : "__variant__"
    )
    .join("/");
}

function fileVariantBias(file: string, repoFiles: string[]): number {
  const normalized = normalizeVariantPath(file);
  const kind = file
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => variantSegmentKind(segment))
    .find((value) => value !== "neutral");

  if (!kind) return 0;

  const counterpartExists = repoFiles.some((candidate) => {
    if (candidate === file) return false;
    if (normalizeVariantPath(candidate) !== normalized) return false;
    const candidateKind = candidate
      .replace(/\\/g, "/")
      .split("/")
      .map((segment) => variantSegmentKind(segment))
      .find((value) => value !== "neutral");
    return candidateKind && candidateKind !== kind;
  });

  if (!counterpartExists) {
    return kind === "risky" ? 1 : 0;
  }

  return kind === "risky" ? 3 : -4;
}

function candidateVariantBias(
  candidate: AuditFindingCandidate,
  ingestion?: IngestionResult
): number {
  if (!ingestion) return 0;
  const repoFiles = ingestion.sourceFiles.map((file) => file.relativePath);
  const files = candidatePrimaryFiles(candidate);
  if (files.length === 0) return 0;

  return files.reduce(
    (score, file) => score + fileVariantBias(file, repoFiles),
    0
  );
}

function suppressReferenceSafeCandidates(
  candidates: AuditFindingCandidate[],
  ingestion?: IngestionResult
): AuditFindingCandidate[] {
  if (!ingestion || candidates.length === 0) return candidates;

  const repoFiles = ingestion.sourceFiles.map((file) => file.relativePath);
  const filtered = candidates.filter((candidate) => {
    const files = candidatePrimaryFiles(candidate);
    if (files.length === 0) return true;

    const safeFiles = files.filter((file) => fileVariantBias(file, repoFiles) < 0);
    return safeFiles.length !== files.length;
  });

  return filtered.length > 0 ? filtered : candidates;
}

function dedupeRankedCandidates(
  candidates: AuditFindingCandidate[],
  ingestion?: IngestionResult,
  limit = MAX_CANDIDATE_FINDINGS
): AuditFindingCandidate[] {
  const deduped: AuditFindingCandidate[] = [];

  for (const candidate of rankCandidates(candidates, ingestion)) {
    const existingIndex = deduped.findIndex((existing) =>
      candidatesShouldMerge(existing, candidate)
    );
    if (existingIndex >= 0) {
      deduped[existingIndex] = mergeDuplicateCandidates(
        deduped[existingIndex],
        candidate
      );
      continue;
    }

    deduped.push(candidate);
    if (deduped.length >= limit) break;
  }

  return suppressReferenceSafeCandidates(deduped, ingestion);
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

function pocAnchorScore(
  poc: AuditFindingCandidate["poc"],
  candidate?: AuditFindingCandidate
): number {
  if (!poc?.text?.trim()) return -100;

  let score = 0;
  if (hasVerificationMarker(poc, "executed_poc")) score += 50;
  if (hasVerificationMarker(poc, "validated_replay")) score += 30;
  if (hasSubstantialPocText(poc)) score += 5;
  if (!looksLikeTemplatePoc(poc)) score += 12;
  if (poc.framework !== "generic") score += 2;

  if (!candidate) return score;

  const haystack = normalizedPocText(poc);
  const anchors = uniqueStrings([
    ...(candidate.affectedSurface ?? []),
    ...(candidate.neighborhoodIds ?? []),
    ...candidate.evidence.traces.map((trace) => trace.file),
    ...candidate.evidence.traces.map((trace) => `${trace.file}:${trace.line}`),
    ...candidate.evidence.traces.flatMap((trace) =>
      trace.file
        .split("/")
        .slice(-2)
        .map((part) => part.replace(/\.[^.]+$/, ""))
    ),
  ]);

  for (const anchor of anchors) {
    if (anchor && haystack.includes(anchor.toLowerCase())) {
      score += 2;
    }
  }

  return score;
}

function selectPreferredPoc(
  parsedPoc: AuditFindingCandidate["poc"],
  fallback: AuditFindingCandidate["poc"],
  candidate?: AuditFindingCandidate
): AuditFindingCandidate["poc"] {
  if (!fallback?.text?.trim()) return parsedPoc;
  return pocAnchorScore(parsedPoc, candidate) >= pocAnchorScore(fallback, candidate)
    ? parsedPoc
    : fallback;
}

function normalizePoc(
  value: unknown,
  fallback: AuditFindingCandidate["poc"],
  pocFramework: PocFramework,
  baseCandidate?: AuditFindingCandidate
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

  const parsedPoc = {
    framework,
    text: parsed.text,
  };

  return selectPreferredPoc(parsedPoc, fallback, baseCandidate);
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
  const poc = normalizePoc(parsedCandidate.poc, baseCandidate.poc, pocFramework, baseCandidate);
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
  const hasGroundedEvidence =
    report.evidence.traces.length > 0 ||
    report.evidence.proofLevel === "guided_replay" ||
    report.evidence.proofLevel === "validated_replay" ||
    report.evidence.proofLevel === "executed_poc";

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

function leadCandidateFromReport(
  report: AuditReport
): AuditFindingCandidate | undefined {
  return (
    report.candidateFindings?.find(
      (candidate) => candidate.candidateId === report.leadCandidateId
    ) ?? report.candidateFindings?.[0]
  );
}

function normalizeAffectedPath(value: string): string {
  return value.replace(/:\d+$/, "").trim();
}

function focusedReviewFiles(
  ingestion: IngestionResult | undefined,
  report: AuditReport
): SourceFile[] {
  if (!ingestion) return [];

  const primaryCandidate = leadCandidateFromReport(report);
  const directPaths = new Set(
    (report.affectedSurface ?? []).map(normalizeAffectedPath).filter(Boolean)
  );
  const neighborhoodIds = new Set(primaryCandidate?.neighborhoodIds ?? []);

  const neighborhoodFiles = new Set<string>();
  for (const neighborhood of ingestion.neighborhoods) {
    if (!neighborhoodIds.has(neighborhood.id)) continue;
    for (const file of neighborhood.files) neighborhoodFiles.add(file);
    for (const file of neighborhood.seedFiles) neighborhoodFiles.add(file);
  }

  const focused = ingestion.sourceFiles.filter(
    (file) => directPaths.has(file.relativePath) || neighborhoodFiles.has(file.relativePath)
  );

  if (focused.length > 0) {
    return focused.slice(0, 16);
  }

  return ingestion.sourceFiles.slice(0, 12);
}

function focusedNeighborhoodSummaries(
  ingestion: IngestionResult | undefined,
  report: AuditReport
): string[] {
  if (!ingestion) return [];
  const primaryCandidate = leadCandidateFromReport(report);
  const ids = new Set(primaryCandidate?.neighborhoodIds ?? []);
  return ingestion.neighborhoods
    .filter((neighborhood) => ids.has(neighborhood.id))
    .slice(0, 4)
    .map((neighborhood) => neighborhood.summary);
}

function buildFocusedReviewContext(
  ingestion: IngestionResult | undefined,
  report: AuditReport
): string {
  if (!ingestion) {
    return "[No source code was available for independent review verification.]";
  }

  const sections: string[] = [];
  const neighborhoodSummaries = focusedNeighborhoodSummaries(ingestion, report);
  if (neighborhoodSummaries.length > 0) {
    sections.push("=== FOCUSED REVIEW NEIGHBORHOODS ===");
    sections.push(neighborhoodSummaries.join("\n\n"));
    sections.push("");
  }

  sections.push(buildSourceFileContext(focusedReviewFiles(ingestion, report), "FOCUSED REVIEW FILES"));
  return sections.join("\n");
}

function detectFrameworkProtections(
  category: TargetCategory,
  files: SourceFile[]
): string[] {
  const protections: string[] = [];
  const addProtection = (value: string) => {
    if (!protections.includes(value)) {
      protections.push(value);
    }
  };

  for (const file of files) {
    const content = file.content;
    if (category === "solidity_evm") {
      if (/\bReentrancyGuard\b|\bnonReentrant\b/.test(content)) {
        addProtection(`${file.relativePath}: reentrancy guard detected`);
      }
      if (/\bSafeERC20\b|\.safeTransfer\b|\.safeTransferFrom\b/.test(content)) {
        addProtection(`${file.relativePath}: SafeERC20-style token handling detected`);
      }
      if (/\bonlyOwner\b|\bonlyRole\b|\bAccessControl\b/.test(content)) {
        addProtection(`${file.relativePath}: explicit access-control guard detected`);
      }
      if (/\binitializer\b|\breinitializer\b|\bInitializable\b/.test(content)) {
        addProtection(`${file.relativePath}: initializer protection detected`);
      }
      if (/\b_authorizeUpgrade\b|\bUUPSUpgradeable\b/.test(content)) {
        addProtection(`${file.relativePath}: upgrade authorization hook detected`);
      }
      if (/\bwhenNotPaused\b|\bPausable\b/.test(content)) {
        addProtection(`${file.relativePath}: pause control detected`);
      }
    } else if (category === "solana_rust") {
      if (/Signer<'info>|#\s*\[\s*account\s*\([^\]]*signer/.test(content)) {
        addProtection(`${file.relativePath}: signer constraint detected`);
      }
      if (/\bhas_one\s*=|\bconstraint\s*=/.test(content)) {
        addProtection(`${file.relativePath}: explicit Anchor account constraint detected`);
      }
      if (/\bowner\s*=/.test(content)) {
        addProtection(`${file.relativePath}: Anchor owner constraint detected`);
      }
      if (/ctx\.accounts\.\w+\.key\s*\(\)\s*(==|!=)|ctx\.accounts\.\w+\.key\s*(==|!=)|ctx\.accounts\.\w+\.is_signer|\.owner\s*(==|!=)|return Err\(ProgramError::InvalidAccountData\)|MissingRequiredSignature/.test(content)) {
        addProtection(`${file.relativePath}: inline account ownership / authority validation detected`);
      }
      if (/Program<'info>|\bProgram\s*<\s*'info/.test(content)) {
        addProtection(`${file.relativePath}: typed Program account validation detected`);
      }
      if (/\bfind_program_address\b/.test(content)) {
        addProtection(`${file.relativePath}: canonical PDA derivation helper detected`);
      }
      if (/Account<'info>/.test(content)) {
        addProtection(`${file.relativePath}: typed account wrapper detected`);
      }
    }
  }

  return protections.slice(0, 10);
}

function buildReviewClaimSummary(report: AuditReport): string {
  const primaryCandidate = leadCandidateFromReport(report);
  const topTraces = report.evidence.traces
    .slice(0, 3)
    .map(
      (trace) =>
        `${trace.vulnerabilityClass} at ${trace.file}:${trace.line} - ${trace.finding}`
    );

  return [
    `Title: ${report.title}`,
    `Severity: ${report.severity}`,
    `Proof state: ${report.evidence.proofLevel}`,
    `Evidence summary: ${report.evidence.summary}`,
    primaryCandidate ? `Origin: ${primaryCandidate.origin}` : "",
    primaryCandidate?.originNotes?.length
      ? `Origin notes: ${primaryCandidate.originNotes.join(" | ")}`
      : "",
    report.whyFlagged.length > 0
      ? `Why flagged: ${report.whyFlagged.slice(0, 3).join(" | ")}`
      : "",
    report.affectedSurface?.length
      ? `Affected surface: ${report.affectedSurface.slice(0, 6).join(", ")}`
      : "",
    topTraces.length > 0 ? `Traces:\n- ${topTraces.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function defaultCounterEvidenceAssessment(
  detectedProtections: string[]
): CounterEvidenceAssessment {
  return {
    counterEvidence: [],
    survivingRisks: [],
    protections: detectedProtections.slice(0, 6),
    reachability: "uncertain",
    confidence: 0.4,
  };
}

function sanitizeReachability(
  value: unknown,
  fallback: CounterEvidenceAssessment["reachability"]
): CounterEvidenceAssessment["reachability"] {
  return value === "blocked" || value === "reachable" || value === "uncertain"
    ? value
    : fallback;
}

function applyCounterEvidencePolicy(
  report: AuditReport,
  verdict: ReviewerVerdict,
  assessment: CounterEvidenceAssessment
): ReviewerVerdict {
  const blockedByProtections =
    assessment.reachability === "blocked" && assessment.confidence >= 0.7;
  const uncertainWithProtections =
    assessment.reachability === "uncertain" &&
    assessment.protections.length > 0 &&
    assessment.confidence >= 0.55;

  if (blockedByProtections) {
    return {
      verdict: "discard",
      rationale: `${verdict.rationale} Independent review found blocking counter-evidence or framework protections that appear to close the exploit path: ${assessment.counterEvidence.slice(0, 2).join(" | ") || assessment.protections.slice(0, 2).join(" | ")}.`.trim(),
      confidence: Math.min(verdict.confidence, 0.3),
    };
  }

  if (
    verdict.verdict === "publish" &&
    uncertainWithProtections &&
    report.evidence.proofLevel !== "validated_replay" &&
    report.evidence.proofLevel !== "executed_poc"
  ) {
    return {
      verdict: "needs_human_review",
      rationale: `${verdict.rationale} Independent review found meaningful protections or uncertainty that prevent confident auto-publication: ${assessment.protections.slice(0, 2).join(" | ") || assessment.counterEvidence.slice(0, 2).join(" | ")}.`.trim(),
      confidence: Math.min(verdict.confidence, 0.6),
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
  const exploratoryLeads = await runExploratoryNeighborhoodPass(
    runtime,
    target,
    category,
    ingestion
  );
  let baseCandidates: AuditFindingCandidate[] = [];

  if (candidateSeeds.length > 0) {
    baseCandidates = candidateSeeds.map((seed) =>
      buildCandidateFinding(
        target,
        reportId,
        seed,
        relatedSignalsForSeed(seed, evidenceSignals),
        createPocForSeed(target, seed, pocFramework, ingestion, solanaAnalysis, evmAnalysis),
        {
          origin: "analyzer",
          neighborhoodIds: findNeighborhoodIdsForFiles(ingestion, [seed.file]),
        }
      )
    );
  }

  if (exploratoryLeads.length > 0 && ingestion) {
    const exploratoryCandidates = exploratoryLeads.map((lead) => {
      const exploratorySignal = exploratorySignalFromLead(category, ingestion, lead);
      const location = `${exploratorySignal.file}:${exploratorySignal.line}`;

      return buildCandidateFinding(
        target,
        reportId,
        exploratorySignal,
        [exploratorySignal],
        createPocForSeed(
          target,
          exploratorySignal,
          pocFramework,
          ingestion,
          solanaAnalysis,
          evmAnalysis
        ),
        {
          origin: "exploration",
          originNotes: [lead.rationale],
          neighborhoodIds: [lead.neighborhoodId],
          extraArtifacts: [
            {
              type: "exploration",
              label: `Exploratory lead: ${lead.label}`,
              description: lead.rationale,
              location,
            },
          ],
        }
      );
    });

    baseCandidates = dedupeRankedCandidates(
      [...baseCandidates, ...exploratoryCandidates],
      ingestion,
      MAX_CANDIDATE_FINDINGS + MAX_EXPLORATORY_LEADS
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
        origin: topSignal ? "analyzer" : "exploration",
        title: buildBaseTitle(target, topSignal),
        severity: fallbackSeverity,
        confidence: defaultConfidenceForEvidence(fallbackEvidence),
        description: buildBaseDescription(topSignal),
        impact: buildImpact(topSignal),
        whyFlagged: fallbackWhyFlagged,
        originNotes: topSignal
          ? undefined
          : ["Fallback hypothesis produced because neither analyzer signals nor exploratory neighborhood leads were available."],
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

  baseCandidates = dedupeRankedCandidates(
    baseCandidates,
    ingestion,
    MAX_CANDIDATE_FINDINGS + MAX_EXPLORATORY_LEADS
  );

  const candidateSeedContext = baseCandidates
    .map((candidate) =>
      [
        `SeedId: ${candidate.candidateId}`,
        `Origin: ${candidate.origin}`,
        `Title: ${candidate.title}`,
        candidate.whyFlagged.length > 0
          ? `Why flagged: ${candidate.whyFlagged.slice(0, 2).join(" | ")}`
          : "",
        candidate.neighborhoodIds?.length
          ? `Neighborhoods: ${candidate.neighborhoodIds.join(", ")}`
          : "",
        candidate.originNotes?.length
          ? `Origin notes: ${candidate.originNotes.slice(0, 2).join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n\n");

  let base = reportFromLeadCandidate(
    reportId,
    target.targetId,
    baseCandidates,
    ingestion
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

    if (exploratoryLeads.length > 0) {
      promptParts.push(
        "IMPORTANT: The following EXPLORATORY NEIGHBORHOOD LEADS came from repo-index reasoning rather than deterministic analyzers.",
        "Treat them as hypotheses worth confirming or disproving from the actual code, especially if they reveal risky subsystems analyzers did not capture directly.",
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

    if (candidateSeedContext) {
      promptParts.push(
        "",
        "=== CANDIDATE SEEDS ===",
        "When you elaborate one of these seeds, preserve its SeedId in the output so finding provenance remains attached.",
        candidateSeedContext
      );
    }

    promptParts.push("", codeContext, "");
    promptParts.push(
      "Return STRICT JSON matching this TypeScript shape:",
      `{ candidates: Array<{ seedId?: string | null, title: string, severity: 'low'|'medium'|'high'|'critical', confidence: number, description: string, impact: string, whyFlagged: string[], affectedSurface: string[], recommendations: string[], poc: { framework: '${pocFramework}', text: string } }> }`
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
        const parsedBySeedId = new Map<string, Record<string, unknown>>();
        const unmatchedParsed: Array<Record<string, unknown>> = [];

        for (const parsedCandidate of parsedCandidates) {
          const seedId =
            typeof parsedCandidate.seedId === "string"
              ? parsedCandidate.seedId
              : "";
          if (
            seedId &&
            baseCandidates.some((candidate) => candidate.candidateId === seedId)
          ) {
            parsedBySeedId.set(seedId, parsedCandidate);
          } else {
            unmatchedParsed.push(parsedCandidate);
          }
        }

        const mergedCandidates = baseCandidates.map((candidate) =>
          mergeCandidateWithParsedResult(
            target,
            candidate,
            parsedBySeedId.get(candidate.candidateId) ?? unmatchedParsed.shift(),
            pocFramework
          )
        );
        const rankedCandidates = dedupeRankedCandidates(mergedCandidates, ingestion);
        if (rankedCandidates.length > 0) {
          return reportFromLeadCandidate(
            reportId,
            target.targetId,
            rankedCandidates,
            ingestion
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
    ? buildFocusedReviewContext(ingestion, report)
    : "[No source code was available for independent review verification.]";
  const focusedFiles = focusedReviewFiles(ingestion, report);
  const claimSummary = buildReviewClaimSummary(report);
  const detectedProtections = detectFrameworkProtections(category, focusedFiles);

  let reviewAnalysisContext = "";
  if (category === "solana_rust" && ingestion && hasCode) {
    reviewAnalysisContext = formatSignalsForPrompt(analyzeSolanaRust(focusedFiles));
  } else if (category === "solidity_evm" && ingestion && hasCode) {
    reviewAnalysisContext = formatEvmSignalsForPrompt(analyzeSolidityEvm(focusedFiles));
  }

  try {
    const counterEvidenceFallback = defaultCounterEvidenceAssessment(detectedProtections);
    let counterEvidenceAssessment = counterEvidenceFallback;

    const counterPromptParts: string[] = [
      "You are an adversarial security reviewer.",
      "Your first job is to DISPROVE the claim before thinking about publication.",
      "Search for disconfirming evidence, framework protections, unreachable assumptions, or semantics that neutralize the exploit path.",
      "Do not restate the auditor's narrative. Focus on what blocks or weakens the claim.",
      "",
      `Category: ${category}`,
      `Target: ${JSON.stringify({ targetId: target.targetId, type: target.type, displayName: target.displayName })}`,
      scopeContext ? `ScopeContext: ${JSON.stringify(scopeContext)}` : "",
      "",
      "=== CLAIM SUMMARY ===",
      claimSummary,
      "",
      detectedProtections.length > 0
        ? `=== DETERMINISTIC PROTECTIONS DETECTED ===\n- ${detectedProtections.join("\n- ")}`
        : "=== DETERMINISTIC PROTECTIONS DETECTED ===\n- none",
      "",
    ];

    if (reviewAnalysisContext) {
      counterPromptParts.push(
        "=== INDEPENDENT STATIC ANALYSIS (for counter-checking) ===",
        reviewAnalysisContext,
        ""
      );
    }

    counterPromptParts.push(
      codeContext,
      "",
      "Return STRICT JSON:",
      "{ counterEvidence: string[], survivingRisks: string[], protections: string[], reachability: 'blocked'|'uncertain'|'reachable', confidence: number }",
      "- Use 'blocked' when guards, ownership checks, standard protections, or framework semantics appear to close the exploit path",
      "- Use 'uncertain' when the claim may survive but important reachability or mitigation questions remain",
      "- Use 'reachable' only when the focused code still appears exploitable after you searched for counter-evidence"
    );

    const counterResult = await (runtime as any).useModel?.(ModelType.TEXT_LARGE, {
      prompt: counterPromptParts.filter(Boolean).join("\n"),
      maxTokens: 900,
    });
    const counterText =
      typeof counterResult === "string" ? counterResult : counterResult?.text ?? "";
    const counterJsonStart = counterText.indexOf("{");
    const counterJsonEnd = counterText.lastIndexOf("}");

    if (counterJsonStart >= 0 && counterJsonEnd > counterJsonStart) {
      const parsedCounter = JSON.parse(
        counterText.slice(counterJsonStart, counterJsonEnd + 1)
      ) as Record<string, unknown>;
      counterEvidenceAssessment = {
        counterEvidence: uniqueStrings(
          Array.isArray(parsedCounter.counterEvidence)
            ? parsedCounter.counterEvidence.map((value) => String(value))
            : counterEvidenceFallback.counterEvidence
        ),
        survivingRisks: uniqueStrings(
          Array.isArray(parsedCounter.survivingRisks)
            ? parsedCounter.survivingRisks.map((value) => String(value))
            : counterEvidenceFallback.survivingRisks
        ),
        protections: uniqueStrings([
          ...detectedProtections,
          ...(Array.isArray(parsedCounter.protections)
            ? parsedCounter.protections.map((value) => String(value))
            : []),
        ]),
        reachability: sanitizeReachability(
          parsedCounter.reachability,
          counterEvidenceFallback.reachability
        ),
        confidence: sanitizeConfidence(
          parsedCounter.confidence,
          counterEvidenceFallback.confidence
        ),
      };
    }

    const promptParts: string[] = [
      "You are an independent security reviewer deciding whether a candidate finding survives adversarial scrutiny.",
      "Use the counter-evidence assessment first. If protections appear to block the path, do not publish just because the auditor sounded confident.",
      "You should be STRICT for critical and high severity findings, and more tolerant for medium and low.",
      "You can return one of three dispositions:",
      "- publish: the finding is grounded and strong enough for the main gallery",
      "- needs_human_review: the finding is grounded enough to preserve, but too uncertain for auto-publication",
      "- discard: the finding is weak, contradicted, or not worth keeping",
      "",
    ];

    if (hasCode) {
      promptParts.push(
        "You have focused source code context. Verify the finding against the real code. Look for:"
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
      "",
      "=== CLAIM SUMMARY ===",
      claimSummary,
      "",
      "=== COUNTER-EVIDENCE ASSESSMENT ===",
      JSON.stringify(counterEvidenceAssessment, null, 2),
      ""
    );

    if (detectedProtections.length > 0) {
      promptParts.push(
        "=== DETERMINISTIC PROTECTIONS DETECTED ===",
        `- ${detectedProtections.join("\n- ")}`,
        ""
      );
    }

    promptParts.push(
      codeContext,
      "",
      "Return STRICT JSON: { verdict: 'publish'|'needs_human_review'|'discard', rationale: string, confidence: number }",
      "- confidence is 0.0 to 1.0 where 1.0 means the finding is certainly valid",
      "- Start from the counter-evidence assessment rather than from the auditor's framing",
      "- If protections or semantics appear to block the exploit path, prefer discard or needs_human_review over publish",
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
      const reviewed = applyCounterEvidencePolicy(
        report,
        {
        verdict: parsedVerdict,
        rationale: String(parsed.rationale ?? fallback.rationale),
        confidence: sanitizeConfidence(parsed.confidence, fallback.confidence),
        },
        counterEvidenceAssessment
      );
      return enforceReviewPolicy(report, reviewed);
    }
  } catch (e) {
    logger.warn(`[Review] LLM review failed, falling back to default verdict: ${e}`);
  }

  return enforceReviewPolicy(report, fallback);
}

function candidateFromReportSummary(report: AuditReport): AuditFindingCandidate {
  return {
    candidateId: report.leadCandidateId ?? `${report.reportId}_lead`,
    origin: "analyzer",
    title: report.title,
    severity: report.severity,
    confidence: report.confidence,
    description: report.description,
    impact: report.impact,
    whyFlagged: report.whyFlagged,
    affectedSurface: report.affectedSurface,
    recommendations: report.recommendations,
    evidence: report.evidence,
    poc: report.poc,
  };
}

function candidatesFromReport(report: AuditReport): AuditFindingCandidate[] {
  return report.candidateFindings?.length
    ? report.candidateFindings
    : [candidateFromReportSummary(report)];
}

function aggregateReviewVerdict(
  reviewedCandidates: AuditFindingCandidate[],
  ingestion?: IngestionResult
): ReviewerVerdict {
  const counts = findingCountsFromCandidates(reviewedCandidates) ?? {
    total: reviewedCandidates.length,
    published: 0,
    needsHumanReview: 0,
    discarded: 0,
  };
  const ordered = rankReviewedCandidates(reviewedCandidates, ingestion);
  const lead = ordered[0];
  const leadReview = lead?.review;

  const outcomeSummary = `${counts.published} published, ${counts.needsHumanReview} queued for human review, ${counts.discarded} discarded`;
  const leadSummary = lead
    ? ` Lead finding: ${lead.title} (${lead.severity}).`
    : "";
  const leadRationale = leadReview?.rationale
    ? ` Lead reviewer rationale: ${leadReview.rationale}`
    : "";

  if (counts.published > 0) {
    return {
      verdict: "publish",
      rationale: `Reviewed ${counts.total} findings: ${outcomeSummary}.${leadSummary}${leadRationale}`.trim(),
      confidence:
        Math.max(
          ...reviewedCandidates.map((candidate) => candidate.review?.confidence ?? 0)
        ) || leadReview?.confidence || 0.55,
    };
  }

  if (counts.needsHumanReview > 0) {
    return {
      verdict: "needs_human_review",
      rationale: `Reviewed ${counts.total} findings: ${outcomeSummary}.${leadSummary}${leadRationale}`.trim(),
      confidence:
        Math.max(
          ...reviewedCandidates
            .filter((candidate) => candidate.review?.verdict === "needs_human_review")
            .map((candidate) => candidate.review?.confidence ?? 0)
        ) || leadReview?.confidence || 0.45,
    };
  }

  return {
    verdict: "discard",
    rationale: `Reviewed ${counts.total} findings: ${outcomeSummary}.${leadSummary}${leadRationale}`.trim(),
    confidence:
      Math.max(
        ...reviewedCandidates.map((candidate) => candidate.review?.confidence ?? 0)
      ) || leadReview?.confidence || 0.3,
  };
}

export function summarizeReviewedReport(
  report: AuditReport,
  ingestion?: IngestionResult
): {
  report: AuditReport;
  verdict: ReviewerVerdict;
} {
  const reviewedCandidates = rankReviewedCandidates(candidatesFromReport(report), ingestion);
  const lead = reviewedCandidates[0];
  const verdict = aggregateReviewVerdict(reviewedCandidates, ingestion);

  if (!lead) {
    return { report, verdict };
  }

  return {
    report: reportFromLeadCandidate(
      report.reportId,
      report.targetId,
      reviewedCandidates,
      ingestion
    ),
    verdict,
  };
}

export async function runReviewFindings(
  runtime: IAgentRuntime,
  opts: {
    target: Target;
    report: AuditReport;
    scopeContext?: unknown;
    ingestion?: IngestionResult;
  }
): Promise<{
  report: AuditReport;
  verdict: ReviewerVerdict;
  leadVerdict?: ReviewerVerdict;
}> {
  const { report, target, scopeContext, ingestion } = opts;
  const candidates = candidatesFromReport(report);
  const reviewedCandidates: AuditFindingCandidate[] = [];

  for (const candidate of candidates) {
    const candidateReport = reportFromSingleCandidate(
      report.reportId,
      report.targetId,
      candidate
    );
    const verdict = await runReview(runtime, {
      target,
      report: candidateReport,
      scopeContext,
      ingestion,
    });
    reviewedCandidates.push({
      ...candidate,
      review: verdict,
    });
  }

  const reviewedReport = reportFromLeadCandidate(
    report.reportId,
    report.targetId,
    reviewedCandidates,
    ingestion
  );
  const leadVerdict =
    leadCandidateFromReport(reviewedReport)?.review ?? reviewedCandidates[0]?.review;

  return {
    report: reviewedReport,
    verdict: aggregateReviewVerdict(reviewedCandidates, ingestion),
    leadVerdict,
  };
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
      "This compatibility path does not yet establish grounded exploitability and should be replaced by the reviewed multi-finding audit flow.",
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
    generatedPoC = generateSolanaPoC(solanaAnalysis, undefined, {
      targetName: target.displayName,
      seed: solanaAnalysis.signals[0],
      repoIndex: ingestion?.repoIndex,
      neighborhoods: ingestion?.neighborhoods,
      sourceFiles: ingestion?.sourceFiles,
    });
  } else if (evmAnalysis && evmAnalysis.signals.length > 0) {
    generatedPoC = generateEvmPoC(evmAnalysis, undefined, {
      targetName: target.displayName,
      seed: evmAnalysis.signals[0],
      repoIndex: ingestion?.repoIndex,
      neighborhoods: ingestion?.neighborhoods,
      sourceFiles: ingestion?.sourceFiles,
    });
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
        "These are GROUNDED evidence signals extracted by pattern analysis. Use them as high-value evidence, not as exclusive truth.",
        "Cross-check them against the repo-index context and actual code before strengthening, reshaping, or rejecting a hypothesis.",
        "Prefer the strongest grounded candidate for the lead summary, but do not force the report to mirror a weak seed if the code evidence points elsewhere.",
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
      "Produce one legacy compatibility summary for the strongest candidate with:",
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
