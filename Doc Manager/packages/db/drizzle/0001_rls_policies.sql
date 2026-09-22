-- Row-Level Security: the database-layer backstop for tenant isolation and
-- ethical walls. See docs/PLAN.md "Permissions Model" — the portal bypasses
-- NTFS ACLs, so this is the one place a missing WHERE clause in application
-- code CANNOT leak another tenant's rows.
--
-- Two roles:
--   law_portal_owner   — migrations, seeding, admin tooling. BYPASSRLS.
--                        The role this file itself runs as.
--   law_portal_app     — the runtime app connects as this role. RLS is
--                        enforced for it because it is NOT the table owner
--                        and does NOT have BYPASSRLS.
--
-- The app must never connect as law_portal_owner. Enforce that at deploy
-- time via DATABASE_URL, not just by convention.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'law_portal_app') THEN
    CREATE ROLE law_portal_app LOGIN PASSWORD 'change_me_in_deploy_secrets';
  END IF;
END
$$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO law_portal_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO law_portal_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO law_portal_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO law_portal_app;--> statement-breakpoint

-- Enable + FORCE RLS on every tenant-scoped table. FORCE matters here:
-- without it, the table owner (law_portal_owner) would silently bypass its
-- own policies, which is fine for migrations run as owner but would be a
-- silent trap if the app role were ever changed to own these tables later.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE clients FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matters FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matter_parties ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matter_parties FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matter_access ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE matter_access FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE time_entries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE conflict_searches ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE conflict_searches FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE connectors ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE connectors FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Standard tenant-isolation policy, identical shape on every scoped table:
-- current_setting('app.tenant_id') is a session-local GUC set by
-- withTenant() in packages/db/src/client.ts for the lifetime of one
-- transaction. `true` on current_setting's second arg makes a missing
-- setting return NULL rather than raise — and NULL = tenant_id is never
-- true, so a request that forgot to set tenant context sees ZERO rows,
-- not all of them. Fail closed.
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON clients
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON matters
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON matter_parties
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON matter_access
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON document_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON time_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON conflict_searches
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON connectors
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_events
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint

-- documents gets a second, additive policy layer for ethical walls: tenant
-- isolation is still mandatory (a matter_access grant from another tenant
-- must never apply here), and on TOP of that a row is visible only if
-- there is no explicit `deny` for the current user on its matter.
-- current_setting('app.user_id') is set alongside app.tenant_id by the
-- same withTenant() call whenever a user-scoped request is being served.
CREATE POLICY tenant_isolation ON documents
  USING (
    tenant_id = current_setting('app.tenant_id', true)::uuid
    AND NOT EXISTS (
      SELECT 1 FROM matter_access ma
      WHERE ma.matter_id = documents.matter_id
        AND ma.user_id = current_setting('app.user_id', true)::uuid
        AND ma.effect = 'deny'
    )
  );--> statement-breakpoint

-- audit_events additionally has no UPDATE/DELETE policy at all — combined
-- with the trigger in 0003_audit_immutability.sql, this makes the table
-- append-only even for law_portal_app, not just "no UI path to edit it".
