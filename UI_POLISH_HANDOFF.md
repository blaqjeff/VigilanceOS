# UI Polish Handoff

Status: Guardrails for UI-only polishing without breaking product logic

Use this document when handing Vigilance-OS UI work to another engineer or LLM.

The goal is to improve presentation, readability, layout, responsiveness, visual hierarchy, and interaction clarity **without breaking the live audit flow**.

## 1. What This UI Must Preserve

The current product logic is already wired and should be treated as fragile but working.

Do not break these flows:

1. Direct target intake
   - GitHub repo input
   - local absolute-path input
   - hosted folder upload
2. Approval and audit actions
   - approve
   - run audit
   - approve and run
3. Multi-finding report viewing
4. Per-finding human-review actions
   - publish
   - discard
5. Archive completed jobs
6. Scout project discovery
7. Scout child-target queueing
   - queue one
   - queue selected
   - queue all
8. Readiness display
9. Telegram-compatible operator workflow

If a UI change risks any of those flows, stop and confirm before changing it.

## 2. Safe Files To Edit

UI polish should stay inside these files unless there is a very strong reason not to:

- [ui/src/app/page.tsx](/C:/VigilanceOS/ui/src/app/page.tsx)
- [ui/src/app/globals.css](/C:/VigilanceOS/ui/src/app/globals.css)
- [ui/src/app/layout.tsx](/C:/VigilanceOS/ui/src/app/layout.tsx)

It is also safe to **add new presentational files** under `ui/`, for example:

- `ui/src/components/*`
- `ui/src/lib/ui/*`

Preferred refactor pattern:

- keep data fetching, mutations, and route contracts stable
- extract presentational components out of `page.tsx`
- move repeated class names and visual helpers into local UI helpers if needed

## 3. Files That Should Be Treated As No-Touch For UI Polish

Do **not** edit these during UI polish unless the task explicitly requires logic work:

- [src/pipeline/*](/C:/VigilanceOS/src/pipeline)
- [src/analyzers/*](/C:/VigilanceOS/src/analyzers)
- [src/scout/*](/C:/VigilanceOS/src/scout)
- [src/telegram/*](/C:/VigilanceOS/src/telegram)
- [src/readiness.ts](/C:/VigilanceOS/src/readiness.ts)
- [src/plugins/plugin-ui-bridge/index.ts](/C:/VigilanceOS/src/plugins/plugin-ui-bridge/index.ts)
- [src/plugins/plugin-hitl/index.ts](/C:/VigilanceOS/src/plugins/plugin-hitl/index.ts)
- [src/plugins/plugin-scout/index.ts](/C:/VigilanceOS/src/plugins/plugin-scout/index.ts)
- [src/plugins/plugin-auditor-reviewer/index.ts](/C:/VigilanceOS/src/plugins/plugin-auditor-reviewer/index.ts)
- [scripts/run-eliza.mjs](/C:/VigilanceOS/scripts/run-eliza.mjs)
- [characters/*](/C:/VigilanceOS/characters)

Also avoid changing Next proxy route files during visual polish:

- [ui/src/app/api/vigilance/proxy.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/proxy.ts)
- [ui/src/app/api/vigilance/targets/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/targets/route.ts)
- [ui/src/app/api/vigilance/upload-folder/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/upload-folder/route.ts)
- [ui/src/app/api/vigilance/approve/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/approve/route.ts)
- [ui/src/app/api/vigilance/audit/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/audit/route.ts)
- [ui/src/app/api/vigilance/scout/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/scout/route.ts)
- [ui/src/app/api/vigilance/scout/queue/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/scout/queue/route.ts)
- [ui/src/app/api/vigilance/scout/refresh/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/scout/refresh/route.ts)
- [ui/src/app/api/vigilance/jobs/[jobId]/archive/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/jobs/[jobId]/archive/route.ts)
- [ui/src/app/api/vigilance/jobs/[jobId]/findings/[candidateId]/resolve/route.ts](/C:/VigilanceOS/ui/src/app/api/vigilance/jobs/[jobId]/findings/[candidateId]/resolve/route.ts)

If a UI idea appears to require editing these, it is no longer a UI-only task.

## 4. The Current UI Is Centralized In One File

The main operator console is still concentrated in:

- [ui/src/app/page.tsx](/C:/VigilanceOS/ui/src/app/page.tsx)

That file currently contains:

- mirrored backend types
- tone/label helpers
- formatting helpers
- feed flattening and sorting logic
- presentational cards
- modal/job detail rendering
- all fetch and mutation handlers
- all local UI state

This is workable, but fragile.

### Safe refactor direction

You may split out presentational components such as:

- readiness cards
- intake section
- job list cards
- job detail modal
- finding cards
- Scout project cards

You should avoid moving or rewriting the mutation logic unless necessary.

## 5. Behavior Contracts That Must Stay Intact

These functions in [ui/src/app/page.tsx](/C:/VigilanceOS/ui/src/app/page.tsx) are the main logic seam. Preserve their behavior and request shapes:

- `submitTarget()`
- `approveJob(job)`
- `runAudit(job)`
- `approveAndRun(job)`
- `resolveFinding(job, candidate, action)`
- `archiveJob(job)`
- `refreshScoutNow()`
- `queueScoutTargets(discovery, options)`
- `handleFolderSelection(files)`
- `resetUploadedFolder()`

### Intake modes that must remain

Keep all 3 intake modes visible and functional:

- `github`
- `local`
- `immunefi`

### Upload states that must remain

Keep the hosted folder upload UX states intact:

- `idle`
- `uploading`
- `queueing`

### Reviewed finding actions that must remain

The operator must still be able to:

- inspect all reviewed findings
- see the lead / most urgent finding
- publish a `needs_human_review` finding
- discard a `needs_human_review` finding

### Scout actions that must remain

The operator must still be able to:

- expand a Scout project
- select child targets
- queue one child
- queue selected children
- queue all queueable children

## 6. API Endpoints The UI Depends On

Do not rename, remove, or quietly change these UI calls during polish:

- `GET /api/vigilance/jobs?limit=50`
- `GET /api/vigilance/readiness`
- `GET /api/vigilance/scout`
- `POST /api/vigilance/targets`
- `POST /api/vigilance/upload-folder`
- `POST /api/vigilance/approve`
- `POST /api/vigilance/audit`
- `POST /api/vigilance/scout/refresh`
- `POST /api/vigilance/scout/queue`
- `POST /api/vigilance/jobs/:jobId/archive`
- `POST /api/vigilance/jobs/:jobId/findings/:candidateId/resolve`

If the UI is reorganized, these contracts should still be called with the same payload intent.

## 7. Known Fragile Areas

### 1. `page.tsx` type mirrors

The frontend mirrors backend types locally. Cosmetic refactors must not accidentally delete fields that are still rendered or sorted against.

Examples:

- `candidateFindings`
- `findingCounts`
- `review`
- `proofLevel`
- `origin`
- Scout `childTargets`
- `queuedJobId`
- `queuedJobState`

### 2. Feed flattening logic

The findings gallery is intentionally flattened by reviewed finding, not by job-primary summary.

Do not regress this behavior while simplifying the UI.

### 3. Archive and resolve controls

The current queue can be cleaned by archiving terminal jobs and resolving human-review findings.

Do not hide these actions without replacing them with something equally clear.

### 4. Hosted folder upload

The upload flow is not just a button.

It relies on:

- folder selection
- label display
- upload progress state
- queue progress state

Do not collapse it back to a single inert input.

## 8. Good UI Improvement Targets

These are good polish targets that should not threaten logic if done carefully:

- fix overflow and cramped spacing
- improve mobile and tablet responsiveness
- break the page into clearer sections
- make the intake panel more obvious
- make queue states easier to scan
- improve hierarchy between published / human-review / discarded findings
- make job detail modal easier to read
- improve typography, spacing, and contrast
- reduce visual clutter in Scout project cards
- improve empty states and loading states

## 9. Changes To Avoid Right Before Demo

Avoid these unless explicitly requested:

- changing backend payload shapes
- renaming job states
- renaming finding verdicts
- changing Scout child target semantics
- moving approval or audit actions to different endpoints
- deleting the current operator actions because they look visually busy

## 10. Verification Checklist After UI Changes

At minimum, run:

```powershell
bunx tsc -p tsconfig.json
bun run build
bun run build:ui
```

Then manually verify:

1. The page loads at `http://127.0.0.1:4001`
2. All 3 intake modes still appear
3. Hosted folder selection still shows upload progress
4. Existing jobs still render in the queue
5. Job detail modal opens
6. Reviewed findings still show all candidates
7. `Publish` / `Discard` buttons still appear for `needs_human_review`
8. `Archive` still appears for terminal jobs
9. Scout projects still expand and child targets can still be selected
10. Queue one / selected / all controls still appear in Scout

## 11. Safe Prompt To Give Another LLM

Use this if you want another LLM to work only on UI polish:

> Work only on visual polish and interaction clarity for Vigilance-OS. Do not change backend logic, Eliza runtime wiring, Scout logic, audit pipeline logic, Telegram logic, or Next proxy route behavior. Keep all intake modes, upload behavior, queue actions, Scout child-target queueing, reviewed-finding actions, archive flow, and API contracts intact. Prefer extracting presentational components from `ui/src/app/page.tsx`, adjusting CSS, improving responsiveness, and refining hierarchy without changing request payloads or business logic. If a proposed UI change requires editing files outside `ui/src/app/page.tsx`, `ui/src/app/globals.css`, `ui/src/app/layout.tsx`, or new presentational files under `ui/`, stop and ask first.

## 12. Final Rule

If a UI change makes the app look better but removes operator clarity or breaks one real workflow, it is a regression.

The demo should feel smoother, not less truthful.
