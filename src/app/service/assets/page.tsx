import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { isUnderWarranty, listInstalledAssets } from "@/lib/services/field-service";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import { actionCreateInstalledAsset } from "../actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default async function InstalledBasePage() {
  const health = await checkModuleHealth(() => listInstalledAssets());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Installed base" description="Units you have in the field." />
        <ModuleNotMigrated module="Field service" health={health} />
      </div>
    );
  }

  const [assets, customers, parts] = await Promise.all([
    listInstalledAssets(),
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.part.findMany({
      orderBy: { partNumber: "asc" },
      take: 500,
      select: { id: true, partNumber: true },
    }),
  ]);

  const customerName = new Map(customers.map((c) => [c.id, c.name]));
  const partNumber = new Map(parts.map((p) => [p.id, p.partNumber]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Installed base"
        description="Every unit you have in the field — where it lives, when it went in, and whether it's still under warranty."
      />

      <Link href="/service" className="inline-block text-xs text-teal-300 hover:underline">
        ← Field service
      </Link>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Units <span className="text-xs font-normal text-slate-500">({assets.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {assets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              Nothing registered yet — add a unit below when you install one.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Serial</th>
                    <th className="pb-2 pr-3 font-medium">Part</th>
                    <th className="pb-2 pr-3 font-medium">Customer</th>
                    <th className="pb-2 pr-3 font-medium">Site</th>
                    <th className="pb-2 pr-3 font-medium">Installed</th>
                    <th className="pb-2 font-medium">Warranty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {assets.map((a) => {
                    const covered = isUnderWarranty(a.warrantyEnds);
                    return (
                      <tr key={a.id} className="text-slate-300">
                        <td className="py-2 pr-3 font-mono text-xs">
                          {a.serialNumber || a.id.slice(0, 8)}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {(a.partId && partNumber.get(a.partId)) || "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {customerName.get(a.customerId) || "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {a.siteName || "—"}
                          {a.address && <div className="text-slate-500">{a.address}</div>}
                        </td>
                        <td className="py-2 pr-3 text-xs">{fmtDate(a.installedAt)}</td>
                        <td className="py-2 text-xs">
                          {a.warrantyEnds ? (
                            <span className={covered ? "text-emerald-300" : "text-slate-500"}>
                              {covered ? "covered to " : "expired "}
                              {fmtDate(a.warrantyEnds)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Register an installed unit</CardTitle>
        </CardHeader>
        <CardContent>
          {customers.length === 0 ? (
            <p className="text-sm text-slate-500">Add a customer first.</p>
          ) : (
            <form action={actionCreateInstalledAsset} className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-slate-500">
                Customer *
                <select name="customerId" required className={selectClass} defaultValue="">
                  <option value="" disabled>
                    Select…
                  </option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Serial number
                <Input name="serialNumber" placeholder="SN-004821" />
              </label>
              <label className="text-xs text-slate-500">
                Part
                <select name="partId" className={selectClass} defaultValue="">
                  <option value="">—</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Site name
                <Input name="siteName" placeholder="North plant" />
              </label>
              <label className="text-xs text-slate-500 sm:col-span-2">
                Address
                <Input name="address" placeholder="1200 Industrial Way, Bay 4" />
              </label>
              <label className="text-xs text-slate-500">
                Installed
                <Input name="installedAt" type="date" />
              </label>
              <label className="text-xs text-slate-500">
                Warranty ends
                <Input name="warrantyEnds" type="date" />
              </label>
              <label className="text-xs text-slate-500">
                Notes
                <Input name="notes" />
              </label>
              <div className="sm:col-span-3">
                <Button type="submit" size="sm">
                  Register unit
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
