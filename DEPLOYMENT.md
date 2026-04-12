# Deployment Guide

Status: Practical deployment notes for local production-style runs, Docker usage, and Nosana submission

## 1. Local Production-Style Run

Build everything first:

```bash
npm run build:all
```

Then start the full stack:

```bash
npm run start
```

That launches:

- backend on `http://127.0.0.1:3001`
- UI on `http://127.0.0.1:4001`

If you are on Windows and want the helper that also performs port cleanup and startup checks, you can use:

```bash
npm run start:stack
```

## 2. Development Run

Preferred portable dev command:

```bash
npm run dev
```

Optional Windows helper:

```bash
npm run dev:stack
```

Stop the stack with:

```bash
npm run stop
```

## 3. Container Build

The repo ships with a root multi-stage [`Dockerfile`](Dockerfile).

Example local build:

```bash
docker build -t vigilance-os:latest .
```

Example local run:

```bash
docker run --rm -p 4001:4001 -p 3001:3001 --env-file .env vigilance-os:latest
```

The container:

- installs backend and UI dependencies separately
- builds backend `dist/` assets and the Next.js UI
- includes Python + Immunefi MCP requirements
- exposes both `3001` and `4001`
- uses a healthcheck based on backend and UI reachability

## 4. How Environment Variables Are Handled

### Local development

- create a root `.env` from [`.env.example`](.env.example)
- `npm run dev` and `npm run start` use those values at runtime

### Docker builds

- the real `.env` file is **not baked into the image**
- `.dockerignore` excludes `.env`, `.env.*`, and other local-only environment files from the build context
- this keeps secrets out of the built container image

### Local container runs

- pass environment variables at runtime with `--env-file .env`
- you can also override individual values with `-e NAME=value`

### Nosana deployments

- Nosana does not rely on your local `.env` file
- values come from the `env` block in [`nosana.yaml`](nosana.yaml)
- secret values should be supplied with `%%SECRETS.NAME%%` placeholders

Current secret-backed values in the manifest:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALERT_CHAT_ID`

Non-secret challenge defaults such as public model endpoints are currently set directly in the manifest for convenience. If you want a more portable deployment, you can also move the `OPENAI_*` and embedding values into deployment-time variables or secrets.

## 5. Nosana Deployment

The repo includes a starter manifest:

- [`nosana.yaml`](nosana.yaml)

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

## 6. Self-Hosted Model Option

If the shared hosted model endpoint is unavailable, use the self-hosting guide:

- [`nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md`](nos_job_def/SELF_HOST_MODEL_ON_NOSANA.md)

That path is a supported fallback for temporary recovery, demos, and situations where you want direct control over model uptime.

## 7. Pre-Submission Verification

Before final submission, verify:

```bash
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

## 8. Notes

- `npm run dev` is now the preferred cross-platform development command.
- `npm run start` is the preferred cross-platform production-style run command.
- the old PowerShell launcher still exists as a Windows convenience helper, but it is no longer the primary workflow.
