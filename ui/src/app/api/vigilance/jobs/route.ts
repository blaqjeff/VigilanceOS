import { NextResponse } from "next/server";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL || "http://127.0.0.1:3001";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const agentUrl = new URL(`${AGENT_BASE_URL}/vigilance/jobs`);

  for (const [key, value] of url.searchParams.entries()) {
    agentUrl.searchParams.set(key, value);
  }

  const res = await fetch(agentUrl.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
