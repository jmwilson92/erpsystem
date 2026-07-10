import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import {
  actionUpdateItem,
  actionUpsertPartVendor,
  actionUpdatePartInspectionFlags,
  actionCreateItemBom,
  actionAddBomLine,
  actionRemoveBomLine,
} from "@/app/actions";
import Link from "next/link";
import { listApprovedSuppliers } from "@/lib/services/items";

export const dynamic = "force-dynamic";

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tabRaw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = tabRaw || "general";

  const [part, uoms, accounts, approvedSuppliers, componentParts] =
    await Promise.all([
      prisma.part.findUnique({
        where: { id },
        include: {
          uomUnit: true,
          inventoryAccount: true,
          expenseAccount: true,
          cogsAccount: true,
          vendors: {
            include: { supplier: true },
            orderBy: [{ isPreferred: "desc" }, { createdAt: "asc" }],
          },
          bomHeaders: {
            orderBy: { revision: "desc" },
            include: {
              lines: {
                include: { componentPart: true },
                orderBy: { sortOrder: "asc" },
              },
            },
          },
          inventoryItems: {
            include: { location: true },
            take: 12,
            orderBy: { updatedAt: "desc" },
          },
        },
      }),
      prisma.uomUnit.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      }),
      prisma.account.findMany({
        where: { isActive: true },
        orderBy: { code: "asc" },
      }),
      listApprovedSuppliers(),
      prisma.part.findMany({
        where: { isActive: true, id: { not: id } },
        orderBy: { partNumber: "asc" },
        select: { id: true, partNumber: true, description: true },
      }),
    ]);
  if (!part) notFound();

  const editableBom = part.bomHeaders.find((b) =>
    ["DRAFT", "PROTOTYPE", "IN_REVIEW"].includes(b.status)
  );
  const nextRevSuggestion = (() => {
    if (part.bomHeaders.length === 0) return "A";
    const last = part.bomHeaders[0].revision;
    if (/^[A-Z]$/i.test(last)) {
      return String.fromCharCode(last.toUpperCase().charCodeAt(0) + 1);
    }
    return `${last}.1`;
  })();

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const tabs = [
    { id: "general", label: "General" },
    { id: "cost", label: "Cost" },
    { id: "inventory", label: "Inventory policy" },
    { id: "accounting", label: "Accounting" },
    { id: "vendors", label: "Vendors" },
    { id: "receiving", label: "Receiving" },
    { id: "bom", label: "BOMs" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title={part.partNumber}
        description={part.description}
        actions={
          <div className="flex gap-2">
            <Link href="/items">
              <Button size="sm" variant="outline">
                All items
              </Button>
            </Link>
            <Link href="/bom">
              <Button size="sm" variant="outline">
                BOMs
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={part.sourcingMethod} />
        {part.itemStructure !== "N_A" && (
          <StatusBadge status={part.itemStructure} />
        )}
        {part.isKanban && (
          <span className="rounded border border-violet-500/40 px-2 py-0.5 text-xs text-violet-300">
            Kanban {part.minStock}/{part.maxStock}
          </span>
        )}
        {part.isCritical && (
          <span className="rounded border border-amber-500/40 px-2 py-0.5 text-xs text-amber-300">
            Critical
          </span>
        )}
        <span className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400">
          Rev {part.revision} · {part.uom}
        </span>
        {!part.isActive && <StatusBadge status="INACTIVE" />}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/items/${part.id}?tab=${t.id}`}
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

      {(tab === "general" ||
        tab === "cost" ||
        tab === "accounting" ||
        tab === "inventory") && (
        <form action={actionUpdateItem} className="space-y-4">
          <input type="hidden" name="id" value={part.id} />
          <input type="hidden" name="returnTab" value={tab} />

          {tab === "general" && (
            <Card>
              <CardHeader>
                <CardTitle>General</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <FieldInput
                  label="Part number"
                  name="partNumber"
                  defaultValue={part.partNumber}
                  mono
                  required
                />
                <FieldInput
                  label="Revision"
                  name="revision"
                  defaultValue={part.revision}
                  mono
                />
                <div className="sm:col-span-2">
                  <FieldInput
                    label="Description"
                    name="description"
                    defaultValue={part.description}
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">UOM</label>
                  <select
                    name="uomUnitId"
                    className={`${selectClass} mt-1`}
                    defaultValue={part.uomUnitId || ""}
                  >
                    <option value="">Code: {part.uom}</option>
                    {uoms.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} — {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <FieldInput
                  label="Drawing #"
                  name="drawingNumber"
                  defaultValue={part.drawingNumber || ""}
                  mono
                />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Sourcing
                  </label>
                  <select
                    name="sourcingMethod"
                    className={`${selectClass} mt-1`}
                    defaultValue={part.sourcingMethod}
                  >
                    <option value="PURCHASE">Purchase (PO)</option>
                    <option value="BUILD">Build (WO)</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Structure
                  </label>
                  <select
                    name="itemStructure"
                    className={`${selectClass} mt-1`}
                    defaultValue={part.itemStructure}
                  >
                    <option value="N_A">N/A</option>
                    <option value="RAW_MATERIAL">Raw material</option>
                    <option value="SUB_ASSEMBLY">Sub-assembly</option>
                    <option value="TOP_LEVEL_ASSEMBLY">Top-level assembly</option>
                  </select>
                </div>
                <FieldInput
                  label="Lead time (days)"
                  name="leadTimeDays"
                  type="number"
                  defaultValue={String(part.leadTimeDays)}
                />
                <div className="flex flex-wrap gap-4 sm:col-span-2">
                  <Check
                    name="isSerialized"
                    label="Serialized"
                    defaultChecked={part.isSerialized}
                  />
                  <Check
                    name="isLotControlled"
                    label="Lot controlled"
                    defaultChecked={part.isLotControlled}
                  />
                  <Check
                    name="isActive"
                    label="Active"
                    defaultChecked={part.isActive}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Notes
                  </label>
                  <Textarea
                    name="notes"
                    rows={2}
                    className="mt-1"
                    defaultValue={part.notes || ""}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {tab === "cost" && (
            <Card>
              <CardHeader>
                <CardTitle>Cost</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <FieldInput
                  label="Standard cost"
                  name="standardCost"
                  type="number"
                  step="0.01"
                  defaultValue={String(part.standardCost)}
                />
                <FieldInput
                  label="Last buy cost"
                  name="lastBuyCost"
                  type="number"
                  step="0.01"
                  defaultValue={String(part.lastBuyCost)}
                />
                <FieldInput
                  label="Average cost"
                  name="averageCost"
                  type="number"
                  step="0.01"
                  defaultValue={String(part.averageCost)}
                />
                <p className="sm:col-span-3 text-xs text-slate-500">
                  Std {formatCurrency(part.standardCost)} · Last buy{" "}
                  {formatCurrency(part.lastBuyCost)} · Avg{" "}
                  {formatCurrency(part.averageCost)}
                </p>
              </CardContent>
            </Card>
          )}

          {tab === "inventory" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Replenishment policy</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-wrap gap-4 sm:col-span-2">
                    <Check
                      name="isKanban"
                      label="Kanban (min / max refill)"
                      defaultChecked={part.isKanban}
                    />
                    <Check
                      name="isCritical"
                      label="Critical / sole-source item"
                      defaultChecked={part.isCritical}
                    />
                  </div>
                  <FieldInput
                    label="Min stock (kanban reorder trigger)"
                    name="minStock"
                    type="number"
                    step="0.01"
                    defaultValue={String(part.minStock)}
                  />
                  <FieldInput
                    label="Max stock (kanban refill target)"
                    name="maxStock"
                    type="number"
                    step="0.01"
                    defaultValue={String(part.maxStock)}
                  />
                  <FieldInput
                    label="Reorder point (classic ROP)"
                    name="reorderPoint"
                    type="number"
                    step="0.01"
                    defaultValue={String(part.reorderPoint)}
                  />
                  <FieldInput
                    label="Safety stock"
                    name="safetyStock"
                    type="number"
                    step="0.01"
                    defaultValue={String(part.safetyStock)}
                  />
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      ABC class
                    </label>
                    <select
                      name="abcClass"
                      className={`${selectClass} mt-1`}
                      defaultValue={part.abcClass || ""}
                    >
                      <option value="">—</option>
                      <option value="A">A (high value / critical)</option>
                      <option value="B">B (moderate)</option>
                      <option value="C">C (low value / bulk)</option>
                    </select>
                  </div>
                  <FieldInput
                    label="Shelf life (days)"
                    name="shelfLifeDays"
                    type="number"
                    defaultValue={
                      part.shelfLifeDays != null ? String(part.shelfLifeDays) : ""
                    }
                  />
                  <p className="sm:col-span-2 text-xs text-slate-500">
                    Kanban items show on Inventory when available qty is at or
                    below min. Refill quantity is typically max − on hand.
                    Safety stock and reorder point support classic MRP-style
                    planning when kanban is off.
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Other item controls (available)</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-slate-400">
                  <ul className="list-inside list-disc space-y-1">
                    <li>
                      <strong className="text-slate-300">Serialized / lot controlled</strong>{" "}
                      — set on General tab
                    </li>
                    <li>
                      <strong className="text-slate-300">Receiving GD&amp;T / functional test</strong>{" "}
                      — Receiving tab
                    </li>
                    <li>
                      <strong className="text-slate-300">Preferred vendor + MOQ / lead time</strong>{" "}
                      — Vendors tab
                    </li>
                    <li>
                      <strong className="text-slate-300">Kanban min/max</strong> — this tab
                      (refill by bin levels)
                    </li>
                    <li>
                      <strong className="text-slate-300">Reorder point + safety stock</strong>{" "}
                      — classic pull when not using kanban
                    </li>
                    <li>
                      <strong className="text-slate-300">ABC class</strong> — inventory
                      value classification for cycle counts
                    </li>
                    <li>
                      <strong className="text-slate-300">Critical flag</strong> — highlight
                      sole-source / high-risk parts
                    </li>
                    <li>
                      <strong className="text-slate-300">Shelf life</strong> — lot expiry
                      planning for chemicals / perishables
                    </li>
                    <li>
                      <strong className="text-slate-300">Lead time</strong> — General tab
                      (purchasing planning)
                    </li>
                  </ul>
                </CardContent>
              </Card>
              {part.inventoryItems.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Current stock (snapshot)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    {part.inventoryItems.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex justify-between rounded border border-slate-800 px-2 py-1.5 text-xs"
                      >
                        <span className="text-slate-400">
                          {inv.location.code}
                        </span>
                        <span className="tabular-nums text-slate-200">
                          OH {inv.quantityOnHand} · Avail {inv.quantityAvailable}
                        </span>
                      </div>
                    ))}
                    <Link
                      href={`/inventory?q=${encodeURIComponent(part.partNumber)}`}
                      className="mt-2 inline-block text-xs text-sky-400 hover:underline"
                    >
                      Open in inventory →
                    </Link>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {tab === "accounting" && (
            <Card>
              <CardHeader>
                <CardTitle>Accounting ledger</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <AccountSelect
                  label="Inventory account"
                  name="inventoryAccountId"
                  accounts={accounts.filter((a) => a.type === "ASSET")}
                  value={part.inventoryAccountId}
                  selectClass={selectClass}
                />
                <AccountSelect
                  label="Expense account"
                  name="expenseAccountId"
                  accounts={accounts.filter((a) =>
                    ["EXPENSE", "COGS"].includes(a.type)
                  )}
                  value={part.expenseAccountId}
                  selectClass={selectClass}
                />
                <AccountSelect
                  label="COGS account"
                  name="cogsAccountId"
                  accounts={accounts.filter((a) =>
                    ["COGS", "EXPENSE"].includes(a.type)
                  )}
                  value={part.cogsAccountId}
                  selectClass={selectClass}
                />
              </CardContent>
            </Card>
          )}

          {(tab === "general" ||
            tab === "cost" ||
            tab === "accounting" ||
            tab === "inventory") && (
            <Button type="submit">Save</Button>
          )}
        </form>
      )}

      {tab === "vendors" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Vendor information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {part.vendors.length === 0 && (
                <p className="text-sm text-slate-500">
                  No vendor lines. Add an approved supplier below.
                </p>
              )}
              {part.vendors.map((v) => (
                <div
                  key={v.id}
                  className="rounded border border-slate-800 px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-200">
                      {v.supplier.name}
                    </span>
                    {v.isPreferred && <StatusBadge status="PREFERRED" />}
                    {!v.supplier.isApprovedVendor && (
                      <StatusBadge status="NOT_ON_ASL" />
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-teal-400">
                    {v.vendorPartNumber || "—"} · SKU {v.vendorSku || "—"}
                  </p>
                  <p className="text-xs text-slate-500">
                    {v.vendorDescription || ""}
                    {v.unitCost
                      ? ` · ${formatCurrency(v.unitCost)} · LT ${v.leadTimeDays}d`
                      : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-teal-900/40">
            <CardHeader>
              <CardTitle>Add vendor line</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionUpsertPartVendor} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="partId" value={part.id} />
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Approved supplier *
                  </label>
                  <select
                    name="supplierId"
                    required
                    className={`${selectClass} mt-1`}
                  >
                    <option value="">— Select ASL supplier —</option>
                    {approvedSuppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                  {approvedSuppliers.length === 0 && (
                    <p className="mt-1 text-xs text-amber-400">
                      No approved suppliers. Mark vendors on the ASL under Suppliers.
                    </p>
                  )}
                </div>
                <FieldInput label="Vendor P/N" name="vendorPartNumber" mono />
                <FieldInput label="Vendor SKU" name="vendorSku" mono />
                <div className="sm:col-span-2">
                  <FieldInput
                    label="Vendor description"
                    name="vendorDescription"
                  />
                </div>
                <FieldInput label="Manufacturer" name="manufacturer" />
                <FieldInput label="Mfr P/N" name="manufacturerPn" mono />
                <FieldInput
                  label="Unit cost"
                  name="unitCost"
                  type="number"
                  step="0.01"
                  defaultValue="0"
                />
                <FieldInput
                  label="Lead time (days)"
                  name="leadTimeDays"
                  type="number"
                  defaultValue="0"
                />
                <FieldInput
                  label="Min order qty"
                  name="minOrderQty"
                  type="number"
                  defaultValue="1"
                />
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="isPreferred"
                    className="rounded border-slate-600"
                  />
                  Preferred vendor
                </label>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Add vendor
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "receiving" && (
        <Card>
          <CardHeader>
            <CardTitle>Receiving inspection flags</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionUpdatePartInspectionFlags} className="space-y-3">
              <input type="hidden" name="partId" value={part.id} />
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="requiresGdtInspection"
                  defaultChecked={part.requiresGdtInspection}
                  className="rounded border-slate-600"
                />
                GD&amp;T / visual (routes to QA)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="requiresFunctionalTest"
                  defaultChecked={part.requiresFunctionalTest}
                  className="rounded border-slate-600"
                />
                Functional / power (routes to Test)
              </label>
              <Button type="submit" size="sm">
                Save flags
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {tab === "bom" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Linked BOMs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {part.bomHeaders.length === 0 && (
                <p className="text-sm text-slate-500">
                  No BOMs for this item yet. Create one below (BUILD items /
                  assemblies usually need a BOM).
                </p>
              )}
              {part.bomHeaders.map((b) => {
                const editable = ["DRAFT", "PROTOTYPE", "IN_REVIEW"].includes(
                  b.status
                );
                return (
                  <div
                    key={b.id}
                    className="rounded border border-slate-800 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/bom/${b.id}`}
                          className="font-mono text-teal-400 hover:underline"
                        >
                          Rev {b.revision}
                        </Link>
                        <StatusBadge status={b.status} />
                        {b.isPrototype && <StatusBadge status="PROTOTYPE" />}
                        <span className="text-xs text-slate-500">
                          {b.lines.length} component
                          {b.lines.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {b.description && (
                        <span className="text-xs text-slate-500">
                          {b.description}
                        </span>
                      )}
                    </div>
                    {b.lines.length > 0 && (
                      <table className="mt-2 w-full text-xs">
                        <thead>
                          <tr className="text-left text-[10px] uppercase text-slate-600">
                            <th className="py-1">Find</th>
                            <th className="py-1">Component</th>
                            <th className="py-1 text-right">Qty</th>
                            {editable && <th className="py-1" />}
                          </tr>
                        </thead>
                        <tbody>
                          {b.lines.map((l) => (
                            <tr
                              key={l.id}
                              className="border-t border-slate-800/50"
                            >
                              <td className="py-1 font-mono text-slate-500">
                                {l.findNumber || "—"}
                              </td>
                              <td className="py-1">
                                <Link
                                  href={`/items/${l.componentPartId}`}
                                  className="font-mono text-sky-400 hover:underline"
                                >
                                  {l.componentPart.partNumber}
                                </Link>
                                <span className="ml-2 text-slate-500">
                                  {l.componentPart.description}
                                </span>
                              </td>
                              <td className="py-1 text-right tabular-nums">
                                {l.quantity}
                              </td>
                              {editable && (
                                <td className="py-1 text-right">
                                  <form action={actionRemoveBomLine}>
                                    <input
                                      type="hidden"
                                      name="bomLineId"
                                      value={l.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="partId"
                                      value={part.id}
                                    />
                                    <input
                                      type="hidden"
                                      name="bomHeaderId"
                                      value={b.id}
                                    />
                                    <button
                                      type="submit"
                                      className="text-[10px] text-rose-400 hover:underline"
                                    >
                                      Remove
                                    </button>
                                  </form>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {!editable && (
                      <p className="mt-2 text-[10px] text-slate-600">
                        Certified/obsolete BOMs are locked — create a new
                        revision to change components.
                      </p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {editableBom && (
            <Card className="border-teal-900/40">
              <CardHeader>
                <CardTitle>
                  Add component · Rev {editableBom.revision}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  action={actionAddBomLine}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <input type="hidden" name="partId" value={part.id} />
                  <input
                    type="hidden"
                    name="bomHeaderId"
                    value={editableBom.id}
                  />
                  <div className="sm:col-span-2">
                    <label className="text-[10px] uppercase text-slate-500">
                      Component item *
                    </label>
                    <select
                      name="componentPartId"
                      required
                      className={`${selectClass} mt-1`}
                    >
                      <option value="">— Select part —</option>
                      {componentParts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.partNumber} — {c.description}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Quantity *
                    </label>
                    <Input
                      name="quantity"
                      type="number"
                      step="any"
                      defaultValue={1}
                      required
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Find #
                    </label>
                    <Input name="findNumber" className="mt-1 font-mono" />
                  </div>
                  <div className="sm:col-span-2">
                    <Button type="submit" size="sm">
                      Add to BOM
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>
                {part.bomHeaders.length === 0
                  ? "Create BOM"
                  : "New BOM revision"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateItemBom}
                className="grid gap-3 sm:grid-cols-2"
              >
                <input type="hidden" name="partId" value={part.id} />
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Revision *
                  </label>
                  <Input
                    name="revision"
                    required
                    defaultValue={nextRevSuggestion}
                    className="mt-1 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Copy lines from
                  </label>
                  <select
                    name="copyFromBomId"
                    className={`${selectClass} mt-1`}
                    defaultValue=""
                  >
                    <option value="">— Empty BOM —</option>
                    {part.bomHeaders.map((b) => (
                      <option key={b.id} value={b.id}>
                        Rev {b.revision} ({b.status})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Description
                  </label>
                  <Input
                    name="description"
                    className="mt-1"
                    placeholder="e.g. Production release"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="asPrototype"
                    className="rounded border-slate-600"
                  />
                  Mark as prototype / FAI
                </label>
                <div className="flex items-end">
                  <Button type="submit" size="sm">
                    {part.bomHeaders.length === 0
                      ? "Create BOM"
                      : "Create revision"}
                  </Button>
                </div>
              </form>
              <p className="mt-2 text-xs text-slate-600">
                New revisions are DRAFT (or PROTOTYPE). Edit components while
                unlocked, then certify from the BOM detail page for production.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function FieldInput(props: {
  label: string;
  name: string;
  defaultValue?: string;
  mono?: boolean;
  required?: boolean;
  type?: string;
  step?: string;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase text-slate-500">{props.label}</label>
      <Input
        name={props.name}
        defaultValue={props.defaultValue}
        required={props.required}
        type={props.type || "text"}
        step={props.step}
        className={`mt-1 ${props.mono ? "font-mono" : ""}`}
      />
    </div>
  );
}

function Check(props: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400">
      <input
        type="checkbox"
        name={props.name}
        defaultChecked={props.defaultChecked}
        className="rounded border-slate-600"
      />
      {props.label}
    </label>
  );
}

function AccountSelect(props: {
  label: string;
  name: string;
  accounts: { id: string; code: string; name: string }[];
  value: string | null;
  selectClass: string;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase text-slate-500">{props.label}</label>
      <select
        name={props.name}
        className={`${props.selectClass} mt-1`}
        defaultValue={props.value || ""}
      >
        <option value="">— None —</option>
        {props.accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} — {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
