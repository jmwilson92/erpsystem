import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionCreateTestProcedure } from "@/app/actions";
import { FlaskConical, Plus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

const selectClass =
  "h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function TestProceduresPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [procedures, parts] = await Promise.all([
    prisma.testProcedure.findMany({
      include: {
        part: { select: { partNumber: true } },
        steps: { orderBy: { sortOrder: "asc" } },
        _count: { select: { wiSteps: true, functionalForParts: true } },
      },
      orderBy: [{ number: "asc" }, { revision: "desc" }],
    }),
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      select: { id: true, partNumber: true, description: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Test Procedures"
        description="CM-controlled test procedures (ATP, functional, burn-in). Released procedures are locked and called out by work-instruction steps and receiving functional-test requirements."
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <FlaskConical className="h-4 w-4 text-teal-400" />
            {procedures.length} procedure{procedures.length === 1 ? "" : "s"}
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">New test procedure</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={actionCreateTestProcedure}
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Input
              name="title"
              required
              placeholder="Title (e.g. ACM Acceptance Test)"
              className="h-9 lg:col-span-2"
            />
            <select name="category" className={selectClass} defaultValue="FUNCTIONAL">
              <option value="FUNCTIONAL">Functional</option>
              <option value="ATP">ATP</option>
              <option value="BURN_IN">Burn-in</option>
              <option value="ENVIRONMENTAL">Environmental</option>
              <option value="INSPECTION">Inspection</option>
            </select>
            <select name="partId" className={selectClass} defaultValue="">
              <option value="">Part (optional)</option>
              {parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.partNumber}
                </option>
              ))}
            </select>
            <Input
              name="equipment"
              placeholder="Required equipment"
              className="h-9 lg:col-span-2"
            />
            <Input name="purpose" placeholder="Purpose" className="h-9 lg:col-span-2" />
            <Button type="submit" size="sm" className="h-9 lg:col-span-4 lg:w-fit">
              <Plus className="mr-1 h-4 w-4" />
              Create procedure
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <div className="grid grid-cols-[8rem_1fr_7rem_5rem_minmax(9rem,1fr)] gap-x-2 border-b border-slate-800 bg-slate-900/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <span>Number</span>
          <span>Title</span>
          <span>Category</span>
          <span className="text-center">Steps</span>
          <span>Called by</span>
        </div>
        {procedures.map((tp) => (
          <Link
            key={tp.id}
            href={`/test-procedures/${tp.id}`}
            className="grid grid-cols-[8rem_1fr_7rem_5rem_minmax(9rem,1fr)] items-center gap-x-2 border-b border-slate-900/70 px-3 py-2 text-sm transition-colors last:border-0 hover:bg-slate-900/40"
          >
            <span className="font-mono text-xs text-teal-400">
              {tp.number} <span className="text-slate-600">R{tp.revision}</span>
            </span>
            <span className="flex items-center gap-2 truncate text-slate-200">
              {tp.title}
              <StatusBadge status={tp.status} className="text-[9px]" />
            </span>
            <span className="text-xs text-slate-400">
              {tp.category.replace(/_/g, " ")}
            </span>
            <span className="text-center text-xs tabular-nums text-slate-400">
              {tp.steps.length}
            </span>
            <span className="truncate text-[11px] text-slate-500">
              {tp._count.wiSteps} WI · {tp._count.functionalForParts} receiving
            </span>
          </Link>
        ))}
        {procedures.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">
            No test procedures yet. Create one above.
          </div>
        )}
      </div>
    </div>
  );
}
