import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { actionApprovePr } from "@/app/actions";
import { ConvertPrToPoButton } from "@/components/purchasing/convert-pr-button";
import { ensureDefaultPrApprovalPolicy } from "@/lib/services/pr-approval";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { ShoppingCart, FileInput, PackageCheck, Filter, X, Search, Settings2 } from "lucide-react";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const PO_STATUSES = [
  "DRAFT",
  "APPROVED",
  "ISSUED",
  "ACKNOWLEDGED",
  "PARTIAL_RECEIPT",
  "RECEIVED",
  "INVOICED",
  "CLOSED",
  "CANCELLED",
] as const;

const PR_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "CONVERTED",
  "CANCELLED",
] as const;

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function PurchasingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") === "prs" ? "prs" : "pos";

  // Shared filter params
  const q = pick(sp, "q").trim();
  const status = pick(sp, "status");
  const supplierId = pick(sp, "supplierId");
  const projectId = pick(sp, "projectId");
  const clin = pick(sp, "clin").trim();
  const department = pick(sp, "department").trim();
  const dateFrom = pick(sp, "dateFrom");
  const dateTo = pick(sp, "dateTo");
  const eddFrom = pick(sp, "eddFrom");
  const eddTo = pick(sp, "eddTo");

  await ensureDefaultPrApprovalPolicy();
  const currentUser = await getCurrentUser();
  // Converting a PR to a PO is a purchasing function only
  const canConvertToPo =
    currentUser?.role === "ADMIN" || currentUser?.role === "PURCHASING";

  const poWhere: Prisma.PurchaseOrderWhereInput = {};
  if (status) poWhere.status = status;
  if (supplierId) poWhere.supplierId = supplierId;
  if (projectId) poWhere.projectId = projectId;
  if (clin) poWhere.clin = { contains: clin };
  if (q) {
    // Keyword search across past + present POs (header, vendor, project, lines, travelers)
    poWhere.OR = [
      { number: { contains: q } },
      { notes: { contains: q } },
      { clin: { contains: q } },
      { paymentTerms: { contains: q } },
      { shippingMethod: { contains: q } },
      { shipToAddress: { contains: q } },
      { currency: { contains: q } },
      { supplier: { name: { contains: q } } },
      { supplier: { code: { contains: q } } },
      { supplier: { contactName: { contains: q } } },
      { project: { number: { contains: q } } },
      { project: { name: { contains: q } } },
      { wbsElement: { code: { contains: q } } },
      { wbsElement: { name: { contains: q } } },
      { purchaseRequest: { number: { contains: q } } },
      { purchaseRequest: { justification: { contains: q } } },
      {
        lines: {
          some: {
            OR: [
              { description: { contains: q } },
              { part: { partNumber: { contains: q } } },
              { part: { description: { contains: q } } },
            ],
          },
        },
      },
      {
        receivingTravelers: {
          some: {
            OR: [
              { number: { contains: q } },
              { notes: { contains: q } },
            ],
          },
        },
      },
    ];
  }
  if (dateFrom || dateTo) {
    poWhere.orderDate = {};
    if (dateFrom) poWhere.orderDate.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      poWhere.orderDate.lte = end;
    }
  }
  if (eddFrom || eddTo) {
    poWhere.promisedDate = {};
    if (eddFrom) poWhere.promisedDate.gte = new Date(eddFrom);
    if (eddTo) {
      const end = new Date(eddTo);
      end.setHours(23, 59, 59, 999);
      poWhere.promisedDate.lte = end;
    }
  }

  const prWhere: Prisma.PurchaseRequestWhereInput = {};
  if (status) prWhere.status = status;
  if (supplierId) prWhere.supplierId = supplierId;
  if (department) prWhere.department = { contains: department };
  if (q) {
    prWhere.OR = [
      { number: { contains: q } },
      { justification: { contains: q } },
      { supplier: { name: { contains: q } } },
      { supplier: { code: { contains: q } } },
    ];
  }
  if (dateFrom || dateTo) {
    prWhere.neededBy = {};
    if (dateFrom) prWhere.neededBy.gte = new Date(dateFrom);
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      prWhere.neededBy.lte = end;
    }
  }
  if (projectId) {
    prWhere.workOrder = { projectId };
  }

  const [prs, pos, suppliers, projects, openPoStats, openPrCount] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: prWhere,
      orderBy: { createdAt: "desc" },
      include: {
        supplier: true,
        lines: true,
        approvalPolicy: { select: { name: true } },
        workOrder: {
          include: {
            project: { select: { number: true, name: true } },
            wbsElement: { select: { code: true, name: true } },
          },
        },
        workInstruction: {
          select: {
            id: true,
            documentNumber: true,
            revision: true,
            title: true,
          },
        },
      },
    }),
    prisma.purchaseOrder.findMany({
      where: poWhere,
      orderBy: { orderDate: "desc" },
      include: {
        supplier: true,
        project: { select: { number: true, name: true } },
        wbsElement: { select: { code: true, name: true } },
        lines: { include: { part: { select: { partNumber: true } } } },
        receivingTravelers: { select: { id: true, number: true, status: true } },
      },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "PLANNING"] } },
      orderBy: { number: "asc" },
      select: { id: true, number: true, name: true },
    }),
    // Stats ignore current filters (plant-wide)
    prisma.purchaseOrder.findMany({
      where: {
        status: { in: ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "APPROVED"] },
      },
      select: { totalAmount: true },
    }),
    prisma.purchaseRequest.count({
      where: { status: { in: ["SUBMITTED", "APPROVED"] } },
    }),
  ]);

  const openCommitments = openPoStats.reduce((s, p) => s + p.totalAmount, 0);

  // Load approval steps for submitted PRs
  const submittedPrIds = prs.filter((p) => p.status === "SUBMITTED").map((p) => p.id);
  const pendingApprovals =
    submittedPrIds.length > 0
      ? await prisma.approval.findMany({
          where: {
            entityType: "PurchaseRequest",
            entityId: { in: submittedPrIds },
          },
          include: {
            policyStep: true,
            approver: { select: { name: true } },
          },
          orderBy: { stepOrder: "asc" },
        })
      : [];
  const approvalsByPr = new Map<string, typeof pendingApprovals>();
  for (const a of pendingApprovals) {
    const list = approvalsByPr.get(a.entityId) || [];
    list.push(a);
    approvalsByPr.set(a.entityId, list);
  }

  const hasFilters = Boolean(
    q || status || supplierId || projectId || clin || department || dateFrom || dateTo || eddFrom || eddTo
  );

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchasing"
        description="Search POs past & present · multi-step PR approvals · travelers on Receiving"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/purchasing/approvals">
              <Button size="sm" variant="outline">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                Approval rules
              </Button>
            </Link>
            <Link href="/receiving">
              <Button size="sm" variant="outline">
                Receiving travelers
              </Button>
            </Link>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Open POs" value={openPoStats.length} icon={ShoppingCart} accent="teal" />
        <StatCard
          title="Open commitments"
          value={formatCurrency(openCommitments)}
          icon={FileInput}
          accent="sky"
        />
        <StatCard
          title="PRs awaiting action"
          value={openPrCount}
          icon={PackageCheck}
          accent="amber"
        />
      </div>

      {/* Tab switch (preserves filters) */}
      <div className="flex gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1 w-fit">
        <Link
          href={`/purchasing?${new URLSearchParams({
            ...Object.fromEntries(
              Object.entries({
                q,
                status,
                supplierId,
                projectId,
                clin,
                department,
                dateFrom,
                dateTo,
                eddFrom,
                eddTo,
              }).filter(([, v]) => v)
            ),
            tab: "pos",
          }).toString()}`}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm transition-colors",
            tab === "pos"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Purchase orders
          <span className="ml-1.5 text-xs text-slate-500">({pos.length})</span>
        </Link>
        <Link
          href={`/purchasing?${new URLSearchParams({
            ...Object.fromEntries(
              Object.entries({
                q,
                status,
                supplierId,
                projectId,
                clin,
                department,
                dateFrom,
                dateTo,
                eddFrom,
                eddTo,
              }).filter(([, v]) => v)
            ),
            tab: "prs",
          }).toString()}`}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm transition-colors",
            tab === "prs"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          Purchase requests
          <span className="ml-1.5 text-xs text-slate-500">({prs.length})</span>
        </Link>
      </div>

      {/* Prominent keyword search — all POs past and present */}
      <form
        method="get"
        className="rounded-xl border border-teal-900/40 bg-gradient-to-r from-slate-950 to-slate-900/80 p-4"
      >
        <input type="hidden" name="tab" value={tab} />
        {/* preserve other filters when searching */}
        {status && <input type="hidden" name="status" value={status} />}
        {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}
        {projectId && <input type="hidden" name="projectId" value={projectId} />}
        {clin && <input type="hidden" name="clin" value={clin} />}
        {department && <input type="hidden" name="department" value={department} />}
        {dateFrom && <input type="hidden" name="dateFrom" value={dateFrom} />}
        {dateTo && <input type="hidden" name="dateTo" value={dateTo} />}
        {eddFrom && <input type="hidden" name="eddFrom" value={eddFrom} />}
        {eddTo && <input type="hidden" name="eddTo" value={eddTo} />}
        <label className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-teal-500/90">
          <Search className="h-3.5 w-3.5" />
          {tab === "pos"
            ? "Search all purchase orders (past & present)"
            : "Search purchase requests"}
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="q"
            defaultValue={q}
            autoFocus={!!q}
            placeholder={
              tab === "pos"
                ? "Keywords: PO #, vendor, part number, project, CLIN, traveler, line desc…"
                : "Keywords: PR #, vendor, justification…"
            }
            className="h-11 flex-1 border-slate-700 bg-slate-950 text-base"
          />
          <Button type="submit" className="h-11 px-6">
            Search
          </Button>
          {q && (
            <Link href={`/purchasing?tab=${tab}`}>
              <Button type="button" variant="ghost" className="h-11">
                Clear
              </Button>
            </Link>
          )}
        </div>
        {q && tab === "pos" && (
          <p className="mt-2 text-xs text-slate-500">
            Showing {pos.length} PO{pos.length === 1 ? "" : "s"} matching{" "}
            <span className="font-mono text-teal-400/90">&quot;{q}&quot;</span> across
            numbers, vendors, parts, projects, travelers, and notes.
          </p>
        )}
      </form>

      {/* Filters */}
      <form
        method="get"
        className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"
      >
        <input type="hidden" name="tab" value={tab} />
        {q && <input type="hidden" name="q" value={q} />}
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <Filter className="h-3.5 w-3.5" />
          Filters
          {hasFilters && (
            <Link
              href={`/purchasing?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-sky-400 hover:underline"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Link>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-600">
              Refine keyword (synced with search bar)
            </label>
            <Input
              name="q"
              defaultValue={q}
              placeholder={tab === "pos" ? "PO #, part, vendor…" : "PR #, vendor, reason…"}
              className="mt-0.5 h-9"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-600">Status</label>
            <select name="status" defaultValue={status} className={cn(selectClass, "mt-0.5")}>
              <option value="">All statuses</option>
              {(tab === "pos" ? PO_STATUSES : PR_STATUSES).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-600">Vendor</label>
            <select
              name="supplierId"
              defaultValue={supplierId}
              className={cn(selectClass, "mt-0.5")}
            >
              <option value="">All vendors</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-600">Project</label>
            <select
              name="projectId"
              defaultValue={projectId}
              className={cn(selectClass, "mt-0.5")}
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} — {p.name}
                </option>
              ))}
            </select>
          </div>
          {tab === "pos" ? (
            <>
              <div>
                <label className="text-[10px] uppercase text-slate-600">CLIN</label>
                <Input
                  name="clin"
                  defaultValue={clin}
                  placeholder="e.g. 0001AA"
                  className="mt-0.5 h-9 font-mono"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">PO date from</label>
                <Input
                  name="dateFrom"
                  type="date"
                  defaultValue={dateFrom}
                  className="mt-0.5 h-9"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">PO date to</label>
                <Input name="dateTo" type="date" defaultValue={dateTo} className="mt-0.5 h-9" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">EDD from</label>
                <Input name="eddFrom" type="date" defaultValue={eddFrom} className="mt-0.5 h-9" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">EDD to</label>
                <Input name="eddTo" type="date" defaultValue={eddTo} className="mt-0.5 h-9" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] uppercase text-slate-600">Department</label>
                <Input
                  name="department"
                  defaultValue={department}
                  placeholder="e.g. Production"
                  className="mt-0.5 h-9"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">Need-by from</label>
                <Input
                  name="dateFrom"
                  type="date"
                  defaultValue={dateFrom}
                  className="mt-0.5 h-9"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-600">Need-by to</label>
                <Input name="dateTo" type="date" defaultValue={dateTo} className="mt-0.5 h-9" />
              </div>
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            Apply filters
          </Button>
          {hasFilters && (
            <Link href={`/purchasing?tab=${tab}`}>
              <Button type="button" size="sm" variant="ghost">
                Reset
              </Button>
            </Link>
          )}
          <span className="self-center text-xs text-slate-600">
            Showing {tab === "pos" ? pos.length : prs.length} result
            {(tab === "pos" ? pos.length : prs.length) === 1 ? "" : "s"}
          </span>
        </div>
      </form>

      {tab === "pos" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">PO #</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-left">Project / WBS / CLIN</th>
                <th className="px-3 py-2 text-left">EDD</th>
                <th className="px-3 py-2 text-left">PO date</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Traveler</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => {
                const projectLabel = po.project
                  ? `${po.project.number}${po.wbsElement ? ` / ${po.wbsElement.code}` : ""}`
                  : po.clin || "—";
                const traveler = po.receivingTravelers[0];
                return (
                  <tr
                    key={po.id}
                    className="border-t border-slate-800/70 hover:bg-slate-900/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/purchasing/po/${po.id}`}
                        className="font-mono font-medium text-teal-400 hover:underline"
                      >
                        {po.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{po.supplier.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                      {formatCurrency(po.totalAmount)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      <span className="font-mono">{projectLabel}</span>
                      {po.clin && po.project && (
                        <span className="ml-1 text-slate-600">CLIN {po.clin}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {formatDate(po.promisedDate)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {formatDate(po.orderDate)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={po.status} />
                    </td>
                    <td className="px-3 py-2">
                      {traveler ? (
                        <Link
                          href={`/receiving/${traveler.id}`}
                          className="font-mono text-xs text-sky-400 hover:underline"
                        >
                          {traveler.number}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {pos.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">
              No purchase orders match these filters.
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">PR #</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-right">Est. amount</th>
                <th className="px-3 py-2 text-left">Project / WBS</th>
                <th className="px-3 py-2 text-left">Dept</th>
                <th className="px-3 py-2 text-left">Need by</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prs.map((pr) => {
                const proj = pr.workOrder?.project;
                const wbs = pr.workOrder?.wbsElement;
                const projectLabel = proj
                  ? `${proj.number}${wbs ? ` / ${wbs.code}` : ""}`
                  : "—";
                return (
                  <tr
                    key={pr.id}
                    className="border-t border-slate-800/70 hover:bg-slate-900/50"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/purchasing/pr/${pr.id}`}
                        className="font-mono text-sky-400 hover:underline"
                      >
                        {pr.number}
                      </Link>
                      {pr.triggerSource && (
                        <StatusBadge
                          status={pr.triggerSource}
                          className="ml-1"
                        />
                      )}
                      {pr.workInstruction && (
                        <p className="text-[11px] text-amber-400/90">
                          Tool for WI{" "}
                          <Link
                            href={`/work-instructions/${pr.workInstruction.id}`}
                            className="font-mono underline"
                          >
                            {pr.workInstruction.documentNumber} Rev{" "}
                            {pr.workInstruction.revision}
                          </Link>
                          {" — "}
                          {pr.workInstruction.title}
                        </p>
                      )}
                      {pr.justification && (
                        <p className="max-w-xs truncate text-[11px] text-slate-600">
                          {pr.justification}
                        </p>
                      )}
                      {pr.triggerSource === "WI_TOOL" &&
                        pr.lines.length > 0 && (
                          <p className="text-[11px] text-slate-400">
                            Tools:{" "}
                            {pr.lines
                              .map((l) => l.description.replace(/^TOOL:\s*/i, ""))
                              .slice(0, 3)
                              .join("; ")}
                          </p>
                        )}
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {pr.supplier?.name || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(pr.totalEstimate)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {projectLabel}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {pr.department || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {formatDate(pr.neededBy)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={pr.status} />
                      {pr.status === "SUBMITTED" && (() => {
                        const steps = approvalsByPr.get(pr.id) || [];
                        if (!steps.length) {
                          return (
                            <p className="mt-1 text-[10px] text-slate-600">
                              Awaiting workflow
                            </p>
                          );
                        }
                        return (
                          <div className="mt-1 space-y-0.5">
                            {steps.map((s) => {
                              const isCurrent =
                                s.stepOrder === pr.currentStepOrder &&
                                s.status === "PENDING";
                              return (
                                <p
                                  key={s.id}
                                  className={cn(
                                    "text-[10px]",
                                    s.status === "APPROVED" && "text-emerald-500",
                                    s.status === "REJECTED" && "text-rose-400",
                                    isCurrent && "font-medium text-amber-400",
                                    !isCurrent &&
                                      s.status === "PENDING" &&
                                      "text-slate-600"
                                  )}
                                >
                                  {s.stepOrder}. {s.stage}
                                  {s.minAmount > 0
                                    ? ` (≥${formatCurrency(s.minAmount)})`
                                    : ""}
                                  {" · "}
                                  {s.status === "APPROVED"
                                    ? `✓ ${s.approver?.name || "ok"}`
                                    : isCurrent
                                      ? `needs ${s.policyStep?.approverRole || "approver"}`
                                      : s.status.toLowerCase()}
                                </p>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {pr.status === "SUBMITTED" && (() => {
                          const steps = approvalsByPr.get(pr.id) || [];
                          const current = steps.find(
                            (s) =>
                              s.stepOrder === pr.currentStepOrder &&
                              s.status === "PENDING"
                          );
                          if (!current) return null;
                          // Server page — canUserApproveStep is async; use same rules as action
                          // (approximated here: admin, assigned person, or matching role)
                          const roleOk =
                            currentUser?.role === "ADMIN" ||
                            (current.approverId
                              ? current.approverId === currentUser?.id
                              : current.policyStep?.approverRole
                                ? currentUser?.role ===
                                  current.policyStep.approverRole
                                : ["PURCHASING", "EXECUTIVE", "PM", "PRODUCTION"].includes(
                                    currentUser?.role || ""
                                  ));
                          const isRequester =
                            !!currentUser?.id &&
                            currentUser.id === pr.requestedById;
                          const canApprove = roleOk && !isRequester;
                          return (
                            <div className="flex flex-col items-end gap-1">
                              <p className="max-w-[160px] text-right text-[10px] text-slate-500">
                                Step: {current.stage}
                              </p>
                              <div className="flex gap-1">
                                {canApprove && (
                                  <form action={actionApprovePr}>
                                    <input type="hidden" name="id" value={pr.id} />
                                    <input type="hidden" name="decision" value="APPROVED" />
                                    <Button type="submit" size="sm">
                                      Approve step
                                    </Button>
                                  </form>
                                )}
                                <Link href={`/purchasing/pr/${pr.id}`}>
                                  <Button size="sm" variant="outline">
                                    {canApprove ? "Review / reject" : "View"}
                                  </Button>
                                </Link>
                              </div>
                            </div>
                          );
                        })()}
                        {pr.status === "APPROVED" &&
                          pr.supplierId &&
                          pr.supplier &&
                          canConvertToPo &&
                          (() => {
                            const aslOk =
                              pr.supplier.isApprovedVendor &&
                              (pr.supplier.status === "APPROVED" ||
                                pr.supplier.status === "CONDITIONAL");
                            if (!aslOk) {
                              return (
                                <p className="text-[11px] text-amber-400">
                                  Vendor not on ASL — cannot convert to PO
                                </p>
                              );
                            }
                            return <ConvertPrToPoButton prId={pr.id} />;
                          })()}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {prs.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500">
              No purchase requests match these filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
