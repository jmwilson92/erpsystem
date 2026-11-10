/** Narrow defense for legacy Data API grants: only new entitlement fields are
 * protected. Existing RLS/read/profile-update behavior is not broadened here.
 * Server Prisma uses its existing server role; no SECURITY DEFINER is introduced.
 */
export function foundingFieldGuard(table) {
  if (!["CompanySettings", "Tenant"].includes(table)) throw new Error("Unsupported entitlement table");
  return `CREATE OR REPLACE FUNCTION founding_fields_server_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."foundingMember" OR OLD."foundingQualifiedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Founding entitlements are server-controlled' USING ERRCODE = '42501';
      END IF;
      RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW."foundingMember" OR NEW."foundingQualifiedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Founding entitlements are server-controlled' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW."foundingMember" IS DISTINCT FROM OLD."foundingMember"
       OR NEW."foundingQualifiedAt" IS DISTINCT FROM OLD."foundingQualifiedAt" THEN
      RAISE EXCEPTION 'Founding entitlements are server-controlled' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS founding_fields_guard ON "${table}";
CREATE TRIGGER founding_fields_guard BEFORE INSERT OR UPDATE OR DELETE ON "${table}"
FOR EACH ROW EXECUTE FUNCTION founding_fields_server_only();`;
}
