import { ModuleOffNotice } from "@/components/layout/module-off-notice";
import { moduleLabel } from "@/lib/modules";

export const dynamic = "force-dynamic";

export default async function ModuleOffPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const raw = sp.m;
  const key = (Array.isArray(raw) ? raw[0] : raw) || "";
  return <ModuleOffNotice moduleName={key ? moduleLabel(key) : "This module"} />;
}
