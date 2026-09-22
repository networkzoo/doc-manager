import { pgTable, pgEnum, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const clientTypeEnum = pgEnum("client_type", ["individual", "corporation"]);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    type: clientTypeEnum("type").notNull(),
    displayName: text("display_name").notNull(),
    // Former names, alternate spellings, known aliases, and (for
    // corporations) parent/affiliate names — all searched during conflicts
    // checks. See docs/PLAN.md "Conflicts checking".
    conflictNames: text("conflict_names").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clients_tenant_idx").on(t.tenantId),
    index("clients_conflict_names_idx").using("gin", t.conflictNames),
  ],
);
