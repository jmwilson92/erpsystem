import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  listGfpByContract,
  listGfpContracts,
  listMasterDd1149,
  listPendingGfpConsumptions,
  listUpcomingGfpAudits,
  listGfpCheckoutHistory,
  searchGfpItems,
} from "@/lib/services/gfp";
import {
  actionAttachGfpDocument,
  actionSetGfpAuditInterval,
  actionCompleteGfpAudit,
  actionCheckoutGfp,
  actionCheckinGfp,
  actionRequestGfpConsumption,
  actionDecideGfpConsumption,
} from "@/app/actions";
import {
  Shield,
  FileText,
  Clock,
  Package,
  Search,
  History,
} from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function GovPropertyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const contract = pick(sp, "contract");
  const tab = pick(sp, "tab") || "items";
  const q = pick(sp, "q").trim();
  const expand = pick(sp, "expand");

  const [
    contracts,
    properties,
    dd1149s,
    pendingConsumptions,
    upcomingAudits,
    checkoutHistory,
    users,
    workOrders,
  ] = await Promise.all([
    listGfpContracts(),
    q ? searchGfpItems(q) : listGfpByContract(contract || null),
    listMasterDd1149(contract || null),
    listPendingGfpConsumptions(),
    listUpcomingGfpAudits(20),
    listGfpCheckoutHistory({
      contractNumber: contract || undefined,
      q: q || undefined,
      limit: 100,
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    prisma.workOrder.findMany({
      where: { status: { notIn: ["COMPLETED", "CANCELLED", "CLOSED"] } },
      orderBy: { number: "desc" },
      take: 80,
      select: { id: true, number: true, description: true },
    }),
  ]);

  const gfp = properties.filter((p) => p.propertyType === "GFP").length;
  const cap = properties.filter((p) => p.propertyType === "CAP").length;
  const checkedOut = properties.filter((p) => p.status === "CHECKED_OUT").length;
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  const tabHref = (t: string) => {
    const p = new URLSearchParams();
    if (contract) p.set("contract", contract);
    if (q) p.set("q", q);
    p.set("tab", t);
    return `/government-property?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Government Property" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="GFP Assets" value={gfp} icon={Shield} accent="violet" />
        <StatCard title="CAP Assets" value={cap} icon={Shield} accent="sky" />
        <StatCard
          title="Lines shown"
          value={properties.length}
          icon={Package}
          accent="teal"
        />
        <StatCard
          title="Checked out"
          value={checkedOut}
          icon={Package}
          accent="amber"
        />
        <StatCard
          title="Pending consume"
          value={pendingConsumptions.length}
          icon={Clock}
          accent="red"
        />
      </div>

      {/* Search + contracts */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <form method="get" className="flex flex-wrap gap-2">
            {contract && <input type="hidden" name="contract" value={contract} />}
            <input type="hidden" name="tab" value={tab} />
            <div className="relative min-w-[16rem] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                name="q"
                defaultValue={q}
                placeholder="Search asset tag, serial, UID, part, contract, location…"
                className="pl-9"
              />
            </div>
            <Button type="submit" size="sm">
              Search
            </Button>
            {q && (
              <Link href={tabHref(tab).replace(/([?&])q=[^&]*/, "").replace(/\?$/, "") || "/government-property"}>
                <Button type="button" size="sm" variant="outline">
                  Clear search
                </Button>
              </Link>
            )}
          </form>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/government-property?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className={`rounded border px-2 py-1 text-xs ${
                !contract
                  ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                  : "border-slate-700 text-slate-400"
              }`}
            >
              All contracts
            </Link>
            {contracts.map((c) => (
              <Link
                key={c}
                href={`/government-property?contract=${encodeURIComponent(c)}&tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`rounded border px-2 py-1 font-mono text-xs ${
                  contract === c
                    ? "border-violet-500/50 bg-violet-500/10 text-violet-200"
                    : "border-slate-700 text-slate-400"
                }`}
              >
                {c}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {(
          [
            { id: "items", label: "Inventory lines" },
            { id: "dd1149", label: "Master DD1149" },
            { id: "audits", label: "Audit schedule" },
            { id: "history", label: "Checkout history" },
            { id: "reports", label: "Reports" },
            { id: "consume", label: "Consumption approvals" },
          ] as const
        ).map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
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

      {/* ─── Line-item inventory style ─────────────────────── */}
      {tab === "items" && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/80 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Asset / tag</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Contract</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Checked out to</th>
                  <th className="px-3 py-2">Expected return</th>
                  <th className="px-3 py-2">Cost</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {properties.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      No government property matches.
                    </td>
                  </tr>
                )}
                {properties.map((prop) => {
                  const openCo = prop.checkouts?.find((c) => c.status === "OPEN");
                  const isOpen = expand === prop.id;
                  return (
                    <Fragment key={prop.id}>
                      <tr
                        className={`border-b border-slate-900/80 ${
                          prop.propertyType === "GFP"
                            ? "bg-violet-500/[0.03]"
                            : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/government-property/${prop.id}`}
                            className="font-mono font-semibold text-violet-400 hover:underline"
                          >
                            {prop.assetTag}
                          </Link>
                          <p className="font-mono text-[10px] text-slate-600">
                            {prop.serialNumber || prop.uid || "—"}
                          </p>
                        </td>
                        <td className="max-w-[14rem] px-3 py-2 text-slate-300">
                          {prop.description}
                          {prop.partNumber && (
                            <p className="text-[10px] text-slate-500">
                              PN {prop.partNumber}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={prop.propertyType} />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={prop.status} />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-400">
                          {prop.contractNumber || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {prop.location || "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {prop.checkedOutTo || openCo?.checkedOutBy ? (
                            <div>
                              <p className="font-medium text-amber-300">
                                {(prop.checkedOutTo || openCo?.checkedOutBy)
                                  ?.name}
                              </p>
                              {openCo?.checkedOutAt && (
                                <p className="text-[10px] text-slate-500">
                                  since {formatDate(openCo.checkedOutAt)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-400">
                          {openCo?.expectedReturn
                            ? formatDate(openCo.expectedReturn)
                            : "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-300">
                          {formatCurrency(prop.acquisitionCost)}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            href={`/government-property?${new URLSearchParams({
                              ...(contract ? { contract } : {}),
                              ...(q ? { q } : {}),
                              tab: "items",
                              expand: isOpen ? "" : prop.id,
                            }).toString()}`}
                          >
                            <Button size="sm" variant="outline">
                              {isOpen ? "Close" : "Open"}
                            </Button>
                          </Link>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-slate-800 bg-slate-950/60">
                          <td colSpan={10} className="px-4 py-4">
                            <GfpDetailPanel
                              prop={prop}
                              users={users}
                              workOrders={workOrders}
                              selectClass={selectClass}
                              openCo={openCo}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "history" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Check-out / check-in trail
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Asset</th>
                  <th className="px-2 py-1">Checked out by</th>
                  <th className="px-2 py-1">Out</th>
                  <th className="px-2 py-1">Expected</th>
                  <th className="px-2 py-1">In by</th>
                  <th className="px-2 py-1">In</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Purpose / notes</th>
                </tr>
              </thead>
              <tbody>
                {checkoutHistory.map((h) => (
                  <tr key={h.id} className="border-t border-slate-900">
                    <td className="px-2 py-2">
                      <span className="font-mono text-violet-400">
                        {h.property.assetTag}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      {h.checkedOutBy.name}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {formatDate(h.checkedOutAt)}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {h.expectedReturn ? formatDate(h.expectedReturn) : "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      {h.checkedInBy?.name || "—"}
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-500">
                      {h.checkedInAt ? formatDate(h.checkedInAt) : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <StatusBadge status={h.status} />
                    </td>
                    <td className="max-w-xs px-2 py-2 text-xs text-slate-500">
                      {h.purpose || h.checkedInNotes || "—"}
                    </td>
                  </tr>
                ))}
                {!checkoutHistory.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-slate-500">
                      No checkout history yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {tab === "reports" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">GFP inventory status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(
                [
                  "ACTIVE",
                  "IN_USE",
                  "IN_STORAGE",
                  "CHECKED_OUT",
                  "CONSUMED",
                  "DISPOSED",
                ] as const
              ).map((st) => {
                const n = properties.filter((p) => p.status === st).length;
                return (
                  <div
                    key={st}
                    className="flex items-center justify-between border-b border-slate-900 py-1.5"
                  >
                    <StatusBadge status={st} />
                    <span className="font-mono tabular-nums text-slate-200">
                      {n}
                    </span>
                  </div>
                );
              })}
              <div className="flex justify-between pt-2 font-medium">
                <span>Total lines</span>
                <span className="font-mono">{properties.length}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>Acquisition value</span>
                <span className="font-mono">
                  {formatCurrency(
                    properties.reduce((s, p) => s + (p.acquisitionCost || 0), 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Checkout activity summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Open checkouts</span>
                <span className="font-mono">
                  {checkoutHistory.filter((h) => h.status === "OPEN").length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Returned (internal)</span>
                <span className="font-mono">
                  {checkoutHistory.filter((h) => h.status === "RETURNED").length}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Returned to government</span>
                <span className="font-mono">
                  {
                    checkoutHistory.filter(
                      (h) => h.status === "RETURNED_TO_GOVERNMENT"
                    ).length
                  }
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Transferred to company</span>
                <span className="font-mono">
                  {
                    checkoutHistory.filter(
                      (h) => h.status === "TRANSFERRED_TO_COMPANY"
                    ).length
                  }
                </span>
              </div>
              <p className="pt-2 text-xs text-slate-500">
                Full trail is on the Checkout history tab. Filter by contract or
                search to narrow the report.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "dd1149" && (
        <div className="space-y-3">
          {dd1149s.map((d) => (
            <Card key={d.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                <div>
                  <p className="font-mono text-violet-300">
                    {d.formNumber || d.fileName || d.id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {d.contractNumber || "—"}
                    {d.property ? ` · ${d.property.assetTag}` : ""}
                    {` · ${formatDate(d.uploadedAt)}`}
                  </p>
                </div>
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline"
                >
                  Open
                </a>
              </CardContent>
            </Card>
          ))}
          {!dd1149s.length && (
            <p className="text-sm text-slate-500">No DD1149 forms on file.</p>
          )}
        </div>
      )}

      {tab === "audits" && (
        <div className="space-y-2">
          {upcomingAudits.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <span className="font-mono text-violet-400">
                    {a.property.assetTag}
                  </span>
                  <span className="ml-2">
                    <StatusBadge status={a.status} />
                  </span>
                  <p className="text-xs text-slate-500">
                    Due {formatDate(a.scheduledFor)} ·{" "}
                    {a.property.contractNumber || "—"}
                  </p>
                </div>
                <form action={actionCompleteGfpAudit} className="flex gap-2">
                  <input type="hidden" name="auditId" value={a.id} />
                  <input type="hidden" name="propertyId" value={a.property.id} />
                  <input type="hidden" name="result" value="PASS" />
                  <Button type="submit" size="sm">
                    Mark pass
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          {!upcomingAudits.length && (
            <p className="text-sm text-slate-500">No scheduled audits.</p>
          )}
        </div>
      )}

      {tab === "consume" && (
        <div className="space-y-3">
          {pendingConsumptions.map((c) => (
            <Card key={c.id} className="border-rose-500/20">
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-violet-400">
                    {c.property.assetTag}
                  </span>
                  <StatusBadge status={c.status} />
                  {c.workOrder && (
                    <Link
                      href={`/work-orders/${c.workOrder.id}`}
                      className="font-mono text-sm text-sky-400"
                    >
                      {c.workOrder.number}
                    </Link>
                  )}
                </div>
                <form
                  action={actionDecideGfpConsumption}
                  className="flex flex-wrap items-end gap-2"
                >
                  <input type="hidden" name="consumptionId" value={c.id} />
                  <Input
                    name="pinCode"
                    type="password"
                    required
                    placeholder="PM PIN *"
                    className="w-28 font-mono"
                  />
                  <Input
                    name="approvalNotes"
                    placeholder="Notes (required to reject)"
                    className="w-48"
                  />
                  <Button type="submit" name="approve" value="true" size="sm">
                    Approve
                  </Button>
                  <Button
                    type="submit"
                    name="approve"
                    value="false"
                    size="sm"
                    variant="outline"
                  >
                    Reject
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          {!pendingConsumptions.length && (
            <p className="text-sm text-slate-500">No pending consumptions.</p>
          )}
        </div>
      )}
    </div>
  );
}

function GfpDetailPanel({
  prop,
  users,
  workOrders,
  selectClass,
  openCo,
}: {
  prop: Awaited<ReturnType<typeof listGfpByContract>>[0];
  users: { id: string; name: string; role: string }[];
  workOrders: { id: string; number: string; description: string | null }[];
  selectClass: string;
  openCo?: {
    id: string;
    expectedReturn: Date | null;
    purpose: string | null;
    checkedOutBy: { name: string };
    checkedOutAt: Date;
  };
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Field label="UID" value={prop.uid || "—"} mono />
        <Field label="Serial" value={prop.serialNumber || "—"} mono />
        <Field label="Custodial" value={prop.custodialCode || "—"} />
        <Field label="Condition" value={prop.condition} />
        <Field
          label="Last inventory"
          value={formatDate(prop.lastInventoryDate)}
        />
        <Field
          label="Next audit"
          value={formatDate(prop.nextAuditDue)}
        />
        <Field
          label="Audit interval"
          value={`${prop.auditIntervalDays} days`}
        />
        <Field
          label="DFARS"
          value={prop.dfarsCompliant ? "Compliant" : "Non-compliant"}
        />
      </div>

      {openCo && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-amber-200">
            Currently checked out to {openCo.checkedOutBy.name}
          </p>
          <p className="text-xs text-slate-400">
            Since {formatDate(openCo.checkedOutAt)}
            {openCo.expectedReturn
              ? ` · Expected return ${formatDate(openCo.expectedReturn)}`
              : ""}
            {openCo.purpose ? ` · ${openCo.purpose}` : ""}
          </p>
        </div>
      )}

      {/* Checkout trail */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase text-slate-500">
          Traceability trail
        </p>
        {prop.checkouts?.length ? (
          <ol className="space-y-1 border-l border-slate-800 pl-3 text-xs text-slate-400">
            {prop.checkouts.map((h) => (
              <li key={h.id}>
                <StatusBadge status={h.status} />{" "}
                Out: {h.checkedOutBy.name} {formatDate(h.checkedOutAt)}
                {h.expectedReturn
                  ? ` · due ${formatDate(h.expectedReturn)}`
                  : ""}
                {h.checkedInAt
                  ? ` · In: ${h.checkedInBy?.name || "—"} ${formatDate(h.checkedInAt)}`
                  : ""}
                {h.purpose ? ` · ${h.purpose}` : ""}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-slate-600">No checkout events yet.</p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {prop.status === "CHECKED_OUT" || openCo ? (
          <div className="space-y-2 rounded border border-slate-800 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">
              Return options
            </p>
            <form action={actionCheckinGfp} className="flex flex-wrap gap-2">
              <input type="hidden" name="propertyId" value={prop.id} />
              <input type="hidden" name="disposition" value="CHECKIN" />
              <Input name="notes" placeholder="Check-in notes" className="flex-1" />
              <Button type="submit" size="sm">
                Check in
              </Button>
            </form>
            <form action={actionCheckinGfp} className="flex flex-wrap gap-2">
              <input type="hidden" name="propertyId" value={prop.id} />
              <input type="hidden" name="disposition" value="RETURN_TO_GOV" />
              <Input
                name="notes"
                placeholder="Government return notes"
                className="flex-1"
              />
              <Button type="submit" size="sm" variant="outline">
                Return to government
              </Button>
            </form>
            <form action={actionCheckinGfp} className="flex flex-wrap gap-2">
              <input type="hidden" name="propertyId" value={prop.id} />
              <input type="hidden" name="disposition" value="TRANSFER_COMPANY" />
              <Input
                name="notes"
                placeholder="Transfer approval notes"
                className="flex-1"
              />
              <Button type="submit" size="sm" variant="secondary">
                Transfer to company-owned
              </Button>
            </form>
          </div>
        ) : (
          !["CONSUMED", "DISPOSED"].includes(prop.status) && (
            <div className="space-y-2 rounded border border-slate-800 p-3">
              <form
                action={actionCheckoutGfp}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="propertyId" value={prop.id} />
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Check out to
                  </label>
                  <select
                    name="checkedOutById"
                    className={`${selectClass} mt-1`}
                    required
                  >
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>
                <Input name="purpose" placeholder="Purpose" />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Expected return
                  </label>
                  <Input name="expectedReturn" type="date" className="mt-1" />
                </div>
                <Button type="submit" size="sm" className="sm:col-span-2">
                  Check out
                </Button>
              </form>
              <div className="border-t border-slate-800 pt-2">
                <p className="mb-1 text-[10px] uppercase text-slate-500">
                  Or dispose without checkout
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={actionCheckinGfp}>
                    <input type="hidden" name="propertyId" value={prop.id} />
                    <input
                      type="hidden"
                      name="disposition"
                      value="RETURN_TO_GOV"
                    />
                    <Button type="submit" size="sm" variant="outline">
                      Return to government
                    </Button>
                  </form>
                  <form action={actionCheckinGfp}>
                    <input type="hidden" name="propertyId" value={prop.id} />
                    <input
                      type="hidden"
                      name="disposition"
                      value="TRANSFER_COMPANY"
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      Transfer to company
                    </Button>
                  </form>
                </div>
              </div>
            </div>
          )
        )}

        <div className="space-y-2 rounded border border-slate-800 p-3">
          <form
            action={actionAttachGfpDocument}
            className="grid gap-2 sm:grid-cols-2"
          >
            <input type="hidden" name="propertyId" value={prop.id} />
            <input type="hidden" name="docType" value="DD1149" />
            <Input name="formNumber" placeholder="DD1149 #" />
            <Input name="fileName" placeholder="File name" />
            <Input name="url" placeholder="URL *" required className="sm:col-span-2" />
            <Button type="submit" size="sm">
              <FileText className="mr-1 h-3.5 w-3.5" />
              Attach DD1149
            </Button>
          </form>
          <form
            action={actionSetGfpAuditInterval}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="propertyId" value={prop.id} />
            <Input
              name="auditIntervalDays"
              type="number"
              defaultValue={prop.auditIntervalDays || 90}
              className="w-24"
            />
            <Button type="submit" size="sm" variant="outline">
              Set audit days
            </Button>
          </form>
          {!["CONSUMED", "DISPOSED"].includes(prop.status) && (
            <form
              action={actionRequestGfpConsumption}
              className="grid gap-2 sm:grid-cols-2 border-t border-slate-800 pt-2"
            >
              <input type="hidden" name="propertyId" value={prop.id} />
              <select name="workOrderId" className={selectClass} required>
                <option value="">— Work order —</option>
                {workOrders.map((wo) => (
                  <option key={wo.id} value={wo.id}>
                    {wo.number}
                  </option>
                ))}
              </select>
              <Input name="quantity" type="number" defaultValue={1} />
              <Input name="reason" placeholder="Reason" className="sm:col-span-2" />
              <Button type="submit" size="sm" variant="outline">
                Request consumption
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      <p className={`text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </p>
    </div>
  );
}
