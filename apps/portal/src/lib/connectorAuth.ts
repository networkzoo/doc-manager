import { createHash, timingSafeEqual } from "crypto";
import { rawSql } from "@law-portal/db";

/**
 * Authenticates a connector's request against its enrollmentSecretHash
 * (see packages/db/src/schema/connectors.ts — no separate enrollment
 * handshake yet, the token IS the enrollment secret). The connectorId
 * comes from the URL path, so this is a targeted single-row lookup, not
 * a brute-force scan.
 *
 * Uses rawSql, not withTenant() — unlike every other query in this app,
 * this one legitimately runs BEFORE the tenant is known (that's exactly
 * what a successful auth tells you), and connectors has RLS enabled
 * (packages/db/drizzle/0001_rls_policies.sql), which would silently
 * return zero rows for any query that hasn't already set app.tenant_id.
 * Same reasoning as findTenantForEmail in lib/auth.ts, except that
 * table was deliberately built with no RLS at all — this one has RLS
 * for every other access path, and only this specific pre-auth lookup
 * is the exception. Every query AFTER this one wraps in withTenant()
 * using the tenantId this returns, and RLS applies normally there.
 */

export type AuthenticatedConnector = {
  connectorId: string;
  tenantId: string;
  documentRoot: string;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function timingSafeHexEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function authenticateConnector(
  connectorId: string,
  authorizationHeader: string | null,
): Promise<AuthenticatedConnector | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const [connector] = await rawSql<
    { id: string; tenant_id: string; document_root: string; enrollment_secret_hash: string; revoked_at: Date | null }[]
  >`
    select id, tenant_id, document_root, enrollment_secret_hash, revoked_at
    from connectors
    where id = ${connectorId}
    limit 1
  `;

  if (!connector || connector.revoked_at) return null;
  if (!timingSafeHexEqual(sha256Hex(token), connector.enrollment_secret_hash)) return null;

  return {
    connectorId: connector.id,
    tenantId: connector.tenant_id,
    documentRoot: connector.document_root,
  };
}

export { sha256Hex };
