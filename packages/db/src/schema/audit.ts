import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

// Append-only. No update/delete path is exposed anywhere in the app layer;
// enforced again at the DB via a REVOKE + trigger in
// drizzle/0002_audit_immutability.sql. Records both successful AND denied
// access attempts — see docs/PLAN.md "Permissions Model" and "Verification
// > Authorization".
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // e.g. 'document.view', 'document.download', 'access.denied'
    targetType: text("target_type").notNull(), // 'document' | 'matter' | 'time_entry' | ...
    targetId: uuid("target_id"),
    outcome: text("outcome").notNull().default("success"), // 'success' | 'denied'
    ip: text("ip"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_events_tenant_idx").on(t.tenantId),
    index("audit_events_tenant_target_idx").on(t.tenantId, t.targetType, t.targetId),
    index("audit_events_tenant_created_idx").on(t.tenantId, t.createdAt),
  ],
);
