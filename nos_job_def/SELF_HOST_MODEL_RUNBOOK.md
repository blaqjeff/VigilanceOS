# Nosana Self-Hosted Model Runbook

This runbook captures the lowest-friction path for swapping VigilanceOS to a self-hosted OpenAI-compatible endpoint on Nosana.

## Goal

Host a vLLM OpenAI-compatible endpoint for `Qwen3.5-27B-AWQ-4bit` so the existing VigilanceOS model integration can run without code changes.

## Why this shape

- VigilanceOS probes `${OPENAI_API_URL}/models` and expects an OpenAI-compatible API.
- Nosana's vLLM example is the cleanest fit for that interface.
- The deployment template uses the same served model name the app already expects.

## Current template

- Deployment template: `nos_job_def/qwen27b_vllm_deployment.template.json`
- Default image: `docker.io/vllm/vllm-openai:v0.10.2`
- Default repo: `cyankiwi/Qwen3.5-27B-AWQ-4bit`
- Served model name: `Qwen3.5-27B-AWQ-4bit`

## Recommended GPU order

Based on the market snapshot discussed during setup:

1. NVIDIA 5090
2. NVIDIA 4090
3. NVIDIA 3090
4. NVIDIA A6000

Notes:

- 24 GB cards are the cheapest credible first attempt for a 27B AWQ model, but they are tighter.
- 5090 is the preferred first choice because it gives more headroom than 24 GB cards while still being reasonably priced.
- If the first attempt OOMs or stalls, move up rather than trying to squeeze the config indefinitely.

## Launch checklist

1. Create a short-lived `NOSANA_API_KEY`.
2. Pick a market address for the preferred GPU.
3. Replace `__NOSANA_MARKET_ADDRESS__` in the deployment template.
4. Create the deployment with the Nosana API or SDK.
5. Wait for the endpoint to become healthy.
6. Point the local app at that endpoint.

## Local env swap

Once the endpoint is live, set:

```env
OPENAI_API_KEY=nosana
OPENAI_API_URL=https://<your-nosana-endpoint>/v1
MODEL_NAME=Qwen3.5-27B-AWQ-4bit
```

Notes:

- Keep the base URL ending in `/v1` so the readiness probe still hits `/models` correctly.
- The current app can keep sending a bearer token; vLLM typically ignores it unless auth is explicitly enabled.

## Immediate post-launch validation

1. Restart the local stack.
2. Confirm `/api/vigilance/readiness` reports model `ready`.
3. Rerun the approved Solana demo job first.
4. If that passes the model gate, rerun the EVM demo job.

## Fallbacks

- If the exact repo fails to load in vLLM, verify the Hugging Face model is public and vLLM-compatible.
- If the card is too tight on VRAM, move to a larger market before changing the app.
- If we intentionally swap to another Qwen model, update `MODEL_NAME` to the hosted served-model name instead of pretending it is the same model.
