import { proxyVigilanceRequest } from "../../../../../proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string; candidateId: string }> }
) {
  const { jobId, candidateId } = await params;
  return proxyVigilanceRequest(req, {
    method: "POST",
    path: `/vigilance/jobs/${jobId}/findings/${candidateId}/resolve`,
  });
}
