import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionCreateTestProcedure,
  actionAddTestProcedureStep,
  actionReleaseTestProcedure,
} from "@/app/actions";
import { FlaskConical, Plus } from "lucide-react";

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

      <div className="space-y-3">
        {procedures.map((tp) => {
          const released = tp.status === "RELEASED";
          return (
            <Card key={tp.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span className="font-mono text-sm text-teal-400">
                      {tp.number} Rev {tp.revision}
                    </span>
                    {tp.title}
                    <StatusBadge status={tp.status} />
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {tp.category.replace(/_/g, " ")}
                    </span>
                  </CardTitle>
                  {!released && (
                    <form action={actionReleaseTestProcedure}>
                      <input type="hidden" name="testProcedureId" value={tp.id} />
                      <Button type="submit" size="sm">
                        Release (CM)
                      </Button>
                    </form>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {tp.part ? `Part ${tp.part.partNumber} · ` : ""}
                  {tp.equipment ? `${tp.equipment} · ` : ""}
                  {tp._count.wiSteps} WI step
                  {tp._count.wiSteps === 1 ? "" : "s"} call this out ·{" "}
                  {tp._count.functionalForParts} part
                  {tp._count.functionalForParts === 1 ? "" : "s"} require it at
                  receiving
                </p>
              </CardHeader>
              <CardContent>
                {tp.steps.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wider text-slate-500">
                          <th className="px-2 py-1">#</th>
                          <th className="px-2 py-1">Parameter</th>
                          <th className="px-2 py-1">Method</th>
                          <th className="px-2 py-1">Spec</th>
                          <th className="px-2 py-1 text-right">Min</th>
                          <th className="px-2 py-1 text-right">Max</th>
                          <th className="px-2 py-1">Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tp.steps.map((s) => (
                          <tr key={s.id} className="border-b border-slate-900/60">
                            <td className="px-2 py-1 text-slate-500">{s.stepNumber}</td>
                            <td className="px-2 py-1 text-slate-200">{s.parameter}</td>
                            <td className="px-2 py-1 text-slate-400">{s.method || "—"}</td>
                            <td className="px-2 py-1 text-slate-400">{s.spec || "—"}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-400">
                              {s.minValue ?? "—"}
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums text-slate-400">
                              {s.maxValue ?? "—"}
                            </td>
                            <td className="px-2 py-1 text-slate-400">{s.units || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {!released && (
                  <form
                    action={actionAddTestProcedureStep}
                    className="mt-2 grid gap-1.5 sm:grid-cols-3 lg:grid-cols-7"
                  >
                    <input type="hidden" name="testProcedureId" value={tp.id} />
                    <Input name="parameter" required placeholder="Parameter" className="h-8 text-xs lg:col-span-2" />
                    <Input name="method" placeholder="Method" className="h-8 text-xs lg:col-span-2" />
                    <Input name="spec" placeholder="Spec" className="h-8 text-xs" />
                    <Input name="minValue" type="number" step="any" placeholder="Min" className="h-8 text-xs" />
                    <Input name="maxValue" type="number" step="any" placeholder="Max" className="h-8 text-xs" />
                    <Input name="units" placeholder="Units" className="h-8 text-xs" />
                    <Button type="submit" size="sm" variant="outline" className="h-8 lg:col-span-7 lg:w-fit">
                      Add test step
                    </Button>
                  </form>
                )}
                {released && (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Released &amp; locked. Edits require a new revision.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
        {procedures.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No test procedures yet. Create one above.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
