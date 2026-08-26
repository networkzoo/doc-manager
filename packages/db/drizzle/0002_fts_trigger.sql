-- Keeps documents.search_vector in sync with filename, tags, and decrypted
-- extracted text via a DB trigger rather than application code, so full-text
-- search stays correct regardless of which code path writes a row (portal
-- upload, SMB reconciliation backfill, a future admin script, ...).
-- See docs/PLAN.md "Search" and packages/db/src/schema/documents.ts.
--
-- IMPORTANT: extracted_text_enc is ciphertext (see documents.ts comment) —
-- this trigger only runs against whatever is in that column at write time.
-- The application layer is responsible for decrypting extracted text
-- BEFORE calling the write that populates this column plaintext-side, i.e.
-- extracted_text_enc must actually hold plaintext-at-index-time content
-- routed through the same encrypted-at-rest column, or (preferred once
-- Phase 4 lands) the app computes the tsvector itself and writes it
-- directly, bypassing this trigger's use of the encrypted column. This
-- trigger is a safety net for filename/tag search from day one; do not
-- assume it gives content search until Phase 4 wires up real extraction.
CREATE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.filename, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, ARRAY[]::text[]), ' ')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER documents_search_vector_trigger
  BEFORE INSERT OR UPDATE OF filename, tags ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_search_vector_update();
