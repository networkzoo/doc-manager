import { withTenant, schema } from "@law-portal/db";
import { sql, eq, and } from "drizzle-orm";
import type { JobType, ConnectorJob, JobResult } from "@law-portal/shared";

/**
 * Hand-rolled Postgres queue — SELECT ... FOR UPDATE SKIP LOCKED, not
 * Graphile Worker as docs/PLAN.md originally suggested. Same underlying
 * locking primitive; simpler starting point, revisit if job volume or
 * retry/scheduling needs outgrow it. See
 * packages/db/src/schema/connector_jobs.ts.
 */

// `payload` is exactly a job's type-specific fields, minus `type` and
// `jobId` — neither exists yet at enqueue time (jobId only becomes
// meaningful once leaseNextJob() returns the row's own generated id, see
// below). Callers know which job type they're creating, so this stays
// an untyped bag rather than threading the full discriminated union
// through — payload is genuinely untyped JSONB at the DB layer regardless.
export async function enqueueJob(
  tenantId: string,
  connectorId: string,
  type: JobType,
  payload: Record<string, unknown>,
): Promise<string> {
  const [row] = await withTenant(tenantId, null, (tx) =>
    tx
      .insert(schema.connectorJobs)
      .values({ tenantId, connectorId, type, payload })
      .returning({ id: schema.connectorJobs.id }),
  );
  return row.id;
}

/**
 * Atomically leases the oldest pending job for a connector, marking it
 * `leased` in the same transaction so two overlapping poll requests
 * (shouldn't happen with one connector process, but cheap insurance)
 * can't both grab it — FOR UPDATE SKIP LOCKED means a concurrent lease
 * attempt just moves on to the next row instead of blocking.
 */
export async function leaseNextJob(
  tenantId: string,
  connectorId: string,
): Promise<ConnectorJob | null> {
  return withTenant(tenantId, null, async (tx) => {
    const [row] = await tx.execute(sql`
      select id, type, payload
      from connector_jobs
      where tenant_id = ${tenantId}
        and connector_id = ${connectorId}
        and status = 'pending'
      order by created_at asc
      limit 1
      for update skip locked
    `);
    if (!row) return null;

    await tx
      .update(schema.connectorJobs)
      .set({ status: "leased", leasedAt: new Date() })
      .where(eq(schema.connectorJobs.id, row.id as string));

    return {
      type: row.type,
      jobId: row.id,
      ...(row.payload as object),
    } as ConnectorJob;
  });
}

// connectorId is required, not just tenantId — a job's completion report
// must come from the same connector it was leased to, so one connector
// can't report results for (and thus can't probe the existence/shape
// of) another connector's jobs even within the same tenant.
export async function completeJob(
  tenantId: string,
  connectorId: string,
  result: JobResult,
): Promise<void> {
  await withTenant(tenantId, null, (tx) =>
    tx
      .update(schema.connectorJobs)
      .set({
        status: result.ok ? "succeeded" : "failed",
        result: result.ok ? result : null,
        error: result.ok ? null : (result.error ?? "unknown error"),
        completedAt: new Date(),
      })
      .where(
        and(
          eq(schema.connectorJobs.id, result.jobId),
          eq(schema.connectorJobs.connectorId, connectorId),
        ),
      ),
  );
}
