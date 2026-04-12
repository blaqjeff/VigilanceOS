# Self-Hosting the Audit Model on Nosana

This guide explains how to run Vigilance-OS against a self-hosted OpenAI-compatible model endpoint on Nosana when you want more control over model availability.

## Why this works

Vigilance-OS expects an OpenAI-compatible model API and probes:

```text
${OPENAI_API_URL}/models
```

That makes a Nosana-hosted `vLLM` deployment a good fit, because the app can keep using the same model integration path without code changes.

## Included deployment template

This repository includes a ready-to-adapt Nosana deployment template:

- [`nos_job_def/qwen27b_vllm_deployment.template.json`](qwen27b_vllm_deployment.template.json)

Default values in that template:

- Image: `docker.io/vllm/vllm-openai:v0.10.2`
- Model repo: `cyankiwi/Qwen3.5-27B-AWQ-4bit`
- Served model name: `Qwen3.5-27B-AWQ-4bit`

## Recommended GPU order

For this specific 27B AWQ model, these GPUs are the most practical starting order:

1. NVIDIA 5090
2. NVIDIA 4090
3. NVIDIA 3090
4. NVIDIA A6000

Notes:

- 24 GB cards can be a cost-effective first attempt, but they are tighter on headroom.
- 5090 is the preferred first choice when available because it offers a better balance of room and price.
- If the model fails to load cleanly, move to a roomier GPU before trying to force the configuration.

## Launch Steps

1. Create or obtain a short-lived `NOSANA_API_KEY`.
2. Choose a Nosana market for the GPU you want to use.
3. Replace `__NOSANA_MARKET_ADDRESS__` in [`qwen27b_vllm_deployment.template.json`](qwen27b_vllm_deployment.template.json).
4. Create the deployment through the Nosana API, SDK, or dashboard.
5. Wait for the endpoint to become healthy.
6. Point Vigilance-OS at the new endpoint.

## App Configuration

Once the endpoint is live, set these values for Vigilance-OS:

```env
OPENAI_API_KEY=nosana
OPENAI_API_URL=https://<your-nosana-endpoint>/v1
MODEL_NAME=Qwen3.5-27B-AWQ-4bit
```

Important notes:

- Keep the base URL ending in `/v1` so readiness checks continue to hit `/models` correctly.
- The app can continue sending a bearer token. A standard `vLLM` endpoint usually ignores it unless auth is explicitly enabled.

## Validation Checklist

After switching the app to the self-hosted model:

1. Restart the stack.
2. Open `/api/vigilance/readiness` and confirm the model shows `ready`.
3. Run a controlled EVM or Solana target through the normal workflow.
4. Confirm the result appears in the UI with findings and reviewer outcomes.

## Fallback Guidance

- If the model repo fails to load, confirm the Hugging Face model is public and compatible with the selected `vLLM` image.
- If the GPU runs out of memory, move to a larger market before changing the app.
- If you intentionally host a different model, update `MODEL_NAME` so the app reflects the actual served model name honestly.

## Related Files

- [`../DEPLOYMENT.md`](../DEPLOYMENT.md)
- [`qwen27b_vllm_deployment.template.json`](qwen27b_vllm_deployment.template.json)
- [`nosana_eliza_job_definition.json`](nosana_eliza_job_definition.json)
