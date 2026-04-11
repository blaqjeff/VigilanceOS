# Submission Checklist

Status: Final submission-day checklist for the Nosana x ElizaOS Agent Challenge

Use this file before recording, before deploying, and before submitting.

## 1. Repo And Documentation

- [ ] Repository is public
- [ ] [README.md](/C:/VigilanceOS/README.md) is polished enough for judges to understand the product quickly
- [ ] [DEPLOYMENT.md](/C:/VigilanceOS/DEPLOYMENT.md) is accurate
- [ ] [DEMO_SCRIPT.md](/C:/VigilanceOS/DEMO_SCRIPT.md) matches the actual product behavior
- [ ] No obviously stale challenge-template text remains in the repo
- [ ] Key docs are easy to find from the repo root

## 2. Build And Run Verification

- [ ] `bunx tsc -p tsconfig.json` passes
- [ ] `bun run build` passes
- [ ] `bun run build:ui` passes
- [ ] `npm run dev` works
- [ ] `npm run start` works after a clean stop
- [ ] `npm run stop` works

## 3. Nosana And Containerization

- [ ] [Dockerfile](/C:/VigilanceOS/Dockerfile) matches the real stack
- [ ] [.dockerignore](/C:/VigilanceOS/.dockerignore) is sane
- [ ] [nosana.yaml](/C:/VigilanceOS/nosana.yaml) matches current env assumptions
- [ ] Full stack is actually deployable on Nosana
- [ ] The public entrypoint is the UI, not a broken backend-only surface
- [ ] Secrets are not hardcoded into committed files
- [ ] If using a self-hosted model for the demo, that path is documented clearly

## 4. ElizaOS Usage

- [ ] The submission can clearly explain where ElizaOS is used
- [ ] The demo shows or explains the multi-agent/runtime/plugin aspect honestly
- [ ] The README and demo do not present ElizaOS as decorative

Recommended talking points:

- ElizaOS powers the runtime
- characters define Scout / Auditor / Reviewer roles
- plugins expose UI bridge, Scout, Telegram HITL, and audit/review behaviors
- MCP integration is used for Immunefi discovery

## 5. Product Workflow Verification

- [ ] Readiness panel works
- [ ] Direct GitHub target intake works
- [ ] Local folder path intake works
- [ ] Hosted folder upload works
- [ ] Approval works from the UI
- [ ] Telegram approval alerts are delivered
- [ ] Telegram commands work if you plan to show them
- [ ] Audit runs complete with the current model path
- [ ] Multi-finding results show in the UI
- [ ] Reviewer outcomes are visible per finding
- [ ] `needs_human_review` findings can be resolved
- [ ] Terminal jobs can be archived
- [ ] Scout projects expand and child targets can be queued

## 6. Demo Readiness

- [ ] Model endpoint is live and stable enough for recording
- [ ] Queue is cleaned up before recording
- [ ] Best demo target has been sanity-tested recently
- [ ] Secondary backup target has been sanity-tested recently
- [ ] Browser tabs/windows are cleaned up
- [ ] Zoom/text size is readable in recording
- [ ] [DEMO_SCRIPT.md](/C:/VigilanceOS/DEMO_SCRIPT.md) has been reviewed once before recording

Recommended hero target:

- `theredguild/damn-vulnerable-defi`

Recommended backup target:

- `coral-xyz/sealevel-attacks`

## 7. Findings To Highlight

- [ ] Pick 1-2 findings that clearly show grounded reasoning
- [ ] Prefer findings with strong evidence traces and clean reviewer outcomes
- [ ] Avoid showing weak/noisy findings if stronger ones are available
- [ ] Be ready to explain the proof label honestly

## 8. Claims Discipline

- [ ] Demo language matches what the code actually does
- [ ] Do not claim perfect full-repo autonomous proof on every run
- [ ] Do not oversell Scout asset expansion beyond what is implemented
- [ ] Do emphasize:
  - evidence-first audit flow
  - explicit approval gate
  - repo-indexed multi-finding output
  - per-finding reviewer behavior
  - honest proof labels
  - ElizaOS runtime integration
  - Nosana deployment path

## 9. Submission Assets

- [ ] Demo video recorded
- [ ] Demo video uploaded or ready to upload
- [ ] Public repo link copied
- [ ] Nosana deployment link or proof prepared if required
- [ ] Any screenshots or thumbnails prepared if useful
- [ ] Final written description for the submission form prepared

## 10. Final Pre-Submit Pass

- [ ] Re-read the challenge requirements once
- [ ] Confirm nothing confidential is exposed in the repo
- [ ] Confirm `.env` is not committed
- [ ] Confirm the final README still matches the final product state
- [ ] Confirm the branch you submit is the correct one
- [ ] Confirm the app you demo is the same app in the repo

## 11. Final Reminder

The strongest submission is the one that is:

- credible
- understandable
- honestly scoped
- clearly demoed

Do not try to win by sounding bigger than the code.
