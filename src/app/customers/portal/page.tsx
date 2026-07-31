import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listTokens } from "@/lib/services/customer-portal";
import {
  actionIssueCustomerToken,
  actionRevokeCustomerToken,
} from "./actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

export default async function CustomerPortalAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ issued?: string }>;
}) {
  const sp = await searchParams;
  const [tokens, customers] = await Promise.all([
    listTokens(),
    prisma.customer.findMany({ orderBy: { name: "asc" }, take: 500 }).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer portal links"
        description="Give a customer a live view of their open orders"
      />

      {sp.issued && (
        <Card className="border-emerald-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-300">
              Copy this link now
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded bg-slate-950 p-3 text-xs text-slate-200">
              /portal/customer/{sp.issued}
            </code>
            <p className="mt-2 text-xs text-slate-500">
              Only a hash is stored, so this cannot be shown again. Issue a new
              link if it is lost.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issued links</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {tokens.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No links issued.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Customer</th>
                  <th className={th}>Label</th>
                  <th className={th}>Expires</th>
                  <th className={th}>Last used</th>
                  <th className={th}>State</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {tokens.map((t) => {
                  const expired = t.expiresAt.getTime() < Date.now();
                  return (
                    <tr key={t.id}>
                      <td className="py-2 text-slate-200">{t.customer.name}</td>
                      <td className="py-2 text-slate-400">{t.label || "—"}</td>
                      <td className="py-2 text-slate-400">{fmtDate(t.expiresAt)}</td>
                      <td className="py-2 text-slate-500">{fmtDate(t.lastUsedAt)}</td>
                      <td className="py-2">
                        {t.revokedAt ? (
                          <span className="text-slate-500">Revoked</span>
                        ) : expired ? (
                          <span className="text-amber-300">Expired</span>
                        ) : (
                          <span className="text-emerald-300">Active</span>
                        )}
                      </td>
                      <td className="py-2">
                        {!t.revokedAt && (
                          <form action={actionRevokeCustomerToken}>
                            <input type="hidden" name="id" value={t.id} />
                            <Button type="submit" variant="outline" size="sm">
                              Revoke
                            </Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <form
            action={actionIssueCustomerToken}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <label className="text-sm text-slate-400">
              Customer *
              <select name="customerId" required className={selectClass}>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Label
              <Input name="label" placeholder="Buyer contact" />
            </label>
            <label className="text-sm text-slate-400">
              Valid for (days)
              <Input name="days" type="number" min="1" defaultValue="365" />
            </label>
            <div className="sm:self-end">
              <Button type="submit">Issue link</Button>
            </div>
          </form>

          <p className="mt-4 text-xs text-slate-500">
            The portal shows quantities, dates, stage and hold state only. It
            never exposes cost, margin, internal notes or any other customer.
          </p>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        <Link href="/customers" className="text-sky-300 hover:underline">
          ← Customers
        </Link>
      </p>
    </div>
  );
}
