CREATE TYPE "public"."client_type" AS ENUM('individual', 'corporation');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('active', 'checked_out', 'archived', 'pending_destruction');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'lawyer', 'law_clerk', 'staff', 'billing');--> statement-breakpoint
CREATE TYPE "public"."access_effect" AS ENUM('grant', 'deny');--> statement-breakpoint
CREATE TYPE "public"."matter_status" AS ENUM('open', 'pending', 'closed');--> statement-breakpoint
CREATE TYPE "public"."party_role" AS ENUM('client', 'opposing_party', 'opposing_counsel', 'court', 'witness', 'expert', 'other');--> statement-breakpoint
CREATE TYPE "public"."time_entry_status" AS ENUM('draft', 'submitted', 'approved', 'billed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"outcome" text DEFAULT 'success' NOT NULL,
	"ip" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "client_type" NOT NULL,
	"display_name" text NOT NULL,
	"conflict_names" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "conflict_searches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"terms" text[] NOT NULL,
	"results_snapshot" jsonb NOT NULL,
	"run_by_id" uuid NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"site_name" text NOT NULL,
	"version" text,
	"document_root" text NOT NULL,
	"enrollment_secret_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"author_id" uuid,
	"source" text DEFAULT 'portal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_document_version_unique" UNIQUE("document_id","version_no")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"rel_path" text NOT NULL,
	"content_hash" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"doc_type" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "document_status" DEFAULT 'active' NOT NULL,
	"checked_out_by_id" uuid,
	"checked_out_at" timestamp with time zone,
	"extracted_text_enc" text,
	"search_vector" "tsvector",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_matter_relpath_unique" UNIQUE("matter_id","rel_path")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"timekeeper_rate_cents" integer,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"sso_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matter_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"effect" "access_effect" NOT NULL,
	"reason" text,
	"set_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matter_access_matter_user_unique" UNIQUE("matter_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matter_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"party_name" text NOT NULL,
	"role" "party_role" NOT NULL,
	"conflict_checked" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"matter_number" text NOT NULL,
	"practice_area" text NOT NULL,
	"responsible_lawyer_id" uuid NOT NULL,
	"status" "matter_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"limitation_date" timestamp with time zone,
	"smb_path" text NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matters_tenant_number_unique" UNIQUE("tenant_id","matter_number")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"duration_minutes" integer NOT NULL,
	"narrative" text NOT NULL,
	"utbms_task_code" text,
	"utbms_activity_code" text,
	"billable" boolean DEFAULT true NOT NULL,
	"rate_cents" integer,
	"status" time_entry_status DEFAULT 'draft' NOT NULL,
	"suggested_from_audit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "retention_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province" text NOT NULL,
	"record_category" text NOT NULL,
	"retention_years" integer NOT NULL,
	"authority_citation" text,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "retention_schedules_province_category_effective_unique" UNIQUE("province","record_category","effective_from")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tax_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province" text NOT NULL,
	"tax_type" text NOT NULL,
	"rate_permille" integer NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	CONSTRAINT "tax_rates_province_type_effective_unique" UNIQUE("province","tax_type","effective_from")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflict_searches" ADD CONSTRAINT "conflict_searches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conflict_searches" ADD CONSTRAINT "conflict_searches_run_by_id_users_id_fk" FOREIGN KEY ("run_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connectors" ADD CONSTRAINT "connectors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_checked_out_by_id_users_id_fk" FOREIGN KEY ("checked_out_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_access" ADD CONSTRAINT "matter_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_access" ADD CONSTRAINT "matter_access_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_access" ADD CONSTRAINT "matter_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_access" ADD CONSTRAINT "matter_access_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matter_parties" ADD CONSTRAINT "matter_parties_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matters" ADD CONSTRAINT "matters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matters" ADD CONSTRAINT "matters_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matters" ADD CONSTRAINT "matters_responsible_lawyer_id_users_id_fk" FOREIGN KEY ("responsible_lawyer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_idx" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_target_idx" ON "audit_events" USING btree ("tenant_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_tenant_created_idx" ON "audit_events" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_tenant_idx" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_conflict_names_idx" ON "clients" USING gin ("conflict_names");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conflict_searches_tenant_idx" ON "conflict_searches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connectors_tenant_idx" ON "connectors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_versions_tenant_idx" ON "document_versions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_matter_idx" ON "documents" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_search_vector_idx" ON "documents" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_metadata_idx" ON "documents" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_email_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matter_access_tenant_idx" ON "matter_access" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matter_parties_tenant_idx" ON "matter_parties" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matter_parties_matter_idx" ON "matter_parties" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matter_parties_name_idx" ON "matter_parties" USING btree ("party_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matters_tenant_idx" ON "matters" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matters_tenant_status_idx" ON "matters" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matters_tenant_limitation_idx" ON "matters" USING btree ("tenant_id","limitation_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_tenant_idx" ON "time_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_matter_idx" ON "time_entries" USING btree ("matter_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_date_idx" ON "time_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_status_idx" ON "time_entries" USING btree ("tenant_id","status");