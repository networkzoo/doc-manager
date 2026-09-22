-- Belt-and-suspenders on top of 0001's missing UPDATE/DELETE policy:
-- explicitly revoke those privileges from the app role, and raise if
-- anything (even a superuser-run script) tries to mutate an existing
-- audit_events row. See docs/PLAN.md "Immutable audit trail" — the whole
-- point of this table is that it cannot be edited after the fact,
-- including by someone who compromises the app role.
REVOKE UPDATE, DELETE ON audit_events FROM law_portal_app;--> statement-breakpoint

CREATE FUNCTION audit_events_prevent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();--> statement-breakpoint

CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_prevent_mutation();
