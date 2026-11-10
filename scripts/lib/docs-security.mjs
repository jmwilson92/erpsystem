/** Docs are server-only (Prisma/session auth), never accessible through PostgREST.
 * Owners/BYPASSRLS keep normal server access. No client-role policies are created.
 * Apply as a single query, after all six Doc tables have been provisioned.
 */
export const DOC_TABLES = ["DocSpace", "DocPage", "DocRevision", "DocSignature", "DocComment", "DocLink"];
export const DOCS_HARDENING_SQL = DOC_TABLES.map(t => `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`).join("\n") + `
CREATE OR REPLACE FUNCTION docs_revision_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Doc revisions and signatures are append-only: % is not permitted', TG_OP;
END;
$$;
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['DocSpace','DocPage','DocRevision','DocSignature','DocComment','DocLink'] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['DocRevision','DocSignature'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'docs_append_only' AND tgrelid = format('%I',t)::regclass) THEN
      EXECUTE format('CREATE TRIGGER docs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION docs_revision_append_only()', t);
    END IF;
  END LOOP;
END;
$$;`;
