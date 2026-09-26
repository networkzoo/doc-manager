import { pgTable, pgEnum, uuid, text, integer, boolean, timestamp, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "lawyer",
  "conveyancer", // e.g. a real-estate-focused firm's responsible-person role instead of "lawyer"
  "law_clerk",
  "staff",
  "billing",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    role: userRoleEnum("role").notNull().default("staff"),
    // Some firms identify the person responsible for a matter by initials
    // rather than full name (e.g. a legacy folder-naming convention like
    // "32860 (dr) Smith purchase" — "dr" here). Nullable: only meaningful
    // for firms/tenants that actually use this convention.
    initials: text("initials"),
    // Default hourly rate in cents; matter/client-level overrides live on
    // their own tables and take precedence — see docs/PLAN.md time tracking
    // rate resolution order.
    timekeeperRateCents: integer("timekeeper_rate_cents"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    ssoSubject: text("sso_subject"), // OIDC `sub` claim from Entra ID / Google Workspace
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
  },
  (t) => [
    index("users_tenant_idx").on(t.tenantId),
    index("users_tenant_email_idx").on(t.tenantId, t.email),
    // Not partial (Postgres unique constraints already treat multiple
    // NULLs as distinct, so this doesn't block tenants that never set
    // initials for anyone).
    unique("users_tenant_initials_unique").on(t.tenantId, t.initials),
  ],
);
