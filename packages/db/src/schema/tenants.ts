import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

// The only table with no tenant_id column and no RLS policy — everything
// else hangs off this and is scoped by it. Keep it that way.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
