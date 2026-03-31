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

### 2. Lock the audit job lifecycle end to end

Goal:

Define one canonical state model for all work.

What to do:

- Normalize job states such as `submitted`, `pending_approval`, `approved`, `scanning`, `reviewing`, `published`, `discarded`, `failed`
- Persist artifacts cleanly
- Persist report, verdict, confidence, target metadata, and timestamps
- Ensure the UI and Telegram speak the same lifecycle language
- Make state transitions deterministic and debuggable

Done when:

- Every audit has a clear lifecycle
- UI and backend no longer infer state from ad hoc text blobs where structured state would be better

### 3. Make the golden path solid

Goal:

Make the single most important workflow feel trustworthy and complete.

What to do:

- UI target submission works reliably
- Approval gate is explicit and enforced
- Audit starts only after approval
- Review step always runs
- Final report is persisted and retrievable
- Failure states are visible and understandable

Done when:

- A user can run the full path from UI submission to final reviewed report without handholding

### 4. Implement real target ingestion in this order

Implementation order:

1. Public GitHub URL
2. Local folder path
3. Zip upload
4. Private GitHub authentication later

Why this order:

It maximizes truthfulness and speed while minimizing auth complexity.

What to do:

- Normalize target descriptors
- Validate and classify target types
- Support local path scanning without breaking portability
- Build clean ingestion interfaces so private auth can be added later

Done when:

- The backend can ingest the first two target types reliably and pass them into the same audit lifecycle

### 5. Build real Solana / Rust audit depth first

Goal:

Make Solana / Rust the strongest submission-day wedge.

Priority classes:

- oracle/accounting logic
- account ownership validation
- signer/authority mistakes
- PDA misuse
- CPI privilege escalation

What to do:

- Build analyzers/prompts/workflows around these classes specifically
- Prefer grounded repo reasoning over generic LLM brainstorming
- Capture exact files, functions, accounts, authorities, and call paths
- Generate reproductions or harnesses where feasible

Done when:

- The engine can produce defensible findings in these classes against controlled or suitable public targets

### 6. Build Solidity / EVM audit depth second

Goal:

Add the second serious audit wedge after Solana / Rust.

Priority classes:

- oracle/price manipulation
- access control
- accounting/invariant violations
- upgradeability/initializer mistakes
- unsafe call/approval/token handling

What to do:

- Build class-aware reasoning and evidence generation
- Support report outputs that reference actual code and exploit flow
- Avoid falling back to generic smart contract issue lists

Done when:

- The engine can produce stronger-than-generic findings on controlled or suitable EVM targets

### 7. Enforce evidence standards for findings

Goal:

Prevent polished speculation from becoming “findings.”

What to do:

- Require stronger proof thresholds for critical/high
- Allow code-path proof plus confidence for medium/low
- Separate evidence generation from report rendering
- Make findings include affected scope, why flagged, confidence, remediation, and reproduction guidance

Done when:

- Reports are visibly evidence-first and not just narrative-first

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
4. Implement ranked build order item 1: harden external integration readiness checks

That work should include:

- explicit MCP dependency diagnostics
- explicit model auth diagnostics
- explicit Telegram config diagnostics
- clear readiness reporting for developers and operators

After that, move directly into the golden path and real audit wedge work.
