# Demo Script

Status: Recording guide for the final submission demo

This script is designed to keep the demo:

- honest
- short
- easy to follow
- aligned with the actual codebase

## 1. Recommended Demo Structure

Use this order:

1. Short product framing
2. Show readiness
3. Submit a direct target
4. Approve it
5. Run the audit
6. Open the findings
7. Explain evidence, review outcome, and why this is credible
8. Optionally show Scout project discovery and child queueing
9. Close with Nosana + ElizaOS + product value

## 2. Best Demo Path

The strongest primary path is:

- direct GitHub target intake

Use Scout as a secondary feature, not the main story.

Recommended hero demo target:

- EVM: `theredguild/damn-vulnerable-defi`

Recommended secondary demo target:

- Solana: `coral-xyz/sealevel-attacks`

Why:

- EVM currently shows broader finding diversity
- Solana is still useful, but narrower

## 3. Recording Length Target

Aim for:

- 3 to 5 minutes total

If you need a tighter version:

- 2 to 3 minutes

Do not try to show every feature. Show the strongest path clearly.

## 4. Pre-Recording Checklist

Before pressing record, confirm:

1. The model endpoint is live
2. The readiness panel loads
3. UI is reachable at `http://127.0.0.1:4001`
4. Backend is reachable at `http://127.0.0.1:3001`
5. Queue is reasonably clean
6. Telegram is connected if you plan to show it
7. Your chosen demo target has already been sanity-tested at least once

Optional but recommended:

- archive old jobs before recording
- close unrelated tabs/windows
- enlarge browser zoom slightly if text feels dense

## 5. Opening Script

Suggested opening:

> Vigilance-OS is an ElizaOS-powered security agent workflow for blockchain repository auditing. It discovers or accepts protocol targets, requires explicit approval before deep audit, runs a repo-indexed multi-finding auditor, reviews each finding individually, and returns evidence-labeled results through a web console and Telegram.

Shorter version:

> Vigilance-OS is a security agent workflow that discovers or ingests targets, audits them with a repo-indexed multi-finding engine, and reviews each finding before surfacing it to an operator.

## 6. Main Recording Script

### Step 1. Show readiness

What to do:

- Open the operator console
- Briefly point at the readiness cards

What to say:

> Before running anything, the system shows whether Scout, the model endpoint, and Telegram are actually ready. That keeps the operator from starting a fake or broken run.

Do not linger here.

### Step 2. Submit a direct target

What to do:

- Use `GitHub Repo` mode
- Paste `theredguild/damn-vulnerable-defi`
- Click `Queue Target`

What to say:

> The main path is direct target intake. I can submit a repo directly instead of relying only on discovery.

### Step 3. Show approval gate

What to do:

- Show the new pending job in the queue
- If Telegram is active, mention the approval alert
- Approve in UI or Telegram

What to say:

> The system does not immediately start deep audit on its own. It requires explicit approval first, which is available both in the UI and in Telegram.

If approving in Telegram:

> The same queued target can be approved from chat using `/approve <jobId>`.

### Step 4. Start the audit

What to do:

- If not using approve-and-run already, click the audit action
- Let the queue state move through scan/review

What to say:

> Once approved, the backend runs asynchronously. The operator doesn’t have to keep one request open for the whole audit lifecycle.

### Step 5. Open the finished findings

What to do:

- Open the job detail modal or the findings view
- Show multiple findings, not just one summary

What to say:

> This is a multi-finding audit, not a single polished guess. The system preserves and ranks reviewed findings instead of collapsing everything into one invisible primary result.

### Step 6. Explain one strong finding

What to do:

- Pick the strongest reviewed finding
- Point out:
  - severity
  - confidence
  - origin
  - proof label
  - reviewer outcome
  - why flagged
  - code evidence or reproduction guidance

What to say:

> Each finding carries its own review result, provenance, and honest proof label. So instead of pretending every issue is fully proven, the system distinguishes between template-only, guided replay, validated replay, and stronger proof states.

Then:

> This lets the operator see both what was found and how well it is actually supported.

### Step 7. Explain the reviewer

What to do:

- Show a downgraded, discarded, or `needs_human_review` example if available

What to say:

> The reviewer is not decorative. It tries to debunk findings, checks for counter-evidence and standard protections, and can keep uncertain findings in a human-review lane instead of auto-publishing them.

### Step 8. Optional Scout section

Only do this if the run is already successful and time remains.

What to do:

- Open the Scout panel
- Expand one project
- Show child targets
- Mention queue one / selected / all

What to say:

> Discovery is project-level. Instead of flattening a protocol into one fake repo target, Scout preserves the project scope and lets the operator queue one or many child targets explicitly.

Do not make Scout the centerpiece unless it is behaving perfectly in that session.

### Step 9. Close

Suggested close:

> Under the hood, this is built on ElizaOS for the multi-agent runtime, plugin wiring, Telegram control, and MCP integrations, with the full stack deployable on Nosana. The result is an evidence-first security workflow that already feels like a real product wedge rather than a hackathon-only demo.

Shorter close:

> The goal here is not agent theater. It is a believable security workflow with real intake, review, and evidence-labeled findings that can keep growing after the hackathon.

## 7. What To Highlight

Emphasize these strengths:

- direct target intake
- explicit approval gate
- multi-finding output
- reviewer per finding
- honest proof labels
- project-level Scout discovery with child queueing
- ElizaOS runtime integration
- Nosana deployment path

## 8. What Not To Say

Avoid saying:

- “It deeply audits every repository perfectly”
- “It proves every exploit automatically”
- “Scout fully explodes every Immunefi asset into complete audit coverage”
- “It reads the entire repo in one pass and never misses anything”

Say instead:

- “repo-indexed”
- “multi-finding”
- “evidence-first”
- “review-aware”
- “honest proof labels”
- “project-level discovery with explicit child queueing”

## 9. If Something Goes Wrong Mid-Recording

### If the model is slow

Say:

> The audit runs asynchronously, so I can keep operating the queue while the backend finishes the review cycle.

Then wait on the best already-tested target.

### If Scout looks noisy

Skip Scout and stay on direct GitHub intake.

### If Telegram misbehaves

Use the UI approval path and mention Telegram as an equivalent supported control surface.

### If the queue is cluttered

Use archive on terminal jobs before recording again.

## 10. Backup Short Script

If you need a very short version:

1. Open readiness
2. Queue `damn-vulnerable-defi`
3. Approve it
4. Open a finished job
5. Show multiple findings
6. Explain proof labels and reviewer outcome
7. Close with ElizaOS + Nosana

## 11. Final Reminder

The strongest demo is the one that matches the code honestly.

Do not try to oversell the system. Show the strongest real path clearly.
