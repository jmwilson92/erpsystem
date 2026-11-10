import { DocBacklinks } from "@/components/docs/backlinks";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getProgramFinancials } from "@/lib/services/program-financials";
import { Input } from "@/components/ui/input";
import { actionAddProgramClin, actionUpdateProgramContract } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const program = await prisma.program.findUnique({
    where: { id },
    include: {
      owner: true,
      projects: {
        include: {
          product: { select: { code: true, name: true } },
          projectManager: { select: { name: true } },
          _count: { select: { risks: true, issues: true, tasks: true } },
        },
        orderBy: { number: "asc" },
      },
    },
  });
  if (!program) notFound();

  const books = await getProgramFinancials(program.id);
  const budget = program.projects.reduce((s, p) => s + p.budgetCost, 0);
  const performanceActual = program.projects.reduce((s, p) => s + p.actualCost, 0);
  const dev = program.projects.reduce((s, p) => s + p.developmentActual, 0);
  const burn =
    books?.outlook.burn == null ? "—" : `${(books.outlook.burn * 100).toFixed(1)}%`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={program.name}
        description={`${program.code}${program.portfolio ? ` · ${program.portfolio}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/pmo/projects/new?programId=${program.id}`}>
              <Button size="sm">Add project</Button>
            </Link>
            <Link href="/pmo">
              <Button size="sm" variant="outline">
                PMO home
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={program.status} />
        <span className="text-xs text-slate-500">
          Owner {program.owner?.name || "—"} · {formatDate(program.startDate)} –{" "}
          {formatDate(program.endDate)}
        </span>
      </div>

      {program.description && (
        <p className="text-sm text-slate-400">{program.description}</p>
      )}

      <p className="text-xs text-slate-500">
        Money on the books comes from posted journals tagged to this program.
        Budget, earned value, and the performance log are what was entered on
        the projects. They are not a second ledger.{" "}
        <Link href="/accounting/govcon" className="text-teal-400 underline">
          Rates and unallowable costs
        </Link>
      </p>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Funded", formatCurrency(books?.funded || program.fundedAmount)],
          ["Billed", formatCurrency(books?.billed || 0)],
          ["Allowable cost", formatCurrency(books?.incurred.allowable || 0)],
          ["Left out", formatCurrency(books?.incurred.unallowable || 0)],
          ["Still in WIP", formatCurrency(books?.wip || 0)],
          ["Burn of funding", burn],
        ].map(([label, value]) => (
          <Card key={label} className="border-slate-800">
            <CardContent className="p-3 text-center">
              <p className="text-lg font-bold tabular-nums text-slate-100">{value}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Project budget", formatCurrency(budget || program.budgetCost)],
          ["Performance log", formatCurrency(performanceActual || program.actualCost)],
          ["Earned value", formatCurrency(books?.earned || 0)],
          ["Dev / NRE log", formatCurrency(dev)],
        ].map(([label, value]) => (
          <Card key={label} className="border-slate-800">
            <CardContent className="p-3 text-center">
              <p className="text-base font-semibold tabular-nums text-slate-200">{value}</p>
              <p className="text-[11px] text-slate-500">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {books && (
        <p className="text-xs text-slate-500">
          Estimate at completion from the books {formatCurrency(books.outlook.eac)}.
          Funding left after billings {formatCurrency(books.outlook.remainingFunding)}.
          Ceiling room {formatCurrency(books.outlook.ceilingRoom)}. Billing worksheet:{" "}
          {books.billing.basis} {formatCurrency(books.billing.amount)}. This is not a
          voucher and it is not a compliance determination.
        </p>
      )}

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">Contract on this program</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpdateProgramContract} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="id" value={program.id} />
            <label className="text-[10px] uppercase text-slate-500">
              Contract number
              <Input name="contractNumber" defaultValue={program.contractNumber || ""} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Type
              <select
                name="contractType"
                defaultValue={program.contractType}
                className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
              >
                {["COMMERCIAL", "FFP", "TM", "COST_PLUS", "IDIQ"].map((t) => (
                  <option key={t} value={t}>
                    {t === "TM" ? "Time and materials" : t === "FFP" ? "Firm fixed price" : t === "COST_PLUS" ? "Cost plus" : t === "IDIQ" ? "IDIQ" : "Commercial"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Customer
              <Input name="customerName" defaultValue={program.customerName || ""} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Funded
              <Input name="fundedAmount" type="number" step="0.01" defaultValue={program.fundedAmount} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Ceiling
              <Input name="ceilingAmount" type="number" step="0.01" defaultValue={program.ceilingAmount} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Fee %
              <Input name="feePercent" type="number" step="0.01" defaultValue={program.feePercent} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Agency
              <Input name="agency" defaultValue={program.agency || ""} className="mt-1" />
            </label>
            <label className="text-[10px] uppercase text-slate-500">
              Prime or sub
              <select
                name="primeOrSub"
                defaultValue={program.primeOrSub || ""}
                className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
              >
                <option value="">—</option>
                <option value="PRIME">Prime</option>
                <option value="SUB">Subcontractor</option>
              </select>
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm text-slate-300">
              <input type="checkbox" name="isGovernment" defaultChecked={program.isGovernment} />
              Government contract
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Save contract
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">CLINs and task orders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {books?.program.clins.length ? (
            <ul className="space-y-1 text-sm">
              {books.program.clins.map((c) => (
                <li key={c.id} className="flex justify-between gap-2 text-slate-300">
                  <span>
                    <span className="font-mono text-teal-400">{c.clinNumber}</span> {c.name}
                    {c.contractType ? ` · ${c.contractType}` : ""}
                  </span>
                  <span className="tabular-nums text-slate-400">
                    Funded {formatCurrency(c.fundedAmount)} · Ceiling {formatCurrency(c.ceilingAmount)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No CLINs yet.</p>
          )}
          <form action={actionAddProgramClin} className="grid gap-2 sm:grid-cols-4">
            <input type="hidden" name="programId" value={program.id} />
            <Input name="clinNumber" placeholder="CLIN number" required />
            <Input name="name" placeholder="Name" required />
            <Input name="fundedAmount" type="number" step="0.01" placeholder="Funded" />
            <Button type="submit" size="sm">
              Add CLIN
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-slate-800">
        <CardHeader>
          <CardTitle className="text-base">
            Projects in this program ({program.projects.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {program.projects.length === 0 && (
            <p className="text-sm text-slate-500">
              No projects yet.{" "}
              <Link
                href={`/pmo/projects/new?programId=${program.id}`}
                className="text-teal-400 underline"
              >
                Create one
              </Link>
            </p>
          )}
          {program.projects.map((p) => (
            <Link
              key={p.id}
              href={`/pmo/projects/${p.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 hover:bg-slate-900/50"
            >
              <div>
                <span className="font-mono text-sm text-teal-400">{p.number}</span>{" "}
                <span className="text-slate-200">{p.name}</span>
                <p className="text-[11px] text-slate-500">
                  {p.methodology} · PM {p.projectManager?.name || "—"}
                  {p.product ? ` · ${p.product.code}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={p.status} />
                <span className="text-xs tabular-nums text-slate-500">
                  {formatCurrency(p.budgetCost)}
                </span>
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>
      <DocBacklinks type="PROGRAM" targetId={id} />
    </div>
  );
}
