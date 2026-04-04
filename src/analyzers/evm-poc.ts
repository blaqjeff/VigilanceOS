/**
 * Solidity / EVM PoC Template Generator
 *
 * Generates draft Foundry exploit-harness templates that still require
 * target-specific wiring and validation before they should be treated
 * as replayable proof.
 */

import type { EvmVulnClass, EvmSignal, EvmAnalysisResult } from "./evm.js";

// ---------------------------------------------------------------------------
// PoC templates per vulnerability class
// ---------------------------------------------------------------------------

function oraclePricePoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
// TODO: Import the target contract
// import {TargetContract} from "src/TargetContract.sol";

/**
 * PoC: Oracle / Price Manipulation
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 *
 * Demonstrates exploitation of stale oracle prices or flash-loan
 * manipulable price feeds to extract value.
 */
contract OraclePriceExploit is Test {
    // TODO: declare target contract and mock oracle

    function setUp() public {
        // Deploy target contract
        // Deploy or mock the oracle (Chainlink aggregator, Uniswap pool, etc.)
        // Fund the attacker with initial capital
    }

    function testStaleOracleExploit() public {
        // 1. Warp time forward to make oracle stale
        // vm.warp(block.timestamp + 1 days);

        // 2. Execute trade at stale (favorable) price
        // target.swap(amount, minOut);

        // 3. Assert attacker profit
        // assertGt(token.balanceOf(address(this)), initialBalance);
    }

    function testFlashLoanPriceManipulation() public {
        // 1. Take flash loan to acquire large token position
        // 2. Manipulate pool reserves / spot price
        // 3. Execute operation at manipulated price
        // 4. Restore pool state and repay flash loan
        // 5. Assert profit from price discrepancy
    }

    function testPrecisionLossExtraction() public {
        // 1. Execute many small swaps/deposits
        // for (uint i = 0; i < 100; i++) {
        //     target.deposit(smallAmount);
        //     target.withdraw(shares);
        // }
        // 2. Assert accumulated rounding profit
        // assertGt(token.balanceOf(address(this)), totalDeposited);
    }
}
`.trim();
}

function accessControlPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
// TODO: Import the target contract

/**
 * PoC: Access Control Bypass
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 *
 * Demonstrates that a privileged function can be called by
 * an unauthorized address due to missing access control.
 */
contract AccessControlExploit is Test {
    address attacker = makeAddr("attacker");
    address owner = makeAddr("owner");

    function setUp() public {
        // Deploy target as owner
        // vm.prank(owner);
        // target = new TargetContract();
    }

    function testUnauthorizedWithdraw() public {
        // Fund the contract
        // deal(address(token), address(target), 100 ether);

        // Attacker calls the unprotected function
        // vm.prank(attacker);
        // target.withdraw(address(token), 100 ether, attacker);

        // Assert attacker received the funds
        // assertEq(token.balanceOf(attacker), 100 ether);
    }

    function testUnauthorizedAdminAction() public {
        // Attacker calls admin function without role
        // vm.prank(attacker);
        // target.setFeeRecipient(attacker);

        // Assert state was changed
        // assertEq(target.feeRecipient(), attacker);
    }

    function testTxOriginPhishing() public {
        // 1. Deploy malicious contract
        // MaliciousRelay relay = new MaliciousRelay(address(target));

        // 2. Victim (the owner) calls the malicious contract
        // vm.prank(owner);
        // relay.innocentFunction(); // internally calls target using tx.origin

        // 3. Assert privilege escalation
    }
}
`.trim();
}

function accountingInvariantPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
// TODO: Import the target vault/pool contract

/**
 * PoC: Accounting / Invariant Violation
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 *
 * Demonstrates exploitation of share calculation bugs,
 * first-depositor attacks, or donation attacks.
 */
contract AccountingExploit is Test {
    address attacker = makeAddr("attacker");
    address victim = makeAddr("victim");

    function setUp() public {
        // Deploy vault/pool
        // Mint tokens for attacker and victim
    }

    function testFirstDepositorAttack() public {
        // 1. Attacker deposits minimal amount (e.g., 1 wei)
        // vm.prank(attacker);
        // vault.deposit(1);

        // 2. Attacker donates large amount directly to vault
        // token.transfer(address(vault), 1_000_000e18);

        // 3. Victim deposits
        // vm.prank(victim);
        // vault.deposit(500_000e18);
        // Victim gets 0 shares due to rounding

        // 4. Attacker withdraws everything
        // vm.prank(attacker);
        // vault.withdraw(vault.balanceOf(attacker));
        // assertGt(token.balanceOf(attacker), 1_000_000e18);
    }

    function testDonationAttack() public {
        // 1. Normal deposits establish share price
        // 2. Attacker donates tokens directly to inflate balanceOf
        // 3. Share calculations break for subsequent users
    }

    function testReentrancyAccountingSkew() public {
        // 1. Deposit into vault
        // 2. During withdrawal callback, re-enter and deposit again
        // 3. State was not updated, so shares are minted at stale price
    }
}
`.trim();
}

function upgradeabilityPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
// TODO: Import the proxy and implementation contracts

/**
 * PoC: Upgradeability / Initializer Exploit
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 *
 * Demonstrates re-initialization of an upgradeable contract
 * or unauthorized upgrade of the implementation.
 */
contract UpgradeExploit is Test {
    address attacker = makeAddr("attacker");

    function setUp() public {
        // Deploy proxy + implementation
        // Initialize with legitimate owner
    }

    function testReinitializeHijack() public {
        // Attacker calls initialize again on the proxy
        // vm.prank(attacker);
        // proxy.initialize(attacker); // takes over ownership

        // Assert attacker is now the owner
        // assertEq(proxy.owner(), attacker);
    }

    function testUninitializedImplementation() public {
        // The implementation contract behind the proxy was never initialized
        // Attacker initializes it directly
        // vm.prank(attacker);
        // implementation.initialize(attacker);

        // Attacker can now selfdestruct the implementation
        // breaking the proxy permanently
    }

    function testUnauthorizedUpgrade() public {
        // Deploy a malicious implementation
        // MaliciousImpl malicious = new MaliciousImpl();

        // Attacker upgrades via unprotected upgradeTo
        // vm.prank(attacker);
        // proxy.upgradeTo(address(malicious));

        // Assert the implementation changed
        // The proxy now delegates to attacker-controlled code
    }
}
`.trim();
}

function reentrancyPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
// TODO: Import the target contract

/**
 * PoC: Reentrancy Attack
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 */
contract ReentrancyExploit is Test {
    // Attacker contract that re-enters on receive
    AttackerContract attackerContract;

    function setUp() public {
        // Deploy target
        // Deploy attacker contract
        // Fund target with ETH/tokens
    }

    function testReentrancyDrain() public {
        // 1. Attacker deposits
        // attackerContract.deposit{value: 1 ether}();

        // 2. Attacker triggers withdrawal — re-enters on receive
        // attackerContract.attack();

        // 3. Assert target was drained
        // assertEq(address(target).balance, 0);
        // assertGt(address(attackerContract).balance, 1 ether);
    }
}

contract AttackerContract {
    // address target;
    // uint256 reenterCount;

    // receive() external payable {
    //     if (reenterCount < 5) {
    //         reenterCount++;
    //         ITarget(target).withdraw();
    //     }
    // }

    // function attack() external {
    //     ITarget(target).withdraw();
    // }

    // function deposit() external payable {
    //     ITarget(target).deposit{value: msg.value}();
    // }
}
`.trim();
}

function unsafeCallsPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * PoC: Unsafe External Call / Token Handling
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 */
contract UnsafeCallExploit is Test {
    function setUp() public {
        // Deploy target
        // Deploy fee-on-transfer mock token
    }

    function testFeeOnTransferDrain() public {
        // 1. Use a fee-on-transfer token
        // 2. Deposit 100 tokens (only 99 arrive due to 1% fee)
        // 3. Contract credits 100 to user's balance
        // 4. Withdraw 100 — drains 1 extra token per deposit
    }

    function testUncheckedCallSilentFailure() public {
        // 1. Target calls .call() without checking return value
        // 2. Call fails but execution continues
        // 3. State is updated as if transfer succeeded
    }

    function testApprovalFrontrun() public {
        // 1. User approves spender for 100 tokens
        // 2. User sends tx to change approval to 50
        // 3. Spender front-runs: spends 100, then spends 50 after new approval
        // 4. Total spent: 150 instead of max(100, 50)
    }
}
`.trim();
}

function genericEvmPoC(signals: EvmSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  const top = signals[0];
  return `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * PoC: ${top?.vulnClass ?? "Generic"} Vulnerability
 * Affected files: ${affectedFiles}
 * Framework: Foundry
 */
contract VulnerabilityPoC is Test {
    function setUp() public {
        // Deploy target contract
    }

    function testExploit() public {
        // Finding: ${top?.finding ?? "See static analysis signals"}
        // Confirm: ${top?.confirmationHint ?? "See analysis signals"}
    }
}
`.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateEvmPoC(
  analysis: EvmAnalysisResult,
  targetVulnClass?: EvmVulnClass
): string {
  if (targetVulnClass) {
    const classSignals = analysis.signals.filter((s) => s.vulnClass === targetVulnClass);
    return getPoCForClass(targetVulnClass, classSignals.length > 0 ? classSignals : analysis.signals);
  }

  // Pick highest severity class
  const criticalSignals = analysis.signals.filter((s) => s.severityHint === "critical");
  if (criticalSignals.length > 0) {
    const topClass = criticalSignals[0].vulnClass;
    return getPoCForClass(topClass, criticalSignals.filter((s) => s.vulnClass === topClass));
  }

  const highSignals = analysis.signals.filter((s) => s.severityHint === "high");
  if (highSignals.length > 0) {
    const topClass = highSignals[0].vulnClass;
    return getPoCForClass(topClass, highSignals.filter((s) => s.vulnClass === topClass));
  }

  if (analysis.signals.length > 0) {
    return getPoCForClass(analysis.signals[0].vulnClass, analysis.signals);
  }

  return genericEvmPoC([]);
}

function getPoCForClass(vulnClass: EvmVulnClass, signals: EvmSignal[]): string {
  switch (vulnClass) {
    case "oracle_price":
      return oraclePricePoC(signals);
    case "access_control":
      return accessControlPoC(signals);
    case "accounting_invariant":
      return accountingInvariantPoC(signals);
    case "upgradeability":
      return upgradeabilityPoC(signals);
    case "reentrancy":
      return reentrancyPoC(signals);
    case "unsafe_external":
    case "unchecked_call":
    case "token_handling":
      return unsafeCallsPoC(signals);
    default:
      return genericEvmPoC(signals);
  }
}
