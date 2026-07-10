import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateProgram } from "@/app/actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function NewProgramPage() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title="New program"
        description="Create a portfolio program that will contain projects"
        actions={
          <Link href="/pmo">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />
      <form action={actionCreateProgram} className="space-y-4">
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Program details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Code (blank = auto)
              </label>
              <Input name="code" className="mt-1 font-mono" placeholder="PRG-001" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Portfolio
              </label>
              <Input name="portfolio" className="mt-1" placeholder="Defense / Commercial" />
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
              <Textarea name="description" rows={3} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Owner
              </label>
              <select name="ownerId" className={`${selectClass} mt-1`}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Budget
              </label>
              <Input name="budgetCost" type="number" step="0.01" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Start
              </label>
              <Input name="startDate" type="date" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">End</label>
              <Input name="endDate" type="date" className="mt-1" />
            </div>
          </CardContent>
        </Card>
        <Button type="submit">Create program</Button>
      </form>
    </div>
  );
}
