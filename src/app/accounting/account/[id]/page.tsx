import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAccountRegister } from "@/lib/services/gaap";
import { formatCurrency, formatDate } from "@/lib/utils";
import { startOfDay, endOfDay } from "date-fns";

export const dynamic = "force-dynamic";

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export default async function AccountRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = searchParams ? await searchParams : {};
  const periodFrom = pick(sp, "from");
  const periodTo = pick(sp, "to");
  const fromDate = periodFrom ? startOfDay(new Date(periodFrom)) : null;
  const toDate = periodTo ? endOfDay(new Date(periodTo)) : null;
  const validFrom =
    fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
  const validTo = toDate && !Number.isNaN(toDate.getTime()) ? toDate : null;

  const reg = await getAccountRegister(id, { from: validFrom, to: validTo });
  if (!reg) notFound();

  const { account, debitNormal, opening, closing, totalDebit, totalCredit, rows } =
    reg;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${account.code} · ${account.name}`}
        description={`${account.type}${
          account.subtype ? ` · ${account.subtype}` : ""
        } · normal balance ${debitNormal ? "debit" : "credit"}`}
        actions={
          <Link href="/accounting?tab=coa">
            <Button size="sm" variant="outline">
              Chart of accounts
            </Button>
          </Link>
        }
      />

      {/* Period filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2 p-3">
          <form className="flex flex-wrap items-end gap-2" method="get">
            <label className="text-xs text-slate-500">
              From
              <Input
                name="from"
                type="date"
                defaultValue={periodFrom}
                className="h-8 w-36"
              />
            </label>
            <label className="text-xs text-slate-500">
              To
              <Input
                name="to"
                type="date"
                defaultValue={periodTo}
                className="h-8 w-36"
              />
            </label>
            <Button type="submit" size="sm" className="h-8">
              Apply
            </Button>
            {(periodFrom || periodTo) && (
              <Button asChild size="sm" variant="outline" className="h-8">
                <Link href={`/accounting/account/${id}`}>Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Opening balance" value={formatCurrency(opening)} />
        <StatTile label="Total debits" value={formatCurrency(totalDebit)} />
        <StatTile label="Total credits" value={formatCurrency(totalCredit)} />
        <StatTile
          label="Closing balance"
          value={formatCurrency(closing)}
          accent
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Register ({rows.length} {rows.length === 1 ? "entry" : "entries"})
          </CardTitle>
          <p className="text-xs text-slate-500">
            Posted journal activity, newest first. Running balance is shown in
            the account&apos;s natural {debitNormal ? "debit" : "credit"} sign.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="py-1.5 pr-3">Date</th>
                <th className="py-1.5 pr-3">Entry</th>
                <th className="py-1.5 pr-3">Memo / description</th>
                <th className="py-1.5 pr-3 text-right">Debit</th>
                <th className="py-1.5 pr-3 text-right">Credit</th>
                <th className="py-1.5 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-800/60 hover:bg-slate-900/40"
                >
                  <td className="py-1.5 pr-3 tabular-nums text-slate-400">
                    {formatDate(r.date)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Link
                      href={`/accounting?tab=je`}
                      className="font-mono text-teal-400 hover:underline"
                    >
                      {r.number}
                    </Link>
                    {r.source && (
                      <span className="ml-1.5 rounded bg-slate-800 px-1 py-0.5 text-[9px] text-slate-400">
                        {r.source}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-300">
                    {r.memo || r.description}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">
                    {r.debit ? formatCurrency(r.debit) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-slate-300">
                    {r.credit ? formatCurrency(r.credit) : "—"}
                  </td>
                  <td className="py-1.5 text-right font-medium tabular-nums text-slate-100">
                    {formatCurrency(r.balance)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-center text-sm text-slate-500"
                  >
                    No posted activity in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? "border-teal-700/50 bg-teal-500/5"
          : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-semibold tabular-nums ${
          accent ? "text-teal-300" : "text-slate-100"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
