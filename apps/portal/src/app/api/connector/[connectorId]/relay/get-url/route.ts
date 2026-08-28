import { NextResponse } from "next/server";
import { authenticateConnector } from "@/lib/connectorAuth";
import { presignGet } from "@/lib/relay";

// Called by requestPresignedGet() in
// apps/connector/cmd/connector/portal_client.go, at the start of
// receive_upload: the connector needs to fetch the ciphertext a browser
// already PUT to this blobKey.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const { connectorId } = await params;
  const connector = await authenticateConnector(connectorId, request.headers.get("authorization"));
  if (!connector) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const blobKey = new URL(request.url).searchParams.get("blobKey");
  if (!blobKey) {
    return NextResponse.json({ error: "blobKey query param is required" }, { status: 400 });
  }

  const presignedUrl = await presignGet(blobKey);
  return NextResponse.json({ presignedUrl });
}
