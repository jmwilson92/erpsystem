import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateProduct } from "@/app/actions";
import { PRODUCT_LIFECYCLE_PHASES } from "@/lib/services/products";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function NewProductPage() {
  const [users, parts, customers] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      select: { id: true, partNumber: true, description: true, itemStructure: true },
      take: 400,
    }),
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  const engUsers = users.filter((u) =>
    ["ADMIN", "ENGINEERING", "CM", "PRODUCTION", "QUALITY"].includes(u.role)
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New product"
        description="Create a PLM product master — lifecycle, ownership, and optional CM library folder"
        actions={
          <Link href="/products">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />

      <form action={actionCreateProduct} className="space-y-4">
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Code{" "}
                <span className="normal-case text-slate-600">
                  (blank = auto PRD-####)
                </span>
              </label>
              <Input name="code" className="mt-1 font-mono" placeholder="PRD-0001" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Revision
              </label>
              <Input name="revision" defaultValue="A" className="mt-1 font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Name *
              </label>
              <Input name="name" required className="mt-1" placeholder="Control Module" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Short description
              </label>
              <Input
                name="description"
                className="mt-1"
                placeholder="One-line product summary"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Overview / what it is
              </label>
              <Textarea
                name="overview"
                rows={4}
                className="mt-1"
                placeholder="PLM narrative: purpose, capabilities, intended use, key design drivers…"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Product family
              </label>
              <Input name="productFamily" className="mt-1" placeholder="Avionics" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Product line
              </label>
              <Input name="productLine" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Model number
              </label>
              <Input name="modelNumber" className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Market segment
              </label>
              <Input name="marketSegment" className="mt-1" placeholder="Defense / Industrial" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lifecycle & ownership</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Starting phase
              </label>
              <select
                name="lifecyclePhase"
                className={`${selectClass} mt-1`}
                defaultValue="CONCEPT"
              >
                {PRODUCT_LIFECYCLE_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Status</label>
              <select name="status" className={`${selectClass} mt-1`} defaultValue="ACTIVE">
                <option value="ACTIVE">Active</option>
                <option value="ON_HOLD">On hold</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Product owner
              </label>
              <select name="productOwnerId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {engUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Engineering lead
              </label>
              <select name="engineeringLeadId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {engUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">CM owner</label>
              <select name="cmOwnerId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {users
                  .filter((u) => ["CM", "ADMIN", "ENGINEERING"].includes(u.role))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Customer</label>
              <select name="customerId" className={`${selectClass} mt-1`}>
                <option value="">— Internal / none —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Customer name{" "}
                <span className="normal-case text-slate-600">
                  (if not in CRM)
                </span>
              </label>
              <Input name="customerName" className="mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Structure & targets</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Top-level assembly (item)
              </label>
              <select name="topLevelPartId" className={`${selectClass} mt-1`}>
                <option value="">— Select finished good / TLA —</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber} — {p.description}
                    {p.itemStructure ? ` (${p.itemStructure})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Target cost
              </label>
              <Input name="targetCost" type="number" step="0.01" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Est. weight
              </label>
              <div className="mt-1 flex gap-2">
                <Input name="estimatedWeight" type="number" step="0.001" className="flex-1" />
                <Input name="weightUom" defaultValue="LB" className="w-20 font-mono" />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Target lead time (days)
              </label>
              <Input name="targetLeadDays" type="number" className="mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Compliance</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Export control
              </label>
              <select name="exportControl" className={`${selectClass} mt-1`} defaultValue="NONE">
                <option value="NONE">None</option>
                <option value="EAR">EAR</option>
                <option value="ITAR">ITAR</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  name="itarControlled"
                  className="rounded border-slate-600"
                />
                ITAR controlled
              </label>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Quality standard
              </label>
              <Input name="qualityStandard" className="mt-1" placeholder="AS9100 / ISO 9001" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">NSN</label>
              <Input name="nsn" className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">CAGE</label>
              <Input name="cageCode" className="mt-1 font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Regulatory notes
              </label>
              <Textarea name="regulatoryNotes" rows={2} className="mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                name="createCmFolder"
                value="true"
                defaultChecked
                className="rounded border-slate-600"
              />
              Create CM library product folder
            </label>
            <Button type="submit">Create product</Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
