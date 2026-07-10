import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateForecast } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewForecastPage() {
  const parts = await prisma.part.findMany({
    where: { isActive: true },
    orderBy: { partNumber: "asc" },
    select: {
      id: true,
      partNumber: true,
      description: true,
      sourcingMethod: true,
    },
  });

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="New forecast"
        description="Build-to-forecast demand plan — later nets to an MRS and MWOs"
        actions={
          <Link href="/planning">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Forecast header &amp; lines</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateForecast} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input
                  name="name"
                  required
                  className="mt-1"
                  placeholder="Q3 radiator forecast"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Period start
                </label>
                <Input name="periodStart" type="date" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Period end
                </label>
                <Input name="periodEnd" type="date" className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Textarea name="notes" rows={2} className="mt-1" />
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium uppercase text-slate-500">
                Demand lines (up to 12)
              </p>
              <div className="space-y-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-12"
                  >
                    <div className="sm:col-span-6">
                      {i === 0 && (
                        <label className="text-[10px] uppercase text-slate-600">
                          Part
                        </label>
                      )}
                      <select
                        name={`partId_${i}`}
                        className={`${selectClass} ${i === 0 ? "mt-1" : ""}`}
                        defaultValue=""
                      >
                        <option value="">—</option>
                        {parts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.partNumber} — {p.description.slice(0, 40)} (
                            {p.sourcingMethod})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      {i === 0 && (
                        <label className="text-[10px] uppercase text-slate-600">
                          Qty
                        </label>
                      )}
                      <Input
                        name={`qty_${i}`}
                        type="number"
                        min={0}
                        step="1"
                        className={i === 0 ? "mt-1" : ""}
                        placeholder="0"
                      />
                    </div>
                    <div className="sm:col-span-4">
                      {i === 0 && (
                        <label className="text-[10px] uppercase text-slate-600">
                          Need by
                        </label>
                      )}
                      <Input
                        name={`due_${i}`}
                        type="date"
                        className={i === 0 ? "mt-1" : ""}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button type="submit">Create forecast</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
