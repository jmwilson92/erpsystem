import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreatePmoProject } from "@/app/actions";
import { METHODOLOGIES, PROJECT_PHASES } from "@/lib/services/pmo";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function NewPmoProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const programId = Array.isArray(sp.programId)
    ? sp.programId[0]
    : sp.programId || "";
  const productId = Array.isArray(sp.productId)
    ? sp.productId[0]
    : sp.productId || "";

  const [programs, products, users] = await Promise.all([
    prisma.program.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New project"
        description="Charter setup · link program + product · methodology (waterfall / agile / hybrid)"
        actions={
          <Link href="/pmo">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />

      <form action={actionCreatePmoProject} className="space-y-4">
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Number (auto if blank)
              </label>
              <Input name="number" className="mt-1 font-mono" placeholder="PRJ-0001" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Methodology
              </label>
              <select
                name="methodology"
                className={`${selectClass} mt-1`}
                defaultValue="HYBRID"
              >
                {METHODOLOGIES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Name *
              </label>
              <Input name="name" required className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Description
              </label>
              <Textarea name="description" rows={2} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Program
              </label>
              <select
                name="programId"
                className={`${selectClass} mt-1`}
                defaultValue={programId}
              >
                <option value="">— Standalone —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Primary product (PLM)
              </label>
              <select
                name="productId"
                className={`${selectClass} mt-1`}
                defaultValue={productId}
              >
                <option value="">— None yet —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Phase</label>
              <select name="phase" className={`${selectClass} mt-1`} defaultValue="INITIATION">
                {PROJECT_PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Customer
              </label>
              <Input name="customerName" className="mt-1" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Charter (initial)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Business case
              </label>
              <Textarea name="businessCase" rows={2} className="mt-1" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Objectives
              </label>
              <Textarea name="objectives" rows={2} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Scope in
              </label>
              <Textarea name="scopeIn" rows={2} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Scope out
              </label>
              <Textarea name="scopeOut" rows={2} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Sponsor
              </label>
              <select name="sponsorId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Project manager
              </label>
              <select name="projectManagerId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Contract value
              </label>
              <Input name="contractValue" type="number" step="0.01" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Budget
              </label>
              <Input name="budgetCost" type="number" step="0.01" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Dev / NRE budget
              </label>
              <Input
                name="developmentBudget"
                type="number"
                step="0.01"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Start / End
              </label>
              <div className="mt-1 flex gap-2">
                <Input name="startDate" type="date" />
                <Input name="endDate" type="date" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit">Create project + wiki</Button>
      </form>
    </div>
  );
}
