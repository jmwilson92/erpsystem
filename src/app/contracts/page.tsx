import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import {
  listContracts,
  getCdrlsDue,
  CONTRACT_TYPES,
} from "@/lib/services/contracts";
import { listUsers } from "@/lib/auth";
import { actionCreateContract } from "./actions";
import { FileSignature, CalendarClock, ShieldAlert, Layers } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "text-slate-400",
  ACTIVE: "text-emerald-300",
  ON_HOLD: "text-amber-300",
  CLOSING: "text-sky-300",
  CLOSED: "text-slate-500",
  TERMINATED: "text-rose-300",
};

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

function money(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function ContractsPage() {
  const [contracts, cdrlsDue, customers, programs, users] = await Promise.all([
    listContracts(),
    getCdrlsDue(30).catch(() => []),
    prisma.customer
      .findMany({ where: { isActive: true }, orderBy: { name: "asc" } })
      .catch(() => []),
    prisma.program
      .findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } })
      .catch(() => []),
    listUsers().catch(() => []),
  ]);

  const active = contracts.filter((c) => c.status === "ACTIVE");
  const totalValue = active.reduce((s, c) => s + c.totalValue, 0);
  const totalFunded = active.reduce((s, c) => s + c.fundedValue, 0);
  // Unfunded backlog is the number a programme manager actually watches: work
  // that is on contract but not yet obligated cannot be invoiced.
  const unfunded = totalValue - totalFunded;
  const rated = active.filter((c) => c.dpasRating).length;
  const today = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Contract line items, modifications and CDRL deliverables — the structure funding, delivery and invoicing all hang off."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-400">
              <FileSignature className="h-4 w-4" /> Active contracts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">{active.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-400">
              <Layers className="h-4 w-4" /> Contract value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">
              {money(totalValue)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {money(unfunded)} not yet funded
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-400">
              <ShieldAlert className="h-4 w-4" /> DPAS rated
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">{rated}</p>
            <p className="mt-1 text-xs text-slate-500">
              Rated orders schedule ahead of unrated work
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-slate-400">
              <CalendarClock className="h-4 w-4" /> CDRLs due (30d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-slate-100">{cdrlsDue.length}</p>
          </CardContent>
        </Card>
      </div>

      {cdrlsDue.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deliverables coming due</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2">CDRL</th>
                  <th className="pb-2">Title</th>
                  <th className="pb-2">Contract</th>
                  <th className="pb-2">Owner</th>
                  <th className="pb-2">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {cdrlsDue.map((c) => {
                  const overdue = c.nextDueDate && new Date(c.nextDueDate) < today;
                  return (
                    <tr key={c.id}>
                      <td className="py-2 font-mono text-slate-200">{c.number}</td>
                      <td className="py-2 text-slate-300">{c.title}</td>
                      <td className="py-2 text-slate-400">{c.contract.number}</td>
                      <td className="py-2 text-slate-400">{c.owner?.name || "—"}</td>
                      <td
                        className={`py-2 ${overdue ? "font-medium text-rose-300" : "text-slate-300"}`}
                      >
                        {fmtDate(c.nextDueDate)}
                        {overdue ? " · overdue" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All contracts</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contracts.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">
              No contracts yet. Add one below to start tracking CLINs,
              modifications and CDRL deliverables.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="pb-2">Number</th>
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Customer</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">DPAS</th>
                  <th className="pb-2 text-right">Value</th>
                  <th className="pb-2 text-right">Funded</th>
                  <th className="pb-2 text-right">CLINs</th>
                  <th className="pb-2">Ends</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contracts.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-900/40">
                    <td className="py-2 font-mono">
                      <Link
                        href={`/contracts/${c.id}`}
                        className="text-sky-300 hover:underline"
                      >
                        {c.number}
                      </Link>
                    </td>
                    <td className="py-2 text-slate-300">{c.name}</td>
                    <td className="py-2 text-slate-400">{c.customer?.name || "—"}</td>
                    <td className="py-2 text-slate-400">{c.contractType}</td>
                    <td className={`py-2 ${STATUS_TONE[c.status] || "text-slate-400"}`}>
                      {c.status}
                    </td>
                    <td className="py-2 font-mono text-amber-300">
                      {c.dpasRating || "—"}
                    </td>
                    <td className="py-2 text-right text-slate-200">
                      {money(c.totalValue)}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {money(c.fundedValue)}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {c._count.clins}
                    </td>
                    <td className="py-2 text-slate-400">{fmtDate(c.endDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a contract</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateContract} className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm text-slate-400">
              Contract number *
              <Input name="number" required placeholder="FA8620-26-C-1234" />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Name *
              <Input name="name" required placeholder="Actuator assemblies, Lot 4" />
            </label>

            <label className="text-sm text-slate-400">
              Customer
              <select name="customerId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Program
              <select name="programId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Contract type
              <select name="contractType" className={selectClass} defaultValue="FFP">
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm text-slate-400">
              Position
              <select name="isPrime" className={selectClass} defaultValue="1">
                <option value="1">Prime</option>
                <option value="0">Subcontract</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Prime contractor
              <Input name="primeContractor" placeholder="If we are a sub" />
            </label>
            <label className="text-sm text-slate-400">
              Contracting officer
              <Input name="contractingOfficer" />
            </label>

            <label className="text-sm text-slate-400">
              DPAS rating
              <Input name="dpasRating" placeholder="DO-A1" />
            </label>
            <label className="text-sm text-slate-400">
              Contract owner
              <select name="ownerId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Award date
              <Input name="awardDate" type="date" />
            </label>

            <label className="text-sm text-slate-400">
              Period of performance start
              <Input name="startDate" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              Period of performance end
              <Input name="endDate" type="date" />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-3">
              Description
              <Input name="description" />
            </label>

            <div className="sm:col-span-3">
              <Button type="submit">Add contract</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
