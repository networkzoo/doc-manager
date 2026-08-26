import {
  pgTable,
  pgEnum,
  uuid,
  text,
  bigint,
  integer,
  timestamp,
  jsonb,
  customType,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matters } from "./matters";
import { users } from "./users";

export const documentStatusEnum = pgEnum("document_status", [
  "active",
  "checked_out",
  "archived",
  "pending_destruction",
]);

// tsvector isn't a first-class Drizzle column type; declare it via
// customType so the FTS index (see docs/PLAN.md "Search") can live on the
// documents table itself instead of a side table.
const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matterId: uuid("matter_id").notNull().references(() => matters.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    // Path relative to the matter's smbPath, e.g. "Correspondence\\2026-01-15 letter.pdf".
    relPath: text("rel_path").notNull(),
    contentHash: text("content_hash").notNull(), // sha256 of current version
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    docType: text("doc_type"), // MIME type or connector-classified type
    tags: text("tags").array().notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    status: documentStatusEnum("status").notNull().default("active"),
    checkedOutById: uuid("checked_out_by_id").references(() => users.id, { onDelete: "set null" }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    // Extracted text, AES-GCM-encrypted client-side (portal-side, under the
    // tenant's KMS key) before it ever touches disk. See docs/PLAN.md "The
    // honest security boundary" — decrypted only in memory to build the
    // tsvector and to serve snippets.
    extractedTextEnc: text("extracted_text_enc"),
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    index("documents_matter_idx").on(t.matterId),
    unique("documents_matter_relpath_unique").on(t.matterId, t.relPath),
    index("documents_search_vector_idx").using("gin", t.searchVector),
    index("documents_metadata_idx").using("gin", t.metadata),
    // Populated by a trigger (see drizzle/0001_fts_trigger.sql), not by the
    // app, so search stays consistent regardless of write path.
  ],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    contentHash: text("content_hash").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    // Null when the version originated from an out-of-band SMB edit rather
    // than a portal upload — see docs/PLAN.md "SMB Reconciliation".
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").notNull().default("portal"), // 'portal' | 'smb_reconcile'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_versions_tenant_idx").on(t.tenantId),
    unique("document_versions_document_version_unique").on(t.documentId, t.versionNo),
  ],
);
