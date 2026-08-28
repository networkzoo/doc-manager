import { pgTable, pgEnum, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { connectors } from "./connectors";

// A hand-rolled Postgres queue (SELECT ... FOR UPDATE SKIP LOCKED, see
// apps/portal/src/lib/connectorJobs.ts) rather than Graphile Worker as
// docs/PLAN.md originally suggested — same underlying locking primitive,
// simpler starting point. Revisit if job volume or retry/scheduling needs
// outgrow this.
export const connectorJobStatusEnum = pgEnum("connector_job_status", [
  "pending",
  "leased",
  "succeeded",
  "failed",
]);

export const connectorJobTypeEnum = pgEnum("connector_job_type", [
  "stage_download",
  "receive_upload",
  "scan_reconcile",
]);

export const connectorJobs = pgTable(
  "connector_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull().references(() => connectors.id, { onDelete: "cascade" }),
    type: connectorJobTypeEnum("type").notNull(),
    // Shape matches packages/shared/src/jobs.ts's per-type job schemas
    // (minus `type`/`jobId`, which live as real columns here) — kept as
    // JSONB rather than one column per job-type field since different
    // job types have different payloads and this table is the queue, not
    // the source of truth for any of them.
    payload: jsonb("payload").notNull(),
    status: connectorJobStatusEnum("status").notNull().default("pending"),
    // Result, once reported — shape matches packages/shared/src/jobs.ts
    // JobResultSchema (minus jobId/ok, which are `id`/`status` here).
    result: jsonb("result"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    leasedAt: timestamp("leased_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("connector_jobs_tenant_idx").on(t.tenantId),
    // The queue's actual access pattern: "next pending job for this
    // connector, oldest first" — see connectorJobs.leaseNextJob().
    index("connector_jobs_connector_status_idx").on(t.connectorId, t.status, t.createdAt),
  ],
);
