import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

// Every conflicts check ever run, with a snapshot of what it found — a
// firm must be able to demonstrate a check was done, not merely assert it.
// Never updated or deleted; see docs/PLAN.md "Conflicts checking".
export const conflictSearches = pgTable(
  "conflict_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    terms: text("terms").array().notNull(),
    resultsSnapshot: jsonb("results_snapshot").notNull(),
    runById: uuid("run_by_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conflict_searches_tenant_idx").on(t.tenantId)],
);
