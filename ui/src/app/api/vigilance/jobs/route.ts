import { proxyVigilanceRequest } from "../proxy";

export async function GET(req: Request) {
  return proxyVigilanceRequest(req, {
    method: "GET",
    path: "/vigilance/jobs",
    includeQuery: true,
  });
}
