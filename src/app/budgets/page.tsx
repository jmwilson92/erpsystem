import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/utils";
import { listBudgets } from "@/lib/services/budgets";
import { actionCreateBudget } from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { Plus, Wallet, Target, Building2 } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function BudgetsPage() {
  const [budgets, forecasts, products, users] = await Promise.all([
    listBudgets(),
    prisma.forecast.findMany({
      where: { status: { in: ["DRAFT", "ACTIVE"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, number: true, name: true },
    }),
    prisma.product.findMany({
      where: { status: "ACTIVE" },
      orderBy: { code: "asc" },
      take: 40,
      select: { id: true, code: true, name: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, title: true },
    }),
  ]);

  const direct = budgets.filter((b) => b.costClass === "DIRECT");
  const indirect = budgets.filter((b) => b.costClass === "INDIRECT");
  const enacted = budgets.filter((b) => b.status === "ENACTED");
  const totalBudget = enacted.reduce((s, b) => s + b.totalAmount, 0);
  const totalActual = enacted.reduce((s, b) => s + b.actualTotal, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description="Owner approves time + material against the charge code. Forecast = DIRECT job cost; standalone = INDIRECT (company). Project/WBS budgets live on each PMO project."
        actions={
          <div className="flex gap-2">
            <Link href="/planning?tab=forecast">
              <Button size="sm" variant="outline">
                Forecasts
              </Button>
            </Link>
            <Link href="/pmo/projects">
              <Button size="sm" variant="outline">
                PMO projects
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Enacted budgets"
          value={enacted.length}
          icon={Wallet}
          accent="teal"
        />
        <StatCard
          title="Enacted total $"
          value={formatCurrency(totalBudget)}
          icon={Target}
          accent="sky"
        />
        <StatCard
          title="Charged actual $"
          value={formatCurrency(totalActual)}
          icon={Building2}
          accent={totalActual > totalBudget ? "red" : "amber"}
        />
        <StatCard
          title="Direct / Indirect"
          value={`${direct.length} / ${indirect.length}`}
          icon={Wallet}
          accent="violet"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">
              Create standalone / forecast budget
            </CardTitle>
            <p className="text-xs text-slate-500">
              Project charge codes are created on the project&apos;s{" "}
              <strong className="text-slate-400">Budgets</strong> tab (per WBS).
              Leave draft to edit money, hours, and charge code before enact.
            </p>
          </CardHeader>
          <CardContent>
            <ActionLoadingForm
              theme="creating"
              action={actionCreateBudget}
              className="space-y-3"
            >
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Name *
                </label>
                <Input
                  name="name"
                  required
                  className="mt-1"
                  placeholder="Facility HVAC upgrade"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Type
                </label>
                <select
                  name="sourceType"
                  className={`${selectClass} mt-1`}
                  defaultValue="STANDALONE"
                >
                  <option value="STANDALONE">Standalone (INDIRECT)</option>
                  <option value="FORECAST">From forecast (DIRECT)</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Responsible owner * (approves time + PRs)
                </label>
                <select name="ownerId" required className={`${selectClass} mt-1`}>
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
                  Charge code (defaults to budget name)
                </label>
                <Input
                  name="chargeCode"
                  className="mt-1 font-mono"
                  placeholder="Leave blank = use name"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Forecasts (multi — one budget can span many)
                </label>
                <select
                  name="forecastIds"
                  multiple
                  size={Math.min(6, Math.max(3, forecasts.length))}
                  className={`${selectClass} mt-1 h-auto min-h-[5.5rem] py-1`}
                >
                  {forecasts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.number} · {f.name}
                    </option>
                  ))}
                </select>
                <p className="mt-0.5 text-[10px] text-slate-600">
                  Hold Ctrl/Cmd to select multiple. Selecting any makes this
                  DIRECT.
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Product track (optional, not NRE)
                </label>
                <select name="productId" className={`${selectClass} mt-1`}>
                  <option value="">— None —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Total $
                  </label>
                  <Input
                    name="totalAmount"
                    type="number"
                    step="0.01"
                    min={0}
                    className="mt-1"
                    placeholder="100000"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Labor hours
                  </label>
                  <Input
                    name="laborHoursBudget"
                    type="number"
                    step="0.5"
                    min={0}
                    className="mt-1"
                    placeholder="400"
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
                    className="mt-1"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Other $
                  </label>
                  <Input
                    name="otherBudget"
                    type="number"
                    step="0.01"
                    min={0}
                    className="mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Notes
                </label>
                <Textarea name="notes" rows={2} className="mt-1" />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  name="enact"
                  className="rounded border-slate-600"
                />
                Enact immediately (default: draft so you can edit first)
              </label>
              <Button type="submit" size="sm">
                <Plus className="mr-1 h-4 w-4" />
                Create budget
              </Button>
            </ActionLoadingForm>
          </CardContent>
        </Card>

        <div className="space-y-3 lg:col-span-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            All budgets
          </h2>
          {budgets.map((b) => {
            const pct =
              b.totalAmount > 0
                ? Math.round((b.actualTotal / b.totalAmount) * 1000) / 10
                : 0;
            return (
              <Link key={b.id} href={`/budgets/${b.id}`}>
                <Card className="mb-2 transition-colors hover:border-teal-500/30">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <p className="font-mono text-teal-400">
                        {b.chargeCode || b.name}
                      </p>
                      <p className="text-sm text-slate-200">{b.name}</p>
                      <p className="text-xs text-slate-500">
                        {b.number} · {b.costClass}
                        {b.owner ? ` · owner ${b.owner.name}` : ""}
                        {b.wbsElement
                          ? ` · WBS ${b.wbsElement.code}`
                          : b.forecastLinks?.length
                            ? ` · ${b.forecastLinks
                                .map((l) => l.forecast.number)
                                .join(", ")}`
                            : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <StatusBadge status={b.status} />
                      <p className="mt-1 text-sm tabular-nums text-slate-300">
                        {formatCurrency(b.actualTotal)} /{" "}
                        {formatCurrency(b.totalAmount)}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {b.actualLaborHours || 0}h / {b.laborHoursBudget || 0}h
                        labor
                      </p>
                      <p
                        className={`text-xs ${
                          pct > 100
                            ? "text-rose-400"
                            : pct > 85
                              ? "text-amber-400"
                              : "text-slate-500"
                        }`}
                      >
                        {pct}% $ · {formatDate(b.createdAt)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
          {!budgets.length && (
            <p className="text-sm text-slate-500">No budgets yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
