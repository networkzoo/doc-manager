import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// One row per on-prem connector installation. `enrollmentSecretHash` is the
// hashed pairing token exchanged during setup; the connector never gets a
// long-lived credential beyond its rotating session token (issued
// elsewhere, not stored here).
export const connectors = pgTable(
  "connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    siteName: text("site_name").notNull(),
    version: text("version"),
    documentRoot: text("document_root").notNull(), // UNC root the connector serves
    enrollmentSecretHash: text("enrollment_secret_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    health: jsonb("health").notNull().default({}), // last-reported disk, queue depth, scan lag
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("connectors_tenant_idx").on(t.tenantId)],
);
