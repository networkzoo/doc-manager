import { NextResponse } from "next/server";
import { authenticateConnector } from "@/lib/connectorAuth";
import { newBlobKey, presignPut } from "@/lib/relay";

/**
 * Called by requestPresignedPut() in
 * apps/connector/cmd/connector/portal_client.go, mid-stage_download: the
 * connector already has ciphertext in hand and needs somewhere in the
 * relay to PUT it. documentId arrives in the body but isn't used yet —
 * there's no portal-side record yet linking a blobKey back to a
 * document/job (that lands with the browser-download UI, a follow-up to
 * this Phase 1 wiring) — so it's accepted now to keep the wire shape
 * stable once that lands, rather than as a functioning parameter today.
 */
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
  if (!body || typeof body.documentId !== "string") {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }

  const blobKey = newBlobKey();
  const presignedUrl = await presignPut(blobKey);

  return NextResponse.json({ presignedUrl, blobKey });
}
