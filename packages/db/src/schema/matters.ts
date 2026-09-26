import { pgTable, pgEnum, uuid, text, timestamp, jsonb, index, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { clients } from "./clients";
import { users } from "./users";

export const matterStatusEnum = pgEnum("matter_status", ["open", "pending", "closed"]);

export const partyRoleEnum = pgEnum("party_role", [
  "client",
  "opposing_party",
  "opposing_counsel",
  "court",
  "witness",
  "expert",
  "other",
]);

export const accessEffectEnum = pgEnum("access_effect", ["grant", "deny"]);

export const matters = pgTable(
  "matters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    // Nullable: bulk-imported matters (e.g. a legacy folder tree with
    // thousands of pre-existing files) often can't populate a real
    // client/lawyer at import time — see docs/PLAN.md "SMB Reconciliation"
    // and the bulk-import work it feeds. Not every tenant needs this
    // looseness, but the schema has to allow it for the ones that do;
    // firms that want it enforced can do so at the application layer.
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "restrict" }),
    // Configurable per tenant, e.g. CLIENT-YYYY-NNN — formatting lives in
    // application code, this column just holds the rendered, unique value.
    matterNumber: text("matter_number").notNull(),
    practiceArea: text("practice_area").notNull(),
    responsibleLawyerId: uuid("responsible_lawyer_id").references(() => users.id, { onDelete: "restrict" }),
    status: matterStatusEnum("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    // The single highest-value field in this schema — see docs/PLAN.md
    // "Limitation-period tracking". Nullable only because not every matter
    // has one; application layer should push hard for it to be set.
    limitationDate: timestamp("limitation_date", { withTimezone: true }),
    // Root path on the firm's SMB share, relative to the connector's
    // configured document root, e.g. "Smith, J\\2026-001 Estate".
    smbPath: text("smb_path").notNull(),
    customFields: jsonb("custom_fields").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matters_tenant_idx").on(t.tenantId),
    index("matters_tenant_status_idx").on(t.tenantId, t.status),
    index("matters_tenant_limitation_idx").on(t.tenantId, t.limitationDate),
    unique("matters_tenant_number_unique").on(t.tenantId, t.matterNumber),
  ],
);

export const matterParties = pgTable(
  "matter_parties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").notNull().references(() => matters.id, { onDelete: "cascade" }),
    partyName: text("party_name").notNull(),
    role: partyRoleEnum("role").notNull(),
    conflictChecked: timestamp("conflict_checked", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matter_parties_tenant_idx").on(t.tenantId),
    index("matter_parties_matter_idx").on(t.matterId),
    index("matter_parties_name_idx").on(t.partyName),
  ],
);

// Ethical walls. A `deny` row here overrides any role-based grant
// everywhere in the application — see docs/PLAN.md "Permissions Model".
// Absence of a row means "use default role-based access"; presence always
// wins, in either direction.
export const matterAccess = pgTable(
  "matter_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").notNull().references(() => matters.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    effect: accessEffectEnum("effect").notNull(),
    reason: text("reason"),
    setById: uuid("set_by_id").notNull().references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("matter_access_tenant_idx").on(t.tenantId),
    unique("matter_access_matter_user_unique").on(t.matterId, t.userId),
  ],
);
