import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  actionGenerateMrsFromForecast,
  actionUpdateForecast,
  actionUpsertForecastLine,
  actionRemoveForecastLine,
  actionCreateBudget,
} from "@/app/actions";
import Link from "next/link";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function ForecastDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const forecast = await prisma.forecast.findUnique({
    where: { id },
    include: {
      lines: {
        include: { part: true },
        orderBy: { id: "asc" },
      },
      materialRequisitions: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { lines: true, workOrders: true } } },
      },
      budgetLinks: {
        include: {
          budget: {
            select: {
              id: true,
              number: true,
              name: true,
              status: true,
              chargeCode: true,
              totalAmount: true,
              actualTotal: true,
              costClass: true,
              laborHoursBudget: true,
              actualLaborHours: true,
              _count: { select: { forecastLinks: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!forecast) notFound();
  const budgets = forecast.budgetLinks.map((l) => l.budget);

  const parts = await prisma.part.findMany({
    where: { isActive: true },
    orderBy: { partNumber: "asc" },
    select: {
      id: true,
      partNumber: true,
      description: true,
      sourcingMethod: true,
    },
    take: 500,
  });

  const editable = !["CLOSED", "CANCELLED"].includes(forecast.status);
  const openMrs = forecast.materialRequisitions.filter((m) =>
    ["DRAFT", "RELEASED", "IN_PROGRESS"].includes(m.status)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={forecast.number}
        description={forecast.name}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/planning?tab=forecast">
              <Button size="sm" variant="outline">
                Planning
              </Button>
            </Link>
            {editable && (
              <>
                <ActionLoadingForm
                  theme="planning"
                  action={actionGenerateMrsFromForecast}
                >
                  <input type="hidden" name="forecastId" value={forecast.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Generate MRS
                  </Button>
                </ActionLoadingForm>
                <Link href={`/budgets?forecastId=${forecast.id}`}>
                  <Button size="sm">New budget draft</Button>
                </Link>
              </>
            )}
          </div>
        }
      />

      {openMrs.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          {openMrs.length} open MRS already exist for this forecast (
          {openMrs.map((m) => m.number).join(", ")}). Generating another creates
          a new sheet with a fresh supply snapshot.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={forecast.status} />
        <span className="text-xs text-slate-500">
          Period {formatDate(forecast.periodStart)} —{" "}
          {formatDate(forecast.periodEnd)}
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Header &amp; status</CardTitle>
        </CardHeader>
        <CardContent>
          <ActionLoadingForm
            theme="planning"
            action={actionUpdateForecast}
            className="grid max-w-2xl gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="forecastId" value={forecast.id} />
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">Name</label>
              <Input
                name="name"
                defaultValue={forecast.name}
                className="mt-1"
                disabled={!editable}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Period start
              </label>
              <Input
                name="periodStart"
                type="date"
                className="mt-1"
                defaultValue={
                  forecast.periodStart
                    ? new Date(forecast.periodStart).toISOString().slice(0, 10)
                    : ""
                }
                disabled={!editable}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Period end
              </label>
              <Input
                name="periodEnd"
                type="date"
                className="mt-1"
                defaultValue={
                  forecast.periodEnd
                    ? new Date(forecast.periodEnd).toISOString().slice(0, 10)
                    : ""
                }
                disabled={!editable}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Status
              </label>
              <select
                name="status"
                className={`${selectClass} mt-1`}
                defaultValue={forecast.status}
              >
                <option value="DRAFT">DRAFT</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="CLOSED">CLOSED</option>
                <option value="CANCELLED">CANCELLED</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Notes
              </label>
              <Textarea
                name="notes"
                rows={2}
                className="mt-1"
                defaultValue={forecast.notes || ""}
                disabled={!editable}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" variant="secondary">
                Save forecast
              </Button>
            </div>
          </ActionLoadingForm>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forecast lines</CardTitle>
          <p className="text-xs text-slate-500">
            Edit qty / need-by before generating MRS. Supply netting uses stock +
            open WOs + open POs.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">Part</th>
                <th className="pb-2">Sourcing</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2">Need by</th>
                {editable && <th className="pb-2">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {forecast.lines.map((l) => (
                <tr key={l.id} className="border-b border-slate-800/60">
                  <td className="py-2">
                    <Link
                      href={`/items/${l.partId}`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {l.part?.partNumber || "(deleted part)"}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {l.part?.description || ""}
                    </p>
                  </td>
                  <td className="py-2">
                    <StatusBadge status={l.part?.sourcingMethod || "N/A"} />
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {l.quantity}
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {formatDate(l.dueDate)}
                  </td>
                  {editable && (
                    <td className="py-2">
                      <div className="flex flex-wrap items-center gap-1">
                        <ActionLoadingForm
                          theme="planning"
                          action={actionUpsertForecastLine}
                          className="flex flex-wrap items-center gap-1"
                        >
                          <input
                            type="hidden"
                            name="forecastId"
                            value={forecast.id}
                          />
                          <input type="hidden" name="lineId" value={l.id} />
                          <input type="hidden" name="partId" value={l.partId} />
                          <Input
                            name="quantity"
                            type="number"
                            min={0.001}
                            step="any"
                            defaultValue={l.quantity}
                            className="h-8 w-20 text-xs"
                          />
                          <Input
                            name="dueDate"
                            type="date"
                            defaultValue={
                              l.dueDate
                                ? new Date(l.dueDate).toISOString().slice(0, 10)
                                : ""
                            }
                            className="h-8 w-32 text-xs"
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            className="h-8 px-2 text-xs"
                          >
                            Save
                          </Button>
                        </ActionLoadingForm>
                        <ActionLoadingForm
                          theme="default"
                          action={actionRemoveForecastLine}
                        >
                          <input
                            type="hidden"
                            name="forecastId"
                            value={forecast.id}
                          />
                          <input type="hidden" name="lineId" value={l.id} />
                          <button
                            type="submit"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/40 hover:text-rose-400"
                            aria-label="Remove line"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </ActionLoadingForm>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {editable && (
            <div className="rounded-lg border border-slate-800 p-3">
              <p className="mb-2 text-xs font-medium text-slate-400">
                Add line
              </p>
              <ActionLoadingForm
                theme="creating"
                action={actionUpsertForecastLine}
                className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_auto]"
              >
                <input type="hidden" name="forecastId" value={forecast.id} />
                <select name="partId" required className={selectClass}>
                  <option value="">— Part —</option>
                  {parts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.partNumber} · {p.description?.slice(0, 40)}
                    </option>
                  ))}
                </select>
                <Input
                  name="quantity"
                  type="number"
                  min={0.001}
                  step="any"
                  defaultValue={1}
                  required
                  className="h-9"
                />
                <Input name="dueDate" type="date" className="h-9" />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </ActionLoadingForm>
            </div>
          )}
        </CardContent>
      </Card>

      {budgets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Budgets (DIRECT — job cost)
            </CardTitle>
            <p className="text-xs text-slate-500">
              Techs scan the charge code; material PRs can charge this budget.
              A budget may span several forecasts (shown when multi).
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {budgets.map((b) => (
              <Link
                key={b.id}
                href={`/budgets/${b.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 hover:border-teal-500/30"
              >
                <div>
                  <p className="font-mono text-teal-400">
                    {b.chargeCode || b.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {b.name}
                    {b.number ? ` · ${b.number}` : ""}
                    {b._count.forecastLinks > 1
                      ? ` · spans ${b._count.forecastLinks} forecasts`
                      : ""}
                  </p>
                </div>
                <div className="text-right">
                  <StatusBadge status={b.status} />
                  <p className="text-xs tabular-nums text-slate-400">
                    {formatCurrency(b.actualTotal)} /{" "}
                    {formatCurrency(b.totalAmount)}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Material requisitions from this forecast</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {forecast.materialRequisitions.length === 0 && (
            <p className="text-sm text-slate-500">
              None yet. Generate an MRS to net stock / open supply and plan BUILD
              / BUY.
            </p>
          )}
          {forecast.materialRequisitions.map((m) => (
            <Link
              key={m.id}
              href={`/planning/mrs/${m.id}`}
              className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 hover:border-violet-500/30"
            >
              <div>
                <p className="font-mono text-violet-400">{m.number}</p>
                <p className="text-xs text-slate-500">
                  {m._count.lines} lines · {m._count.workOrders} MWOs ·{" "}
                  {formatDate(m.createdAt)}
                </p>
              </div>
              <StatusBadge status={m.status} />
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
