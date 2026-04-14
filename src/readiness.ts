export type IntegrationState = "ready" | "degraded" | "blocked" | "disabled" | "unknown";

export type IntegrationKey = "immunefiMcp" | "model" | "telegram";

export type IntegrationReadiness = {
  key: IntegrationKey;
  label: string;
  feature: string;
  state: IntegrationState;
  available: boolean;
  summary: string;
  details: string[];
  action?: string;
  checkedAt: string;
};

export type ReadinessSnapshot = {
  checkedAt: string;
  overallState: "ready" | "degraded";
  summary: string;
  integrations: Record<IntegrationKey, IntegrationReadiness>;
};

type IntegrationTemplate = Pick<
  IntegrationReadiness,
  "key" | "label" | "feature"
>;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneIntegration(
  integration: IntegrationReadiness
): IntegrationReadiness {
  return {
    ...integration,
    details: [...integration.details],
  };
}

function cloneSnapshot(snapshot: ReadinessSnapshot): ReadinessSnapshot {
  return {
    ...snapshot,
    integrations: {
      immunefiMcp: cloneIntegration(snapshot.integrations.immunefiMcp),
      model: cloneIntegration(snapshot.integrations.model),
      telegram: cloneIntegration(snapshot.integrations.telegram),
    },
  };
}

function integrationTemplate(key: IntegrationKey): IntegrationTemplate {
  switch (key) {
    case "immunefiMcp":
      return {
        key,
        label: "Immunefi MCP",
        feature: "Live Scout discovery",
      };
    case "model":
      return {
        key,
        label: "OpenAI-Compatible Model",
        feature: "LLM-backed audit and review",
      };
    case "telegram":
      return {
        key,
        label: "Telegram",
        feature: "Telegram alerts and approval controls",
      };
  }
}

function buildReadinessResult({
  key,
  label,
  feature,
  state,
  available,
  summary,
  details = [],
  action,
}: IntegrationTemplate & {
  state: IntegrationState;
  available: boolean;
  summary: string;
  details?: string[];
  action?: string;
}): IntegrationReadiness {
  return {
    key,
    label,
    feature,
    state,
    available,
    summary,
    details,
    action,
    checkedAt: nowIso(),
  };
}

function joinUrl(base: string, suffix: string): string {
  return `${String(base).replace(/\/+$/, "")}/${String(suffix).replace(
    /^\/+/,
    ""
  )}`;
}

const MODEL_PROBE_TIMEOUT_MS = 20_000;
const MODEL_REFRESH_INTERVAL_MS = 30_000;
const MODEL_TRANSIENT_GRACE_MS = 5 * 60_000;

function checkedAtMs(value: string): number {
  return Date.parse(value);
}

function isRecentSuccessfulModelReadiness(
  integration: IntegrationReadiness | null | undefined
): integration is IntegrationReadiness {
  if (!integration || integration.key !== "model") {
    return false;
  }

  if (!integration.available || integration.state !== "ready") {
    return false;
  }

  const parsed = checkedAtMs(integration.checkedAt);
  return Number.isFinite(parsed) && Date.now() - parsed <= MODEL_TRANSIENT_GRACE_MS;
}

function defaultIntegration(
  key: IntegrationKey,
  label: string,
  feature: string
): IntegrationReadiness {
  return {
    key,
    label,
    feature,
    state: "unknown",
    available: false,
    summary: "Readiness has not been checked yet.",
    details: [],
    checkedAt: nowIso(),
  };
}

export function createDefaultReadinessSnapshot(): ReadinessSnapshot {
  const checkedAt = nowIso();
  return {
    checkedAt,
    overallState: "degraded",
    summary: "Integration readiness has not been evaluated yet.",
    integrations: {
      immunefiMcp: {
        ...defaultIntegration(
          "immunefiMcp",
          "Immunefi MCP",
          "Live Scout discovery"
        ),
        checkedAt,
      },
      model: {
        ...defaultIntegration(
          "model",
          "OpenAI-Compatible Model",
          "LLM-backed audit and review"
        ),
        checkedAt,
      },
      telegram: {
        ...defaultIntegration(
          "telegram",
          "Telegram",
          "Telegram alerts and approval controls"
        ),
        checkedAt,
      },
    },
  };
}

let readinessSnapshot = createDefaultReadinessSnapshot();

export function createReadinessSnapshot(
  integrations: Record<IntegrationKey, IntegrationReadiness>
): ReadinessSnapshot {
  const checkedAt = nowIso();
  const values = Object.values(integrations);
  const readyCount = values.filter((integration) => integration.available).length;
  const overallState = values.every((integration) => integration.state === "ready")
    ? "ready"
    : "degraded";

  return {
    checkedAt,
    overallState,
    summary:
      overallState === "ready"
        ? `All ${values.length} integrations are ready.`
        : `${readyCount}/${values.length} integrations are fully ready.`,
    integrations: {
      immunefiMcp: cloneIntegration(integrations.immunefiMcp),
      model: cloneIntegration(integrations.model),
      telegram: cloneIntegration(integrations.telegram),
    },
  };
}

export function setReadinessSnapshot(
  snapshot: ReadinessSnapshot
): ReadinessSnapshot {
  readinessSnapshot = cloneSnapshot(snapshot);
  return getReadinessSnapshot();
}

export function getReadinessSnapshot(): ReadinessSnapshot {
  return cloneSnapshot(readinessSnapshot);
}

export function getIntegrationReadiness(
  key: IntegrationKey
): IntegrationReadiness {
  return cloneIntegration(readinessSnapshot.integrations[key]);
}

export function updateIntegrationReadiness(
  key: IntegrationKey,
  integration: IntegrationReadiness
): ReadinessSnapshot {
  const current = getReadinessSnapshot();
  return setReadinessSnapshot(
    createReadinessSnapshot({
      ...current.integrations,
      [key]: integration,
    })
  );
}

export async function probeModelReadinessFromEnv(
  previous?: IntegrationReadiness
): Promise<IntegrationReadiness> {
  const template = integrationTemplate("model");
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const apiUrl = String(
    process.env.OPENAI_API_URL || process.env.OPENAI_BASE_URL || ""
  ).trim();
  const modelName = String(process.env.MODEL_NAME || "configured default").trim();

  if (!apiUrl) {
    return buildReadinessResult({
      ...template,
      state: "blocked",
      available: false,
      summary: "OPENAI_API_URL is not set.",
      action: "Set OPENAI_API_URL to a reachable OpenAI-compatible endpoint.",
    });
  }

  if (!apiKey) {
    return buildReadinessResult({
      ...template,
      state: "blocked",
      available: false,
      summary: "OPENAI_API_KEY is not set.",
      action: "Set OPENAI_API_KEY before running LLM-backed audits.",
    });
  }

  const probeUrl = joinUrl(apiUrl, "models");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(probeUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (response.ok) {
      return buildReadinessResult({
        ...template,
        state: "ready",
        available: true,
        summary: "Model endpoint accepted the readiness probe.",
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
      });
    }

    if (response.status === 401 || response.status === 403) {
      return buildReadinessResult({
        ...template,
        state: "blocked",
        available: false,
        summary: `Model endpoint rejected authentication (${response.status} ${response.statusText}).`,
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
        action: "Update OPENAI_API_KEY or point OPENAI_API_URL at a valid endpoint.",
      });
    }

    if (response.status === 404) {
      return buildReadinessResult({
        ...template,
        state: "degraded",
        available: false,
        summary:
          "Model endpoint is reachable, but the /models readiness probe returned 404.",
        details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
        action:
          "Verify that OPENAI_API_URL points at the API root expected by the OpenAI plugin.",
      });
    }

    return buildReadinessResult({
      ...template,
      state: "degraded",
      available: false,
      summary: `Model endpoint readiness probe failed with ${response.status} ${response.statusText}.`,
      details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
      action: "Check endpoint availability and credentials before relying on model-backed audits.",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError" &&
      isRecentSuccessfulModelReadiness(previous)
    ) {
      return buildReadinessResult({
        ...template,
        state: "ready",
        available: true,
        summary:
          "Using the last successful model readiness check after a transient probe timeout.",
        details: [
          `Endpoint: ${probeUrl}`,
          `Model: ${modelName}`,
          `Last success: ${previous.checkedAt}`,
        ],
      });
    }

    const summary =
      error instanceof Error ? error.message : "Unknown model readiness probe error.";
    return buildReadinessResult({
      ...template,
      state: "degraded",
      available: false,
      summary: `Model endpoint readiness probe failed: ${summary}`,
      details: [`Endpoint: ${probeUrl}`, `Model: ${modelName}`],
      action: "Verify network access and the OPENAI_API_URL value.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshModelReadinessSnapshot(): Promise<ReadinessSnapshot> {
  const current = getIntegrationReadiness("model");
  const parsed = checkedAtMs(current.checkedAt);

  if (
    current.state !== "unknown" &&
    Number.isFinite(parsed) &&
    Date.now() - parsed < MODEL_REFRESH_INTERVAL_MS
  ) {
    return getReadinessSnapshot();
  }

  const integration = await probeModelReadinessFromEnv(current);
  return updateIntegrationReadiness("model", integration);
}

export function formatReadinessLines(snapshot: ReadinessSnapshot): string[] {
  const lines = [
    `[vigilance][readiness] overall=${snapshot.overallState} - ${snapshot.summary}`,
  ];

  for (const integration of Object.values(snapshot.integrations)) {
    const detailSuffix =
      integration.details.length > 0
        ? ` (${integration.details.join("; ")})`
        : "";
    const actionSuffix = integration.action
      ? ` Action: ${integration.action}`
      : "";
    lines.push(
      `[vigilance][readiness] ${integration.label}: ${integration.state} - ${integration.summary}${detailSuffix}${actionSuffix}`
    );
  }

  return lines;
}
