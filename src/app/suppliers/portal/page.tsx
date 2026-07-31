import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import { listTokens, pendingDateChanges } from "@/lib/services/supplier-portal";
import {
  actionAcceptDate,
  actionIssueToken,
  actionRevokeToken,
} from "./actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

export default async function SupplierPortalAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ issued?: string; error?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const [tokens, pending, suppliers] = await Promise.all([
    listTokens(),
    pendingDateChanges(),
    prisma.supplier.findMany({ orderBy: { name: "asc" }, take: 500 }).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Supplier portal"
        description="Portal links, acknowledgements and proposed date changes"
      />

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}

      {sp.issued && (
        <Card className="border-emerald-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-emerald-300">
              Copy this link now
            </CardTitle>
          </CardHeader>
          <CardContent>
            <code className="block break-all rounded bg-slate-950 p-3 text-xs text-slate-200">
              /portal/supplier/{sp.issued}
            </code>
            <p className="mt-2 text-xs text-slate-500">
              Only a hash is stored, so this link cannot be shown again. Issue a
              new one if it is lost.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Proposed date changes awaiting a decision
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {pending.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">Nothing outstanding.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>PO</th>
                  <th className={th}>Supplier</th>
                  <th className={th}>Part</th>
                  <th className={th}>Required</th>
                  <th className={th}>Proposed</th>
                  <th className={th}>Note</th>
                  <th className={th}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {pending.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 font-mono text-slate-200">
                      {a.line.purchaseOrder.number}
                    </td>
                    <td className="py-2 text-slate-300">
                      {a.line.purchaseOrder.supplier?.name || "—"}
                    </td>
                    <td className="py-2 font-mono text-slate-400">
                      {a.line.part?.partNumber || "—"}
                    </td>
                    <td className="py-2 text-slate-400">
                      {fmtDate(a.line.promisedDate)}
                    </td>
                    <td className="py-2 text-amber-300">
                      {fmtDate(a.confirmedDate)}
                    </td>
                    <td className="py-2 text-slate-400">{a.supplierNote || "—"}</td>
                    <td className="py-2">
                      <form action={actionAcceptDate}>
                        <input type="hidden" name="lineId" value={a.lineId} />
                        <Button type="submit" variant="outline" size="sm">
                          Accept date
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-500">
            A supplier's date only becomes the promised date when a buyer
            accepts it here — the portal records what was proposed, it does not
            move the commitment.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Portal links</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {tokens.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No links issued.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Supplier</th>
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
                      <td className="py-2 text-slate-200">{t.supplier.name}</td>
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
                          <form action={actionRevokeToken}>
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
            action={actionIssueToken}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <label className="text-sm text-slate-400">
              Supplier *
              <select name="supplierId" required className={selectClass}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Label
              <Input name="label" placeholder="Quality contact" />
            </label>
            <label className="text-sm text-slate-400">
              Valid for (days)
              <Input name="days" type="number" min="1" defaultValue="180" />
            </label>
            <div className="sm:self-end">
              <Button type="submit">Issue link</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500">
        <Link href="/suppliers" className="text-sky-300 hover:underline">
          ← Suppliers
        </Link>
      </p>
    </div>
  );
}
