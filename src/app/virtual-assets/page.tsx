import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatCurrency } from "@/lib/utils";
import { listVirtualAssets } from "@/lib/services/virtual-assets";
import {
  actionCreateVirtualAsset,
  actionAssignVirtualAsset,
  actionCheckoutVirtualAsset,
  actionReturnVirtualAsset,
  actionUnassignVirtualAsset,
} from "@/app/actions";
import { listUsers } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Monitor, KeyRound, Package } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function VirtualAssetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const programId = pick(sp, "programId");
  const projectId = pick(sp, "projectId");
  const salesOrderId = pick(sp, "salesOrderId");
  const productId = pick(sp, "productId");
  const usageType = pick(sp, "usageType");
  const q = pick(sp, "q").trim();

  const [assets, users, products, programs, projects, salesOrders] =
    await Promise.all([
      listVirtualAssets({
        programId: programId || undefined,
        projectId: projectId || undefined,
        salesOrderId: salesOrderId || undefined,
        productId: productId || undefined,
        usageType: usageType || undefined,
        q: q || undefined,
      }),
      listUsers(),
      prisma.product.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
        take: 100,
      }),
      prisma.program.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.project.findMany({
        where: { status: { in: ["ACTIVE", "PLANNING"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
      }),
      prisma.salesOrder.findMany({
        orderBy: { number: "desc" },
        take: 80,
        select: { id: true, number: true },
      }),
    ]);

  const available = assets.filter((a) => a.status === "AVAILABLE").length;
  const assigned = assets.filter((a) => a.status === "ASSIGNED").length;
  const checkedOut = assets.filter((a) => a.status === "CHECKED_OUT").length;
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader title="License / Virtual Assets" />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Available" value={available} icon={Package} accent="teal" />
        <StatCard title="Assigned" value={assigned} icon={KeyRound} accent="sky" />
        <StatCard
          title="Checked out"
          value={checkedOut}
          icon={Monitor}
          accent="amber"
        />
      </div>

      <Card>
        <CardContent className="p-3">
          <form method="get" className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Input name="q" defaultValue={q} placeholder="Search licenses…" />
            <select name="usageType" defaultValue={usageType} className={selectClass}>
              <option value="">All use types</option>
              <option value="INTERNAL">Internal</option>
              <option value="SOLD">Sold / shipped</option>
            </select>
            <select name="programId" defaultValue={programId} className={selectClass}>
              <option value="">All programs</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
            <select name="projectId" defaultValue={projectId} className={selectClass}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number}
                </option>
              ))}
            </select>
            <select
              name="salesOrderId"
              defaultValue={salesOrderId}
              className={selectClass}
            >
              <option value="">All sales orders</option>
              {salesOrders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number}
                </option>
              ))}
            </select>
            <Button type="submit" size="sm">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add license / virtual asset</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={actionCreateVirtualAsset}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
          >
            <Input name="name" placeholder="Name *" required />
            <select name="assetType" className={selectClass} defaultValue="LICENSE">
              <option value="LICENSE">License</option>
              <option value="DOWNLOAD">Download</option>
              <option value="SUBSCRIPTION">Subscription</option>
              <option value="DIGITAL">Digital</option>
              <option value="OTHER">Other</option>
            </select>
            <select name="usageType" className={selectClass} defaultValue="INTERNAL">
              <option value="INTERNAL">Internal use</option>
              <option value="SOLD">Sold / customer deliverable</option>
            </select>
            <Input name="vendor" placeholder="Vendor" />
            <Input name="licenseKey" placeholder="License key" />
            <Input name="computerName" placeholder="Computer / host" />
            <Input name="seats" type="number" min={1} placeholder="Seats" />
            <Input name="cost" type="number" step="any" placeholder="Cost" />
            <Input name="expiresAt" type="date" />
            <select name="productId" className={selectClass}>
              <option value="">— Product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} {p.name}
                </option>
              ))}
            </select>
            <select name="programId" className={selectClass}>
              <option value="">— Program —</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
            <select name="projectId" className={selectClass}>
              <option value="">— Project —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number}
                </option>
              ))}
            </select>
            <select name="salesOrderId" className={selectClass}>
              <option value="">— Sales order —</option>
              {salesOrders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number}
                </option>
              ))}
            </select>
            <Input
              name="description"
              placeholder="Description"
              className="sm:col-span-2"
            />
            <Button type="submit" size="sm">
              Create
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {assets.map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/virtual-assets/${a.id}`}>
                  <CardTitle className="font-mono text-sky-400 hover:underline">
                    {a.assetTag}
                  </CardTitle>
                </Link>
                <StatusBadge status={a.assetType} />
                <StatusBadge status={a.usageType} />
                <StatusBadge status={a.status} />
              </div>
              <p className="text-sm text-slate-300">{a.name}</p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Vendor" value={a.vendor || "—"} />
                <Field
                  label="Seats"
                  value={a.seats != null ? `${a.seatsUsed}/${a.seats}` : "—"}
                />
                <Field label="Cost" value={formatCurrency(a.cost)} />
                <Field
                  label="Expires"
                  value={a.expiresAt ? formatDate(a.expiresAt) : "—"}
                />
                <Field label="Computer" value={a.computerName || "—"} mono />
                <Field
                  label="Product"
                  value={
                    a.product ? `${a.product.code} ${a.product.name}` : "—"
                  }
                />
                <Field
                  label="Program / Project"
                  value={
                    [
                      a.program?.code,
                      a.project ? a.project.number : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"
                  }
                />
                <Field
                  label="Sales order"
                  value={a.salesOrder?.number || "—"}
                />
                <Field label="Assigned to" value={a.assignedTo?.name || "—"} />
                <Field
                  label="Checked out to"
                  value={a.checkedOutTo?.name || "—"}
                />
                <Field label="License key" value={a.licenseKey || "—"} mono />
              </div>

              <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                {!a.assignedToId &&
                  !["RETIRED", "EXPIRED"].includes(a.status) && (
                    <form
                      action={actionAssignVirtualAsset}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="assetId" value={a.id} />
                      <select
                        name="userId"
                        required
                        className={`${selectClass} min-w-[10rem]`}
                      >
                        <option value="">— Assign user —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm" variant="outline">
                        Assign
                      </Button>
                    </form>
                  )}
                {a.assignedToId && (
                  <form action={actionUnassignVirtualAsset}>
                    <input type="hidden" name="assetId" value={a.id} />
                    <Button type="submit" size="sm" variant="outline">
                      Unassign
                    </Button>
                  </form>
                )}
                {!a.checkedOutToId &&
                  !["RETIRED", "EXPIRED"].includes(a.status) && (
                    <form
                      action={actionCheckoutVirtualAsset}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <input type="hidden" name="assetId" value={a.id} />
                      <select
                        name="userId"
                        required
                        className={`${selectClass} min-w-[10rem]`}
                      >
                        <option value="">— Checkout —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" size="sm">
                        Check out
                      </Button>
                    </form>
                  )}
                {a.checkedOutToId && (
                  <form action={actionReturnVirtualAsset}>
                    <input type="hidden" name="assetId" value={a.id} />
                    <Button type="submit" size="sm">
                      Return
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {!assets.length && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No licenses match these filters.{" "}
              <Link href="/virtual-assets" className="text-sky-400">
                Clear filters
              </Link>
            </CardContent>
          </Card>
        )}
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
