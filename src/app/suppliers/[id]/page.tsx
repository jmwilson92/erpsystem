import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate, scoreRatingColor, cn } from "@/lib/utils";
import {
  actionRefreshScorecard,
  actionToggleSupplierAsl,
  actionUpsertSupplierCert,
  actionDeleteSupplierCert,
  actionRecordApPayment,
  actionCreateVendorApInvoice,
} from "@/app/actions";
import {
  getAslPolicy,
  refreshCertStatuses,
  supplierMeetsCertPolicy,
} from "@/lib/services/asl";
import { SupplierTrendChart } from "@/components/suppliers/trend-chart";
import Link from "next/link";
import { ActivityTimeline } from "@/components/shared/activity-timeline";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function SupplierDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "overview";

  await refreshCertStatuses(id);

  const [supplier, policy, certCheck] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id },
      include: {
        scorecardHistory: { orderBy: { period: "asc" } },
        purchaseOrders: {
          orderBy: { orderDate: "desc" },
          take: 40,
          include: { lines: true },
        },
        ncrs: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { mrbCases: true },
        },
        certifications: { orderBy: { expiresAt: "asc" } },
        apInvoices: {
          orderBy: { invoiceDate: "desc" },
          take: 40,
        },
        partVendors: {
          include: { part: true },
          take: 20,
        },
      },
    }),
    getAslPolicy(),
    supplierMeetsCertPolicy(id),
  ]);
  if (!supplier) notFound();

  const onAsl =
    supplier.isApprovedVendor &&
    (supplier.status === "APPROVED" || supplier.status === "CONDITIONAL");

  const unpaidInvoices = supplier.apInvoices.filter((inv) =>
    ["OPEN", "PARTIAL", "DRAFT"].includes(inv.status)
  );
  const paidInvoices = supplier.apInvoices.filter((inv) => inv.status === "PAID");
  const openPos = supplier.purchaseOrders.filter((po) =>
    !["CLOSED", "CANCELLED", "RECEIVED"].includes(po.status)
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "pos", label: `POs (${supplier.purchaseOrders.length})` },
    { id: "invoices", label: `Invoices (${supplier.apInvoices.length})` },
    { id: "certs", label: `QMS certs (${supplier.certifications.length})` },
    { id: "quality", label: `Quality (${supplier.ncrs.length})` },
  ] as const;

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={`${supplier.code} · ${supplier.category || "General"} · ${supplier.contactEmail || ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/suppliers">
              <Button size="sm" variant="outline">
                ASL list
              </Button>
            </Link>
            <form action={actionToggleSupplierAsl}>
              <input type="hidden" name="supplierId" value={supplier.id} />
              {onAsl ? (
                <>
                  <input type="hidden" name="approve" value="false" />
                  <Button type="submit" size="sm" variant="outline">
                    Remove from ASL
                  </Button>
                </>
              ) : (
                <>
                  <input type="hidden" name="approve" value="on" />
                  <Button type="submit" size="sm">
                    {certCheck.meetsRequirements
                      ? "Add to ASL"
                      : policy.allowTrialOrders
                        ? "Add as trial ASL"
                        : "Add to ASL"}
                  </Button>
                </>
              )}
            </form>
            {!onAsl &&
              !certCheck.meetsRequirements &&
              policy.allowTrialOrders && (
                <form action={actionToggleSupplierAsl}>
                  <input type="hidden" name="supplierId" value={supplier.id} />
                  <input type="hidden" name="approve" value="on" />
                  <input type="hidden" name="forceTrial" value="on" />
                  <Button type="submit" size="sm" variant="secondary">
                    Force trial order path
                  </Button>
                </form>
              )}
            <form action={actionRefreshScorecard}>
              <input type="hidden" name="supplierId" value={supplier.id} />
              <Button type="submit" size="sm" variant="outline">
                Recalculate scorecard
              </Button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <div className={cn("text-5xl font-bold", scoreRatingColor(supplier.rating))}>
          {supplier.rating}
        </div>
        <div>
          <p className="text-2xl font-semibold text-slate-100">
            {supplier.overallScore}
          </p>
          <p className="text-xs text-slate-500">Overall score</p>
        </div>
        <StatusBadge status={supplier.status} />
        {onAsl ? (
          <span className="rounded border border-emerald-500/40 px-2 py-1 text-xs font-medium text-emerald-400">
            On ASL{supplier.isTrialVendor ? " (trial)" : ""}
          </span>
        ) : (
          <span className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-400">
            Not eligible for new POs
          </span>
        )}
        {supplier.isTrialVendor && (
          <span className="text-xs text-sky-400">
            Trial POs: {supplier.trialOrdersUsed}/{supplier.trialOrderLimit}
          </span>
        )}
      </div>

      {!certCheck.meetsRequirements && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 text-sm text-amber-100">
            Missing required cert(s) for full ASL:{" "}
            <strong>{certCheck.missingCerts.join(", ")}</strong>
            {policy.allowTrialOrders
              ? " — can join via trial order path (conditional)."
              : " — trial path disabled; upload valid certs to approve."}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/suppliers/${supplier.id}?tab=${t.id}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === t.id
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-teal-400">
                  {supplier.onTimeDeliveryPct}%
                </p>
                <p className="text-xs text-slate-500">On-time delivery</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-amber-400">
                  {Math.round(supplier.qualityPpm)}
                </p>
                <p className="text-xs text-slate-500">Quality PPM</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-sky-400">
                  {openPos.length}
                </p>
                <p className="text-xs text-slate-500">Open POs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-orange-400">
                  {unpaidInvoices.length}
                </p>
                <p className="text-xs text-slate-500">Unpaid invoices</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Scorecard trend</CardTitle>
              </CardHeader>
              <CardContent>
                <SupplierTrendChart
                  data={supplier.scorecardHistory.map((h) => ({
                    period: h.period,
                    score: h.overallScore,
                    otd: h.onTimeDeliveryPct,
                    ppm: h.qualityPpm,
                  }))}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Contact &amp; terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-300">
                <p>{supplier.contactName || "—"}</p>
                <p className="text-slate-500">{supplier.contactEmail || "—"}</p>
                <p className="text-slate-500">{supplier.contactPhone || "—"}</p>
                <p className="pt-2 text-xs text-slate-500">
                  Terms: {supplier.paymentTerms}
                </p>
                {supplier.address && (
                  <pre className="whitespace-pre-wrap font-sans text-xs text-slate-500">
                    {supplier.address}
                  </pre>
                )}
              </CardContent>
            </Card>
          </div>

          {supplier.partVendors.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Linked items</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {supplier.partVendors.map((pv) => (
                  <Link
                    key={pv.id}
                    href={`/items/${pv.partId}`}
                    className="rounded border border-slate-800 px-2 py-1 font-mono text-xs text-teal-400 hover:border-teal-500/40"
                  >
                    {pv.part.partNumber}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "pos" && (
        <Card>
          <CardHeader>
            <CardTitle>Purchase orders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supplier.purchaseOrders.length === 0 && (
              <p className="text-sm text-slate-500">No POs yet.</p>
            )}
            {supplier.purchaseOrders.map((po) => (
              <Link
                key={po.id}
                href={`/purchasing/po/${po.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-teal-500/30"
              >
                <div>
                  <span className="font-mono text-teal-400">{po.number}</span>
                  <span className="ml-2 text-slate-500">
                    {formatDate(po.orderDate)}
                  </span>
                  <p className="text-[11px] text-slate-600">
                    {po.lines.length} line(s)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums">
                    {formatCurrency(po.totalAmount)}
                  </span>
                  <StatusBadge status={po.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {tab === "invoices" && (
        <div className="space-y-4">
          <Card className="border-teal-900/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Enter vendor invoice
              </CardTitle>
              <p className="text-xs text-slate-500">
                Outside vendors / services / non-receipt bills. After entry, pay
                below or from Accounting → AP. PO receipts also auto-create AP
                vouchers (3-way match).
              </p>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateVendorApInvoice}
                className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
              >
                <input type="hidden" name="supplierId" value={supplier.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Amount *
                  </label>
                  <Input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Vendor invoice #
                  </label>
                  <Input name="vendorInvoiceNumber" className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Invoice date
                  </label>
                  <Input name="invoiceDate" type="date" className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Due date
                  </label>
                  <Input name="dueDate" type="date" className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Description
                  </label>
                  <Input
                    name="description"
                    className="mt-1"
                    placeholder="e.g. Machine calibration service"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Link PO (optional)
                  </label>
                  <select name="purchaseOrderId" className={`${selectClass} mt-1`}>
                    <option value="">— none —</option>
                    {supplier.purchaseOrders.map((po) => (
                      <option key={po.id} value={po.id}>
                        {po.number} · {formatCurrency(po.totalAmount)} ·{" "}
                        {po.status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-4">
                  <Button type="submit" size="sm">
                    Create AP invoice
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Unpaid / open AP</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {unpaidInvoices.length === 0 && (
                  <p className="text-sm text-slate-500">No open AP invoices.</p>
                )}
                {unpaidInvoices.map((inv) => {
                  const open = inv.total - inv.amountPaid;
                  return (
                    <div
                      key={inv.id}
                      className="space-y-2 rounded border border-slate-800 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono text-amber-400">
                            {inv.number}
                          </span>
                          <StatusBadge status={inv.status} className="ml-2" />
                          <p className="text-[11px] text-slate-500">
                            {formatDate(inv.invoiceDate)}
                            {inv.dueDate
                              ? ` · Due ${formatDate(inv.dueDate)}`
                              : ""}
                          </p>
                          {inv.notes && (
                            <p className="text-[11px] text-slate-500">
                              {inv.notes}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="tabular-nums">
                            {formatCurrency(inv.total)}
                          </p>
                          <p className="text-[10px] text-slate-500">
                            Paid {formatCurrency(inv.amountPaid)}
                          </p>
                        </div>
                      </div>
                      {open > 0.01 && (
                        <form
                          action={actionRecordApPayment}
                          className="flex flex-wrap items-center gap-1 border-t border-slate-900 pt-2"
                        >
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <Input
                            name="amount"
                            type="number"
                            step="0.01"
                            min="0.01"
                            defaultValue={open.toFixed(2)}
                            className="h-8 w-24 text-xs"
                          />
                          <select
                            name="method"
                            className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                            defaultValue="ACH"
                          >
                            <option value="ACH">ACH</option>
                            <option value="CHECK">Check</option>
                            <option value="WIRE">Wire</option>
                            <option value="CARD">Card</option>
                          </select>
                          <Input
                            name="reference"
                            placeholder="Check / ref #"
                            className="h-8 w-28 text-xs"
                          />
                          <Button type="submit" size="sm" className="h-8 text-xs">
                            Pay vendor
                          </Button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Paid invoices</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {paidInvoices.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No paid invoices on file.
                  </p>
                )}
                {paidInvoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-mono text-slate-400">
                        {inv.number}
                      </span>
                      <StatusBadge status={inv.status} className="ml-2" />
                    </div>
                    <span className="tabular-nums text-emerald-400">
                      {formatCurrency(inv.total)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === "certs" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Certifications on file</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {supplier.certifications.length === 0 && (
                <p className="text-sm text-slate-500">
                  No QMS certificates on file yet.
                </p>
              )}
              {supplier.certifications.map((c) => {
                const expired =
                  c.status === "EXPIRED" ||
                  (c.expiresAt ? c.expiresAt < now : false);
                const expiringSoon =
                  !expired &&
                  c.expiresAt &&
                  c.expiresAt.getTime() - now.getTime() <
                    90 * 24 * 60 * 60 * 1000;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3 py-3",
                      expired
                        ? "border-red-500/40 bg-red-500/5"
                        : expiringSoon
                          ? "border-amber-500/30 bg-amber-500/5"
                          : "border-slate-800"
                    )}
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-teal-400">
                          {c.certType}
                        </span>
                        <StatusBadge status={expired ? "EXPIRED" : c.status} />
                        {expiringSoon && (
                          <span className="text-[10px] text-amber-400">
                            Expiring soon
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {c.certNumber ? `#${c.certNumber}` : "No number"}
                        {c.issuedBy ? ` · ${c.issuedBy}` : ""}
                      </p>
                      <p className="text-xs text-slate-500">
                        Issued {formatDate(c.issuedAt)} · Expires{" "}
                        {formatDate(c.expiresAt) || "—"}
                      </p>
                      {c.documentUrl && (
                        <a
                          href={c.documentUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-block text-xs text-sky-400 hover:underline"
                        >
                          {c.documentName || "View document"}
                        </a>
                      )}
                      {c.notes && (
                        <p className="mt-1 text-xs text-slate-500">{c.notes}</p>
                      )}
                    </div>
                    <form action={actionDeleteSupplierCert}>
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="supplierId" value={supplier.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Remove
                      </Button>
                    </form>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add / update certification</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionUpsertSupplierCert} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="supplierId" value={supplier.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Type
                  </label>
                  <select name="certType" className={`${selectClass} mt-1`} defaultValue="ISO9001">
                    <option value="ISO9001">ISO 9001</option>
                    <option value="AS9100D">AS9100D</option>
                    <option value="ISO14001">ISO 14001</option>
                    <option value="NADCAP">NADCAP</option>
                    <option value="NDA">NDA (signed)</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Cert number
                  </label>
                  <Input name="certNumber" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Issued by
                  </label>
                  <Input name="issuedBy" className="mt-1 h-9" placeholder="Registrar" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Issued date
                  </label>
                  <Input name="issuedAt" type="date" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Expiration
                  </label>
                  <Input name="expiresAt" type="date" className="mt-1 h-9" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Document name
                  </label>
                  <Input name="documentName" className="mt-1 h-9" placeholder="ISO9001.pdf" />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Document URL / path
                  </label>
                  <Input
                    name="documentUrl"
                    className="mt-1 h-9"
                    placeholder="/uploads/certs/… or https://…"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Notes
                  </label>
                  <Textarea name="notes" rows={2} className="mt-1" />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Save certification
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "quality" && (
        <Card>
          <CardHeader>
            <CardTitle>NCRs / quality events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supplier.ncrs.length === 0 && (
              <p className="text-sm text-slate-500">
                No NCRs — strong quality performance
              </p>
            )}
            {supplier.ncrs.map((ncr) => (
              <div
                key={ncr.id}
                className="rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-amber-400">{ncr.number}</span>
                  <StatusBadge status={ncr.status} />
                  {ncr.mrbCases[0] && (
                    <Link href="/mrb" className="text-xs text-teal-400">
                      {ncr.mrbCases[0].number}
                    </Link>
                  )}
                </div>
                <p className="text-slate-400">{ncr.title}</p>
              </div>
            ))}
            {supplier.rating === "C" ||
            supplier.rating === "D" ||
            supplier.rating === "F" ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                Performance below threshold — consider issuing a Corrective
                Action Request from the next MRB disposition.
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      <ActivityTimeline entityType="Supplier" entityId={id} />
    </div>
  );
}
