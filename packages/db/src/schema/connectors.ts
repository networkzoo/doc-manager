import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// One row per on-prem connector installation. `enrollmentSecretHash` is
// the SHA-256 hash of a long random token created once (by an operator,
// see infra/deploy/README.md "Enrolling a connector") and passed to the
// connector binary directly as its -token flag — every request from that
// connector includes it as a Bearer token, verified against this hash
// (apps/portal/src/lib/connectorAuth.ts). No separate enrollment
// handshake or token rotation yet; revocation is a hand-set
// `revokedAt`, not a token swap. Simpler than the plan's original
// "rotating session token" framing — revisit if a real token-rotation
// need shows up (e.g. auto-expiring compromised credentials without
// requiring a fresh manual token on every firm's connector).
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
