CREATE TYPE "public"."connector_job_status" AS ENUM('pending', 'leased', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."connector_job_type" AS ENUM('stage_download', 'receive_upload', 'scan_reconcile');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"type" "connector_job_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "connector_job_status" DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connector_jobs" ADD CONSTRAINT "connector_jobs_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_jobs_tenant_idx" ON "connector_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_jobs_connector_status_idx" ON "connector_jobs" USING btree ("connector_id","status","created_at");