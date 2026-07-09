import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateItem } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewItemPage() {
  const [uoms, accounts] = await Promise.all([
    prisma.uomUnit.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    }),
    prisma.account.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
  const invAccounts = accounts.filter((a) => a.type === "ASSET");
  const expAccounts = accounts.filter((a) =>
    ["EXPENSE", "COGS"].includes(a.type)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="New item"
        description="Create part number / item card"
        actions={
          <Link href="/items">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />

      <form action={actionCreateItem} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Part number *
              </label>
              <Input name="partNumber" required className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Revision
              </label>
              <Input name="revision" defaultValue="A" className="mt-1 font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Description *
              </label>
              <Input name="description" required className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">UOM *</label>
              <select name="uomUnitId" className={`${selectClass} mt-1`} required>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
                {uoms.length === 0 && <option value="">No UOMs — seed first</option>}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Drawing #
              </label>
              <Input name="drawingNumber" className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Sourcing *
              </label>
              <select
                name="sourcingMethod"
                className={`${selectClass} mt-1`}
                defaultValue="BUILD"
              >
                <option value="PURCHASE">Purchase (acquire via PO)</option>
                <option value="BUILD">Build (acquire via WO)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Structure
              </label>
              <select
                name="itemStructure"
                className={`${selectClass} mt-1`}
                defaultValue="N_A"
              >
                <option value="N_A">N/A</option>
                <option value="RAW_MATERIAL">Raw material</option>
                <option value="SUB_ASSEMBLY">Sub-assembly</option>
                <option value="TOP_LEVEL_ASSEMBLY">Top-level assembly</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Lead time (days)
              </label>
              <Input
                name="leadTimeDays"
                type="number"
                defaultValue={0}
                className="mt-1"
              />
            </div>
            <div className="flex flex-wrap items-end gap-4 pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="isSerialized"
                  className="rounded border-slate-600"
                />
                Serialized
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="isLotControlled"
                  className="rounded border-slate-600"
                />
                Lot controlled
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="isActive"
                  defaultChecked
                  className="rounded border-slate-600"
                />
                Active
              </label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Standard cost
              </label>
              <Input
                name="standardCost"
                type="number"
                step="0.01"
                defaultValue={0}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Last buy cost
              </label>
              <Input
                name="lastBuyCost"
                type="number"
                step="0.01"
                defaultValue={0}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Average cost
              </label>
              <Input
                name="averageCost"
                type="number"
                step="0.01"
                defaultValue={0}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Accounting (ledger assignment)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Inventory account
              </label>
              <select name="inventoryAccountId" className={`${selectClass} mt-1`}>
                <option value="">— None —</option>
                {invAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Expense account
              </label>
              <select name="expenseAccountId" className={`${selectClass} mt-1`}>
                <option value="">— None —</option>
                {expAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                COGS account
              </label>
              <select name="cogsAccountId" className={`${selectClass} mt-1`}>
                <option value="">— None —</option>
                {accounts
                  .filter((a) => a.type === "COGS" || a.type === "EXPENSE")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
              </select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Receiving inspection</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                name="requiresGdtInspection"
                className="rounded border-slate-600"
              />
              GD&amp;T / visual (QA)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                name="requiresFunctionalTest"
                className="rounded border-slate-600"
              />
              Functional (Test / power)
            </label>
          </CardContent>
        </Card>

        <div>
          <label className="text-[10px] uppercase text-slate-500">Notes</label>
          <Textarea name="notes" rows={2} className="mt-1" />
        </div>

        <Button type="submit">Create item</Button>
      </form>
    </div>
  );
}
