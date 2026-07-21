import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleField } from "@/components/ui/toggle-field";
import { scoreRatingColor, cn } from "@/lib/utils";
import { getAslPolicy } from "@/lib/services/asl";
import { actionUpdateAslPolicy, actionCreateSupplier } from "@/app/actions";
import Link from "next/link";
import { Search, X, ShieldCheck } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = pick(sp, "q").trim();
  const asl = pick(sp, "asl"); // "", "1", "0", "trial"
  const rating = pick(sp, "rating");

  const where: Prisma.SupplierWhereInput = {};
  if (q) {
    where.OR = [
      { code: { contains: q } },
      { name: { contains: q } },
      { category: { contains: q } },
      { contactName: { contains: q } },
    ];
  }
  if (asl === "1") {
    where.isApprovedVendor = true;
    where.status = { in: ["APPROVED", "CONDITIONAL"] };
  } else if (asl === "0") {
    where.OR = [
      { isApprovedVendor: false },
      { status: { notIn: ["APPROVED", "CONDITIONAL"] } },
    ];
  } else if (asl === "trial") {
    where.isTrialVendor = true;
    where.isApprovedVendor = true;
  }
  if (rating) where.rating = rating;

  const [suppliers, policy] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy: [{ isApprovedVendor: "desc" }, { overallScore: "desc" }],
      include: {
        _count: { select: { purchaseOrders: true, ncrs: true, certifications: true } },
        certifications: {
          select: { certType: true, status: true, expiresAt: true },
        },
      },
    }),
    getAslPolicy(),
  ]);

  const hasFilters = Boolean(q || asl || rating);
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approved Supplier List"
        description="ASL line items — open a supplier for POs, invoices, QMS certs, and scorecard"
        actions={
          <div className="flex gap-2">
            <a href="/api/export?entity=suppliers">
              <Button size="sm" variant="outline">
                Export CSV
              </Button>
            </a>
            <Link href="/admin/import">
              <Button size="sm" variant="outline">
                Import
              </Button>
            </Link>
          </div>
        }
      />

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-teal-400" />
            ASL certification policy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionUpdateAslPolicy} className="space-y-3">
            <p className="text-xs text-slate-500">
              Optionally require QMS certifications for full ASL. Suppliers
              missing certs can be admitted on a trial order path (conditional
              ASL), or blocked entirely if trial is off.
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              <ToggleField
                name="requireIso9001"
                defaultChecked={policy.requireIso9001}
                label="Require ISO 9001"
              />
              <ToggleField
                name="requireAs9100d"
                defaultChecked={policy.requireAs9100d}
                label="Require AS9100D"
              />
              <ToggleField
                name="allowTrialOrders"
                defaultChecked={policy.allowTrialOrders}
                label="Allow trial orders (conditional ASL)"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">Trial limit</label>
                <Input
                  name="defaultTrialLimit"
                  type="number"
                  min={1}
                  className="h-8 w-16"
                  defaultValue={String(policy.defaultTrialLimit)}
                />
              </div>
              <Button type="submit" size="sm" variant="secondary">
                Save policy
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <details className="rounded-xl border border-slate-800 bg-slate-950/50">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm text-slate-300 hover:text-teal-300">
          + Add a vendor{" "}
          <span className="text-xs text-slate-500">
            (starts as a prospect — upload QMS certs &amp; NDA on their page, then
            approve to the ASL)
          </span>
        </summary>
        <form
          action={actionCreateSupplier}
          className="grid gap-2 border-t border-slate-800 p-4 sm:grid-cols-3 lg:grid-cols-7"
        >
          <Input name="name" required placeholder="Vendor name" className="h-9 sm:col-span-2" />
          <Input name="code" placeholder="Code (auto if blank)" className="h-9" />
          <Input name="category" placeholder="Category" className="h-9" />
          <Input name="contactName" placeholder="Contact" className="h-9" />
          <Input name="contactEmail" type="email" placeholder="Email" className="h-9" />
          <Button type="submit" size="sm" className="h-9">
            Add vendor
          </Button>
        </form>
      </details>

      <form
        method="get"
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Search className="h-3.5 w-3.5" />
          Search &amp; filters
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            name="q"
            placeholder="Code, name, category…"
            defaultValue={q}
            className="h-9 lg:col-span-2"
          />
          <select name="asl" className={selectClass} defaultValue={asl}>
            <option value="">ASL: all</option>
            <option value="1">On ASL</option>
            <option value="0">Not on ASL</option>
            <option value="trial">Trial only</option>
          </select>
          <select name="rating" className={selectClass} defaultValue={rating}>
            <option value="">Rating: all</option>
            {["A", "B", "C", "D", "F"].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" className="h-9">
              Apply
            </Button>
            {hasFilters && (
              <Link href="/suppliers">
                <Button type="button" size="sm" variant="outline" className="h-9">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </Link>
            )}
          </div>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Code</th>
              <th className="px-3 py-2.5 text-left">Supplier</th>
              <th className="px-3 py-2.5 text-left">Category</th>
              <th className="px-3 py-2.5 text-left">ASL</th>
              <th className="px-3 py-2.5 text-center">Rating</th>
              <th className="px-3 py-2.5 text-right">OTD</th>
              <th className="px-3 py-2.5 text-right">PPM</th>
              <th className="px-3 py-2.5 text-left">Certs</th>
              <th className="px-3 py-2.5 text-right">POs</th>
              <th className="px-3 py-2.5 text-right">NCRs</th>
              <th className="px-3 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const onAsl =
                s.isApprovedVendor &&
                (s.status === "APPROVED" || s.status === "CONDITIONAL");
              const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
              const certLabels = s.certifications.map((c) => {
                const expired =
                  c.status === "EXPIRED" ||
                  (c.expiresAt && c.expiresAt < now);
                const expiringSoon =
                  !expired && !!c.expiresAt && c.expiresAt < soon;
                return {
                  type: c.certType,
                  expired: !!expired,
                  expiringSoon,
                  expiresAt: c.expiresAt,
                };
              });
              return (
                <tr
                  key={s.id}
                  className="border-t border-slate-800/60 hover:bg-slate-900/40"
                >
                  <td className="px-3 py-3 font-mono text-xs text-teal-400">
                    {s.code}
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="font-medium text-slate-100 hover:text-sky-400"
                    >
                      {s.name}
                    </Link>
                    {s.contactName && (
                      <p className="text-[11px] text-slate-500">{s.contactName}</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-400">
                    {s.category || "—"}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {onAsl ? (
                        <span className="rounded border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                          ASL
                        </span>
                      ) : (
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
                          Off
                        </span>
                      )}
                      {s.isTrialVendor && (
                        <span className="rounded border border-sky-500/40 px-1.5 py-0.5 text-[10px] text-sky-400">
                          Trial
                        </span>
                      )}
                      <StatusBadge status={s.status} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span
                      className={cn(
                        "text-lg font-bold",
                        scoreRatingColor(s.rating)
                      )}
                    >
                      {s.rating}
                    </span>
                    <p className="text-[10px] text-slate-500">{s.overallScore}</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-teal-400">
                    {s.onTimeDeliveryPct}%
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-amber-400">
                    {Math.round(s.qualityPpm)}
                  </td>
                  <td className="px-3 py-3">
                    {certLabels.length === 0 ? (
                      <span className="text-xs text-slate-600">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {certLabels.map((c, i) => (
                          <span
                            key={`${c.type}-${i}`}
                            className={cn(
                              "rounded border px-1 py-0.5 text-[10px]",
                              c.expired
                                ? "border-red-500/40 text-red-400"
                                : c.expiringSoon
                                  ? "border-amber-500/40 text-amber-400"
                                  : "border-slate-700 text-slate-400"
                            )}
                            title={
                              c.expired
                                ? `Expired${c.expiresAt ? ` ${c.expiresAt.toLocaleDateString()}` : ""} — needs re-up`
                                : c.expiringSoon
                                  ? `Expires ${c.expiresAt?.toLocaleDateString()} — re-up soon`
                                  : "Valid"
                            }
                          >
                            {c.type}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {s._count.purchaseOrders}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {s._count.ncrs}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link href={`/suppliers/${s.id}`}>
                      <Button size="sm" variant="outline">
                        Open
                      </Button>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {suppliers.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">
            No suppliers match these filters.
          </div>
        )}
      </div>

      {(policy.requireIso9001 || policy.requireAs9100d) && (
        <p className="text-xs text-slate-600">
          Policy active:{" "}
          {[
            policy.requireIso9001 && "ISO 9001",
            policy.requireAs9100d && "AS9100D",
          ]
            .filter(Boolean)
            .join(" + ")}{" "}
          required for full ASL
          {policy.allowTrialOrders
            ? ` · trial path allowed (${policy.defaultTrialLimit} PO limit)`
            : " · trial path disabled"}
          .
        </p>
      )}
    </div>
  );
}
