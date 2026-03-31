import { NextResponse } from "next/server";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL || "http://127.0.0.1:3001";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${AGENT_BASE_URL}/vigilance/targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

