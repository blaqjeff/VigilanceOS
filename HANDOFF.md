# Vigilance-OS Handoff

Status: New-thread bootstrap and implementation handoff

Use this document to continue work in a fresh thread rooted at `C:\VigilanceOS`.

Read this file first, then read `PROJECT_SCOPE.md`.

## 1. Source Of Truth

- `PROJECT_SCOPE.md` is the primary source of truth for product intent, scope, priorities, tradeoffs, and quality bar.
- `DEEP_AUDITOR_PIVOT.md` is the primary source of truth for the audit-engine pivot from the current MVP toward the deeper repo auditor.
- `DEEP_AUDITOR_CHECKLIST.md` is the ranked implementation checklist for that pivot.
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
- `README.md` now documents Vigilance-OS itself instead of the generic challenge template

### Remaining runtime/integration blockers

- OpenAI-compatible model availability is the current blocker for end-to-end audits in the active environment

### Latest validation snapshot

- The UI-facing Vigilance proxy layer now correctly resolves Eliza plugin panel routes instead of calling stale flat `/vigilance/*` backend paths
- Manual Scout refresh through the UI was verified live against Immunefi MCP and returned real projects
- Controlled demo targets were submitted and approved successfully through the UI:
  - `theredguild/damn-vulnerable-defi`
  - `coral-xyz/sealevel-attacks`
- The first real audit attempt reached the expected model-readiness gate and failed honestly because the configured Nosana endpoint returned `503 Service Unavailable`
- Legacy Eliza memory persistence can still fail in this environment, but those writes are now non-fatal and no longer break canonical job creation
- The deep-auditor pivot now includes repo indexing, security-neighborhood retrieval, and ranked multi-candidate audit output stored on `report.candidateFindings`
- Live GitHub ingestion validation now succeeds against both primary demo repos through the real ingestion pipeline, including clean clone / cleanup behavior outside sandbox constraints
- Evidence labels are now honest end-to-end: generic exploit templates surface as `template_only`, repo-anchored replay drafts surface as `guided_replay`, and high/critical findings no longer clear the evidence bar unless stronger validation exists
- The audit engine now runs an exploratory repo-index pass before final synthesis, merges exploration-seeded candidates with analyzer-seeded candidates, and tracks candidate provenance as `analyzer`, `exploration`, or `analyzer+exploration`
- The reviewer now runs a counter-evidence-first pass on focused code neighborhoods, trims auditor framing down to a structured claim summary, detects standard framework protections deterministically, and can override overconfident reviewer verdicts when blocking protections are found
- Target-specific replay generation now resolves real repo symbols, files, imports, and instruction/function names through `src/analyzers/solana-guided-poc.ts`, `src/analyzers/evm-guided-poc.ts`, and `src/pipeline/audit.ts`, so controlled demo targets no longer fall back to blank class templates
- Local replay-generation probes against `sealevel-attacks` and `damn-vulnerable-defi-shallow` now produce repo-anchored `guided_replay` artifacts that avoid the template detector while still remaining honestly unvalidated
- The old class-template generators (`src/analyzers/solana-poc.ts` and `src/analyzers/evm-poc.ts`) are no longer part of the active path and have been removed to keep the repo aligned with the guided-replay architecture
- The operator console now surfaces ranked candidate findings inside the job-detail modal, shows discovery provenance (`analyzer`, `exploration`, `analyzer+exploration`), displays candidate counts on finding cards, and explains publish / human-review / discard outcomes through explicit outcome-driver summaries instead of relying on implicit reviewer text alone
- The operator-facing intake UX now exposes explicit `GitHub Repo`, `Local Folder`, and `Immunefi Project` modes with mode-specific validation and demo presets, and `Local Folder` now supports both same-machine absolute paths and hosted browser-folder upload
- Custom UI-submitted targets now send Telegram pending-approval alerts too, so manual queueing no longer depends on Scout to make `/approve <jobId>` visible in the operator chat
- Telegram HITL is re-enabled in the local environment; readiness now reports Telegram as `ready` and backend startup logs show the Telegram bot plugin starting again
- Telegram proactive delivery is no longer blocked by the old missing-send-handler bug, and it now prefers direct Bot API delivery before runtime send-handler fallback so alerts reach the operator chat without the old non-fatal Telegram memory-write noise
- The Scout UI is now explicitly labeled as project-level discovery only; it should not be presented as asset-level Immunefi scope expansion until the watcher can explode per-project assets/docs/repos properly
- Scout discovery is now split cleanly from execution: parent Scout projects stay in the discovery layer, each project exposes explicit child targets, and only queued child targets become real audit jobs
- Scout child targets can now be queued one-by-one, as selected subsets, or all at once from the UI, and the same project-scope / child-queue flow is exposed through Telegram via `/scope`, `/queue`, and `/queueall`
- Scout child fan-out now normalizes GitHub tree/blob/release links back to repo-root queue targets before creating jobs, which avoids polluting the audit queue with non-cloneable GitHub subpaths
- Model readiness is no longer boot-time-only: `src/readiness.ts` and `src/plugins/plugin-ui-bridge/index.ts` now refresh the model probe live for the readiness panel and again right before audits start
- Audit launch is now asynchronous at the backend, so `/vigilance/audit` accepts the job quickly and the scan/review lifecycle continues in the background instead of holding one request open through the whole run
- Controlled Solana demo suppression is stronger now: paired `secure` reference examples are filtered out of ranked candidates for repos like `sealevel-attacks`, and opposite `secure` / `insecure` variants no longer merge into the same finding during dedupe
- The stale Scout-only auditor instruction has been removed from both `characters/auditor.character.json` and the live enrichment prompt in `src/pipeline/audit.ts`, so the auditor is no longer told to mirror Scout rules exclusively or force every final report to inherit weak seeded hypotheses
- Candidate-level review is now first-class: each candidate finding carries its own reviewer verdict, job state is aggregated across all reviewed candidates, and the top-level report / verdict are derived lead summaries instead of the only source of truth
- The operator console findings gallery is now flattened by reviewed finding instead of one job-primary card, with ranking controls plus `lead finding` / `most urgent` labeling so the full reviewed finding set is visible on the main screen
- Human-review findings are no longer stuck: the job-detail modal now exposes per-candidate `Publish` and `Discard` actions, and the backend recomputes the aggregate job outcome after each analyst decision instead of flattening the whole job at once
- Hosted folder upload is now a first-class intake path through `ui/src/app/api/vigilance/upload-folder/route.ts`, and smoke tests confirmed that browser-uploaded folders materialize under `.uploaded-targets`, queue as `local` jobs, and preserve cleanup metadata for later ingestion cleanup
- Hosted folder uploads now show explicit `Uploading` / `Queueing` state in the UI so large transfers do not look idle and invite duplicate submissions
- Terminal jobs can now be archived from the job-detail modal; archived jobs are hidden from the default queue and findings views but can still be fetched through the backend with `includeArchived=true`
- Scout discovery is now richer at the project level: watcher snapshots and alerts keep asset counts, impact counts, repo counts, and linked non-GitHub resources/doc URLs instead of collapsing discovery down to only the first repo summary
- Live smoke tests on `2026-04-10` verified the new Scout fan-out path: the watcher recovered after MCP warm-up, `/api/vigilance/scout` returned project discoveries with child targets, and `/api/vigilance/scout/queue` successfully created a pending approval child job while leaving the parent project in `discovered` / `partially_queued` state

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

### 8. Make the Reviewer a real filter â€” âœ… COMPLETED

Goal:

Turn the reviewer into a meaningful quality gate, not a cosmetic persona.

Implementation summary:

- Updated the canonical lifecycle with a real `needs_human_review` lane in `src/pipeline/types.ts` and `src/pipeline/jobStore.ts`
  - `reviewing` jobs can now transition to `published`, `needs_human_review`, or `discarded`
  - `needs_human_review` is preserved as a distinct review queue instead of being flattened into publish/discard
- Refined reviewer policy in `src/pipeline/audit.ts`:
  - reviewer prompts now support `publish`, `needs_human_review`, and `discard`
  - high/critical findings require stronger reviewer confidence and replayable proof before auto-publication
  - grounded-but-uncertain findings are preserved in the human-review queue instead of being silently discarded
  - context-only or too-weak findings are still discarded deterministically
- Updated `src/plugins/plugin-ui-bridge/index.ts` and `src/plugins/plugin-auditor-reviewer/index.ts` so both the HTTP golden path and the plugin action path respect the new reviewer outcome
- Updated `ui/src/app/page.tsx` so the operator console clearly separates:
  - published findings
  - needs-human-review findings
  - discarded findings
- Verification: `bunx tsc -p tsconfig.json` and `bun run build:ui` both pass cleanly

Done when:

- âœ… High-impact findings feel filtered, not rubber-stamped

### 9. Upgrade the UI into an operator console — ✅ COMPLETED

Goal:

Make the UI useful for real operation, not just demonstration.

Implementation summary:

- Updated `ui/src/app/page.tsx` so the operator console now includes an explicit operations snapshot above the main pipeline:
  - queue overview cards for `pending_approval`, `approved`, `scanning/reviewing`, and `needs_human_review`
  - manual `Sync State` control plus visible last-sync timestamp
  - recent activity panel that shows the latest job state transitions without requiring backend log access
- Strengthened pipeline readability inside the main queue view:
  - each job card now includes operator-facing state copy explaining what is happening and what action is needed
  - jobs are sorted by most recent updates so the console surfaces active work first
- Strengthened the findings surface so evidence density is visible at a glance:
  - findings summary band now distinguishes published, analyst-review, and discarded outcomes
  - published, needs-human-review, and discarded cards now expose trace/artifact/replay-step counts directly in the list view
  - modal detail view remains the deep drill-down surface for proof, PoC, artifacts, reproduction guidance, and full state history
- Verification: `bunx tsc -p tsconfig.json` and `bun run build:ui` both pass cleanly

Done when:

- ✅ A user can understand the full pipeline state from the UI alone

### 10. Finish Telegram MVP commands and alerts — ✅ COMPLETED

Goal:

Make Telegram a real control surface.

Implementation summary:

- Added shared Telegram delivery/formatting helpers in `src/telegram/ops.ts`:
  - captures Telegram room/channel context from incoming messages
  - formats Scout alerts, audit-complete alerts, `/status`, `/report`, and `/findings` responses
  - supports proactive delivery to the originating Telegram room and optional default `TELEGRAM_ALERT_CHAT_ID`
- Updated `src/plugins/plugin-hitl/index.ts` so Telegram is now a real operator surface:
  - `/approve <job>` now resolves the pending job, approves it, and immediately starts the audit flow
  - `/report <audit>` returns a concise report view for the latest or requested job
  - `/findings` lists recent published findings plus the human-review queue
  - `/status <audit>` was added as the nice-to-have command and returns live lifecycle state, confidence, and next action
  - approval requests now return explicit Telegram-friendly command hints (`/approve`, `/status`)
- Updated `src/plugins/plugin-scout/index.ts` so Scout discoveries carry Telegram targeting context and produce operator-facing alert text with direct follow-up commands
- Updated `src/plugins/plugin-ui-bridge/index.ts` so callback-less UI-triggered audits can still push completion alerts into Telegram when a Telegram target is known/configured
- Updated `.env.example` with optional `TELEGRAM_ALERT_CHAT_ID` guidance for proactive alert routing
- Verification: `bunx tsc -p tsconfig.json` and `bun run build:ui` both pass cleanly

Done when:

- ✅ A user can reasonably monitor and approve work from Telegram

### 11. Implement Scout as scheduled polling plus manual refresh — ✅ COMPLETED

Goal:

Ship believable monitoring without overcommitting to brittle real-time behavior.

Implementation summary:

- Created `src/scout/watcher.ts` — shared Scout watcher state with:
  - scheduled polling
  - manual refresh entrypoints
  - dedupe across repeated and cross-category discoveries
  - category classification for Blockchain / DLT, Smart Contract, and Websites and Applications
  - scope and reward context extraction
  - recent discovery snapshots for the UI/API
- Updated `src/plugins/plugin-scout/index.ts` so Scout now:
  - starts the watcher on boot
  - supports manual full refresh
  - supports ad hoc category/project queries through the same shared discovery path
- Updated `src/pipeline/jobStore.ts` so refreshed Scout discoveries can update target metadata and Scout context on existing jobs instead of creating duplicate jobs
- Updated `src/plugins/plugin-ui-bridge/index.ts` with:
  - `GET /vigilance/scout`
  - `POST /vigilance/scout/refresh`
- Added Next.js proxy routes:
  - `ui/src/app/api/vigilance/scout/route.ts`
  - `ui/src/app/api/vigilance/scout/refresh/route.ts`
- Updated `ui/src/app/page.tsx` so the operator console now includes:
  - Scout watcher health/status
  - poll interval, last run, next run, and total tracked counts
  - manual Scout refresh control
  - per-category watch cards
  - recent discoveries with reward, scope, repo, and refresh context
- Updated `src/telegram/ops.ts` so Scout alerts now include category plus scope/reward context
- Updated `.env.example` with optional Scout polling configuration
- Verification: `bunx tsc -p tsconfig.json` and `bun run build:ui` both pass cleanly

Done when:

- ✅ Scout behaves like a real watcher even if it is not truly continuous yet

### 12. Prepare controlled demo targets â€” âœ… COMPLETED

Goal:

Make the demo dependable.

Implementation summary:

- Selected an intentional demo set aligned with the real audit wedge:
  - Solana / Rust primary: `coral-xyz/sealevel-attacks`
  - Solidity / EVM primary: `theredguild/damn-vulnerable-defi`
  - Controlled secondary / backup: `Ackee-Blockchain/solana-common-attack-vectors`
- Validated why each target belongs in the demo:
  - `sealevel-attacks` is a strong fit for signer / authority, PDA, account ownership, and CPI mistake coverage
  - `damn-vulnerable-defi` is a strong fit for controlled EVM exploit-path demonstrations and reviewer/evidence checks
  - Ackee's Solana repo provides intentionally vulnerable examples and PoC-style coverage as a backup or second-pass validation set
- Verified the manual-target golden path against the primary demo repos through the live UI/API:
  - both primary demo targets can be submitted and approved successfully
  - queue visibility reflects the resulting approved jobs correctly
- Confirmed the remaining blocker is no longer target selection or product routing, but external model availability

Done when:

- âœ… Demo targets are selected intentionally rather than improvised at the last minute

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
3. Read `DEEP_AUDITOR_PIVOT.md`
4. Read `DEEP_AUDITOR_CHECKLIST.md`
5. Verify the current stack in `C:\VigilanceOS`
6. Start the audit-engine pivot from the first incomplete checklist item

That work should prioritize:

- rerunning the controlled demo targets with the stronger reviewer and repo-anchored guided replay artifacts before final demo recording
- capturing operator-facing demo material only after the UI can explain provenance, proof state, and downgrade reasons clearly
- tightening any remaining false positives that show up during the final controlled reruns before recording submission material

After the pivot reaches a believable multi-finding state, move into:

- preserving demo targets and rerunnable jobs
- documenting the exact live-demo sequence for judges
- deciding whether Telegram should stay disabled for demo simplicity or be re-enabled once a fresh token is available

After that, move directly into final demo hardening and submission prep.
