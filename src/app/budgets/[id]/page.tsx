import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getBudgetDetail } from "@/lib/services/budgets";
import {
  actionEnactBudget,
  actionCloseBudget,
  actionPostBudgetCharge,
  actionUpdateBudget,
} from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function BudgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [budget, users, allForecasts] = await Promise.all([
    getBudgetDetail(id),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, title: true },
    }),
    prisma.forecast.findMany({
      where: { status: { in: ["DRAFT", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, number: true, name: true },
    }),
  ]);
  if (!budget) notFound();
  const linkedForecastIds = new Set(
    budget.forecastLinks.map((l) => l.forecastId)
  );

  const pct =
    budget.totalAmount > 0
      ? Math.round((budget.actualTotal / budget.totalAmount) * 1000) / 10
      : 0;
  const hoursPct =
    budget.laborHoursBudget > 0
      ? Math.round(
          (budget.actualLaborHours / budget.laborHoursBudget) * 1000
        ) / 10
      : 0;
  const editable = !["CLOSED", "CANCELLED"].includes(budget.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={budget.chargeCode || budget.name}
        description={`${budget.name} · ${budget.number}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/budgets">
              <Button size="sm" variant="outline">
                All budgets
              </Button>
            </Link>
            {budget.projectId && (
              <Link href={`/pmo/projects/${budget.projectId}?tab=budgets`}>
                <Button size="sm" variant="outline">
                  Project budgets
                </Button>
              </Link>
            )}
            {budget.status === "DRAFT" && (
              <ActionLoadingForm theme="planning" action={actionEnactBudget}>
                <input type="hidden" name="budgetId" value={budget.id} />
                <input
                  type="hidden"
                  name="chargeCode"
                  value={budget.chargeCode || ""}
                />
                <Button type="submit" size="sm">
                  Enact → live charge code
                </Button>
              </ActionLoadingForm>
            )}
            {budget.status === "ENACTED" && (
              <ActionLoadingForm theme="default" action={actionCloseBudget}>
                <input type="hidden" name="budgetId" value={budget.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Close budget
                </Button>
              </ActionLoadingForm>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={budget.status} />
        <StatusBadge status={budget.costClass} />
        <StatusBadge status={budget.sourceType} />
        {budget.chargeCode && (
          <span className="rounded border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 font-mono text-xs text-teal-300">
            {budget.chargeCode}
          </span>
        )}
        {budget.owner && (
          <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
            Owner: {budget.owner.name}
          </span>
        )}
      </div>

      {budget.costClass === "INDIRECT" && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Indirect — company pocketbook. Owner approves time + material PRs on
          this code.
        </p>
      )}
      {budget.costClass === "DIRECT" && (
        <p className="rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs text-sky-200">
          Direct job cost. Owner approves timesheet slices and PRs charged here.
          Product link is tracking only (not development NRE).
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase text-slate-500">Total $</p>
            <p className="text-xl font-semibold tabular-nums text-slate-100">
              {formatCurrency(budget.totalAmount)}
            </p>
            <p className="text-xs text-slate-500">{pct}% used</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase text-slate-500">Actual $</p>
            <p className="text-xl font-semibold tabular-nums text-teal-300">
              {formatCurrency(budget.actualTotal)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase text-slate-500">Labor hours</p>
            <p className="text-lg tabular-nums text-slate-200">
              {budget.actualLaborHours} / {budget.laborHoursBudget || "—"}
            </p>
            <p className="text-xs text-slate-500">{hoursPct}% hours</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase text-slate-500">Labor $</p>
            <p className="text-lg tabular-nums text-slate-200">
              {formatCurrency(budget.actualLabor)} /{" "}
              {formatCurrency(budget.laborBudget)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase text-slate-500">Material $</p>
            <p className="text-lg tabular-nums text-slate-200">
              {formatCurrency(budget.actualMaterial)} /{" "}
              {formatCurrency(budget.materialBudget)}
            </p>
          </CardContent>
        </Card>
      </div>

      {editable && (
        <Card className="border-teal-900/40">
          <CardHeader>
            <CardTitle className="text-base">Edit budget</CardTitle>
            <p className="text-xs text-slate-500">
              Change money, labor hours, charge code, and owner anytime while
              open. Save before enacting a draft.
            </p>
          </CardHeader>
          <CardContent>
            <ActionLoadingForm
              theme="planning"
              action={actionUpdateBudget}
              className="grid gap-3 sm:grid-cols-2"
            >
              <input type="hidden" name="budgetId" value={budget.id} />
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name
                </label>
                <Input name="name" defaultValue={budget.name} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Owner (time + PR approver)
                </label>
                <select
                  name="ownerId"
                  className={`${selectClass} mt-1`}
                  defaultValue={budget.ownerId || ""}
                >
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
                  Charge code (= name unless you override)
                </label>
                <Input
                  name="chargeCode"
                  defaultValue={budget.chargeCode || ""}
                  className="mt-1 font-mono"
                  placeholder={budget.name}
                />
                <p className="mt-0.5 text-[10px] text-slate-600">
                  Renaming the budget updates the charge code to match the new
                  name (unless you type a different code).
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Total $
                </label>
                <Input
                  name="totalAmount"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={budget.totalAmount}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Labor hours budget
                </label>
                <Input
                  name="laborHoursBudget"
                  type="number"
                  step="0.5"
                  min={0}
                  defaultValue={budget.laborHoursBudget}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Labor $
                </label>
                <Input
                  name="laborBudget"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={budget.laborBudget}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Material $
                </label>
                <Input
                  name="materialBudget"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={budget.materialBudget}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Other $
                </label>
                <Input
                  name="otherBudget"
                  type="number"
                  step="0.01"
                  min={0}
                  defaultValue={budget.otherBudget}
                  className="mt-1"
                />
              </div>
              {budget.sourceType !== "PROJECT" && (
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Linked forecasts (multi)
                  </label>
                  <select
                    name="forecastIds"
                    multiple
                    size={Math.min(8, Math.max(4, allForecasts.length))}
                    className={`${selectClass} mt-1 h-auto min-h-[6rem] py-1`}
                    defaultValue={[...linkedForecastIds]}
                  >
                    {allForecasts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.number} · {f.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-0.5 text-[10px] text-slate-600">
                    Ctrl/Cmd+click to span multiple forecasts with one budget /
                    charge code.
                  </p>
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Textarea
                  name="notes"
                  rows={2}
                  defaultValue={budget.notes || ""}
                  className="mt-1"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Save changes
                </Button>
              </div>
            </ActionLoadingForm>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Links</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-400">
            {budget.forecastLinks.length > 0 && (
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Forecasts ({budget.forecastLinks.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {budget.forecastLinks.map((l) => (
                    <li key={l.forecastId}>
                      <Link
                        href={`/planning/forecasts/${l.forecast.id}`}
                        className="font-mono text-sky-400 hover:underline"
                      >
                        {l.forecast.number}
                      </Link>
                      <span className="text-slate-500">
                        {" "}
                        · {l.forecast.name}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {budget.project && (
              <p>
                Project{" "}
                <Link
                  href={`/pmo/projects/${budget.project.id}?tab=budgets`}
                  className="font-mono text-sky-400 hover:underline"
                >
                  {budget.project.number}
                </Link>
                {budget.wbsElement
                  ? ` · WBS ${budget.wbsElement.code} ${budget.wbsElement.name}`
                  : ""}
              </p>
            )}
            {budget.product && (
              <p>
                Product track{" "}
                <Link
                  href={`/products/${budget.product.id}`}
                  className="font-mono text-violet-400 hover:underline"
                >
                  {budget.product.code}
                </Link>
              </p>
            )}
            {budget.chargeCode && budget.status === "ENACTED" && (
              <p className="text-xs text-slate-500">
                Techs pick{" "}
                <span className="font-mono text-teal-400">{budget.chargeCode}</span>{" "}
                on My Timesheet —{" "}
                <strong className="text-slate-400">{budget.owner?.name}</strong>{" "}
                approves that slice. PRs on this code also go to the owner.
              </p>
            )}
          </CardContent>
        </Card>

        {budget.status === "ENACTED" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manual charge</CardTitle>
            </CardHeader>
            <CardContent>
              <ActionLoadingForm
                theme="planning"
                action={actionPostBudgetCharge}
                className="space-y-2"
              >
                <input type="hidden" name="budgetId" value={budget.id} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Category
                    </label>
                    <select
                      name="category"
                      className={`${selectClass} mt-1`}
                      defaultValue="MATERIAL"
                    >
                      <option value="LABOR">LABOR</option>
                      <option value="MATERIAL">MATERIAL</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Amount $
                    </label>
                    <Input
                      name="amount"
                      type="number"
                      step="0.01"
                      min={0.01}
                      required
                      className="mt-1"
                    />
                  </div>
                </div>
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="Description"
                  className="text-sm"
                />
                <Button type="submit" size="sm" variant="secondary">
                  Post charge
                </Button>
              </ActionLoadingForm>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Charge ledger</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="pb-2">Date</th>
                <th className="pb-2">Category</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Who</th>
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Hours</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {budget.charges.map((c) => (
                <tr key={c.id} className="border-t border-slate-800/80">
                  <td className="py-2 text-xs text-slate-400">
                    {formatDate(c.chargeDate)}
                  </td>
                  <td className="py-2">
                    <StatusBadge status={c.category} />
                  </td>
                  <td className="py-2 font-mono text-xs text-slate-500">
                    {c.source}
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {c.user?.name || "—"}
                  </td>
                  <td className="py-2 text-xs text-slate-400">
                    {c.description || "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-500">
                    {c.hours != null ? c.hours : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-200">
                    {formatCurrency(c.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!budget.charges.length && (
            <p className="py-8 text-center text-slate-500">
              No charges yet. Enact, then charge labor via timesheet or material
              via PR / manual post.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
