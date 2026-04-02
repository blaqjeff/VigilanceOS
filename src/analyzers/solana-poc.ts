/**
 * Solana / Anchor PoC Template Generator
 *
 * Generates runnable (or near-runnable) Anchor test harnesses
 * based on the vulnerability class and analysis signals.
 */

import type { VulnClass, AnalysisSignal, SolanaAnalysisResult } from "./solana.js";

// ---------------------------------------------------------------------------
// PoC templates per vulnerability class
// ---------------------------------------------------------------------------

function oracleAccountingPoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// PoC: Oracle / Accounting Logic Exploit
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)
//
// This test demonstrates exploitation of arithmetic or oracle logic flaws.
// Adapt the instruction names and account structs to match the target program.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { expect } from "chai";

describe("Oracle/Accounting Exploit", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // TODO: Replace with actual program IDL import
  // const program = anchor.workspace.TargetProgram as Program<TargetProgram>;

  it("demonstrates precision loss via division-before-multiplication", async () => {
    // 1. Set up initial state with a known balance
    // const initialBalance = new anchor.BN(1_000_000);

    // 2. Execute many small transactions that individually truncate
    // for (let i = 0; i < 100; i++) {
    //   await program.methods.swap(smallAmount).accounts({...}).rpc();
    // }

    // 3. Assert that attacker extracted more value than expected
    // const finalBalance = await getBalance(attackerAccount);
    // expect(finalBalance.toNumber()).to.be.greaterThan(expectedBalance);

    console.log("TODO: Implement against target program");
  });

  it("demonstrates stale oracle price exploitation", async () => {
    // 1. Set up oracle to return a stale price
    // const stalePrice = { price: 100, lastUpdate: oldTimestamp };

    // 2. Execute trade at stale (advantageous) price
    // await program.methods.trade(amount).accounts({
    //   oracle: staleOracleAccount,
    //   ...
    // }).rpc();

    // 3. Assert profit from price discrepancy
    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

function ownershipValidationPoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// PoC: Account Ownership Validation Bypass
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)
//
// This test demonstrates passing a fake account that is accepted
// because the program does not validate the account's owner.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";

describe("Ownership Validation Bypass", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("passes a fake data account owned by system program", async () => {
    // 1. Create a fake account with carefully crafted data
    const fakeAccount = Keypair.generate();

    // 2. Write data that mimics the expected account structure
    // const fakeData = Buffer.alloc(ACCOUNT_SIZE);
    // fakeData.write(DISCRIMINATOR, 0);
    // fakeData.writeBigUInt64LE(BigInt(FAKE_BALANCE), 8);

    // 3. Pass the fake account to the vulnerable instruction
    // The program deserializes it without checking the owner
    // await program.methods.vulnerableInstruction().accounts({
    //   dataAccount: fakeAccount.publicKey,
    //   ...
    // }).rpc();

    // 4. Assert that the program accepted the fake data
    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

function signerAuthorityPoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// PoC: Missing Signer / Authority Check
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)
//
// This test demonstrates that a state-mutating instruction can be called
// by an unauthorized user because the signer check is missing.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";
import { expect } from "chai";

describe("Missing Authority Check", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const attacker = Keypair.generate();

  before(async () => {
    // Fund the attacker
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  });

  it("attacker calls admin-only function without authority", async () => {
    // 1. Initialize program state with legitimate admin
    // await program.methods.initialize().accounts({
    //   authority: provider.wallet.publicKey,
    //   ...
    // }).rpc();

    // 2. Attacker calls a restricted function
    // const attackerProvider = new anchor.AnchorProvider(
    //   provider.connection,
    //   new anchor.Wallet(attacker),
    //   {}
    // );
    // const attackerProgram = new Program(IDL, PROGRAM_ID, attackerProvider);

    // 3. This should fail but succeeds due to missing signer check
    // await attackerProgram.methods.withdraw(drainAmount).accounts({
    //   authority: attacker.publicKey, // NOT the real authority
    //   vault: vaultAccount,
    //   ...
    // }).rpc();

    // 4. Assert funds were drained
    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

function pdaMisusePoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// PoC: PDA Derivation / Seed Misuse
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)
//
// This test demonstrates exploitation of non-canonical bump seeds
// or seed collision to create duplicate/conflicting PDAs.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

describe("PDA Seed Misuse", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("demonstrates bump seed canonicalization bypass", async () => {
    // 1. Find the canonical bump
    // const [pda, canonicalBump] = PublicKey.findProgramAddressSync(
    //   [Buffer.from("vault"), user.publicKey.toBuffer()],
    //   program.programId
    // );

    // 2. Try non-canonical bumps (255 down to canonicalBump+1)
    // for (let bump = 255; bump > canonicalBump; bump--) {
    //   try {
    //     const nonCanonical = PublicKey.createProgramAddressSync(
    //       [Buffer.from("vault"), user.publicKey.toBuffer(), Buffer.from([bump])],
    //       program.programId
    //     );
    //     // If the program accepts this, it's vulnerable
    //     // Multiple PDAs can be created for the same logical entity
    //   } catch {}
    // }

    console.log("TODO: Implement against target program");
  });

  it("demonstrates seed collision for global singleton", async () => {
    // If PDA uses only static seeds (e.g., b"config"):
    // 1. Two users calling init with same static seed
    // 2. Second call should fail or overwrite first
    // 3. Assert state corruption or unauthorized access

    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

function cpiEscalationPoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  return `
// PoC: CPI Privilege Escalation
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)
//
// This test demonstrates substituting a malicious program in a CPI call
// because the target program ID is not validated.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { expect } from "chai";

describe("CPI Privilege Escalation", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("substitutes malicious program in CPI call", async () => {
    // 1. Deploy a malicious program that mimics the expected interface
    // but executes arbitrary logic (e.g., drains funds to attacker)

    // 2. Pass malicious program's ID as the "token_program" or
    // other unvalidated program account

    // 3. The vulnerable program invokes the malicious program
    // with its PDA authority, unknowingly granting access

    // await program.methods.delegatedAction().accounts({
    //   tokenProgram: maliciousProgramId, // Should be SPL Token
    //   authority: pdaAuthority,
    //   vault: vaultAccount,
    //   ...
    // }).rpc();

    // 4. Assert that the malicious program executed with the PDA's authority
    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

function genericPoC(signals: AnalysisSignal[]): string {
  const affectedFiles = [...new Set(signals.map((s) => s.file))].join(", ");
  const topSignal = signals[0];
  return `
// PoC: ${topSignal?.vulnClass ?? "Generic"} Vulnerability
// Affected files: ${affectedFiles}
// Framework: Anchor (TypeScript test)

import * as anchor from "@coral-xyz/anchor";
import { expect } from "chai";

describe("Vulnerability PoC", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  it("demonstrates the vulnerability", async () => {
    // Finding: ${topSignal?.finding ?? "See analysis signals"}
    // Confirmation: ${topSignal?.confirmationHint ?? "See analysis signals"}
    console.log("TODO: Implement against target program");
  });
});
`.trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateSolanaPoC(
  analysis: SolanaAnalysisResult,
  targetVulnClass?: VulnClass
): string {
  // If a specific class is requested, generate that template
  if (targetVulnClass) {
    const classSignals = analysis.signals.filter((s) => s.vulnClass === targetVulnClass);
    return getPoCForClass(targetVulnClass, classSignals.length > 0 ? classSignals : analysis.signals);
  }

  // Otherwise, generate for the highest-severity class with the most signals
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

  return genericPoC([]);
}

function getPoCForClass(vulnClass: VulnClass, signals: AnalysisSignal[]): string {
  switch (vulnClass) {
    case "oracle_accounting":
      return oracleAccountingPoC(signals);
    case "ownership_validation":
      return ownershipValidationPoC(signals);
    case "signer_authority":
      return signerAuthorityPoC(signals);
    case "pda_misuse":
      return pdaMisusePoC(signals);
    case "cpi_escalation":
      return cpiEscalationPoC(signals);
    default:
      return genericPoC(signals);
  }
}
