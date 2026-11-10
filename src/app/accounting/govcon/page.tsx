import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { ensureAccountingDefaults } from "@/lib/services/gl-posting";
import {
  computeIndirectRates,
  getProgramFinancials,
} from "@/lib/services/program-financials";
import {
  actionSaveIndirectRate,
  actionSetAccountAllowability,
  actionSetGovconControls,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const pct = (n: number | null) =>
  n == null ? "—" : `${(n * 100).toFixed(1)}%`;

export default async function GovconPage() {
  const user = await getCurrentUser();
  const canEdit = await userHasPermission(user?.id, "accounting.govcon.manage");
  const canControl = await userHasPermission(user?.id, "accounting.controller");
  await ensureAccountingDefaults();

  const [programs, rates, accounts, settings] = await Promise.all([
    prisma.program.findMany({
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true, isGovernment: true },
    }),
    computeIndirectRates(),
    prisma.account.findMany({
      where: { isActive: true, type: { in: ["EXPENSE", "COGS"] } },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        allowability: true,
        farCitation: true,
        poolCode: true,
        balance: true,
      },
    }),
    prisma.accountingSettings.findUnique({ where: { id: "default" } }),
  ]);

  const financials = (
    await Promise.all(programs.map((p) => getProgramFinancials(p.id)))
  ).filter((f): f is NonNullable<typeof f> => !!f);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts and rates"
        description="Costs roll up to the program in PMO. This page is a worksheet for your accountant. It does not certify DCAA, FAR, CAS, or DFARS compliance."
        actions={
          <div className="flex flex-wrap gap-2">
            <a href="/reports/export?key=ice">
              <Button size="sm" variant="outline">
                Download cost worksheet (CSV)
              </Button>
            </a>
            <Link href="/print/report?key=ice">
              <Button size="sm" variant="outline">
                Print / PDF
              </Button>
            </Link>
            <Link href="/accounting">
              <Button size="sm" variant="outline">
                Back to accounting
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="border-amber-900/50 bg-amber-950/20">
        <CardContent className="p-4 text-sm text-amber-100/90">
          Unallowable costs are left out of the billing worksheet and out of
          rate pools. Provisional rates load jobs during the year. Actual rates
          are last year&apos;s pool divided by its base. Your CPA or contracts
          specialist still has to review anything billed to the government.
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 text-xs">
        {[
          ["program-pl", "Profit by program"],
          ["job-profit", "Job profitability"],
          ["wip-books", "WIP on the books"],
          ["labor-dist", "Labor distribution"],
          ["indirect-rates", "Indirect rates"],
          ["unallowables", "Unallowable costs"],
          ["gl-detail", "Ledger detail"],
          ["ice", "Incurred cost worksheet"],
        ].map(([key, label]) => (
          <span key={key} className="inline-flex gap-2">
            <a className="text-teal-400 underline" href={`/reports/export?key=${key}`}>
              {label} CSV
            </a>
            <Link className="text-slate-400 underline" href={`/print/report?key=${key}`}>
              Print
            </Link>
          </span>
        ))}
      </div>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">Programs</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="py-1 pr-3">Program</th>
                <th className="py-1 pr-3">Type</th>
                <th className="py-1 pr-3">Funded</th>
                <th className="py-1 pr-3">Billed</th>
                <th className="py-1 pr-3">Allowable cost</th>
                <th className="py-1 pr-3">Left out</th>
                <th className="py-1 pr-3">Still in WIP</th>
                <th className="py-1">Burn</th>
              </tr>
            </thead>
            <tbody>
              {financials.map((f) => (
                <tr key={f.program.id} className="border-t border-slate-800">
                  <td className="py-2 pr-3">
                    <Link
                      href={`/pmo/programs/${f.program.id}`}
                      className="font-mono text-teal-400"
                    >
                      {f.program.code}
                    </Link>
                    <div className="text-xs text-slate-400">{f.program.name}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{f.program.contractType}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(f.funded)}</td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(f.billed)}</td>
                  <td className="py-2 pr-3 tabular-nums">
                    {formatCurrency(f.incurred.allowable)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-amber-200/80">
                    {formatCurrency(f.incurred.unallowable)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{formatCurrency(f.wip)}</td>
                  <td className="py-2 tabular-nums">
                    {f.outlook.burn == null ? "—" : pct(f.outlook.burn)}
                  </td>
                </tr>
              ))}
              {financials.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-slate-500">
                    No programs yet. Create one in PMO — that record is the contract.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">Indirect rates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {rates.map((r) => (
            <form
              key={r.code}
              action={actionSaveIndirectRate}
              className="grid gap-2 border-b border-slate-800 pb-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
            >
              <div>
                <p className="text-sm text-slate-100">{r.name}</p>
                <p className="text-xs text-slate-500">
                  {r.description} Base{" "}
                  {r.allocationBase === "TOTAL_COST_INPUT"
                    ? "is all cost except G&A and unallowable"
                    : "is direct labor on jobs"}
                  . Pool {formatCurrency(r.poolCosts)} ÷ base {formatCurrency(r.base)}.
                  Actual {pct(r.actualRate)}. Provisional {pct(r.provisionalRate)}.
                </p>
              </div>
              <input type="hidden" name="code" value={r.code} />
              <label className="text-[10px] uppercase text-slate-500">
                Provisional rate (0.35 = 35%)
                <Input
                  name="provisionalRate"
                  type="number"
                  step="0.0001"
                  min="0"
                  defaultValue={r.provisionalRate}
                  disabled={!canEdit}
                  className="mt-1 w-36"
                />
              </label>
              {canEdit && (
                <Button type="submit" size="sm">
                  Save
                </Button>
              )}
            </form>
          ))}
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">Unallowable and pool flags</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-slate-500">
            Flag an account unallowable to keep it out of billings and rate pools.
            Put fringe, shop overhead, or G&A on the pool it feeds. New postings
            copy the flag onto the journal line.
          </p>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {accounts.slice(0, 40).map((a) => (
              <form
                key={a.id}
                action={actionSetAccountAllowability}
                className="grid gap-2 rounded border border-slate-800 p-2 sm:grid-cols-[1fr_8rem_8rem_8rem_auto] sm:items-center"
              >
                <input type="hidden" name="accountId" value={a.id} />
                <div className="text-xs text-slate-300">
                  <span className="font-mono text-teal-400">{a.code}</span> {a.name}
                  <span className="ml-2 text-slate-500">{formatCurrency(a.balance)}</span>
                </div>
                <select
                  name="allowability"
                  defaultValue={a.allowability || ""}
                  disabled={!canEdit}
                  className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs"
                >
                  <option value="">Not flagged</option>
                  <option value="ALLOWABLE">Allowable</option>
                  <option value="UNALLOWABLE">Unallowable</option>
                </select>
                <Input
                  name="farCitation"
                  defaultValue={a.farCitation || ""}
                  placeholder="FAR note"
                  disabled={!canEdit}
                  className="h-8 text-xs"
                />
                <select
                  name="poolCode"
                  defaultValue={a.poolCode || ""}
                  disabled={!canEdit}
                  className="h-8 rounded border border-slate-700 bg-slate-950 px-2 text-xs"
                >
                  <option value="">No pool</option>
                  <option value="FRINGE">Fringe pool</option>
                  <option value="OVERHEAD">Shop overhead pool</option>
                  <option value="GA">G&A pool</option>
                </select>
                {canEdit && (
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                )}
              </form>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">Controls</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionSetGovconControls} className="space-y-2 text-sm text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireJournalSoD"
                defaultChecked={settings?.requireJournalSoD ?? false}
                disabled={!canControl}
              />
              Someone else must approve a journal you wrote (a controller can override)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireTotalTime"
                defaultChecked={settings?.requireTotalTime ?? false}
                disabled={!canControl}
              />
              Timesheets need a full day recorded on every weekday in the period
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="requireTimeChangeReason"
                defaultChecked={settings?.requireTimeChangeReason ?? false}
                disabled={!canControl}
              />
              Changing a timecard that already has time requires a reason
            </label>
            {canControl && (
              <Button type="submit" size="sm">
                Save controls
              </Button>
            )}
            {!canControl && (
              <p className="text-xs text-slate-500">
                A controller turns these on. Accounting can still post and close periods.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
