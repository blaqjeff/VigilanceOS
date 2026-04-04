/**
 * Solidity / EVM guided replay generator.
 *
 * Produces target-specific Foundry harness drafts anchored to real files,
 * symbols, and neighborhoods so they can be used as guided replay artifacts
 * instead of generic class templates.
 */

import type { RepoIndex, RepoNeighborhood, RepoSymbol, SourceFile } from "../pipeline/types.js";
import type { EvmAnalysisResult, EvmSignal, EvmVulnClass } from "./evm.js";

export type EvmPocOptions = {
  targetName?: string;
  seed?: EvmSignal;
  repoIndex?: RepoIndex;
  neighborhoods?: RepoNeighborhood[];
  sourceFiles?: SourceFile[];
};

type EvmReplayContext = {
  targetName: string;
  vulnClass: EvmVulnClass | "generic";
  primarySignal?: EvmSignal;
  signals: EvmSignal[];
  affectedFiles: string[];
  contractName: string;
  importPath?: string;
  primaryFile?: string;
  functionName?: string;
  functionSignature?: string;
  relatedContracts: string[];
  relatedInterfaces: string[];
  modifierNames: string[];
  relatedTests: string[];
  neighborhoodLabels: string[];
  compiler: string | null;
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `Replay_${cleaned}`;
}

function basename(relativePath: string): string {
  const parts = relativePath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? relativePath;
}

function stem(relativePath: string): string {
  const file = basename(relativePath);
  const lastDot = file.lastIndexOf(".");
  return lastDot > 0 ? file.slice(0, lastDot) : file;
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

function contractFallbackName(analysis: EvmAnalysisResult): string {
  const preferred = analysis.solidityMeta.contractNames.find(
    (name) => !analysis.solidityMeta.interfaces.includes(name)
  );
  return preferred ?? analysis.solidityMeta.contractNames[0] ?? "TargetContract";
}

function isTestLike(relativePath: string, repoIndex?: RepoIndex): boolean {
  const lower = relativePath.toLowerCase();
  return (
    lower.includes("/test/") ||
    lower.includes("/tests/") ||
    lower.endsWith(".t.sol") ||
    Boolean(repoIndex?.testFiles.includes(relativePath))
  );
}

function scopedSignals(
  analysis: EvmAnalysisResult,
  vulnClass: EvmVulnClass,
  options: EvmPocOptions
): EvmSignal[] {
  const classSignals = analysis.signals.filter((signal) => signal.vulnClass === vulnClass);
  if (!options.seed) return classSignals;

  const sameFile = classSignals.filter((signal) => signal.file === options.seed?.file);
  if (sameFile.length > 0) return sameFile;

  return classSignals;
}

function relevantNeighborhoods(
  options: EvmPocOptions,
  affectedFiles: string[]
): RepoNeighborhood[] {
  return (options.neighborhoods ?? []).filter((neighborhood) =>
    neighborhoodMatchesFiles(neighborhood, affectedFiles)
  );
}

function relatedTests(
  repoIndex: RepoIndex | undefined,
  affectedFiles: string[],
  contractName: string
): string[] {
  if (!repoIndex) return [];

  const fileHints = uniqueStrings([
    ...affectedFiles.map((file) => stem(file).toLowerCase()),
    contractName.toLowerCase(),
  ]);

  return repoIndex.testFiles
    .filter((testFile) => {
      const lower = testFile.toLowerCase();
      return fileHints.some((hint) => lower.includes(hint));
    })
    .slice(0, 6);
}

function buildReplayContext(
  analysis: EvmAnalysisResult,
  signals: EvmSignal[],
  vulnClass: EvmVulnClass | "generic",
  options: EvmPocOptions
): EvmReplayContext {
  const primarySignal = options.seed ?? signals[0];
  const affectedFiles = uniqueStrings(
    signals.map((signal) => signal.file).concat(primarySignal?.file ? [primarySignal.file] : [])
  );
  const neighborhoodFiles = uniqueStrings(
    relevantNeighborhoods(options, affectedFiles).flatMap((neighborhood) => neighborhood.files)
  );
  const primaryFile =
    (primarySignal?.file && !isTestLike(primarySignal.file, options.repoIndex) ? primarySignal.file : undefined) ??
    [...affectedFiles, ...neighborhoodFiles].find((file) => !isTestLike(file, options.repoIndex)) ??
    primarySignal?.file ??
    affectedFiles[0];
  const neighborhoods = relevantNeighborhoods(options, affectedFiles);
  const contractSymbol =
    nearestSymbol(options.repoIndex, primaryFile, primarySignal?.line, ["contract", "library"]) ??
    symbolsForFiles(options.repoIndex, affectedFiles, ["contract", "library"])[0] ??
    symbolsForFiles(options.repoIndex, neighborhoodFiles, ["contract", "library"])[0];
  const functionSymbol =
    nearestSymbol(options.repoIndex, primaryFile, primarySignal?.line, ["function"]) ??
    symbolsForFiles(options.repoIndex, affectedFiles, ["function"])[0];
  const contractName = contractSymbol?.name ?? contractFallbackName(analysis);

  return {
    targetName: options.targetName ?? contractName,
    vulnClass,
    primarySignal,
    signals,
    affectedFiles,
    contractName,
    importPath: contractSymbol?.file ?? (primaryFile?.endsWith(".sol") ? primaryFile : undefined),
    primaryFile,
    functionName: functionSymbol?.name,
    functionSignature: functionSymbol?.signature,
    relatedContracts: uniqueStrings(
      symbolsForFiles(options.repoIndex, [...affectedFiles, ...neighborhoodFiles], ["contract", "library"])
        .map((symbol) => symbol.name)
        .slice(0, 6)
    ),
    relatedInterfaces: uniqueStrings(
      symbolsForFiles(options.repoIndex, [...affectedFiles, ...neighborhoodFiles], ["interface"])
        .map((symbol) => symbol.name)
        .concat(analysis.solidityMeta.interfaces.slice(0, 4))
    ).slice(0, 6),
    modifierNames: uniqueStrings(
      symbolsForFiles(options.repoIndex, affectedFiles, ["modifier"])
        .map((symbol) => symbol.name)
        .slice(0, 4)
    ),
    relatedTests: relatedTests(options.repoIndex, [...affectedFiles, ...neighborhoodFiles], contractName),
    neighborhoodLabels: neighborhoods.map((neighborhood) => neighborhood.label).slice(0, 4),
    compiler: analysis.solidityMeta.compiler,
  };
}

function replayHeader(title: string, context: EvmReplayContext): string {
  return [
    "/**",
    ` * Guided replay: ${title}`,
    ` * Target: ${context.targetName}`,
    " * Proof state: guided_replay (repo-anchored harness draft, not executed)",
    context.primarySignal
      ? ` * Evidence anchor: ${context.primarySignal.file}:${context.primarySignal.line}`
      : "",
    context.functionSignature ? ` * Candidate function: ${context.functionSignature}` : "",
    context.compiler ? ` * Compiler range: ${context.compiler}` : "",
    context.relatedContracts.length > 0
      ? ` * Related contracts: ${context.relatedContracts.join(", ")}`
      : "",
    context.relatedInterfaces.length > 0
      ? ` * Related interfaces: ${context.relatedInterfaces.join(", ")}`
      : "",
    context.modifierNames.length > 0
      ? ` * Nearby modifiers: ${context.modifierNames.join(", ")}`
      : "",
    context.relatedTests.length > 0
      ? ` * Reuse fixture surface: ${context.relatedTests.join(", ")}`
      : "",
    context.neighborhoodLabels.length > 0
      ? ` * Neighborhoods: ${context.neighborhoodLabels.join(", ")}`
      : "",
    context.affectedFiles.length > 0
      ? ` * Affected files: ${context.affectedFiles.join(", ")}`
      : "",
    " */",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderImport(context: EvmReplayContext): string {
  return context.importPath ? `import {${context.contractName}} from "${context.importPath}";` : "";
}

function targetType(context: EvmReplayContext): string {
  return context.importPath ? context.contractName : "address";
}

function commentedLines(lines: string[]): string {
  return lines.map((line) => `        // ${line}`).join("\n");
}

function targetCallLine(context: EvmReplayContext, fallback: string): string {
  if (context.functionName) {
    return `target.${context.functionName}(/* mirror the repo's real arguments from ${context.primaryFile}:${context.primarySignal?.line ?? 1} */);`;
  }
  return fallback;
}

function harnessName(prefix: string, context: EvmReplayContext): string {
  return sanitizeIdentifier(
    `${prefix}_${context.contractName}_${context.functionName ?? context.vulnClass}`,
    `${prefix}_Replay`
  );
}

function oraclePricePoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Oracle / price manipulation", context)}
contract ${harnessName("OracleReplay", context)} is Test {
    ${targetType(context)} internal target;
    address internal attacker = makeAddr("attacker");

    function test_replay_price_path() public {
        // Replay objective: drive the same price-sensitive code path while the oracle or pool state is attacker-controlled.
        // Anchor finding: ${context.primarySignal?.finding ?? "Inspect the flagged oracle path"}.
        // Confirmation hint: ${context.primarySignal?.confirmationHint ?? "Verify the code path trusts spot or stale price data."}
${commentedLines([
  "vm.warp(block.timestamp + 1 days);",
  "Manipulate the oracle or reserve source used by the flagged path before calling the target.",
  targetCallLine(context, `call the price-sensitive entrypoint in ${context.primaryFile ?? "the affected contract"};`),
  "Assert that the attacker receives a better execution price, extra shares, or excess withdrawals.",
])}
    }
}
`.trim();
}

function accessControlPoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Access control bypass", context)}
contract ${harnessName("AccessReplay", context)} is Test {
    ${targetType(context)} internal target;
    address internal attacker = makeAddr("attacker");

    function test_replay_unauthorized_execution() public {
        // Replay objective: show that an unprivileged caller can reach a privileged state transition.
        // Nearby auth surface: ${context.modifierNames.join(", ") || "no explicit modifier indexed in the affected file"}.
${commentedLines([
  "vm.startPrank(attacker);",
  targetCallLine(context, `call the suspected admin path in ${context.primaryFile ?? "the affected contract"};`),
  "vm.stopPrank();",
  "Assert that ownership, balances, fee recipients, or config changed despite attacker privileges.",
])}
    }
}
`.trim();
}

function accountingInvariantPoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Accounting / invariant violation", context)}
contract ${harnessName("AccountingReplay", context)} is Test {
    ${targetType(context)} internal target;
    address internal attacker = makeAddr("attacker");
    address internal victim = makeAddr("victim");

    function test_replay_invariant_break() public {
        // Replay objective: exercise the same deposit / withdraw / mint path until balances or shares drift from protocol expectations.
${commentedLines([
  "Seed the protocol with the same token or asset setup used by the repo's local tests.",
  "Let attacker take the first action on the accounting path (deposit, mint, donate, or withdraw).",
  targetCallLine(context, `re-enter the value-flow path rooted in ${context.primaryFile ?? "the affected contract"};`),
  "Check for rounding gain, inflation, donation skew, or stale-accounting profit after the sequence completes.",
])}
    }
}
`.trim();
}

function upgradeabilityPoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Upgradeability / initializer abuse", context)}
contract ${harnessName("UpgradeReplay", context)} is Test {
    ${targetType(context)} internal target;
    address internal attacker = makeAddr("attacker");

    function test_replay_upgrade_path() public {
        // Replay objective: confirm that initialize / reinitialize / upgrade entrypoints can be reached by the wrong caller or at the wrong time.
${commentedLines([
  "vm.startPrank(attacker);",
  targetCallLine(context, `call the initializer or upgrade entrypoint anchored in ${context.primaryFile ?? "the affected proxy path"};`),
  "vm.stopPrank();",
  "Assert that implementation state, admin slots, or ownership move under attacker control.",
])}
    }
}
`.trim();
}

function actorCall(context: EvmReplayContext): string {
  return context.functionName
    ? `Trigger ${context.functionName} through the attacker-controlled contract so receive() can re-enter.`
    : `Trigger the flagged external-call path in ${context.primaryFile ?? "the affected contract"} through the attacker-controlled contract.`;
}

function reentrancyPoC(context: EvmReplayContext): string {
  const interfaceName = sanitizeIdentifier(`I${context.contractName}`, "ITarget");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Reentrancy", context)}
contract ${harnessName("ReentrancyReplay", context)} is Test {
    ${targetType(context)} internal target;
    ReentrantActor internal actor;

    function setUp() public {
        actor = new ReentrantActor();
    }

    function test_replay_reentrancy_path() public {
        // Replay objective: let the callee regain control before the protocol updates balances or shares.
${commentedLines([
  "Wire actor to the deployed target and fund the vulnerable path.",
  actorCall(context),
  "Assert that the actor drains extra funds or reuses stale accounting state across nested calls.",
])}
    }
}

interface ${interfaceName} {
    ${context.functionSignature ?? "function replayHook() external;"}
}

contract ReentrantActor {
    uint256 internal reentryCount;

    receive() external payable {
        if (reentryCount >= 2) return;
        reentryCount++;
        // Re-enter the same target entrypoint while state is stale.
    }
}
`.trim();
}

function unsafeCallsPoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader("Unsafe external call / token handling", context)}
contract ${harnessName("UnsafeReplay", context)} is Test {
    ${targetType(context)} internal target;
    address internal attacker = makeAddr("attacker");

    function test_replay_external_call_assumption() public {
        // Replay objective: pass a token or callee that behaves differently from the happy-path assumptions in the target code.
${commentedLines([
  "Prepare a fee-on-transfer token, malicious callee, or false-returning token stub depending on the flagged path.",
  "Fund the protocol with balances that make the accounting visible after the call returns.",
  targetCallLine(context, `exercise the unchecked call surface rooted in ${context.primaryFile ?? "the affected contract"};`),
  "Assert that state advances even though the transfer / call / approval path delivered less than expected or silently failed.",
])}
    }
}
`.trim();
}

function genericEvmPoC(context: EvmReplayContext): string {
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
${renderImport(context)}

${replayHeader(`${context.vulnClass} replay`, context)}
contract ${harnessName("GenericReplay", context)} is Test {
    ${targetType(context)} internal target;

    function test_replay_flagged_path() public {
        // Replay objective: confirm the grounded signal by driving the exact file / line path through a local fixture.
        // Finding: ${context.primarySignal?.finding ?? "See grounded analyzer evidence."}
        // Confirmation hint: ${context.primarySignal?.confirmationHint ?? "Confirm that the suspicious path is reachable with attacker-controlled inputs."}
${commentedLines([
  targetCallLine(context, `drive execution into ${context.primaryFile ?? "the affected contract"} at the anchored line.`),
  "Assert the unauthorized state change or economic gain described in the report.",
])}
    }
}
`.trim();
}

export function generateEvmPoC(
  analysis: EvmAnalysisResult,
  targetVulnClass?: EvmVulnClass,
  options: EvmPocOptions = {}
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

  return genericEvmPoC(buildReplayContext(analysis, [], "generic", options));
}

function getPoCForClass(
  analysis: EvmAnalysisResult,
  vulnClass: EvmVulnClass,
  signals: EvmSignal[],
  options: EvmPocOptions
): string {
  const context = buildReplayContext(analysis, signals, vulnClass, options);

  switch (vulnClass) {
    case "oracle_price":
      return oraclePricePoC(context);
    case "access_control":
      return accessControlPoC(context);
    case "accounting_invariant":
      return accountingInvariantPoC(context);
    case "upgradeability":
      return upgradeabilityPoC(context);
    case "reentrancy":
      return reentrancyPoC(context);
    case "unsafe_external":
    case "unchecked_call":
    case "token_handling":
    case "frontrunning":
      return unsafeCallsPoC(context);
    default:
      return genericEvmPoC(context);
  }
}
