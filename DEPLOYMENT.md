# Deployment Guide

Status: Practical deployment notes for local production-style runs and Nosana submission

## 1. Local Production-Style Run

Build everything first:

```powershell
npm run build:all
```

Then start the full stack:

```powershell
npm run start
```

That launches:

- backend on `http://127.0.0.1:3001`
- UI on `http://127.0.0.1:4001`

If you are on Windows and want the helper that also performs port cleanup and startup checks, you can use:

```powershell
npm run start:stack
```

## 2. Development Run

Preferred portable dev command:

```powershell
npm run dev
```

Optional Windows helper:

```powershell
npm run dev:stack
```

Stop the stack with:

```powershell
npm run stop
```

## 3. Container Build

The repo ships with a root multi-stage [Dockerfile](/C:/VigilanceOS/Dockerfile).

Example local build:

```powershell
docker build -t vigilance-os:latest .
```

Example local run:

```powershell
docker run --rm -p 4001:4001 -p 3001:3001 --env-file .env vigilance-os:latest
```

The container:

- installs backend and UI dependencies separately
- builds backend `dist/` assets and the Next.js UI
- includes Python + Immunefi MCP requirements
- exposes both `3001` and `4001`
- uses a healthcheck based on backend and UI reachability

## 4. Nosana Deployment

The repo includes a starter manifest:

- [nosana.yaml](/C:/VigilanceOS/nosana.yaml)

Current assumptions:

- UI is the public entrypoint on port `4001`
- backend runs internally on port `3001`
- model provider is an OpenAI-compatible endpoint
- embeddings are configured for Eliza memory/search support

### Environment and secrets to supply on Nosana

Required or strongly recommended:

- `OPENAI_API_URL`
- `OPENAI_API_KEY`
- `MODEL_NAME`
- `OPENAI_EMBEDDING_URL`
- `OPENAI_EMBEDDING_API_KEY`
- `OPENAI_EMBEDDING_MODEL`
- `OPENAI_EMBEDDING_DIMENSIONS`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALERT_CHAT_ID`
- `SERVER_PORT=3001`
- `UI_PORT=4001`
- `AGENT_BASE_URL=http://127.0.0.1:3001`
- `IMMUNEFI_PYTHON_CMD=python3`

### Submission deployment story

For the challenge, the cleanest story is:

1. build the full stack into one container
2. deploy the complete stack on Nosana
3. expose the UI on `4001`
4. keep the backend internal and proxied through the UI routes

## 5. Self-Hosted Model Option

If the shared hosted model endpoint is unavailable, use the self-host runbook:

- [nos_job_def/SELF_HOST_MODEL_RUNBOOK.md](/C:/VigilanceOS/nos_job_def/SELF_HOST_MODEL_RUNBOOK.md)

That path is intended for temporary recovery and live demo continuity, not as the only supported model path.

## 6. Pre-Submission Verification

Before final submission, verify:

```powershell
bunx tsc -p tsconfig.json
bun run build
bun run build:ui
```

And verify these product behaviors from the deployed UI:

1. readiness panel loads
2. direct GitHub target intake works
3. folder upload intake works
4. approval works from UI and Telegram
5. audit results appear with multiple findings
6. Scout project cards and child target queueing work

## 7. Notes

- `npm run dev` is now the preferred cross-platform development command.
- `npm run start` is the preferred cross-platform production-style run command.
- the old PowerShell launcher still exists as a Windows convenience helper, but it is no longer the primary workflow.
