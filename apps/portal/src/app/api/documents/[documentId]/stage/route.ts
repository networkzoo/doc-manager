import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { withTenant, schema } from "@law-portal/db";
import { getSession } from "@/lib/session";
import { resolveConnectorForTenant } from "@/lib/connectors";
import { enqueueJob } from "@/lib/connectorJobs";

/**
 * Browser-triggered start of docs/PLAN.md "Download — user clicks a
 * document in the portal", step 1: enqueue stage_download, hand the
 * jobId back so the client can poll ../../jobs/[jobId] for the result.
 *
 * No ethical-wall check yet (matterAccess, docs/PLAN.md "Permissions
 * Model") — that authorization layer hasn't been built anywhere in the
 * app yet (Phase 2), so this matches the rest of the codebase's current
 * depth (RLS + session tenant scoping) rather than partially
 * implementing it in just one place.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const doc = await withTenant(session.tenantId, session.userId, async (tx) => {
    const [row] = await tx
      .select({
        relPath: schema.documents.relPath,
        matterSmbPath: schema.matters.smbPath,
      })
      .from(schema.documents)
      .innerJoin(schema.matters, eq(schema.matters.id, schema.documents.matterId))
      .where(eq(schema.documents.id, documentId))
      .limit(1);
    return row ?? null;
  });
  if (!doc) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }

  const connector = await resolveConnectorForTenant(session.tenantId, session.userId);
  if (!connector) {
    return NextResponse.json({ error: "no active connector enrolled for this tenant" }, { status: 503 });
  }

  const jobId = await enqueueJob(session.tenantId, connector.id, "stage_download", {
    documentId,
    relPath: doc.relPath,
    matterSmbPath: doc.matterSmbPath,
  });

  return NextResponse.json({ jobId });
}
