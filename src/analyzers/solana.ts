/**
 * Solana / Anchor Static Analyzer
 *
 * Extracts structured vulnerability signals from Rust / Anchor source files.
 * These signals are NOT final findings — they are evidence fragments that the
 * LLM auditor uses to produce grounded, specific, defensible findings.
 *
 * Priority vulnerability classes (from PROJECT_SCOPE.md):
 *   1. Oracle, price, and accounting logic flaws
 *   2. Account ownership validation bugs
 *   3. Signer and authority mistakes
 *   4. PDA derivation and seed misuse
 *   5. CPI privilege escalation
 */

import type { SourceFile } from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type VulnClass =
  | "oracle_accounting"
  | "ownership_validation"
  | "signer_authority"
  | "pda_misuse"
  | "cpi_escalation"
  | "reinitialization"
  | "integer_overflow"
  | "arbitrary_close"
  | "unchecked_return"
  | "missing_constraint";

export type AnalysisSignal = {
  /** Which vulnerability class this signal maps to */
  vulnClass: VulnClass;
  /** Severity hint for the LLM */
  severityHint: "critical" | "high" | "medium" | "low";
  /** File where the signal was found */
  file: string;
  /** Line number (approximate, 1-indexed) */
  line: number;
  /** The offending code snippet */
  snippet: string;
  /** What the analyzer detected */
  finding: string;
  /** What to look for to confirm exploitability */
  confirmationHint: string;
};

export type SolanaAnalysisResult = {
  signals: AnalysisSignal[];
  /** Per-class summary counts */
  classCounts: Partial<Record<VulnClass, number>>;
  /** Anchor-specific structural metadata */
  anchorMeta: {
    isAnchor: boolean;
    programCount: number;
    instructionCount: number;
    accountStructs: string[];
    stateAccounts: string[];
  };
  /** Summary for the LLM */
  summary: string;
};

// ---------------------------------------------------------------------------
// Line-level helpers
// ---------------------------------------------------------------------------

function getLines(content: string): string[] {
  return content.split("\n");
}

function surrounding(lines: string[], lineIdx: number, radius = 2): string {
  const start = Math.max(0, lineIdx - radius);
  const end = Math.min(lines.length - 1, lineIdx + radius);
  return lines
    .slice(start, end + 1)
    .map((l, i) => `${start + i + 1}: ${l}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// 1. Oracle / Price / Accounting Logic
// ---------------------------------------------------------------------------

function analyzeOracleAccounting(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Price calculations without overflow protection
    if (
      /\b(price|amount|rate|value|balance)\b.*[\*\/]/.test(trimmed) &&
      !trimmed.includes("checked_") &&
      !trimmed.includes("safe_") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("///")
    ) {
      signals.push({
        vulnClass: "oracle_accounting",
        severityHint: "high",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i),
        finding: "Arithmetic operation on price/amount/balance without checked math.",
        confirmationHint: "Check if this value flows into a token transfer, mint, or LP share calculation. Verify if overflow/underflow can cause fund loss.",
      });
    }

    // Direct oracle reads without staleness checks
    if (
      /\b(get_price|load_price|oracle|pyth|switchboard|chainlink)\b/i.test(trimmed) &&
      !trimmed.startsWith("//")
    ) {
      // Look for absence of staleness check within ±5 lines
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 8)).join(" ");
      if (
        !/\b(stale|staleness|valid_slot|last_update|timestamp|max_age|confidence)\b/i.test(context)
      ) {
        signals.push({
          vulnClass: "oracle_accounting",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Oracle price fetch without apparent staleness or confidence check.",
          confirmationHint: "Verify whether this oracle read has staleness validation elsewhere. Stale prices enable price manipulation attacks.",
        });
      }
    }

    // Division before multiplication (precision loss)
    if (/\/.*\*/.test(trimmed) && /\b(amount|share|rate|supply)\b/.test(trimmed) && !trimmed.startsWith("//")) {
      signals.push({
        vulnClass: "oracle_accounting",
        severityHint: "medium",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i),
        finding: "Division before multiplication — potential precision loss in token math.",
        confirmationHint: "Check if integer division truncation can be exploited to extract excess value over many transactions.",
      });
    }

    // Unchecked subtraction on token amounts
    if (
      /\.(checked_sub|saturating_sub)\b/.test(trimmed) === false &&
      /\b(balance|amount|supply|reserve|total)\s*[-=]\s*/.test(trimmed) &&
      !trimmed.startsWith("//") &&
      !trimmed.includes("+=")
    ) {
      const hasSubtraction = /\b\w+\s*-\s*\w+/.test(trimmed) || trimmed.includes("-=");
      if (hasSubtraction) {
        signals.push({
          vulnClass: "oracle_accounting",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i),
          finding: "Unchecked subtraction on a balance or amount field — underflow risk.",
          confirmationHint: "Verify if an attacker can cause this subtraction to underflow, resulting in a wrapped-around balance.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 2. Account Ownership Validation
// ---------------------------------------------------------------------------

function analyzeOwnershipValidation(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  // Track #[account(...)] constraint patterns
  const accountBlocks: { startLine: number; name: string; hasOwner: boolean; hasConstraint: boolean }[] = [];
  let currentAccountBlock: typeof accountBlocks[0] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect #[account(...)] blocks
    if (/#\[account\(/.test(trimmed)) {
      const nameMatch = lines[i + 1]?.trim().match(/pub\s+(\w+)\s*:/);
      currentAccountBlock = {
        startLine: i + 1,
        name: nameMatch?.[1] ?? "unknown",
        hasOwner: /owner\s*=/.test(trimmed),
        hasConstraint: /constraint\s*=/.test(trimmed) || /has_one\s*=/.test(trimmed),
      };
    }

    // End of account annotation
    if (currentAccountBlock && /pub\s+\w+\s*:/.test(trimmed)) {
      accountBlocks.push(currentAccountBlock);
      currentAccountBlock = null;
    }

    // UncheckedAccount or AccountInfo without owner validation
    if (
      /\bUncheckedAccount\b/.test(trimmed) ||
      (/\bAccountInfo\b/.test(trimmed) && !trimmed.startsWith("//"))
    ) {
      const nameMatch = trimmed.match(/pub\s+(\w+)\s*:/);
      const fieldName = nameMatch?.[1] ?? "unknown";

      // Check surrounding context for owner verification
      const context = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join(" ");
      if (!/\b(owner|key)\s*==/.test(context) && !/#\[account\(.*owner/.test(context)) {
        signals.push({
          vulnClass: "ownership_validation",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: `UncheckedAccount/AccountInfo '${fieldName}' without apparent owner validation.`,
          confirmationHint: "An attacker can pass any account here. Check if this account's data is trusted downstream without an owner check.",
        });
      }
    }

    // Deserialization without owner check
    if (
      /\btry_from_slice\b|\bdeserialize\b|\bunpack\b/.test(trimmed) &&
      !/\.owner\b/.test(trimmed) &&
      !trimmed.startsWith("//")
    ) {
      const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 2)).join(" ");
      if (!/\.owner\s*==|owner\s*=/.test(context)) {
        signals.push({
          vulnClass: "ownership_validation",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "Account data deserialized without prior owner check.",
          confirmationHint: "If the account's owner is not verified, an attacker can create a fake account with crafted data that passes deserialization.",
        });
      }
    }
  }

  // Check Anchor account structs that lack owner constraints
  for (const block of accountBlocks) {
    if (!block.hasOwner && !block.hasConstraint) {
      const context = surrounding(lines, block.startLine - 1, 3);
      // Only flag if it looks like a data account (not a Signer or SystemProgram)
      if (!/Signer|SystemProgram|Program<|TokenProgram/.test(context)) {
        signals.push({
          vulnClass: "ownership_validation",
          severityHint: "medium",
          file: file.relativePath,
          line: block.startLine,
          snippet: context,
          finding: `Account '${block.name}' in #[account(...)] has no owner or constraint checks.`,
          confirmationHint: "Verify whether this account needs ownership validation. Data accounts that are read and trusted should have owner = <program_id>.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 3. Signer / Authority Mistakes
// ---------------------------------------------------------------------------

function analyzeSignerAuthority(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Functions that mutate state without checking is_signer
    if (/\bfn\s+(transfer|withdraw|update|set_|modify|change|close|remove|delete)\w*/i.test(trimmed)) {
      // Look for signer check within the function body (next ~30 lines)
      const body = lines.slice(i, Math.min(lines.length, i + 40)).join("\n");
      if (
        !/\bis_signer\b/.test(body) &&
        !/\bSigner\b/.test(body) &&
        !/\bauthority\b.*\bSigner\b/i.test(body) &&
        !/\b#\[account\(.*signer/.test(body)
      ) {
        signals.push({
          vulnClass: "signer_authority",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: `State-mutating function without apparent signer/authority check.`,
          confirmationHint: "If no signer is validated, any user can call this instruction. Check the #[derive(Accounts)] struct for this instruction.",
        });
      }
    }

    // Authority field that is not validated against expected value
    if (/\bauthority\b.*\bAccountInfo\b/.test(trimmed) || /\badmin\b.*\bAccountInfo\b/.test(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 5)).join(" ");
      if (!/\bhas_one\s*=\s*authority\b/.test(context) && !/\bconstraint\b/.test(context)) {
        signals.push({
          vulnClass: "signer_authority",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "Authority/admin account passed as AccountInfo without has_one or constraint validation.",
          confirmationHint: "Verify if this authority is checked against the expected authority stored in program state. Without it, anyone can impersonate the admin.",
        });
      }
    }

    // Mutable account without signer
    if (/\b#\[account\(\s*mut\s*\)/.test(trimmed)) {
      const nextLines = lines.slice(i + 1, Math.min(lines.length, i + 3)).join(" ");
      const fieldName = nextLines.match(/pub\s+(\w+)\s*:/)?.[1] ?? "unknown";
      // If a mut account is not also marked as signer
      if (!/signer/.test(trimmed) && /\b(authority|admin|owner|payer)\b/.test(fieldName)) {
        signals.push({
          vulnClass: "signer_authority",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: `Authority-like account '${fieldName}' is mutable but not marked as signer.`,
          confirmationHint: "Check if the signer constraint is applied elsewhere. A mutable authority account without signer check allows unauthorized mutations.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 4. PDA Derivation and Seed Misuse
// ---------------------------------------------------------------------------

function analyzePdaMisuse(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // find_program_address without bump validation
    if (/\bfind_program_address\b/.test(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 8)).join(" ");
      // Check if canonical bump is validated
      if (!/\bbump\b/.test(context) && !/canonical_bump/.test(context)) {
        signals.push({
          vulnClass: "pda_misuse",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "find_program_address called without apparent bump seed validation.",
          confirmationHint:
            "If the bump seed is not stored or validated, an attacker may derive a different PDA with a non-canonical bump, " +
            "leading to account confusion or duplicate accounts.",
        });
      }
    }

    // create_program_address with user-controlled seeds
    if (/\bcreate_program_address\b/.test(trimmed)) {
      signals.push({
        vulnClass: "pda_misuse",
        severityHint: "high",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i, 3),
        finding: "create_program_address used — bump canonicalization bypass risk.",
        confirmationHint:
          "create_program_address does NOT find the canonical bump. If the bump is user-supplied, " +
          "non-canonical bumps can create colliding accounts. Prefer find_program_address.",
      });
    }

    // Seeds macro without bump constraint
    if (/\bseeds\s*=\s*\[/.test(trimmed) && !trimmed.startsWith("//")) {
      const annotationContext = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 4)).join(" ");
      if (!/\bbump\b/.test(annotationContext)) {
        signals.push({
          vulnClass: "pda_misuse",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "PDA seeds defined without bump constraint — Anchor may use a non-canonical bump.",
          confirmationHint: "In Anchor, omitting bump = <field> means the runtime finds the canonical bump each time. If the PDA is an init account, ensure bump is stored for future validation.",
        });
      }
    }

    // Seed collision — seeds that only use common fields
    if (/\bseeds\s*=\s*\[/.test(trimmed)) {
      // Extract seed components
      const seedContent = trimmed.match(/seeds\s*=\s*\[(.*)/)?.[1] ?? "";
      // If seeds only contain a static string (e.g., b"vault") without user-specific components
      if (/^b"[^"]*"\s*[,\]]/.test(seedContent.trim()) && !seedContent.includes(".key()") && !seedContent.includes(".as_ref()")) {
        signals.push({
          vulnClass: "pda_misuse",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "PDA seeds appear to use only a static prefix without user-specific components — potential global singleton collision.",
          confirmationHint: "If this PDA should be user-scoped, add the user's pubkey or a unique identifier to the seeds to prevent global state conflicts.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 5. CPI Privilege Escalation
// ---------------------------------------------------------------------------

function analyzeCpiEscalation(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // invoke or invoke_signed without program ID check
    if (/\b(invoke|invoke_signed)\s*\(/.test(trimmed) && !trimmed.startsWith("//")) {
      // Check if the program being called is validated
      const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join(" ");
      if (!/\bprogram_id\b.*==/.test(context) && !/\b(system_program|token_program|spl_token)\b/i.test(context)) {
        signals.push({
          vulnClass: "cpi_escalation",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "CPI invoke/invoke_signed without apparent target program ID validation.",
          confirmationHint:
            "If the target program is passed as an AccountInfo without verification, " +
            "an attacker can substitute a malicious program that executes arbitrary logic with the caller's authority.",
        });
      }
    }

    // Signer seeds forwarded to CPI (authority delegation)
    if (/\binvoke_signed\b/.test(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 10)).join(" ");
      // Check if signer seeds include broad authority
      if (/signer_seeds|signers_seeds/.test(context)) {
        signals.push({
          vulnClass: "cpi_escalation",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "invoke_signed with PDA signer seeds — verify authority scope.",
          confirmationHint:
            "Ensure the PDA whose seeds are used here has the minimum required authority. " +
            "If this PDA is also an authority for other operations, a CPI call could escalate privileges.",
        });
      }
    }

    // Anchor CpiContext without program validation
    if (/\bCpiContext::new\b/.test(trimmed) && !trimmed.startsWith("//")) {
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)).join(" ");
      if (!/program\.to_account_info\(\)/.test(context) && !/\.program\b/.test(context)) {
        signals.push({
          vulnClass: "cpi_escalation",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "CpiContext created — verify the target program account is validated in the Accounts struct.",
          confirmationHint:
            "If the program account used in CpiContext is an unvalidated AccountInfo, " +
            "it can be swapped for a malicious program.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Bonus: Reinitialization, integer overflow, arbitrary close
// ---------------------------------------------------------------------------

function analyzeAdditionalPatterns(file: SourceFile): AnalysisSignal[] {
  const signals: AnalysisSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Reinitialization: init without checking is_initialized
    if (/\bfn\s+initialize\b/.test(trimmed) || /\bfn\s+init\b/.test(trimmed)) {
      const body = lines.slice(i, Math.min(lines.length, i + 25)).join(" ");
      if (!/\bis_initialized\b/.test(body) && !/\binit\b.*constraint/.test(body)) {
        // Check if anchor #[account(init, ...)] is used
        if (!/\binit\s*,/.test(body) && !/\binit_if_needed\b/.test(body)) {
          signals.push({
            vulnClass: "reinitialization",
            severityHint: "critical",
            file: file.relativePath,
            line: i + 1,
            snippet: surrounding(lines, i, 3),
            finding: "Initialization function without is_initialized guard — reinitialization attack vector.",
            confirmationHint: "An attacker can call initialize again to reset state, potentially draining funds or hijacking authority.",
          });
        }
      }
    }

    // Integer overflow: unchecked arithmetic on u64/u128
    if (/\b(u64|u128|i64|i128)\b/.test(trimmed)) {
      if (/[+\-*](?!=)/.test(trimmed) && !/\bchecked_/.test(trimmed) && !/\bsaturating_/.test(trimmed) && !trimmed.startsWith("//")) {
        // Only flag in non-test code
        if (!file.relativePath.includes("/test")) {
          signals.push({
            vulnClass: "integer_overflow",
            severityHint: "medium",
            file: file.relativePath,
            line: i + 1,
            snippet: surrounding(lines, i),
            finding: "Unchecked arithmetic on u64/u128 — wrap-around risk in release mode.",
            confirmationHint: "Rust's release builds wrap on overflow. Use checked_add/checked_mul or #[overflow-checks = true] in Cargo.toml.",
          });
        }
      }
    }

    // Arbitrary account close (lamport draining)
    if (/\bclose\b/.test(trimmed) && !trimmed.startsWith("//")) {
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 5)).join(" ");
      if (/lamports/.test(context) && !/\bauthority\b/.test(context) && !/\bhas_one\b/.test(context)) {
        signals.push({
          vulnClass: "arbitrary_close",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Account close operation that drains lamports — verify authority check.",
          confirmationHint: "If any user can trigger this close instruction, they can drain the account's lamports to themselves.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Main analyzer entry point
// ---------------------------------------------------------------------------

export function analyzeSolanaRust(sourceFiles: SourceFile[]): SolanaAnalysisResult {
  const rustFiles = sourceFiles.filter((f) => f.language === "rust");
  // Also check TOML for structural metadata
  const tomlFiles = sourceFiles.filter((f) => f.relativePath.toLowerCase().endsWith(".toml"));

  const allSignals: AnalysisSignal[] = [];

  for (const file of rustFiles) {
    allSignals.push(...analyzeOracleAccounting(file));
    allSignals.push(...analyzeOwnershipValidation(file));
    allSignals.push(...analyzeSignerAuthority(file));
    allSignals.push(...analyzePdaMisuse(file));
    allSignals.push(...analyzeCpiEscalation(file));
    allSignals.push(...analyzeAdditionalPatterns(file));
  }

  // Deduplicate near-identical signals (same file + same line + same class)
  const seen = new Set<string>();
  const deduped = allSignals.filter((s) => {
    const key = `${s.file}:${s.line}:${s.vulnClass}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Count by class
  const classCounts: Partial<Record<VulnClass, number>> = {};
  for (const s of deduped) {
    classCounts[s.vulnClass] = (classCounts[s.vulnClass] ?? 0) + 1;
  }

  // Extract Anchor metadata
  const isAnchor = sourceFiles.some(
    (f) =>
      f.relativePath.toLowerCase().includes("anchor.toml") ||
      f.content.includes("use anchor_lang")
  );

  const programCount = rustFiles.filter(
    (f) =>
      f.content.includes("#[program]") || f.content.includes("declare_id!")
  ).length;

  const instructionCount = rustFiles.reduce((count, f) => {
    const matches = f.content.match(/pub\s+fn\s+\w+/g);
    return count + (matches?.length ?? 0);
  }, 0);

  const accountStructs = rustFiles.flatMap((f) => {
    const matches = f.content.match(/#\[derive\(Accounts\)\]\s*pub\s+struct\s+(\w+)/g);
    return matches?.map((m) => m.match(/struct\s+(\w+)/)?.[1] ?? "") ?? [];
  });

  const stateAccounts = rustFiles.flatMap((f) => {
    const matches = f.content.match(/#\[account\]\s*pub\s+struct\s+(\w+)/g);
    return matches?.map((m) => m.match(/struct\s+(\w+)/)?.[1] ?? "") ?? [];
  });

  const anchorMeta = {
    isAnchor,
    programCount,
    instructionCount,
    accountStructs,
    stateAccounts,
  };

  // Build summary
  const totalSignals = deduped.length;
  const criticals = deduped.filter((s) => s.severityHint === "critical").length;
  const highs = deduped.filter((s) => s.severityHint === "high").length;

  const classBreakdown = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, count]) => `  ${cls}: ${count}`)
    .join("\n");

  const summary = [
    `=== SOLANA/RUST STATIC ANALYSIS ===`,
    `Framework: ${isAnchor ? "Anchor" : "Native Solana"}`,
    `Programs: ${programCount}, Instructions: ${instructionCount}`,
    `Account structs: ${accountStructs.join(", ") || "none detected"}`,
    `State accounts: ${stateAccounts.join(", ") || "none detected"}`,
    ``,
    `Signals found: ${totalSignals} (${criticals} critical, ${highs} high)`,
    classBreakdown,
    ``,
    totalSignals > 0
      ? `The following signals are EVIDENCE, not final findings. Use them to build a grounded, specific, defensible vulnerability report.`
      : `No obvious vulnerability signals detected in static analysis. Proceed with manual-depth LLM reasoning.`,
  ].join("\n");

  return { signals: deduped, classCounts, anchorMeta, summary };
}

/**
 * Format analysis signals into a structured text block for the LLM prompt.
 */
export function formatSignalsForPrompt(result: SolanaAnalysisResult): string {
  if (result.signals.length === 0) {
    return result.summary;
  }

  const sections: string[] = [result.summary, ""];

  // Group by severity
  const criticals = result.signals.filter((s) => s.severityHint === "critical");
  const highs = result.signals.filter((s) => s.severityHint === "high");
  const mediums = result.signals.filter((s) => s.severityHint === "medium");

  function formatGroup(title: string, signals: AnalysisSignal[]): void {
    if (signals.length === 0) return;
    sections.push(`--- ${title} (${signals.length}) ---`);
    for (const s of signals.slice(0, 15)) {
      sections.push(`[${s.vulnClass}] ${s.file}:${s.line}`);
      sections.push(`  Finding: ${s.finding}`);
      sections.push(`  Confirm: ${s.confirmationHint}`);
      sections.push(`  Code:\n${s.snippet}`);
      sections.push("");
    }
    if (signals.length > 15) {
      sections.push(`  ... and ${signals.length - 15} more ${title.toLowerCase()} signals`);
    }
  }

  formatGroup("CRITICAL SIGNALS", criticals);
  formatGroup("HIGH SIGNALS", highs);
  formatGroup("MEDIUM SIGNALS", mediums);

  return sections.join("\n");
}
