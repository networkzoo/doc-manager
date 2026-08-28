import { NextResponse } from "next/server";
import { JobResultSchema } from "@law-portal/shared";
import { authenticateConnector } from "@/lib/connectorAuth";
import { completeJob } from "@/lib/connectorJobs";

// Called by reportResult() in
// apps/connector/cmd/connector/portal_client.go once a leased job (from
// ../poll) finishes, success or failure.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const connector = await authenticateConnector(connectorId, request.headers.get("authorization"));
  if (!connector) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = JobResultSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  await completeJob(connector.tenantId, connector.connectorId, parsed.data);
  return NextResponse.json({ ok: true });
}
