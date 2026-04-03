import { proxyVigilanceRequest } from "../proxy";

export async function GET() {
  return proxyVigilanceRequest(new Request("http://localhost"), {
    method: "GET",
    path: "/vigilance/readiness",
  });
}
