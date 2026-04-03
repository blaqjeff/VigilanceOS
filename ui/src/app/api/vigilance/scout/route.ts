import { NextResponse } from "next/server";

const AGENT_BASE_URL = process.env.AGENT_BASE_URL || "http://127.0.0.1:3001";

export async function GET() {
  const res = await fetch(`${AGENT_BASE_URL}/vigilance/scout`, { method: "GET" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
