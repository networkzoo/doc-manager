ALTER TABLE connector_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE connector_jobs FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY tenant_isolation ON connector_jobs
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
