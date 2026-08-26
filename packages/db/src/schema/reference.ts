import { pgTable, uuid, text, integer, date, timestamp, unique } from "drizzle-orm/pg-core";

// Global reference data, not tenant-scoped and not covered by RLS —
// every tenant reads the same rows. Seeded now, consumed starting in the
// v2 billing phase (see docs/PLAN.md "Tax table scaffolding" and
// "Retention & closing"). Rates and retention rules change by date and by
// province, so both are tables keyed on an effective date rather than
// constants in application code.

export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    province: text("province").notNull(), // ISO 3166-2:CA subdivision code, e.g. 'ON', 'QC', 'NS'
    taxType: text("tax_type").notNull(), // 'GST' | 'HST' | 'PST' | 'QST'
    ratePermille: integer("rate_permille").notNull(), // e.g. 130 = 13.0%
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"), // null = current
  },
  (t) => [unique("tax_rates_province_type_effective_unique").on(t.province, t.taxType, t.effectiveFrom)],
);

export const retentionSchedules = pgTable(
  "retention_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    province: text("province").notNull(),
    // e.g. 'financial_records', 'client_file_general', 'wills_estates'
    recordCategory: text("record_category").notNull(),
    retentionYears: integer("retention_years").notNull(),
    // e.g. 'LSO By-Law 9' — kept as free text since citation formats and
    // authorities differ by law society.
    authorityCitation: text("authority_citation"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
  },
  (t) => [unique("retention_schedules_province_category_effective_unique").on(
    t.province,
    t.recordCategory,
    t.effectiveFrom,
  )],
);
