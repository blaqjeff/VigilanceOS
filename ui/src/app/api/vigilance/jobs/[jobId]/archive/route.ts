import { proxyVigilanceRequest } from "../../../proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  return proxyVigilanceRequest(req, {
    method: "POST",
    path: `/vigilance/jobs/${jobId}/archive`,
  });
}
