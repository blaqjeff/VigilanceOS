import type { IAgentRuntime } from "@elizaos/core";
import { logger } from "@elizaos/core";
import type {
  AuditReport,
  IngestionResult,
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

function getPocFramework(category: TargetCategory): AuditReport["poc"] extends undefined ? never : NonNullable<AuditReport["poc"]>["framework"] {
  switch (category) {
    case "solana_rust":
      return "anchor";
    case "solidity_evm":
      return "foundry";
    default:
      return "generic";
  }
}

// ---------------------------------------------------------------------------
// Run Audit — now with real code context
// ---------------------------------------------------------------------------

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

  // Base (fallback) report
  const base: AuditReport = {
    reportId,
    targetId: target.targetId,
    severity: "high",
    title: `Potential high-impact security issue in ${target.displayName}`,
    description:
      "Automated review produced a candidate vulnerability. " +
      "This is a first-pass report and should be validated against the target's actual code paths and bounty scope.",
    affectedSurface: [],
    recommendations: [
      "Confirm the issue is in-scope for the program (if applicable).",
      "Reproduce locally with a minimal PoC.",
      "Add regression tests covering the exploit path.",
      "Apply standard mitigations.",
    ],
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

    const result = await (runtime as any).useModel?.("text_large", {
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

    const result = await (runtime as any).useModel?.("text_large", {
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
