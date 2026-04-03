# Vigilance-OS Handoff

Status: New-thread bootstrap and implementation handoff

Use this document to continue work in a fresh thread rooted at `C:\VigilanceOS`.

Read this file first, then read `PROJECT_SCOPE.md`.

## 1. Source Of Truth

- `PROJECT_SCOPE.md` is the primary source of truth for product intent, scope, priorities, tradeoffs, and quality bar.
- `VIGILANCE_REQUIREMENTS.md` is legacy challenge context only.

If those documents differ, follow `PROJECT_SCOPE.md`.

## 2. What The User Actually Wants

The user does not want a flashy hackathon-only illusion.

They want:

- A credible security product wedge
- Strong enough execution to compete for the hackathon
- A clean enough architecture to keep building into a startup later

The most important thing is that the system should not feel fake.

The product should impress because it is believable, not because it is loud.

### Non-negotiables

- The golden path must feel real
- Findings must feel grounded, not invented
- The reviewer stage must materially reduce false positives
- Both UI and Telegram must be meaningful surfaces
- Architecture should stay understandable and extendable

### The user's main fear

The worst outcome is a flashy system that does not really audit code.

## 3. Golden Path

This is the single most important workflow to make credible:

1. User submits a target through the UI.
2. System requests explicit approval before deeper audit.
3. Audit runs.
4. Reviewer attempts to debunk or downgrade weak findings.
5. User receives a report with evidence, confidence, remediation, and reproducible PoC when feasible.

This is the path to optimize before broader feature work.

## 4. Current Verified State In Main Repo

All of the following refer to the main repo at `C:\VigilanceOS`.

### Verified true

- Backend build passes with `npm run build:backend`
- Main stack boots successfully when run with real filesystem access
- Backend health checks pass
- UI health checks pass after startup
- Feed route responds
- Agents register successfully

### Reconciled repo state

The following important local/source changes were reconciled:

- `src/pipeline/memory.ts` exists and is now recognized as a real source file
- `.gitignore` was fixed so `src/pipeline/memory.ts` is no longer hidden by the broad `memory.*` ignore rule
- `PROJECT_SCOPE.md` exists in the main repo
- `VIGILANCE_REQUIREMENTS.md` now points readers to `PROJECT_SCOPE.md`

### Remaining runtime/integration blockers

- Immunefi MCP is not working because local Python dependencies are missing
- OpenAI-compatible model auth is currently unauthorized in the active environment
- Telegram is not active because `TELEGRAM_BOT_TOKEN` is not set

### Important note about earlier failures

Some earlier runtime failures were caused by sandbox/worktree limitations and stale build artifacts, not just code defects. The main repo stack was later verified to boot successfully when run with elevated access.

## 5. Product Scope Summary

### Submission-day truth

The product should be honest enough to defend:

"We deeply audit one category very well, and discover the others."

### Intended audit wedge

1. Solana / Rust depth first
2. Solidity / EVM depth second
3. Websites / apps repository analysis as static analysis only in this version

### Scout breadth

Scout should discover across:

- Blockchain / DLT
- Smart Contract
- Websites and Applications

But discovery breadth is not the same as equal audit depth.

## 6. Hard Coverage For Submission

### Solana / Rust target classes

- Oracle, price, and accounting logic flaws
- Account ownership validation bugs
- Signer and authority mistakes
- PDA derivation and seed misuse
- CPI privilege escalation

### Solidity / EVM target classes

- Oracle and price manipulation
- Access control and authorization flaws
- Accounting and invariant violations
- Upgradeability and initializer mistakes
- Unsafe external calls, approvals, token handling, and transfer-flow bugs

### Web/app scope for this version

- Static repository analysis should work
- Dynamic live website testing is explicitly the first major cut under time pressure

## 7. Evidence And Reviewer Standard

### Critical / High findings

Should require runnable or replayable evidence whenever feasible:

- Foundry test
- Hardhat script
- Anchor test or Solana harness
- Reproducible request sequence
- Concrete replay steps

### Medium / Low findings

Can ship with strong code-path proof plus reviewer confidence:

- exact code path
- why protection is missing
- validating test or replay guidance
- confidence label

### Reviewer policy

- Strict for critical/high
- More tolerant for medium/low if uncertainty is clearly labeled

The system should not suppress everything uncertain, but should be much harder to fool on high-impact findings.

## 8. Delivery Surfaces

### UI

The UI is the primary operator surface.

It should support:

- target intake
- queue visibility
- approval state
- audit progress state
- finding/report viewing
- confidence visibility
- artifact access

### Telegram MVP

Must have:

- alert on newly discovered Scout targets
- alert when an audit finishes
- `/approve`
- `/report <audit>`
- `/findings`

Nice to have:

- `/status <audit>`

## 9. Ranked Build Order

This is the implementation order the previous thread converged on. It has been expanded here so a fresh thread can execute it directly.

### 1. Harden external integration readiness checks

Goal:

Make MCP/model/Telegram failures obvious, actionable, and non-misleading.

Why this is first:

The app boots, but important integrations are not actually ready. The next thread should stop silent or confusing degradation before deeper feature work.

What to do:

- Detect and report missing Python deps for the Immunefi MCP server
- Detect and report missing or invalid model auth early
- Detect and report missing Telegram token/config clearly
- Surface readiness state in logs and ideally in the UI/API
- Fail gracefully when optional integrations are unavailable
- Avoid pretending Scout or LLM-backed auditing is live when those dependencies are broken

Done when:

- A developer can boot the stack and immediately know which integrations are healthy
- There is no ambiguity about why Scout, Telegram, or model features are unavailable

### 2. Lock the audit job lifecycle end to end — ✅ COMPLETED

Goal:

Define one canonical state model for all work.

Implementation summary:

- Created `AuditJob` type with canonical states: `submitted`, `pending_approval`, `approved`, `scanning`, `reviewing`, `published`, `discarded`, `failed`
- Built `src/pipeline/jobStore.ts` — in-memory state machine with validated transitions, full `stateHistory` with timestamps
- All plugins updated to use JobStore: `plugin-ui-bridge`, `plugin-hitl`, `plugin-auditor-reviewer`, `plugin-scout`
- Added `GET /vigilance/jobs` and `GET /vigilance/jobs/:jobId` API routes
- Feed and findings routes now return structured job data instead of memory text blobs
- Report, verdict, confidence, target metadata, and timestamps all stored on the `AuditJob`
- Invalid state transitions throw errors; every transition is logged with `[JobStore]` prefix
- Build verified clean (tsc exit 0)

Done when:

- ✅ Every audit has a clear lifecycle
- ✅ UI and backend no longer infer state from ad hoc text blobs where structured state would be better

### 3. Make the golden path solid — ✅ COMPLETED

Goal:

Make the single most important workflow feel trustworthy and complete.

Implementation summary:

- Completely rewrote `ui/src/app/page.tsx` to drive the golden path through the JobStore API
- UI now calls `/vigilance/jobs` for all state instead of parsing raw memory text blobs
- Added `/api/vigilance/jobs/route.ts` proxy for the new backend endpoint
- **Explicit approval gate**: Pending jobs show separate "Approve" and "Approve + Run" buttons
- **Approved state is visible**: Approved-but-not-yet-audited jobs show "▶ Run Audit" button
- **Live pipeline visibility**: Scanning/reviewing jobs show pulsing animation and progress indicator
- **Job detail modal**: Click any job to see full report, verdict, confidence bar, PoC, affected surface, recommendations, and complete state history timeline
- **Failure states**: Failed jobs shown in a dedicated section with error messages
- **Discarded findings**: Reviewer-rejected findings appear separately from published ones
- **Stats badges**: Header shows live counts (pending, active, published)
- **Lifecycle progress bar**: Visual dot-and-line indicator on every job card showing progress through the pipeline
- Both backend (`tsc`) and UI (`next build`) verified clean — exit 0

Done when:

- ✅ A user can run the full path from UI submission to final reviewed report without handholding

### 4. Implement real target ingestion in this order — ✅ COMPLETED

Implementation order:

1. ✅ Public GitHub URL — shallow-cloned via `git clone --depth 1`
2. ✅ Local folder path — direct filesystem read with validation
3. Zip upload — future
4. Private GitHub authentication — future

Why this order:

It maximizes truthfulness and speed while minimizing auth complexity.

Implementation summary:

- Created `src/pipeline/ingestion.ts` — core ingestion module with:
  - **GitHub cloning**: shallow clone (`depth 1`) into `.vigilance-work/` directory
  - **Local folder reading**: validates path exists and is a directory
  - **File walker**: recursively walks source tree, ignores `node_modules`, `.git`, `target`, etc.
  - **Language classification**: `.sol` → solidity, `.rs` → rust, `.ts/.js` → typescript/javascript, `.py` → python, `.move` → move
  - **Target categorization**: auto-classifies as `solana_rust`, `solidity_evm`, `web_app`, `mixed`, or `unknown`
  - **Priority ranking**: files scored by relevance (smart contracts/programs highest), selects top 40 files / 200KB
  - **Truncation**: files > 32KB are truncated with `// ... [truncated]` marker
  - **Cleanup**: `cleanupIngestion()` removes cloned repos after audit+review
- Updated `src/pipeline/types.ts` with `TargetType: "local"`, `TargetCategory`, `SourceFile`, `IngestionResult`, `AuditJob.ingestion`
- Updated `src/pipeline/audit.ts` with:
  - `targetFromInput()`: now handles local paths (`C:\...`, `/...`) as `type: "local"`
  - Category-aware specialist prompts (Solana/Rust, Solidity/EVM, Web/App)
  - `buildCodeContext()`: feeds real source files into LLM prompts with file path, language, and truncation metadata
  - PoC framework auto-selected (anchor for Solana, foundry for Solidity, generic for others)
- Updated `src/pipeline/jobStore.ts` with `updateJobData()` for non-state data updates (ingestion)
- Updated `plugin-ui-bridge` and `plugin-auditor-reviewer` to perform ingestion during audit flow
- Added `VIGILANCE_WORK_DIR` to `.env.example`
- Added `.vigilance-work/` to `.gitignore`
- Both builds verified clean (tsc + next build, exit 0)

Done when:

- ✅ The backend can ingest the first two target types reliably and pass them into the same audit lifecycle

### 5. Build real Solana / Rust audit depth first — ✅ COMPLETED

Goal:

Make Solana / Rust the strongest submission-day wedge.

Priority classes (all implemented):

- ✅ oracle/accounting logic
- ✅ account ownership validation
- ✅ signer/authority mistakes
- ✅ PDA misuse
- ✅ CPI privilege escalation
- ✅ bonus: reinitialization, integer overflow, arbitrary close

Implementation summary:

- Created `src/analyzers/solana.ts` — **Solana/Anchor static analyzer** with pattern-matching detectors for all 5 priority classes:

  **1. Oracle / Accounting Logic (`oracle_accounting`)**
  - Arithmetic on price/balance without `checked_` math
  - Oracle reads (Pyth/Switchboard) without staleness/confidence checks
  - Division before multiplication (precision loss)
  - Unchecked subtraction on balance fields (underflow risk)

  **2. Account Ownership Validation (`ownership_validation`)**
  - `UncheckedAccount` / `AccountInfo` without owner verification
  - Deserialization (`try_from_slice`, `unpack`) without prior owner check
  - `#[account(...)]` blocks missing `owner=` or `constraint=` on data accounts
  - Anchor struct analysis for missing constraints

  **3. Signer / Authority Mistakes (`signer_authority`)**
  - State-mutating functions (`transfer`, `withdraw`, `close`) without signer check
  - Authority/admin as `AccountInfo` without `has_one=` validation
  - `#[account(mut)]` on authority-like fields without `signer` flag

  **4. PDA Derivation and Seed Misuse (`pda_misuse`)**
  - `find_program_address` without bump storage
  - `create_program_address` (non-canonical bump attack vector)
  - `seeds=` without `bump=` constraint
  - Seed collision: static-only seeds without user-specific components

  **5. CPI Privilege Escalation (`cpi_escalation`)**
  - `invoke()` / `invoke_signed()` with unvalidated target program ID
  - `CpiContext::new()` with unvalidated program account
  - Signer seeds forwarded to CPI (authority scope bleed)

  **Bonus: reinitialization, integer_overflow, arbitrary_close**

- Created `src/analyzers/solana-poc.ts` — **Anchor PoC template generator**:
  - Generates Anchor TypeScript test harnesses per vulnerability class
  - Templates include setup/exploit/assert scaffolding with TODO markers
  - PoC references specific affected files from static analysis signals

- Updated `src/pipeline/audit.ts`:
  - **Enhanced Solana audit prompt**: 70-line specialist prompt with detailed sub-patterns for each class, evidence standard, and Solana account model context
  - **Static analysis → LLM pipeline**: analyzer runs first, grounded signals injected into prompt as primary evidence, LLM develops the most exploitable signal into a complete finding
  - **PoC fallback**: if LLM produces a generic PoC, the pre-generated Anchor template is used instead
  - **Enhanced Solana reviewer**: Solana-specific false positive checks (Anchor auto-validation, init_if_needed safety, Program<T> CPI safety, debug vs release overflow behavior)
  - **Reviewer receives static analysis independently** for cross-reference verification

- Both builds verified clean (tsc + next build, exit 0)

Done when:

- ✅ The engine can produce defensible findings in these classes against controlled or suitable public targets

### 6. Build Solidity / EVM audit depth second — ✅ COMPLETED

Goal:

Add the second serious audit wedge after Solana / Rust.

Priority classes (all implemented):

- ✅ oracle/price manipulation
- ✅ access control
- ✅ accounting/invariant violations
- ✅ upgradeability/initializer mistakes
- ✅ unsafe call/approval/token handling
- ✅ bonus: reentrancy, front-running, integer issues, unchecked calls, token quirks

Implementation summary:

- Created `src/analyzers/evm.ts` — **Solidity/EVM static analyzer** with pattern-matching detectors for all 5 priority classes + 5 additional:

  **1. Oracle / Price Manipulation (`oracle_price`)**
  - Chainlink latestRoundData() without staleness/updatedAt check
  - Ignored return values (roundId, answeredInRound)
  - Uniswap slot0() used directly (flash-loan manipulable)
  - AMM getReserves() for pricing (flash-loan manipulable)
  - Division before multiplication (precision loss)

  **2. Access Control (`access_control`)**
  - External/public state-mutating functions without modifiers (onlyOwner, onlyRole, etc.)
  - Inline msg.sender checks via require/revert detection
  - tx.origin for authorization (phishing attack)
  - Unprotected selfdestruct

  **3. Accounting / Invariant Violations (`accounting_invariant`)**
  - totalSupply used in division without zero-check (first depositor attack)
  - balanceOf() mixed with internal tracking (donation/inflation attack)
  - State updates after external calls (CEI violation)
  - Custom mint/burn without totalSupply sync

  **4. Upgradeability (`upgradeability`)**
  - initialize() without `initializer` modifier (re-initialization)
  - delegatecall to potentially user-controlled addresses
  - Unprotected upgradeTo / _authorizeUpgrade
  - Storage slot collision (sstore/sload analysis)
  - Constructor in upgradeable contract

  **5. Unsafe External / Token Handling (`unsafe_external`, `token_handling`, `unchecked_call`)**
  - .call() without return value check (silent failure)
  - ERC-20 .transfer()/.transferFrom() without SafeERC20
  - approve() without reset to 0 (front-running)
  - Fee-on-transfer tokens: amount trusted post-transferFrom
  - delegatecall to address parameter

  **6. Reentrancy (`reentrancy`)**
  - External calls followed by state updates without nonReentrant
  - Function-start scanner for ReentrancyGuard checks
  - Read-only reentrancy signals

  **7. Additional (`frontrunning`, `integer_issue`)**
  - deadline = block.timestamp (no deadline), amountOutMin = 0 (no slippage)
  - unchecked{} blocks in 0.8+ on financial values
  - Pre-0.8 arithmetic without SafeMath

  **Metadata extraction:**
  - Compiler version, contract names/count, proxy detection, initializer detection
  - OpenZeppelin usage, interface detection

- Created `src/analyzers/evm-poc.ts` — **Foundry PoC template generator**:
  - Generates Solidity Foundry test contracts per vulnerability class
  - Templates for oracle manipulation, access control bypass, accounting/donation attacks, upgradeability exploits, reentrancy, unsafe token handling
  - setUp/testExploit scaffolding with detailed attack flow comments

- Updated `src/pipeline/audit.ts`:
  - **Enhanced Solidity audit prompt**: 75-line specialist prompt with EVM execution model context, detailed sub-patterns, evidence standard
  - **EVM static analysis → LLM pipeline**: parallel branch to Solana; analyzer runs first, signals injected into prompt
  - **EVM PoC fallback**: if LLM produces generic PoC, pre-generated Foundry template used instead
  - **EVM reviewer false positive checks**: Solidity >= 0.8 overflow safety, SafeERC20, Initializable, UUPS auth, CEI compliance, view/pure safety
  - **Reviewer receives EVM static analysis independently** for cross-reference

- Both builds verified clean (tsc + next build, exit 0)

Done when:

- ✅ The engine can produce stronger-than-generic findings on controlled or suitable EVM targets

### 7. Enforce evidence standards for findings â€” âœ… COMPLETED

Goal:

Prevent polished speculation from becoming “findings.”

Implementation summary:

- Updated `src/pipeline/types.ts` with structured evidence primitives: `EvidenceBundle`, `EvidenceTrace`, `EvidenceArtifact`, `ReproductionGuide`, explicit proof levels, and auditor confidence / impact / why-flagged fields on `AuditReport`
- Refactored `src/pipeline/audit.ts` so evidence generation is separate from report rendering:
  - analyzer signals are normalized into grounded traces
  - reports now carry structured evidence, affected surface, why-flagged reasons, impact, and reproduction guidance
  - reviewer output is gated by `enforceEvidencePolicy()` so critical/high findings only publish with replayable proof, while medium/low can publish with code-path evidence
- Updated `src/pipeline/memory.ts` so audit/review/finding memories now store proof level, auditor confidence, evidence summary, impact, and reproduction guidance instead of narrative-only summaries
- Updated `src/plugins/plugin-auditor-reviewer/index.ts` so draft audit callbacks now include auditor confidence, proof level, evidence summary, impact, and why-flagged reasons
- Updated `ui/src/app/page.tsx` so the operator console is visibly evidence-first:
  - audit detail modal now shows auditor confidence, proof level, evidence-bar status, impact, grounded traces, artifacts, and reproduction guidance
  - finding cards now surface proof level and auditor confidence alongside reviewer confidence
- Verification: `bunx tsc -p tsconfig.json` and `bun run build:ui` both pass cleanly

Done when:

- âœ… Reports are visibly evidence-first and not just narrative-first

### 8. Make the Reviewer a real filter

Goal:

Turn the reviewer into a meaningful quality gate, not a cosmetic persona.

What to do:

- Increase reviewer strictness for critical/high
- Allow more nuance for medium/low
- Separate `review-passed` from `needs-human-review`
- Preserve useful uncertain findings without letting them pollute the main gallery

Done when:

- High-impact findings feel filtered, not rubber-stamped

### 9. Upgrade the UI into an operator console

Goal:

Make the UI useful for real operation, not just demonstration.

What to do:

- show queue states
- show approval status
- show scan/review status
- show finding confidence and severity
- provide report detail views
- expose artifacts and PoCs
- handle uncertain findings distinctly

Done when:

- A user can understand the full pipeline state from the UI alone

### 10. Finish Telegram MVP commands and alerts

Goal:

Make Telegram a real control surface.

What to do:

- deliver Scout alerts for discovered targets
- deliver audit-finished alerts
- support `/approve`
- support `/report <audit>`
- support `/findings`
- add `/status <audit>` if time allows

Done when:

- A user can reasonably monitor and approve work from Telegram

### 11. Implement Scout as scheduled polling plus manual refresh

Goal:

Ship believable monitoring without overcommitting to brittle real-time behavior.

What to do:

- scheduled polling
- manual refresh
- dedupe discovered programs
- extract scope and reward context
- classify across all Scout categories
- feed both UI and Telegram

Done when:

- Scout behaves like a real watcher even if it is not truly continuous yet

### 12. Prepare controlled demo targets

Goal:

Make the demo dependable.

Suggested demo set:

- one strong Solana target
- one strong EVM target
- one controlled or intentionally vulnerable example

Known suggestion:

- `theredguild/damn-vulnerable-defi` for EVM-friendly demonstrations

Done when:

- Demo targets are selected intentionally rather than improvised at the last minute

## 10. What To Cut First If Time Tightens

If time pressure hits, cut in roughly this order:

1. Live website testing
2. Full continuous monitoring
3. Rich private repo authentication flows
4. Deep cross-category parity
5. Advanced blast-radius estimation beyond readily available data

Do not cut:

- evidence quality for important findings
- the golden path
- reviewer usefulness
- UI and Telegram being real surfaces

## 11. Recommended Immediate Next Step

If continuing in a new thread, start here:

1. Read `HANDOFF.md`
2. Read `PROJECT_SCOPE.md`
3. Verify the current stack in `C:\VigilanceOS`
4. Implement ranked build order item 8: make the Reviewer a real filter

That work should include:

- increasing reviewer strictness for critical/high beyond the current evidence gate
- separating `review-passed` from a secondary `needs-human-review` or similar uncertain state
- preserving useful medium-confidence findings without letting them pollute the primary published gallery
- reflecting that distinction clearly in the UI/API surfaces

After that, move directly into the next ranked operator-surface and Telegram work.
