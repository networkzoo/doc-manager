import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@law-portal/db";
import { JobResultSchema } from "@law-portal/shared";
import { getSession } from "@/lib/session";
import { presignGet } from "@/lib/relay";

/**
 * Polled by the browser after POSTing ../../documents/[id]/stage, until
 * status is a terminal state. On success this is docs/PLAN.md "Download"
 * step 5: hand the browser a fresh presigned GET (not the one the
 * connector used — that was for its own PUT/GET, this is a new one for
 * the browser) plus the content key, so it can decrypt with WebCrypto.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const job = await withTenant(session.tenantId, session.userId, async (tx) => {
    const [row] = await tx
      .select({ status: schema.connectorJobs.status, result: schema.connectorJobs.result, error: schema.connectorJobs.error })
      .from(schema.connectorJobs)
      .where(eq(schema.connectorJobs.id, jobId))
      .limit(1);
    return row ?? null;
  });
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  if (job.status === "failed") {
    return NextResponse.json({ status: job.status, error: job.error });
  }
  if (job.status !== "succeeded") {
    return NextResponse.json({ status: job.status });
  }

  const parsed = JobResultSchema.safeParse(job.result);
  if (!parsed.success || !parsed.data.blobKey || !parsed.data.contentKeyB64) {
    return NextResponse.json({ status: "failed", error: "malformed job result" }, { status: 500 });
  }

  const presignedUrl = await presignGet(parsed.data.blobKey);
  return NextResponse.json({
    status: "succeeded",
    presignedUrl,
    contentKeyB64: parsed.data.contentKeyB64,
  });
}
