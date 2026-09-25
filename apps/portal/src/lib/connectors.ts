import { withTenant, schema } from "@law-portal/db";
import { isNull, desc } from "drizzle-orm";

/**
 * Picks the connector that serves a tenant's document requests. Matters
 * have no connectorId column (packages/db/src/schema/matters.ts) — a
 * tenant is assumed to run exactly one active connector for now, which
 * holds for a single-office pilot firm. A firm with multiple sites will
 * need matters (or clients) to record which connector serves them; this
 * is the first place that assumption would need to change.
 */
export async function resolveConnectorForTenant(
  tenantId: string,
  userId: string | null,
): Promise<{ id: string } | null> {
  return withTenant(tenantId, userId, async (tx) => {
    const [connector] = await tx
      .select({ id: schema.connectors.id })
      .from(schema.connectors)
      .where(isNull(schema.connectors.revokedAt))
      .orderBy(desc(schema.connectors.enrolledAt))
      .limit(1);
    return connector ?? null;
  });
}
