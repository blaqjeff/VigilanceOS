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
