import { proxyVigilanceRequest } from "../proxy";

export async function POST(req: Request) {
  return proxyVigilanceRequest(req, {
    method: "POST",
    path: "/vigilance/audit",
  });
}

