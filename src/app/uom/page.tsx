import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionSaveUomUnit, actionSaveUomConversion } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function UomMasterPage() {
  const units = await prisma.uomUnit.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { code: "asc" }],
    include: {
      conversionsFrom: { include: { toUom: true } },
    },
  });

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="UOM master"
        description="Units of measure and conversion factors (item cards reference these)"
        actions={
          <Link href="/items">
            <Button size="sm" variant="outline">
              Items
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Units</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Category</th>
                    <th className="px-3 py-2 text-left">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id} className="border-t border-slate-800/60">
                      <td className="px-3 py-2 font-mono text-teal-400">
                        {u.code}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{u.name}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {u.category}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {u.isActive ? "Yes" : "No"}
                      </td>
                    </tr>
                  ))}
                  {units.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-6 text-center text-slate-500"
                      >
                        No units yet — add below or reseed.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <form
              action={actionSaveUomUnit}
              className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
            >
              <p className="sm:col-span-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Add unit
              </p>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Code *
                </label>
                <Input name="code" required className="mt-1 font-mono" placeholder="EA" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input name="name" required className="mt-1" placeholder="Each" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Category
                </label>
                <select name="category" className={`${selectClass} mt-1`} defaultValue="COUNT">
                  <option value="COUNT">Count</option>
                  <option value="WEIGHT">Weight</option>
                  <option value="LENGTH">Length</option>
                  <option value="VOLUME">Volume</option>
                  <option value="TIME">Time</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Sort order
                </label>
                <Input name="sortOrder" type="number" defaultValue={0} className="mt-1" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="rounded border-slate-600"
                />
                Active
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm">
                  Save unit
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-500">
              Multiply quantity in <em>from</em> by factor to get quantity in{" "}
              <em>to</em> (e.g. 1 FT → 12 IN, factor 12). Inverse is stored
              automatically.
            </p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-800 p-2">
              {units.flatMap((u) =>
                u.conversionsFrom.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-slate-900/60"
                  >
                    <span className="font-mono text-slate-300">
                      1 {u.code} ={" "}
                      <span className="text-teal-400">{c.factor}</span>{" "}
                      {c.toUom.code}
                    </span>
                    {c.notes && (
                      <span className="text-[10px] text-slate-600">{c.notes}</span>
                    )}
                  </div>
                ))
              )}
              {units.every((u) => u.conversionsFrom.length === 0) && (
                <p className="py-4 text-center text-sm text-slate-500">
                  No conversions defined.
                </p>
              )}
            </div>

            <form
              action={actionSaveUomConversion}
              className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
            >
              <p className="sm:col-span-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Add conversion
              </p>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  From *
                </label>
                <select name="fromUomId" required className={`${selectClass} mt-1`}>
                  <option value="">—</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  To *
                </label>
                <select name="toUomId" required className={`${selectClass} mt-1`}>
                  <option value="">—</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Factor *
                </label>
                <Input
                  name="factor"
                  type="number"
                  step="any"
                  required
                  className="mt-1"
                  placeholder="12"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Input name="notes" className="mt-1" placeholder="1 FT = 12 IN" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Save conversion
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
