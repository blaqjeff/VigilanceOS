/**
 * Solidity / EVM Static Analyzer
 *
 * Extracts structured vulnerability signals from Solidity source files.
 * These signals are evidence fragments for the LLM auditor — NOT final findings.
 *
 * Priority vulnerability classes (from PROJECT_SCOPE.md):
 *   1. Oracle and price manipulation
 *   2. Access control and authorization flaws
 *   3. Accounting and invariant violations
 *   4. Upgradeability and initializer mistakes
 *   5. Unsafe external calls, approvals, token handling, transfer-flow bugs
 *
 * Additional:
 *   - Reentrancy
 *   - Front-running / sandwich
 *   - Integer overflow (pre-0.8)
 *   - Unchecked low-level calls
 *   - ERC-20 quirks
 */

import type { SourceFile } from "../pipeline/types.js";

// ---------------------------------------------------------------------------
// Signal types
// ---------------------------------------------------------------------------

export type EvmVulnClass =
  | "oracle_price"
  | "access_control"
  | "accounting_invariant"
  | "upgradeability"
  | "unsafe_external"
  | "reentrancy"
  | "frontrunning"
  | "integer_issue"
  | "unchecked_call"
  | "token_handling";

export type EvmSignal = {
  vulnClass: EvmVulnClass;
  severityHint: "critical" | "high" | "medium" | "low";
  file: string;
  line: number;
  snippet: string;
  finding: string;
  confirmationHint: string;
};

export type EvmAnalysisResult = {
  signals: EvmSignal[];
  classCounts: Partial<Record<EvmVulnClass, number>>;
  solidityMeta: {
    compiler: string | null;
    contractCount: number;
    contractNames: string[];
    hasProxy: boolean;
    hasInitializer: boolean;
    usesOpenZeppelin: boolean;
    interfaces: string[];
  };
  summary: string;
};

// ---------------------------------------------------------------------------
// Helpers
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

function isComment(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function isInterfaceOnlyFile(file: SourceFile): boolean {
  const content = file.content;
  const hasInterface = /\binterface\s+\w+/.test(content);
  const hasConcreteType = /\b(contract|library)\s+\w+/.test(content);
  return hasInterface && !hasConcreteType;
}

function isPrototypeSignature(lines: string[], startIndex: number): boolean {
  const signature = lines.slice(startIndex, Math.min(lines.length, startIndex + 8)).join(" ");
  const signatureEnd = signature.indexOf(";");
  const bodyStart = signature.indexOf("{");
  return signatureEnd >= 0 && (bodyStart < 0 || signatureEnd < bodyStart);
}

// ---------------------------------------------------------------------------
// 1. Oracle / Price Manipulation
// ---------------------------------------------------------------------------

function analyzeOraclePrice(file: SourceFile): EvmSignal[] {
  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // Chainlink oracle without staleness
    if (/\blatestRoundData\b/.test(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 10)).join(" ");
      if (!/\bupdatedAt\b/.test(context) && !/\btimestamp\b/.test(context) && !/\bstale\b/i.test(context)) {
        signals.push({
          vulnClass: "oracle_price",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Chainlink latestRoundData() without staleness check on updatedAt.",
          confirmationHint: "If updatedAt is not validated, stale prices can be exploited for favorable trades. Check if the heartbeat interval is enforced.",
        });
      }
      // Check for ignored return values
      if (/\(\s*,\s*.*,\s*,\s*,\s*\)/.test(trimmed) || /\(,/.test(trimmed)) {
        signals.push({
          vulnClass: "oracle_price",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "Chainlink latestRoundData() return values partially ignored (roundId, answeredInRound, etc.).",
          confirmationHint: "Ignoring roundId and answeredInRound means stale/incomplete rounds are accepted. Validate answeredInRound >= roundId.",
        });
      }
    }

    // Uniswap slot0 / direct spot price usage
    if (/\bslot0\b/.test(trimmed) && !isComment(trimmed)) {
      signals.push({
        vulnClass: "oracle_price",
        severityHint: "critical",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i, 3),
        finding: "Uniswap slot0() used directly — vulnerable to flash loan / sandwich manipulation.",
        confirmationHint: "slot0 returns the instantaneous price which can be manipulated in a single transaction. Use TWAP from observe() instead.",
      });
    }

    // getReserves for price calculation
    if (/\bgetReserves\b/.test(trimmed) && !isComment(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 8)).join(" ");
      if (/\b(price|rate|value|ratio)\b/i.test(context) || /reserve[01]\s*[*/]/.test(context)) {
        signals.push({
          vulnClass: "oracle_price",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "getReserves() used for on-chain price calculation — flash loan manipulable.",
          confirmationHint: "AMM reserve ratios are manipulable within a single transaction via flash loans. Use a time-weighted oracle.",
        });
      }
    }

    // Division before multiplication in price/share math
    if (/\/.*\*/.test(trimmed) && /\b(amount|share|price|rate|supply|balance)\b/i.test(trimmed)) {
      signals.push({
        vulnClass: "oracle_price",
        severityHint: "medium",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i),
        finding: "Division before multiplication — precision loss in token/share calculation.",
        confirmationHint: "Integer division truncation can be exploited across many transactions to extract excess value (rounding attacks).",
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 2. Access Control
// ---------------------------------------------------------------------------

function analyzeAccessControl(file: SourceFile): EvmSignal[] {
  if (isInterfaceOnlyFile(file)) return [];

  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  // Track which functions have modifiers
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // State-mutating functions without access control
    const funcMatch = trimmed.match(/function\s+(\w+)\s*\(/);
    if (funcMatch) {
      const funcName = funcMatch[1];
      const sensitiveNames = /^(set|update|change|withdraw|transfer|pause|unpause|upgrade|migrate|mint|burn|add|remove|revoke|grant|kill|destroy|selfdestruct)/i;

      if (sensitiveNames.test(funcName)) {
        if (isPrototypeSignature(lines, i)) continue;

        // Get the full function signature (may span multiple lines)
        const sigLines = lines.slice(i, Math.min(lines.length, i + 5)).join(" ");

        const hasModifier = /\b(onlyOwner|onlyAdmin|onlyRole|onlyGovernance|onlyMinter|onlyOperator|whenNotPaused|auth|restricted|requiresAuth)\b/.test(sigLines);
        const isExternal = /\b(external|public)\b/.test(sigLines);
        const isView = /\b(view|pure)\b/.test(sigLines);

        if (isExternal && !hasModifier && !isView) {
          // Check function body for require(msg.sender) or if(msg.sender)
          const body = lines.slice(i, Math.min(lines.length, i + 20)).join(" ");
          const hasInlineCheck = /\bmsg\.sender\b/.test(body) && /\brequire\b|\brevert\b|\bassert\b/.test(body);

          if (!hasInlineCheck) {
            signals.push({
              vulnClass: "access_control",
              severityHint: "critical",
              file: file.relativePath,
              line: i + 1,
              snippet: surrounding(lines, i, 3),
              finding: `Sensitive function '${funcName}' is external/public without access control modifier.`,
              confirmationHint: "Any address can call this function. Verify if access is restricted via inline msg.sender checks or inherited modifiers not visible here.",
            });
          }
        }
      }
    }

    // tx.origin for auth (phishing attack vector)
    if (/\btx\.origin\b/.test(trimmed) && /\brequire\b|\bif\b/.test(trimmed)) {
      signals.push({
        vulnClass: "access_control",
        severityHint: "high",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i, 2),
        finding: "tx.origin used for authorization — phishing/relay attack vector.",
        confirmationHint: "tx.origin returns the EOA that initiated the transaction. A malicious contract can trick users into calling it, forwarding tx.origin auth to the target.",
      });
    }

    // Unprotected selfdestruct
    if (/\bselfdestruct\b|\bsuicide\b/.test(trimmed)) {
      const context = lines.slice(Math.max(0, i - 10), i + 1).join(" ");
      if (!/\bonlyOwner\b|\bowner\b|\brequire\b.*msg\.sender/.test(context)) {
        signals.push({
          vulnClass: "access_control",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "selfdestruct without apparent access control — contract can be destroyed by anyone.",
          confirmationHint: "If any user can trigger selfdestruct, the contract's ETH balance is sent to the caller and all code is erased.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 3. Accounting / Invariant Violations
// ---------------------------------------------------------------------------

function analyzeAccountingInvariant(file: SourceFile): EvmSignal[] {
  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // Share calculation with totalSupply == 0 (first depositor attack / inflation attack)
    if (/\btotalSupply\b/.test(trimmed) && /[\/*]/.test(trimmed)) {
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 5)).join(" ");
      if (!/totalSupply\s*==\s*0|totalSupply\s*>\s*0|totalSupply\s*!=\s*0/.test(context)) {
        signals.push({
          vulnClass: "accounting_invariant",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Share/amount calculation using totalSupply without zero-check — first depositor / vault inflation attack.",
          confirmationHint: "If totalSupply is 0, division by totalSupply reverts, or share calculation can be gamed. Check for dead shares or minimum deposit protections.",
        });
      }
    }

    // Balance vs internal accounting mismatch
    if (/\bbalanceOf\b/.test(trimmed) && !isComment(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 8)).join(" ");
      // Check if balanceOf is compared/used alongside internal tracking
      if (/\b(reserve|_balance|internalBalance|totalDeposits|totalStaked)\b/.test(context)) {
        signals.push({
          vulnClass: "accounting_invariant",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "balanceOf() used alongside internal balance tracking — potential donation/inflation attack vector.",
          confirmationHint: "If the contract uses balanceOf() for accounting, an attacker can donate tokens directly to inflate the balance and skew share calculations.",
        });
      }
    }

    // State updates after external calls (checks-effects-interactions violation)
    if (/\.call\{|\.transfer\(|\.send\(|\.safeTransfer\(/.test(trimmed)) {
      const afterCall = lines.slice(i + 1, Math.min(lines.length, i + 8)).join(" ");
      if (/\b(balance|amount|shares|deposit|stake|reward)\w*\s*[+-]?=/.test(afterCall)) {
        signals.push({
          vulnClass: "accounting_invariant",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 4),
          finding: "State variable updated AFTER external call — checks-effects-interactions pattern violation.",
          confirmationHint: "This ordering enables reentrancy. The external call recipient can re-enter and read stale state. Move state updates before the call.",
        });
      }
    }

    // Mint/burn without total supply update
    if (/\b_mint\b|\b_burn\b/.test(trimmed) && !isComment(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 5)).join(" ");
      if (!/totalSupply/.test(context) && !/_totalSupply/.test(context)) {
        // Custom mint/burn that doesn't update supply
        const broader = lines.slice(Math.max(0, i - 15), Math.min(lines.length, i + 15)).join(" ");
        if (!/\bERC20\b|\bERC721\b|\bERC1155\b/.test(broader)) {
          signals.push({
            vulnClass: "accounting_invariant",
            severityHint: "medium",
            file: file.relativePath,
            line: i + 1,
            snippet: surrounding(lines, i, 2),
            finding: "Custom mint/burn without apparent totalSupply update — supply tracking inconsistency.",
            confirmationHint: "If totalSupply drifts from actual token balances, share and reward calculations break.",
          });
        }
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 4. Upgradeability / Initializer Mistakes
// ---------------------------------------------------------------------------

function analyzeUpgradeability(file: SourceFile): EvmSignal[] {
  if (isInterfaceOnlyFile(file)) return [];

  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);
  const fullContent = file.content;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // Initializer without "initializer" modifier
    if (/function\s+initialize\s*\(/.test(trimmed) || /function\s+init\s*\(/.test(trimmed)) {
      if (isPrototypeSignature(lines, i)) continue;
      const sigLines = lines.slice(i, Math.min(lines.length, i + 5)).join(" ");
      if (!/\binitializer\b/.test(sigLines) && !/\breinitializer\b/.test(sigLines)) {
        signals.push({
          vulnClass: "upgradeability",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Initializer function without 'initializer' modifier — re-initialization attack.",
          confirmationHint: "Without OpenZeppelin's initializer modifier, the function can be called again to reset state (hijack ownership, drain funds).",
        });
      }
    }

    // delegatecall to user-controlled address
    if (/\bdelegatecall\b/.test(trimmed)) {
      const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 3)).join(" ");
      if (!/\bimplementation\b|\b_implementation\b|\b_getImplementation\b/.test(context)) {
        signals.push({
          vulnClass: "upgradeability",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "delegatecall — verify the target address is not user-controllable.",
          confirmationHint: "If the delegatecall target can be influenced by the caller, it enables arbitrary code execution in the proxy's storage context.",
        });
      }
    }

    // Unprotected upgrade function
    if (/\bupgradeTo\b|\bupgradeToAndCall\b|\b_authorizeUpgrade\b/.test(trimmed)) {
      const funcContext = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join(" ");
      if (!/\bonlyOwner\b|\bonlyRole\b|\brequire\b.*msg\.sender|\bonlyProxy\b/.test(funcContext)) {
        signals.push({
          vulnClass: "upgradeability",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Upgrade function without apparent access control — anyone can upgrade the implementation.",
          confirmationHint: "An unprotected _authorizeUpgrade allows any user to replace the implementation, leading to total contract takeover.",
        });
      }
    }

    // Storage collision patterns
    if (/\bstorage\b.*\bslot\b/i.test(trimmed) || /\bassembly\b/.test(trimmed)) {
      const asmBlock = lines.slice(i, Math.min(lines.length, i + 15)).join(" ");
      if (/sstore|sload/.test(asmBlock) && /\b(slot|position|keccak256)\b/.test(asmBlock)) {
        signals.push({
          vulnClass: "upgradeability",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Direct storage slot manipulation — verify no collision with proxy or inherited storage.",
          confirmationHint: "Custom storage slots must not overlap with OpenZeppelin's proxy storage (EIP-1967 slots) or inherited contract variables.",
        });
      }
    }

    // Constructor in upgradeable contract
    if (/\bconstructor\s*\(/.test(trimmed) && /\bUpgradeable\b|\bProxy\b|\binitialize\b/.test(fullContent)) {
      signals.push({
        vulnClass: "upgradeability",
        severityHint: "high",
        file: file.relativePath,
        line: i + 1,
        snippet: surrounding(lines, i, 3),
        finding: "Constructor in upgradeable contract — constructors are not called on proxy instances.",
        confirmationHint: "State set in the constructor only exists on the implementation, not the proxy. Use initializer pattern instead.",
      });
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 5. Unsafe External Calls / Token Handling
// ---------------------------------------------------------------------------

function analyzeUnsafeExternal(file: SourceFile): EvmSignal[] {
  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // Unchecked low-level call
    if (/\.call\{/.test(trimmed) || /\.call\(/.test(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 4)).join(" ");
      if (!/\brequire\b|\bif\s*\(!?\s*success\b|\bassert\b/.test(context) && !/\(bool\s+success/.test(context)) {
        signals.push({
          vulnClass: "unchecked_call",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "Low-level .call() without checking the return value — silent failure.",
          confirmationHint: "If the call fails silently, the contract proceeds as if the transfer succeeded. Funds may be lost or state corrupted.",
        });
      }
    }

    // Unprotected approve (front-running of approve+transferFrom)
    if (/\.approve\(/.test(trimmed) && !isComment(trimmed)) {
      const context = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5)).join(" ");
      if (!/\bsafeApprove\b|\bforceApprove\b|\bsafeIncreaseAllowance\b/.test(context)) {
        // Check if approval amount is not reset to 0 first
        if (!/approve\(\s*\w+\s*,\s*0\s*\)/.test(context)) {
          signals.push({
            vulnClass: "unsafe_external",
            severityHint: "medium",
            file: file.relativePath,
            line: i + 1,
            snippet: surrounding(lines, i, 2),
            finding: "ERC-20 approve() without prior reset to 0 — approval front-running risk.",
            confirmationHint: "approve(X) after approve(Y) allows the spender to spend both Y and X via front-running. Use safeApprove or increaseAllowance.",
          });
        }
      }
    }

    // Arbitrary external call with user-supplied address
    if (/\.(call|delegatecall|staticcall)\b/.test(trimmed)) {
      // Look for function parameter addresses being called
      const funcContext = lines.slice(Math.max(0, i - 20), i + 1).join(" ");
      const hasParamAddress = /function\s+\w+\s*\([^)]*address\s+\w+/.test(funcContext);
      if (hasParamAddress && /delegatecall/.test(trimmed)) {
        signals.push({
          vulnClass: "unsafe_external",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "delegatecall to address parameter — arbitrary code execution in caller's context.",
          confirmationHint: "If the target address comes from a function parameter, an attacker can execute arbitrary logic with the contract's storage and balance.",
        });
      }
    }

    // Transfer-related: missing return value check for non-standard ERC20
    if (/\.transfer\(/.test(trimmed) && !/\bsafeTransfer\b/.test(trimmed) && !/\brequire\b/.test(trimmed)) {
      // Distinguish ETH transfer from ERC20 transfer
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 2)).join(" ");
      if (/\bIERC20\b|\btoken\b|\bERC20\b/i.test(context)) {
        signals.push({
          vulnClass: "token_handling",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "ERC-20 .transfer() without return value check — fails silently with non-standard tokens.",
          confirmationHint: "Some ERC-20 tokens (USDT, BNB) don't return bool. Use SafeERC20.safeTransfer() to handle all cases.",
        });
      }
    }

    // transferFrom without safeTransferFrom
    if (/\.transferFrom\(/.test(trimmed) && !/\bsafeTransferFrom\b/.test(trimmed)) {
      const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 2)).join(" ");
      if (/\bIERC20\b|\btoken\b|\bERC20\b/i.test(context) && !/\brequire\b/.test(trimmed)) {
        signals.push({
          vulnClass: "token_handling",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "ERC-20 .transferFrom() without safeTransferFrom — return value may not be checked.",
          confirmationHint: "Non-standard tokens may not return bool or may return false instead of reverting. Use SafeERC20.",
        });
      }
    }

    // Fee-on-transfer token handling
    if (/\btransferFrom\b/.test(trimmed) && !isComment(trimmed)) {
      const context = lines.slice(i, Math.min(lines.length, i + 8)).join(" ");
      if (/\bamount\b/.test(context) && !/\bbalanceOf\b.*after|after.*\bbalanceOf\b/.test(context)) {
        // Check if the code trusts the amount parameter directly after transfer
        const afterTransfer = lines.slice(i + 1, Math.min(lines.length, i + 5)).join(" ");
        if (/\bamount\b/.test(afterTransfer) && /\b(deposit|stake|mint|credit|balance\s*[+=])/.test(afterTransfer)) {
          signals.push({
            vulnClass: "token_handling",
            severityHint: "high",
            file: file.relativePath,
            line: i + 1,
            snippet: surrounding(lines, i, 4),
            finding: "Amount parameter trusted after transferFrom — vulnerable to fee-on-transfer/rebasing tokens.",
            confirmationHint: "Fee-on-transfer tokens deliver less than the specified amount. Measure balanceOf() before and after to get the actual received amount.",
          });
        }
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// 6. Reentrancy
// ---------------------------------------------------------------------------

function analyzeReentrancy(file: SourceFile): EvmSignal[] {
  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // External call patterns
    const isExternalCall =
      /\.call\{/.test(trimmed) ||
      /\.call\(/.test(trimmed) ||
      /\.transfer\(/.test(trimmed) ||
      /\.send\(/.test(trimmed) ||
      /\.safeTransfer\(/.test(trimmed) ||
      /\.safeTransferFrom\(/.test(trimmed);

    if (isExternalCall) {
      // Check for state updates after the call (CEI violation)
      const afterCall = lines.slice(i + 1, Math.min(lines.length, i + 10)).join(" ");
      const hasStateUpdate = /\b\w+\s*[+-]?=\s/.test(afterCall) &&
        !/\b(bool|uint|int|address|bytes)\b/.test(afterCall.split("=")[0] ?? "");

      // Check for nonReentrant modifier in the function
      const funcStart = findFunctionStart(lines, i);
      const funcHeader = funcStart >= 0 ? lines.slice(funcStart, Math.min(lines.length, funcStart + 5)).join(" ") : "";
      const hasReentrancyGuard = /\bnonReentrant\b|\bReentrancyGuard\b|\block_\b/.test(funcHeader);

      if (hasStateUpdate && !hasReentrancyGuard) {
        signals.push({
          vulnClass: "reentrancy",
          severityHint: "critical",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 4),
          finding: "External call followed by state update without reentrancy guard — CEI pattern violation.",
          confirmationHint: "The callee can re-enter this function before state is updated. Add nonReentrant modifier or move state updates before the external call.",
        });
      }
    }

    // Read-only reentrancy (view function reading state during external call)
    if (/\bview\b/.test(trimmed) && /\bbalanceOf\b|\btotalSupply\b|\bgetReserves\b/.test(lines.slice(i, Math.min(lines.length, i + 15)).join(" "))) {
      // This is just a flag for the LLM to investigate
      const context = lines.slice(i, Math.min(lines.length, i + 15)).join(" ");
      if (/\bcall\b|\btransfer\b/.test(context)) {
        signals.push({
          vulnClass: "reentrancy",
          severityHint: "medium",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "View function reads state that may be inconsistent during a reentrancy — read-only reentrancy vector.",
          confirmationHint: "If this view function is called by another contract during a reentrant call, it may return stale values. Check cross-contract interactions.",
        });
      }
    }
  }

  return signals;
}

function findFunctionStart(lines: string[], currentLine: number): number {
  for (let i = currentLine; i >= Math.max(0, currentLine - 30); i--) {
    if (/\bfunction\s+\w+\s*\(/.test(lines[i])) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 7. Additional: Integer issues (pre-0.8), front-running
// ---------------------------------------------------------------------------

function analyzeAdditional(file: SourceFile): EvmSignal[] {
  const signals: EvmSignal[] = [];
  const lines = getLines(file.content);

  // Detect Solidity version
  const pragmaLine = lines.find((l) => /pragma\s+solidity/.test(l));
  const isPreO8 = pragmaLine && /0\.[4-7]\./.test(pragmaLine);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (isComment(trimmed)) continue;

    // Unchecked blocks in 0.8+ (intentional overflow-allow)
    if (/\bunchecked\b/.test(trimmed) && !isPreO8) {
      const context = lines.slice(i, Math.min(lines.length, i + 8)).join(" ");
      if (/[+\-*]/.test(context) && /\b(balance|amount|supply|share|reward|fee)\b/i.test(context)) {
        signals.push({
          vulnClass: "integer_issue",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 3),
          finding: "unchecked block with arithmetic on financial values — intentional overflow risk.",
          confirmationHint: "Verify the unchecked math is provably safe. If attacker-controlled inputs reach this arithmetic, overflow/underflow enables fund extraction.",
        });
      }
    }

    // Pre-0.8 arithmetic without SafeMath
    if (isPreO8 && /[+\-*]/.test(trimmed) && !/\bSafeMath\b|\bsafe/.test(trimmed)) {
      if (/\b(uint|int)\d*\b/.test(trimmed) && /\b(balance|amount|supply)\b/i.test(trimmed)) {
        signals.push({
          vulnClass: "integer_issue",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i),
          finding: "Pre-0.8 arithmetic on financial values without SafeMath — overflow/underflow.",
          confirmationHint: "Solidity < 0.8 does not revert on overflow. Use SafeMath or upgrade to 0.8+.",
        });
      }
    }

    // Front-running: deadline-sensitive operations without slippage protection
    if (/\bdeadline\b/.test(trimmed) && /block\.timestamp/.test(trimmed)) {
      if (/deadline\s*=\s*block\.timestamp/.test(trimmed)) {
        signals.push({
          vulnClass: "frontrunning",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "Deadline set to block.timestamp — effectively no deadline protection.",
          confirmationHint: "Setting deadline = block.timestamp means every block is a valid deadline. Miners/validators can hold and execute transactions at any time.",
        });
      }
    }

    // Missing slippage protection
    if (/\bamountOutMin\b/.test(trimmed) && !isComment(trimmed)) {
      if (/amountOutMin\s*[:,=]\s*0\b/.test(trimmed)) {
        signals.push({
          vulnClass: "frontrunning",
          severityHint: "high",
          file: file.relativePath,
          line: i + 1,
          snippet: surrounding(lines, i, 2),
          finding: "amountOutMin set to 0 — no slippage protection against sandwich attacks.",
          confirmationHint: "Setting minimum output to 0 allows MEV bots to extract arbitrarily large value via sandwich attacks.",
        });
      }
    }
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzeSolidityEvm(sourceFiles: SourceFile[]): EvmAnalysisResult {
  const solFiles = sourceFiles.filter((f) => f.language === "solidity");

  const allSignals: EvmSignal[] = [];

  for (const file of solFiles) {
    allSignals.push(...analyzeOraclePrice(file));
    allSignals.push(...analyzeAccessControl(file));
    allSignals.push(...analyzeAccountingInvariant(file));
    allSignals.push(...analyzeUpgradeability(file));
    allSignals.push(...analyzeUnsafeExternal(file));
    allSignals.push(...analyzeReentrancy(file));
    allSignals.push(...analyzeAdditional(file));
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = allSignals.filter((s) => {
    const key = `${s.file}:${s.line}:${s.vulnClass}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Class counts
  const classCounts: Partial<Record<EvmVulnClass, number>> = {};
  for (const s of deduped) {
    classCounts[s.vulnClass] = (classCounts[s.vulnClass] ?? 0) + 1;
  }

  // Metadata extraction
  const allContent = solFiles.map((f) => f.content).join("\n");

  const compilerMatch = allContent.match(/pragma\s+solidity\s+([^;]+);/);
  const compiler = compilerMatch?.[1]?.trim() ?? null;

  const contractMatches = allContent.match(/\b(contract|library|interface)\s+(\w+)/g) ?? [];
  const contractNames = contractMatches
    .map((m) => m.match(/\b(?:contract|library|interface)\s+(\w+)/)?.[1] ?? "")
    .filter(Boolean);

  const contractCount = contractNames.length;

  const hasProxy = /\bProxy\b|\bUpgradeable\b|\bUUPS\b|\bTransparent\b|\bdelegatecall\b/.test(allContent);
  const hasInitializer = /\binitialize\b|\binitializer\b/.test(allContent);
  const usesOpenZeppelin = /\b@openzeppelin\b|\bOpenZeppelin\b|\bOwnableUpgradeable\b|\bAccessControl\b/.test(allContent);

  const interfaceMatches = allContent.match(/\bI[A-Z]\w+\b/g) ?? [];
  const interfaces = [...new Set(interfaceMatches)].slice(0, 20);

  const solidityMeta = {
    compiler,
    contractCount,
    contractNames: contractNames.slice(0, 20),
    hasProxy,
    hasInitializer,
    usesOpenZeppelin,
    interfaces,
  };

  // Summary
  const totalSignals = deduped.length;
  const criticals = deduped.filter((s) => s.severityHint === "critical").length;
  const highs = deduped.filter((s) => s.severityHint === "high").length;

  const classBreakdown = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cls, count]) => `  ${cls}: ${count}`)
    .join("\n");

  const summary = [
    `=== SOLIDITY/EVM STATIC ANALYSIS ===`,
    `Compiler: ${compiler ?? "unknown"}`,
    `Contracts: ${contractCount} (${contractNames.slice(0, 8).join(", ")}${contractCount > 8 ? "..." : ""})`,
    `Proxy: ${hasProxy ? "yes" : "no"}, Initializer: ${hasInitializer ? "yes" : "no"}, OpenZeppelin: ${usesOpenZeppelin ? "yes" : "no"}`,
    `Interfaces: ${interfaces.slice(0, 10).join(", ") || "none"}`,
    ``,
    `Signals found: ${totalSignals} (${criticals} critical, ${highs} high)`,
    classBreakdown,
    ``,
    totalSignals > 0
      ? `The following signals are EVIDENCE, not final findings. Use them to build a grounded, specific, defensible vulnerability report.`
      : `No obvious vulnerability signals detected in static analysis. Proceed with manual-depth LLM reasoning.`,
  ].join("\n");

  return { signals: deduped, classCounts, solidityMeta, summary };
}

/**
 * Format EVM analysis signals for the LLM prompt.
 */
export function formatEvmSignalsForPrompt(result: EvmAnalysisResult): string {
  if (result.signals.length === 0) {
    return result.summary;
  }

  const sections: string[] = [result.summary, ""];

  const criticals = result.signals.filter((s) => s.severityHint === "critical");
  const highs = result.signals.filter((s) => s.severityHint === "high");
  const mediums = result.signals.filter((s) => s.severityHint === "medium");

  function formatGroup(title: string, signals: EvmSignal[]): void {
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
