import { pgTable, pgEnum, uuid, text, integer, boolean, date, timestamp, index } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { matters } from "./matters";
import { users } from "./users";

export const timeEntryStatusEnum = pgEnum("time_entry_status", [
  "draft",
  "submitted",
  "approved",
  "billed",
]);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").notNull().references(() => matters.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    entryDate: date("entry_date").notNull(),
    // Stored in minutes so rounding policy (e.g. 6-minute increments) is an
    // application-layer decision, not baked into the column type.
    durationMinutes: integer("duration_minutes").notNull(),
    narrative: text("narrative").notNull(),
    utbmsTaskCode: text("utbms_task_code"),
    utbmsActivityCode: text("utbms_activity_code"),
    billable: boolean("billable").notNull().default(true),
    // Resolved rate at time of entry (matter override -> client override ->
    // timekeeper default; see docs/PLAN.md "Time tracking"), snapshotted so
    // later rate changes don't retroactively alter historical entries.
    rateCents: integer("rate_cents"),
    status: timeEntryStatusEnum("status").notNull().default("draft"),
    // Set when created from passive-capture suggestion rather than typed
    // directly, so the UI can distinguish and let the user confirm/edit.
    suggestedFromAudit: boolean("suggested_from_audit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("time_entries_tenant_idx").on(t.tenantId),
    index("time_entries_matter_idx").on(t.matterId),
    index("time_entries_user_date_idx").on(t.userId, t.entryDate),
    index("time_entries_status_idx").on(t.tenantId, t.status),
  ],
);
