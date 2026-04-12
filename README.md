# Vigilance-OS

Vigilance-OS is an evidence-first security operations platform for blockchain code review.

It combines repository ingestion, repo indexing, static analyzers, model-guided exploration, human approval gates, reviewer filtering, Scout discovery over Immunefi scope, and operator surfaces in both a web console and Telegram.

## Overview

Vigilance-OS supports two main operating modes:

1. Direct target intake
   Queue a GitHub repository, a local folder path, or a folder uploaded from the browser.
2. Scout-driven discovery
   Discover Immunefi projects, inspect their child targets, and queue one, many, or all relevant children for review.

The core workflow is:

1. Submit or discover a target
2. Approve it through the human-in-the-loop gate
3. Run the audit
4. Review findings individually
5. Publish, hold, discard, or archive results from the operator console

## Core Characteristics

Vigilance-OS is designed to be explicit about what it does well and where evidence is still weak.

- Repo-indexed auditing instead of raw whole-repo prompt dumping
- Multiple findings per target instead of a single hidden primary result
- Per-finding review outcomes instead of a cosmetic reviewer pass
- Honest evidence labels:
  - `template_only`
  - `guided_replay`
  - `validated_replay`
  - `executed_poc`
- Project-level Scout discovery with child-target fan-out
- UI and Telegram as real operator control surfaces

## Architecture

```mermaid
flowchart TD
    A["Operator / Telegram"] --> B["ElizaOS Runtime"]
    B --> C["Scout Plugin"]
    B --> D["UI Bridge Plugin"]
    B --> E["HITL / Telegram Plugin"]
    B --> F["Auditor + Reviewer Plugin"]

    C --> G["Immunefi MCP"]
    D --> H["Next.js Operator Console"]
    F --> I["Repo Ingestion + Indexing"]
    I --> J["Security Neighborhoods"]
    J --> K["Analyzer Signals"]
    J --> L["Exploratory Discovery"]
    K --> M["Auditor"]
    L --> M
    M --> N["Per-Finding Reviewer"]
    N --> O["Published / Needs Review / Discarded / Archived"]
```

## How ElizaOS Is Used

ElizaOS is the runtime and orchestration layer for Vigilance-OS.

It is used for:

- agent boot and lifecycle
- character-driven roles for Scout, Auditor, and Reviewer
- plugin composition and tool wiring
- Telegram controls and notifications
- UI bridge routing into the runtime
- OpenAI-compatible model access
- MCP integration for Immunefi discovery

Key runtime entrypoint:

- [`scripts/run-eliza.mjs`](scripts/run-eliza.mjs)

Key Eliza-facing plugins:

- [`src/plugins/plugin-scout/index.ts`](src/plugins/plugin-scout/index.ts)
- [`src/plugins/plugin-hitl/index.ts`](src/plugins/plugin-hitl/index.ts)
- [`src/plugins/plugin-auditor-reviewer/index.ts`](src/plugins/plugin-auditor-reviewer/index.ts)
- [`src/plugins/plugin-ui-bridge/index.ts`](src/plugins/plugin-ui-bridge/index.ts)

The security-specific engine lives inside that runtime in:

- [`src/pipeline`](src/pipeline)
- [`src/analyzers`](src/analyzers)
- [`src/scout`](src/scout)

## Audit Engine

The current audit engine is a repo-indexed, multi-finding auditor.

At a high level it:

1. Materializes the target
2. Indexes repository structure and important files
3. Builds security-relevant code neighborhoods
4. Seeds candidate findings from analyzers and exploratory model passes
5. Reviews findings individually
6. Ranks and exposes all findings in the UI

Important current behavior:

- findings are not collapsed into one hidden result
- every finding can carry its own review outcome
- the operator console shows the full reviewed finding set
- proof strength is labeled separately from severity

## Feature Summary

- Direct GitHub repo intake
- Local absolute-path intake for same-machine operation
- Browser folder upload for hosted or remote operation
- Project-level Immunefi Scout discovery
- Child-target fan-out under each Scout project
- Queue one, selected, or all queueable Scout children
- Telegram approval and status workflow
- Multi-finding audit output
- Reviewer pass per finding
- Archive flow for completed jobs
- Readiness cards for model, Scout, and Telegram state

## Quick Start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Create your environment file

Copy [`.env.example`](.env.example) to `.env` and fill in the values you need.

Important variables:

- `OPENAI_API_URL`
- `OPENAI_API_KEY`
- `MODEL_NAME`
- `OPENAI_EMBEDDING_URL`
- `OPENAI_EMBEDDING_API_KEY`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_DIMENSIONS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALERT_CHAT_ID`
- `IMMUNEFI_PYTHON_CMD`
- `SERVER_PORT`

### 3. Start the full stack

```bash
npm run dev
```

This starts:

- ElizaOS backend on `http://127.0.0.1:3001`
- Next.js UI on `http://127.0.0.1:4001`

Useful commands:

```bash
npm run stop
npm run build
npm run build:ui
npm run build:all
npm run start
```

Optional Windows helpers:

```bash
npm run dev:stack
npm run start:stack
npm run stop:stack
```

## Usage

### Direct Target Intake

The operator console supports:

- `GitHub Repo`
- `Local Folder`
- `Immunefi Project`

For direct auditing, the strongest paths are:

- a public GitHub repo URL such as `https://github.com/theredguild/damn-vulnerable-defi`
- a plain `owner/repo` value such as `theredguild/damn-vulnerable-defi`
- a local absolute folder path when the backend runs on the same machine
- a folder upload when the backend is hosted elsewhere

### Scout Workflow

Scout works at the project level and keeps discovery separate from execution.

The flow is:

1. Scout discovers a project
2. The UI shows that project with child targets underneath it
3. The operator queues one child, selected children, or all queueable children
4. Only then are real audit jobs created

This keeps project discovery broad without flooding the execution queue.

### Telegram Workflow

Telegram is a real operator surface, not just a notification stub.

Supported commands:

- `/approve <jobId>`
- `/status <jobId>`
- `/report <jobId>`
- `/findings`
- `/scope <projectRef>`
- `/queue <projectRef> <childRef[,childRef...]>`
- `/queueall <projectRef>`

Automatic alerts include:

- Scout project discovery alerts
- manual target approval requests
- audit completion summaries

## Nosana Integration

Vigilance-OS is designed to run against Nosana-hosted models and can also point at a self-hosted Nosana vLLM deployment.

Current usage patterns:

- hosted OpenAI-compatible Nosana endpoint for the main audit model
- hosted Nosana embedding endpoint for Eliza memory and semantic retrieval support
- optional self-hosted vLLM deployment for `Qwen3.5-27B-AWQ-4bit`

Deployment and self-hosting references:

- [`DEPLOYMENT.md`](DEPLOYMENT.md)
- [`nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md`](nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md)

## Readiness Model

The UI exposes live readiness states so operators can tell whether the system is usable before starting a run.

Readiness covers:

- Scout / Immunefi MCP
- OpenAI-compatible model endpoint
- Telegram

Relevant files:

- [`src/readiness.ts`](src/readiness.ts)
- [`src/plugins/plugin-ui-bridge/index.ts`](src/plugins/plugin-ui-bridge/index.ts)

## Project Structure

```text
characters/                 ElizaOS character definitions
src/analyzers/              EVM, Solana, and guided replay analyzers
src/pipeline/               Ingestion, indexing, audit, review, job store
src/plugins/                ElizaOS runtime plugins
src/scout/                  Scout watcher and project discovery logic
src/telegram/               Telegram alert helpers
ui/                         Next.js operator console
nos_job_def/                Nosana model deployment templates and self-hosting guides
scripts/                    Stack orchestration and startup scripts
```

## Verification

The following commands are used regularly to validate the codebase:

```bash
bunx tsc -p tsconfig.json
bun run build
bun run build:ui
```

For day-to-day local development:

```bash
npm run dev
```

## Limitations

Vigilance-OS is intentionally explicit about current limits.

- Solana coverage is improving but still narrower than EVM coverage
- Scout child fan-out is strongest for repo-like targets
- explorer, docs, and web scope entries are preserved as context, but not all are queueable yet
- findings are evidence-ranked, but not every finding has validated or executed proof
- dynamic live web testing is not part of the current version

## Additional Documentation

- [`DEPLOYMENT.md`](DEPLOYMENT.md)
- [`nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md`](nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md)

## License

This repository does not yet define a separate project license.
