import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getBankingOverview } from "@/lib/services/banking";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BankImport } from "@/components/accounting/bank-import";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionConnectBank,
  actionCategorizeBankTxn,
  actionReconcileBankTxn,
} from "@/app/actions";
import { Landmark, CreditCard, Link2 } from "lucide-react";

const selectClass =
  "h-8 rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

/** Banking center — rendered as a tab inside Accounting. */
export async function BankingTab({ selectedId }: { selectedId?: string }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const canPost = await userHasPermission(user.id, "accounting.journal.post");

  const [overview, accounts, categoryAccounts, glAccounts] = await Promise.all([
    getBankingOverview(),
    prisma.bankAccount.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.account.findMany({
      where: {
        isActive: true,
        type: { in: ["EXPENSE", "REVENUE", "COGS", "ASSET", "LIABILITY"] },
      },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.account.findMany({
      where: { isActive: true, type: { in: ["ASSET", "LIABILITY"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const active = selectedId || overview[0]?.id || "";
  const feed = active
    ? await prisma.bankTransaction.findMany({
        where: { bankAccountId: active },
        orderBy: { date: "desc" },
        include: { categoryAccount: { select: { code: true, name: true } } },
        take: 100,
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {overview.map((a) => (
          <Link key={a.id} href={`/accounting?tab=banking&acct=${a.id}`}>
            <Card
              className={
                a.id === active
                  ? "border-teal-500/50 bg-teal-500/5"
                  : "hover:border-slate-700"
              }
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {a.kind === "CREDIT_CARD" ? (
                      <CreditCard className="h-4 w-4 text-violet-400" />
                    ) : (
                      <Landmark className="h-4 w-4 text-teal-400" />
                    )}
                    <span className="text-sm font-medium text-slate-200">
                      {a.name}
                    </span>
                  </div>
                  {a.unmatched > 0 && (
                    <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      {a.unmatched} to review
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {a.institution || "—"}
                  {a.last4 ? ` ···· ${a.last4}` : ""}
                  {a.glCode ? ` · GL ${a.glCode}` : ""}
                </p>
                <p className="mt-2 text-xl font-bold tabular-nums text-slate-50">
                  {formatCurrency(a.currentBalance)}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transaction feed</CardTitle>
            <p className="text-xs text-slate-500">
              Categorize a transaction to post it to the GL (balances against
              the account&apos;s cash/CC-payable account), then reconcile.
            </p>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No transactions. Import a statement on the right.
              </p>
            ) : (
              <div className="space-y-1">
                {feed.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-900 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-slate-200">{t.description}</p>
                      <p className="text-[11px] text-slate-500">
                        {formatDate(t.date)}
                        {t.categoryAccount
                          ? ` · ${t.categoryAccount.code} ${t.categoryAccount.name}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`tabular-nums ${t.amount < 0 ? "text-rose-400" : "text-emerald-400"}`}
                      >
                        {formatCurrency(t.amount)}
                      </span>
                      {t.status === "UNMATCHED" && canPost ? (
                        <form
                          action={actionCategorizeBankTxn}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="transactionId" value={t.id} />
                          <select
                            name="categoryAccountId"
                            required
                            className={selectClass}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Categorize…
                            </option>
                            {categoryAccounts.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.code} {c.name}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" variant="outline" className="h-8">
                            Post
                          </Button>
                        </form>
                      ) : t.status === "MATCHED" && canPost ? (
                        <form action={actionReconcileBankTxn}>
                          <input type="hidden" name="transactionId" value={t.id} />
                          <Button type="submit" size="sm" variant="outline" className="h-8">
                            Reconcile
                          </Button>
                        </form>
                      ) : (
                        <StatusBadge status={t.status} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {canPost && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Import statement</CardTitle>
              </CardHeader>
              <CardContent>
                <BankImport accounts={accounts} />
              </CardContent>
            </Card>
          )}

          {canPost && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Link2 className="h-4 w-4 text-teal-400" />
                  Connect an account
                </CardTitle>
                <p className="text-xs text-slate-500">
                  In production this links via your bank; here it registers the
                  account so you can import its statements.
                </p>
              </CardHeader>
              <CardContent>
                <form action={actionConnectBank} className="grid gap-2">
                  <Input name="name" required placeholder="Account name" className="h-9" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="institution" placeholder="Institution" className="h-9" />
                    <Input name="last4" placeholder="Last 4" className="h-9" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      name="kind"
                      className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                      defaultValue="CHECKING"
                    >
                      <option value="CHECKING">Checking</option>
                      <option value="SAVINGS">Savings</option>
                      <option value="CREDIT_CARD">Credit card</option>
                    </select>
                    <select
                      name="glAccountId"
                      className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                      defaultValue=""
                    >
                      <option value="">GL account…</option>
                      {glAccounts.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button type="submit" size="sm">
                    Connect account
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
