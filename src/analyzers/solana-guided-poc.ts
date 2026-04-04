/**
 * Solana / Anchor guided replay generator.
 *
 * Produces target-specific Anchor test drafts anchored to real programs,
 * instructions, account structs, and files so findings can carry replayable
 * context even before the harness is validated.
 */

import type { RepoIndex, RepoNeighborhood, RepoSymbol, SourceFile } from "../pipeline/types.js";
import type { AnalysisSignal, SolanaAnalysisResult, VulnClass } from "./solana.js";

export type SolanaPocOptions = {
  targetName?: string;
  seed?: AnalysisSignal;
  repoIndex?: RepoIndex;
  neighborhoods?: RepoNeighborhood[];
  sourceFiles?: SourceFile[];
};

type SolanaReplayContext = {
  targetName: string;
  vulnClass: VulnClass | "generic";
  primarySignal?: AnalysisSignal;
  signals: AnalysisSignal[];
  affectedFiles: string[];
  programName: string;
  programFile?: string;
  instructionName?: string;
  instructionSignature?: string;
  accountStructName?: string;
  accountFields: string[];
  stateStructs: string[];
  relatedTests: string[];
  neighborhoodLabels: string[];
  seedHints: string[];
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Replay_${cleaned}`;
}

function neighborhoodMatchesFiles(neighborhood: RepoNeighborhood, files: string[]): boolean {
  const fileSet = new Set(files);
  return (
    neighborhood.files.some((file) => fileSet.has(file)) ||
    neighborhood.seedFiles.some((file) => fileSet.has(file))
  );
}

function symbolsForFiles(
  repoIndex: RepoIndex | undefined,
  files: string[],
  kinds?: RepoSymbol["kind"][]
): RepoSymbol[] {
  if (!repoIndex) return [];
  const fileSet = new Set(files);
  return repoIndex.symbols.filter(
    (symbol) => fileSet.has(symbol.file) && (!kinds || kinds.includes(symbol.kind))
  );
}

function nearestSymbol(
  repoIndex: RepoIndex | undefined,
  file: string | undefined,
  line: number | undefined,
  kinds: RepoSymbol["kind"][]
): RepoSymbol | undefined {
  if (!repoIndex || !file) return undefined;
  const candidates = repoIndex.symbols.filter(
    (symbol) => symbol.file === file && kinds.includes(symbol.kind)
  );
  if (candidates.length === 0) return undefined;

  if (typeof line !== "number") {
    return candidates[0];
  }

  const preceding = candidates
    .filter((symbol) => symbol.line <= line)
    .sort((left, right) => right.line - left.line);
  if (preceding.length > 0) {
    return preceding[0];
  }

  return [...candidates].sort((left, right) => left.line - right.line)[0];
}

function relevantNeighborhoods(
  options: SolanaPocOptions,
  affectedFiles: string[]
): RepoNeighborhood[] {
  return (options.neighborhoods ?? []).filter((neighborhood) =>
    neighborhoodMatchesFiles(neighborhood, affectedFiles)
  );
}

function scopedSignals(
  analysis: SolanaAnalysisResult,
  vulnClass: VulnClass,
  options: SolanaPocOptions
): AnalysisSignal[] {
  const classSignals = analysis.signals.filter((signal) => signal.vulnClass === vulnClass);
  if (!options.seed) return classSignals;

  const sameFile = classSignals.filter((signal) => signal.file === options.seed?.file);
  if (sameFile.length > 0) return sameFile;

  return classSignals;
}

function findSourceFile(sourceFiles: SourceFile[] | undefined, relativePath: string | undefined): SourceFile | undefined {
  if (!sourceFiles || !relativePath) return undefined;
  return sourceFiles.find((file) => file.relativePath === relativePath);
}

function extractWindow(
  sourceFiles: SourceFile[] | undefined,
  relativePath: string | undefined,
  line: number | undefined,
  span = 6
): string {
  const sourceFile = findSourceFile(sourceFiles, relativePath);
  if (!sourceFile) return "";
  const lines = sourceFile.content.split("\n");
  const center = typeof line === "number" ? Math.max(0, line - 1) : 0;
  return lines.slice(Math.max(0, center - span), Math.min(lines.length, center + span + 1)).join("\n");
}

function extractContextStructName(
  sourceFiles: SourceFile[] | undefined,
  relativePath: string | undefined,
  line: number | undefined,
  fallback?: string
): string | undefined {
  const window = extractWindow(sourceFiles, relativePath, line, 8);
  const match = window.match(/Context\s*<\s*([A-Za-z_]\w*)\s*>/);
  return match?.[1] ?? fallback;
}

function extractStructFields(
  sourceFiles: SourceFile[] | undefined,
  relativePath: string | undefined,
  structName: string | undefined
): string[] {
  if (!relativePath || !structName) return [];
  const sourceFile = findSourceFile(sourceFiles, relativePath);
  if (!sourceFile) return [];

  const lines = sourceFile.content.split("\n");
  const startPattern = new RegExp(`\\bpub\\s+struct\\s+${structName}\\b`);
  let inside = false;
  let depth = 0;
  const fields: string[] = [];

  for (const line of lines) {
    if (!inside && startPattern.test(line)) {
      inside = true;
      depth += (line.match(/\{/g) ?? []).length;
      depth -= (line.match(/\}/g) ?? []).length;
      continue;
    }
    if (!inside) continue;

    depth += (line.match(/\{/g) ?? []).length;
    depth -= (line.match(/\}/g) ?? []).length;

    const fieldMatch = line.trim().match(/^pub\s+([A-Za-z_]\w*)\s*:/);
    if (fieldMatch) {
      fields.push(fieldMatch[1]);
    }

    if (depth <= 0) {
      break;
    }
  }

  return uniqueStrings(fields).slice(0, 12);
}

function extractSeedHints(
  sourceFiles: SourceFile[] | undefined,
  relativePath: string | undefined,
  line: number | undefined
): string[] {
  const window = extractWindow(sourceFiles, relativePath, line, 10);
  if (!window) return [];

  const hints: string[] = [];
  for (const match of window.matchAll(/seeds\s*=\s*\[([^\]]+)\]/g)) {
    hints.push(match[1].replace(/\s+/g, " ").trim());
  }
  for (const match of window.matchAll(/find_program_address\s*\(\s*&?\[([^\]]+)\]/g)) {
    hints.push(match[1].replace(/\s+/g, " ").trim());
  }

  return uniqueStrings(hints).slice(0, 3);
}

function relatedTests(repoIndex: RepoIndex | undefined, files: string[], programName: string): string[] {
  if (!repoIndex) return [];
  const hints = uniqueStrings([...files, programName].map((value) => value.toLowerCase()));
  return repoIndex.testFiles
    .filter((testFile) => {
      const lower = testFile.toLowerCase();
      return hints.some((hint) => lower.includes(hint));
    })
    .slice(0, 6);
}

function fieldValueExpression(field: string): string {
  if (/^(authority|admin|owner|signer)$/i.test(field)) return "attacker.publicKey";
  if (/payer/i.test(field)) return "provider.wallet.publicKey";
  if (/system_?program|systemProgram/i.test(field)) return "SystemProgram.programId";
  if (/rent/i.test(field)) return "anchor.web3.SYSVAR_RENT_PUBKEY";
  if (/token_?program|tokenProgram/i.test(field)) {
    return 'new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")';
  }
  if (/associated_?token/i.test(field)) {
    return 'new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")';
  }
  if (/program/i.test(field)) return "program.programId";
  return "Keypair.generate().publicKey";
}

function accountAssignments(fields: string[]): string {
  if (fields.length === 0) {
    return "        // accounts: add the concrete Accounts struct fields extracted from the target";
  }

  return fields
    .map((field) => `        ${field}: ${fieldValueExpression(field)},`)
    .join("\n");
}

function instructionCall(context: SolanaReplayContext, fallback: string): string {
  return context.instructionName
    ? `await program.methods.${context.instructionName}(/* mirror the repo's real instruction args */)`
    : fallback;
}

function buildReplayContext(
  analysis: SolanaAnalysisResult,
  signals: AnalysisSignal[],
  vulnClass: VulnClass | "generic",
  options: SolanaPocOptions
): SolanaReplayContext {
  const primarySignal = options.seed ?? signals[0];
  const affectedFiles = uniqueStrings(
    signals.map((signal) => signal.file).concat(primarySignal?.file ? [primarySignal.file] : [])
  );
  const neighborhoods = relevantNeighborhoods(options, affectedFiles);
  const neighborhoodFiles = uniqueStrings(neighborhoods.flatMap((neighborhood) => neighborhood.files));
  const primaryFile = primarySignal?.file ?? affectedFiles[0];
  const programSymbol =
    nearestSymbol(options.repoIndex, primaryFile, primarySignal?.line, ["program"]) ??
    symbolsForFiles(options.repoIndex, affectedFiles, ["program"])[0] ??
    symbolsForFiles(options.repoIndex, neighborhoodFiles, ["program"])[0];
  const instructionSymbol =
    nearestSymbol(options.repoIndex, primaryFile, primarySignal?.line, ["instruction"]) ??
    symbolsForFiles(options.repoIndex, affectedFiles, ["instruction"])[0];
  const fallbackStructSymbol =
    nearestSymbol(options.repoIndex, primaryFile, primarySignal?.line, ["account_struct"]) ??
    symbolsForFiles(options.repoIndex, affectedFiles, ["account_struct"])[0];
  const accountStructName = extractContextStructName(
    options.sourceFiles,
    primaryFile,
    primarySignal?.line,
    fallbackStructSymbol?.name
  );
  const programName = programSymbol?.name ?? "target_program";
  const accountFields = extractStructFields(
    options.sourceFiles,
    fallbackStructSymbol?.file ?? primaryFile,
    accountStructName
  );

  return {
    targetName: options.targetName ?? programName,
    vulnClass,
    primarySignal,
    signals,
    affectedFiles,
    programName,
    programFile: programSymbol?.file ?? primaryFile,
    instructionName: instructionSymbol?.name,
    instructionSignature: instructionSymbol?.signature,
    accountStructName,
    accountFields,
    stateStructs: uniqueStrings(
      symbolsForFiles(options.repoIndex, [...affectedFiles, ...neighborhoodFiles], ["state_struct"])
        .map((symbol) => symbol.name)
        .slice(0, 4)
    ),
    relatedTests: relatedTests(options.repoIndex, [...affectedFiles, ...neighborhoodFiles], programName),
    neighborhoodLabels: neighborhoods.map((neighborhood) => neighborhood.label).slice(0, 4),
    seedHints: extractSeedHints(options.sourceFiles, primaryFile, primarySignal?.line),
  };
}

function replayHeader(title: string, context: SolanaReplayContext): string {
  return [
    `// Guided replay: ${title}`,
    `// Target: ${context.targetName}`,
    "// Proof state: guided_replay (repo-anchored harness draft, not executed)",
    context.primarySignal
      ? `// Evidence anchor: ${context.primarySignal.file}:${context.primarySignal.line}`
      : "",
    context.programFile ? `// Program file: ${context.programFile}` : "",
    context.instructionSignature ? `// Candidate instruction: ${context.instructionSignature}` : "",
    context.accountStructName ? `// Accounts struct: ${context.accountStructName}` : "",
    context.stateStructs.length > 0 ? `// State structs: ${context.stateStructs.join(", ")}` : "",
    context.relatedTests.length > 0 ? `// Reuse fixture surface: ${context.relatedTests.join(", ")}` : "",
    context.neighborhoodLabels.length > 0 ? `// Neighborhoods: ${context.neighborhoodLabels.join(", ")}` : "",
    context.seedHints.length > 0 ? `// Seed hints: ${context.seedHints.join(" | ")}` : "",
    context.affectedFiles.length > 0 ? `// Affected files: ${context.affectedFiles.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function describeBlock(title: string, context: SolanaReplayContext, body: string[]): string {
  return `
${replayHeader(title, context)}

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

describe("${sanitizeIdentifier(title, "guided_replay")}", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const attacker = Keypair.generate();
  const program = anchor.workspace.${context.programName} as Program<any>;

  it("replays the anchored path", async () => {
    const accounts = {
${accountAssignments(context.accountFields)}
    };

${body.join("\n")}
  });
});
`.trim();
}

function oracleAccountingPoC(context: SolanaReplayContext): string {
  return describeBlock("oracle_accounting", context, [
    "    // Replay objective: run the same price-sensitive instruction with manipulated oracle or rounding conditions.",
    `    // Finding: ${context.primarySignal?.finding ?? "Inspect the flagged accounting path."}`,
    `    // Confirmation hint: ${context.primarySignal?.confirmationHint ?? "Verify stale or attacker-controlled price input."}`,
    `    ${instructionCall(context, `// Call the price-sensitive instruction rooted in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert balance, share, or vault drift after the call sequence completes.",
  ]);
}

function ownershipValidationPoC(context: SolanaReplayContext): string {
  return describeBlock("ownership_validation", context, [
    "    // Replay objective: pass an attacker-controlled account where the program trusts ownership or account data without verifying it.",
    `    // Finding: ${context.primarySignal?.finding ?? "Inspect the flagged account-validation path."}`,
    `    ${instructionCall(context, `// Call the instruction that trusts account data in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert that the program accepted fake state or routed value using the forged account.",
  ]);
}

function signerAuthorityPoC(context: SolanaReplayContext): string {
  return describeBlock("signer_authority", context, [
    "    // Replay objective: drive a state-mutating instruction as an unauthorized signer.",
    `    // Accounts struct under review: ${context.accountStructName ?? "inspect the local Context<...> binding"}.`,
    `    ${instructionCall(context, `// Call the authority-sensitive instruction rooted in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert that balances, authorities, or config changed even though attacker should not satisfy the signer checks.",
  ]);
}

function pdaMisusePoC(context: SolanaReplayContext): string {
  return describeBlock("pda_misuse", context, [
    "    // Replay objective: derive the same PDA family with alternate bump or seed material and feed it to the instruction.",
    context.seedHints.length > 0
      ? `    // Seed material observed near the finding: ${context.seedHints.join(" | ")}`
      : "    // Inspect the local seeds = [...] or find_program_address(...) call when building the PDA inputs.",
    `    ${instructionCall(context, `// Call the PDA-sensitive instruction rooted in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert that the program accepts a non-canonical PDA or confuses duplicate logical accounts.",
  ]);
}

function cpiEscalationPoC(context: SolanaReplayContext): string {
  return describeBlock("cpi_escalation", context, [
    "    // Replay objective: substitute an attacker-controlled program where the CPI target should have been fixed or validated.",
    `    // Finding: ${context.primarySignal?.finding ?? "Inspect the CPI target validation path."}`,
    `    ${instructionCall(context, `// Call the CPI-triggering instruction rooted in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert that the malicious CPI executes with signer seeds or authority that the protocol intended for a trusted program.",
  ]);
}

function genericPoC(context: SolanaReplayContext): string {
  return describeBlock("generic_replay", context, [
    "    // Replay objective: drive the grounded path with the real instruction and account layout extracted from the repo index.",
    `    // Finding: ${context.primarySignal?.finding ?? "See grounded analyzer evidence."}`,
    `    // Confirmation hint: ${context.primarySignal?.confirmationHint ?? "Confirm the suspicious path with attacker-controlled inputs."}`,
    `    ${instructionCall(context, `// Call the anchored instruction path rooted in ${context.programFile ?? "the affected program file"}`)}`,
    "      .accounts(accounts)",
    "      .signers([attacker])",
    "      .rpc();",
    "    // Assert the unauthorized state change or value movement described in the report.",
  ]);
}

export function generateSolanaPoC(
  analysis: SolanaAnalysisResult,
  targetVulnClass?: VulnClass,
  options: SolanaPocOptions = {}
): string {
  if (targetVulnClass) {
    const classSignals = scopedSignals(analysis, targetVulnClass, options);
    return getPoCForClass(
      analysis,
      targetVulnClass,
      classSignals.length > 0 ? classSignals : analysis.signals,
      options
    );
  }

  const criticalSignals = analysis.signals.filter((signal) => signal.severityHint === "critical");
  if (criticalSignals.length > 0) {
    const topClass = criticalSignals[0].vulnClass;
    return getPoCForClass(
      analysis,
      topClass,
      criticalSignals.filter((signal) => signal.vulnClass === topClass),
      options
    );
  }

  const highSignals = analysis.signals.filter((signal) => signal.severityHint === "high");
  if (highSignals.length > 0) {
    const topClass = highSignals[0].vulnClass;
    return getPoCForClass(
      analysis,
      topClass,
      highSignals.filter((signal) => signal.vulnClass === topClass),
      options
    );
  }

  if (analysis.signals.length > 0) {
    return getPoCForClass(analysis, analysis.signals[0].vulnClass, analysis.signals, options);
  }

  return genericPoC(buildReplayContext(analysis, [], "generic", options));
}

function getPoCForClass(
  analysis: SolanaAnalysisResult,
  vulnClass: VulnClass,
  signals: AnalysisSignal[],
  options: SolanaPocOptions
): string {
  const context = buildReplayContext(analysis, signals, vulnClass, options);

  switch (vulnClass) {
    case "oracle_accounting":
      return oracleAccountingPoC(context);
    case "ownership_validation":
      return ownershipValidationPoC(context);
    case "signer_authority":
      return signerAuthorityPoC(context);
    case "pda_misuse":
      return pdaMisusePoC(context);
    case "cpi_escalation":
      return cpiEscalationPoC(context);
    default:
      return genericPoC(context);
  }
}
