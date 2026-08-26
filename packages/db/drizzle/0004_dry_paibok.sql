CREATE TABLE IF NOT EXISTS "tenant_sso_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email_domain" text NOT NULL,
	"entra_tenant_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_sso_domains_email_domain_unique" UNIQUE("email_domain")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_sso_domains" ADD CONSTRAINT "tenant_sso_domains_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
