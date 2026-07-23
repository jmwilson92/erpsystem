import Link from "next/link";
import { Paperclip, Tag, Wrench, AlertTriangle } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QualityFileField } from "@/components/quality/quality-file-field";
import { ToolboxInspectionPanel } from "@/components/quality/toolbox-inspection-panel";
import {
  actionCreateToolbox,
  actionCreateTool,
  actionSaveToolboxInspection,
  actionCreateToolReport,
  actionAssignToolToToolbox,
} from "@/app/actions";
import { ensureQualityPrograms, refreshProgramStatuses, statusFor } from "@/lib/services/quality-programs";
import { listToolboxes, parseJson } from "@/lib/services/tool-control";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";
const fieldLabelClass = "text-[10px] uppercase tracking-wide text-slate-500";

type InspRow = { toolId: string; identifier: string; name: string; present: boolean; ok: boolean; note?: string };

export default async function ToolControlPage() {
  await ensureQualityPrograms();
  const program = await prisma.qualityProgram.findUnique({ where: { key: "tools" } });
  if (program) await refreshProgramStatuses(program.id);

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "quality.programs.manage");

  const [toolboxes, looseTools, people, openReports, workcenters] = await Promise.all([
    listToolboxes(),
    program
      ? prisma.qualityItem.findMany({
          where: { programId: program.id, toolboxId: null },
          include: { toolReports: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, kind: true, number: true } } },
          orderBy: { identifier: "asc" },
        })
      : Promise.resolve([]),
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.toolReport.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { createdAt: "desc" },
      include: { item: { select: { identifier: true, name: true } } },
    }),
    prisma.workCenter.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true } }),
  ]);

  const totalTools = toolboxes.reduce((s, b) => s + b.tools.length, 0) + looseTools.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool Control"
        description="Controlled tooling accountability — toolboxes, tool checks, and missing/broken tool reports."
        actions={
          <Link href="/quality/programs">
            <Button size="sm" variant="outline">← All programs</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-slate-400">
        <span>{toolboxes.length} toolbox(es)</span>
        <span>{totalTools} tool(s)</span>
        {openReports.length > 0 && (
          <span className="text-rose-300">{openReports.length} open missing/broken report(s)</span>
        )}
      </div>

      {openReports.length > 0 && (
        <Card className="border-rose-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-rose-300">Open tool reports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {openReports.map((r) => (
              <Link
                key={r.id}
                href={`/quality/programs/tools/report/${r.id}`}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-slate-700"
              >
                <span>
                  <StatusBadge status={r.kind} className="text-[9px]" />
                  <span className="ml-2 font-mono text-xs text-teal-400">{r.number}</span>
                  <span className="ml-2 text-slate-300">
                    {r.item ? `${r.item.identifier} — ${r.item.name}` : "tool"}
                  </span>
                </span>
                <StatusBadge status={r.status} className="text-[9px]" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Add toolbox + add tool */}
      {canManage && (
        <div className="grid gap-4 lg:grid-cols-2" data-tour="tools-add">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add toolbox</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionCreateToolbox} className="grid items-end gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelClass}>Toolbox ID *</label>
                  <Input name="identifier" placeholder="e.g. TB-01" className="h-9" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelClass}>Location (workcenter)</label>
                  <select name="location" className={selectClass} defaultValue="">
                    <option value="">Workcenter…</option>
                    {workcenters.map((w) => (
                      <option key={w.code} value={`${w.code} — ${w.name}`}>{w.code} — {w.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className={fieldLabelClass}>Owner</label>
                  <select name="ownerId" className={selectClass} defaultValue="">
                    <option value="">Owner…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <Button type="submit" size="sm" className="h-9 sm:col-span-2">Add toolbox</Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add tool</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionCreateTool} className="grid items-end gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelClass}>Tool ID *</label>
                  <Input name="identifier" placeholder="e.g. T-1042" className="h-9" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className={fieldLabelClass}>Name / description</label>
                  <Input name="name" placeholder="Torque wrench 3/8" className="h-9" />
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className={fieldLabelClass}>Toolbox</label>
                  <select name="toolboxId" className={selectClass} defaultValue="">
                    <option value="">— loose / unassigned —</option>
                    {toolboxes.map((b) => (
                      <option key={b.id} value={b.id}>{b.identifier} — {b.name}</option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-300 sm:col-span-2">
                  <input type="checkbox" name="needsCalibration" />
                  This tool needs calibration — also list it on the Calibration register
                </label>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelClass}>Cal interval (days)</label>
                    <Input name="intervalDays" type="number" placeholder="e.g. 365" className="h-9" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabelClass}>Cal next due</label>
                    <Input name="nextDueAt" type="date" className="h-9" />
                  </div>
                </div>
                <div className="flex flex-col gap-1 sm:col-span-2">
                  <label className={fieldLabelClass}>Attach document / photo</label>
                  <QualityFileField label="Attach document / photo" />
                </div>
                <Button type="submit" size="sm" className="h-9 sm:col-span-2">Add tool</Button>
              </form>
              <p className="mt-2 text-[11px] text-slate-500">
                Ticking &ldquo;needs calibration&rdquo; makes the tool appear on the Calibration
                register using the interval/next-due above.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Toolboxes */}
      {toolboxes.map((box) => (
        <Card key={box.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">
                <span className="font-mono text-teal-400">{box.identifier}</span>
                <span className="ml-2">{box.name}</span>
                {box.location && <span className="ml-2 text-xs font-normal text-slate-500">· {box.location}</span>}
              </CardTitle>
              <span className="text-xs text-slate-500">{box.tools.length} tool(s)</span>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {box.tools.length === 0 && <p className="text-sm text-slate-500">No tools in this box yet.</p>}
            {box.tools.length > 0 && (
              <table className="w-full text-sm">
                <tbody>
                  {box.tools.map((t) => (
                    <ToolRow key={t.id} tool={t} canManage={canManage} />
                  ))}
                </tbody>
              </table>
            )}

            {canManage && (
              <ToolboxInspectionPanel
                toolboxId={box.id}
                tools={box.tools.map((t) => ({ id: t.id, identifier: t.identifier, name: t.name }))}
                action={actionSaveToolboxInspection}
              />
            )}

            {/* Historical inspection documents */}
            {box.inspections.length > 0 && (
              <div className="mt-2 border-t border-slate-800 pt-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Inspection history
                </p>
                <div className="space-y-1">
                  {box.inspections.map((insp) => {
                    const rows = parseJson<InspRow[]>(insp.results, []);
                    return (
                      <details key={insp.id} className="rounded border border-slate-800 px-2 py-1.5 text-xs">
                        <summary className="cursor-pointer text-slate-300">
                          {formatDate(insp.performedAt)} · {insp.okCount}/{insp.toolCount} verified
                          {insp.okCount < insp.toolCount && (
                            <span className="ml-2 text-amber-400">needs attention</span>
                          )}
                        </summary>
                        <table className="mt-1 w-full">
                          <tbody>
                            {rows.map((r) => (
                              <tr key={r.toolId} className="border-t border-slate-800/60">
                                <td className="py-0.5 font-mono text-teal-400">{r.identifier}</td>
                                <td className="py-0.5 text-slate-300">{r.name}</td>
                                <td className="py-0.5 text-slate-400">{r.present ? "present" : "MISSING"}</td>
                                <td className="py-0.5 text-slate-400">{r.ok ? "ok" : "not ok"}</td>
                                <td className="py-0.5 text-slate-500">{r.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {insp.notes && <p className="mt-1 text-slate-500">{insp.notes}</p>}
                      </details>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Loose tools */}
      {looseTools.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Loose / unassigned tools</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {looseTools.map((t) => (
                  <ToolRow
                    key={t.id}
                    tool={t}
                    canManage={canManage}
                    assignToolboxes={toolboxes.map((b) => ({ id: b.id, identifier: b.identifier, name: b.name }))}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ToolRow({
  tool,
  canManage,
  assignToolboxes,
}: {
  tool: {
    id: string;
    identifier: string;
    name: string;
    status: string;
    nextDueAt: Date | null;
    needsCalibration: boolean;
    toolReports: { id: string; kind: string; number: string }[];
  };
  canManage: boolean;
  /** When provided (loose tools), show a control to move the tool into a box. */
  assignToolboxes?: { id: string; identifier: string; name: string }[];
}) {
  const st = statusFor(tool.nextDueAt, tool.status);
  const openReport = tool.toolReports[0];
  return (
    <tr className="border-t border-slate-800/60">
      <td className="py-1.5 pr-2 font-mono text-xs text-teal-400">{tool.identifier}</td>
      <td className="py-1.5 pr-2 text-slate-200">
        <span className="inline-flex items-center gap-1">
          <Wrench className="h-3 w-3 text-slate-500" />
          {tool.name}
        </span>
        {tool.needsCalibration && (
          <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
            cal
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2"><StatusBadge status={st} className="text-[9px]" /></td>
      <td className="py-1.5 pr-2 text-right">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {canManage && assignToolboxes && assignToolboxes.length > 0 && (
            <form action={actionAssignToolToToolbox} className="flex items-center gap-1">
              <input type="hidden" name="toolId" value={tool.id} />
              <select
                name="toolboxId"
                defaultValue=""
                className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-[11px] text-slate-200"
              >
                <option value="">Add to toolbox…</option>
                {assignToolboxes.map((b) => (
                  <option key={b.id} value={b.id}>{b.identifier} — {b.name}</option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline" className="h-7 text-[11px]">Move</Button>
            </form>
          )}
          <Link
            href={`/quality/programs/tools/${tool.id}/label`}
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-1.5 py-1 text-[11px] text-slate-300 hover:border-teal-500/40"
            title="Print label / download DXF"
          >
            <Tag className="h-3 w-3" /> Label
          </Link>
          {openReport ? (
            <Link
              href={`/quality/programs/tools/report/${openReport.id}`}
              className="inline-flex items-center gap-1 rounded border border-rose-500/40 px-1.5 py-1 text-[11px] text-rose-300"
            >
              <AlertTriangle className="h-3 w-3" /> {openReport.number}
            </Link>
          ) : (
            canManage && (
              <form action={actionCreateToolReport} className="flex items-center gap-1">
                <input type="hidden" name="itemId" value={tool.id} />
                <select
                  name="kind"
                  defaultValue="BROKEN"
                  className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-[11px] text-slate-200"
                >
                  <option value="BROKEN">Broken</option>
                  <option value="MISSING">Missing</option>
                  <option value="WORN">Worn</option>
                </select>
                <Button type="submit" size="sm" variant="outline" className="h-7 text-[11px]">
                  Report
                </Button>
              </form>
            )
          )}
        </div>
      </td>
    </tr>
  );
}
