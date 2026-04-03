import { NextResponse } from "next/server";

const AGENT_BASE_URL = (process.env.AGENT_BASE_URL || "http://127.0.0.1:3001").replace(/\/+$/, "");
const VIGILANCE_AGENT_NAME = process.env.VIGILANCE_AGENT_NAME || "Scout";
const VIGILANCE_PLUGIN_NAME = process.env.VIGILANCE_PLUGIN_NAME || "VigilanceUIBridge";
const READINESS_PANEL_NAME = "vigilance-readiness";

type AgentSummary = {
  id: string;
  name?: string;
  characterName?: string;
};

type AgentsResponse = {
  data?: {
    agents?: AgentSummary[];
  };
};

type PanelSummary = {
  name?: string;
  path?: string;
};

type PanelsResponse = {
  data?: PanelSummary[];
};

type ResolvedPanelBase = {
  agentId: string;
  basePath: string;
  baseQuery: URLSearchParams;
};

let cachedPanelBase: ResolvedPanelBase | null = null;
let cachedPanelBaseExpiresAt = 0;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();

  if (!text.trim()) {
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${url}`);
    }

    return {};
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 160)}`);
  }

  if (!res.ok) {
    const message =
      isObject(data) && isObject(data.error) && typeof data.error.message === "string"
        ? data.error.message
        : `Request failed (${res.status}) for ${url}`;
    throw new Error(message);
  }

  return data;
}

async function resolveScoutAgentId(): Promise<string> {
  const agentsUrl = `${AGENT_BASE_URL}/api/agents`;
  const payload = (await fetchJson(agentsUrl)) as AgentsResponse;
  const agents = payload.data?.agents ?? [];

  const preferred =
    agents.find((agent) => agent.name === VIGILANCE_AGENT_NAME) ||
    agents.find((agent) => agent.characterName === VIGILANCE_AGENT_NAME) ||
    agents[0];

  if (!preferred?.id) {
    throw new Error("No active agents are available for the Vigilance UI proxy.");
  }

  return preferred.id;
}

async function resolvePanelBase(): Promise<ResolvedPanelBase> {
  const now = Date.now();
  if (cachedPanelBase && cachedPanelBaseExpiresAt > now) {
    return cachedPanelBase;
  }

  const agentId = await resolveScoutAgentId();
  const panelsUrl = `${AGENT_BASE_URL}/api/agents/${agentId}/panels`;
  const payload = (await fetchJson(panelsUrl)) as PanelsResponse;
  const panels = payload.data ?? [];

  const readinessPanel =
    panels.find((panel) => panel.name === READINESS_PANEL_NAME) ||
    panels.find((panel) => panel.path?.includes(`/${VIGILANCE_PLUGIN_NAME}/vigilance/readiness`));

  if (!readinessPanel?.path) {
    throw new Error("The Scout agent did not expose the Vigilance UI bridge panel routes.");
  }

  const readinessUrl = new URL(readinessPanel.path, AGENT_BASE_URL);
  const marker = "/vigilance/readiness";
  const markerIndex = readinessUrl.pathname.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Unexpected readiness panel path: ${readinessUrl.pathname}`);
  }

  const resolved = {
    agentId,
    basePath: readinessUrl.pathname.slice(0, markerIndex),
    baseQuery: new URLSearchParams(readinessUrl.search),
  };

  cachedPanelBase = resolved;
  cachedPanelBaseExpiresAt = now + 30_000;
  return resolved;
}

async function buildPluginUrl(pathname: string, searchParams?: URLSearchParams): Promise<URL> {
  const resolved = await resolvePanelBase();
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const url = new URL(`${resolved.basePath}${normalizedPath}`, AGENT_BASE_URL);

  for (const [key, value] of resolved.baseQuery.entries()) {
    url.searchParams.set(key, value);
  }

  if (searchParams) {
    for (const [key, value] of searchParams.entries()) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

export async function proxyVigilanceRequest(
  req: Request,
  options: {
    method: "GET" | "POST";
    path: string;
    includeQuery?: boolean;
  }
) {
  try {
    const incomingUrl = new URL(req.url);
    const upstreamUrl = await buildPluginUrl(
      options.path,
      options.includeQuery ? incomingUrl.searchParams : undefined
    );

    const init: RequestInit = {
      method: options.method,
      cache: "no-store",
    };

    if (options.method !== "GET") {
      const body = await req.text();
      if (body) {
        init.body = body;
        init.headers = {
          "Content-Type": req.headers.get("content-type") || "application/json",
        };
      }
    }

    const res = await fetch(upstreamUrl.toString(), init);
    const text = await res.text();

    if (!text.trim()) {
      return NextResponse.json({}, { status: res.status });
    }

    try {
      return NextResponse.json(JSON.parse(text), { status: res.status });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: `Expected JSON from Vigilance backend, received: ${text.slice(0, 160)}`,
        },
        { status: 502 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to proxy request to Vigilance backend.",
      },
      { status: 502 }
    );
  }
}
