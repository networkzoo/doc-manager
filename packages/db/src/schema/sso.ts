import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// Global, NOT tenant-scoped and NOT RLS-protected — same category as
// reference.ts (tax_rates, retention_schedules). This table's entire job
// is to answer "which tenant does this login belong to?" BEFORE any
// tenant context exists, so it has to be readable pre-authentication; an
// RLS policy keyed on app.tenant_id would be circular here.
//
// Populated by ops today (see packages/db/src/seed.ts for the dev
// example) — a self-serve admin UI for firms to register their own
// domain is future work, not v1.
//
// See docs/PLAN.md "SSO (build, not buy — Auth.js)": a login is only
// ever mapped to a tenant that is already registered here. An
// unrecognized email domain must be rejected at sign-in, never used to
// auto-create a tenant.
export const tenantSsoDomains = pgTable(
  "tenant_sso_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    emailDomain: text("email_domain").notNull(), // e.g. "smithlawllp.ca", lowercase
    // Optional tightening: Entra ID's `tid` claim for this firm's
    // directory. When set, sign-in must match BOTH the domain and this
    // tenant ID — guards against someone registering a look-alike domain
    // under a different Entra directory.
    entraTenantId: text("entra_tenant_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tenant_sso_domains_email_domain_unique").on(t.emailDomain)],
);
