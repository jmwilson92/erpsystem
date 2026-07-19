import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateForecast } from "@/app/actions";
import Link from "next/link";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

export default async function NewForecastPage() {
  const [parts, users] = await Promise.all([
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      select: {
        id: true,
        partNumber: true,
        description: true,
        sourcingMethod: true,
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, title: true },
    }),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="New forecast"
        description="Build-to-forecast demand plan — optionally draft a DIRECT production budget with your charge code"
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
          <ActionLoadingForm
            theme="planning"
            title="Creating forecast"
            action={actionCreateForecast}
            className="space-y-4"
          >
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

            <div className="rounded-lg border border-teal-900/40 bg-teal-500/5 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-300">
                Optional production budget (DIRECT)
              </p>
              <p className="text-[11px] text-slate-500">
                Set money + labor hours and pick your charge code before the
                forecast is created. Saved as a draft budget you can tweak, then
                enact.
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  name="createBudget"
                  className="rounded border-slate-600"
                  defaultChecked
                />
                Create linked budget with this forecast
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Budget name / charge code *
                  </label>
                  <Input
                    name="budgetName"
                    className="mt-1 font-mono"
                    placeholder="e.g. Q3-Radiator-Build (this IS the charge code)"
                  />
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    Techs scan this name as the charge code. System id BDGT-#####
                    stays internal only. Defaults to the forecast name if blank.
                  </p>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Budget owner (approves time + PRs)
                  </label>
                  <select name="budgetOwnerId" className={`${selectClass} mt-1`}>
                    <option value="">— Select —</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.title ? ` · ${u.title}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Charge code override (optional)
                  </label>
                  <Input
                    name="budgetChargeCode"
                    className="mt-1 font-mono"
                    placeholder="Only if different from name"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Total $
                  </label>
                  <Input
                    name="budgetTotal"
                    type="number"
                    step="0.01"
                    min={0}
                    className="mt-1"
                    defaultValue={100000}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Labor hours
                  </label>
                  <Input
                    name="budgetLaborHours"
                    type="number"
                    step="0.5"
                    min={0}
                    className="mt-1"
                    defaultValue={400}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Labor $
                  </label>
                  <Input
                    name="budgetLabor"
                    type="number"
                    step="0.01"
                    min={0}
                    className="mt-1"
                    defaultValue={50000}
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Material $
                  </label>
                  <Input
                    name="budgetMaterial"
                    type="number"
                    step="0.01"
                    min={0}
                    className="mt-1"
                    defaultValue={50000}
                  />
                </div>
              </div>
            </div>

            <Button type="submit">Create forecast</Button>
          </ActionLoadingForm>
        </CardContent>
      </Card>
    </div>
  );
}
