import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@law-portal/db";
import { authenticateConnector } from "@/lib/connectorAuth";
import { leaseNextJob } from "@/lib/connectorJobs";

/**
 * The long-poll endpoint apps/connector/cmd/connector/main.go's
 * pollNextJob() blocks on (client.Timeout is 90s there). We hold the
 * request open, re-checking the queue every POLL_INTERVAL_MS, and return
 * 204 once LONG_POLL_TIMEOUT_MS elapses with nothing pending — the
 * connector treats that as "no job" and immediately polls again. Well
 * under the connector's own 90s client timeout so we always answer first.
 */

const LONG_POLL_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const connector = await authenticateConnector(connectorId, request.headers.get("authorization"));
  if (!connector) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  await withTenant(connector.tenantId, null, (tx) =>
    tx
      .update(schema.connectors)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.connectors.id, connector.connectorId)),
  );

  const deadline = Date.now() + LONG_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const job = await leaseNextJob(connector.tenantId, connector.connectorId);
    if (job) {
      return NextResponse.json(job);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  return new NextResponse(null, { status: 204 });
}
