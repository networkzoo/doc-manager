ALTER TYPE "public"."user_role" ADD VALUE 'conveyancer' BEFORE 'law_clerk';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "initials" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_initials_unique" UNIQUE("tenant_id","initials");