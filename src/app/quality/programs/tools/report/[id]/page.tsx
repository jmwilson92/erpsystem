import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChecklistEditor } from "@/components/quality/checklist-editor";
import {
  actionUpdateToolReportPieces,
  actionUpdateToolReportSteps,
  actionDeclarePieceUnrecoverable,
  actionPlaceReplacementPr,
  actionSetToolReportStatus,
} from "@/app/actions";
import { parseJson } from "@/lib/services/tool-control";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { MISSING: "Missing tool", BROKEN: "Broken tool", WORN: "Worn tool" };

export default async function ToolReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.toolReport.findUnique({
    where: { id },
    include: { item: { select: { identifier: true, name: true, location: true } } },
  });
  if (!report) notFound();

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "quality.programs.manage");

  const pieces = parseJson<{ piece: string; gathered: boolean }[]>(report.pieces, []).map((p) => ({
    label: p.piece,
    checked: p.gathered,
  }));
  const steps = parseJson<{ step: string; done: boolean }[]>(report.steps, []).map((s) => ({
    label: s.step,
    checked: s.done,
  }));

  const allGathered = pieces.length > 0 && pieces.every((p) => p.checked);
  const closed = ["RESOLVED", "CLOSED"].includes(report.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${report.number} · ${KIND_LABEL[report.kind] ?? report.kind}`}
        description={report.item ? `${report.item.identifier} — ${report.item.name}` : undefined}
        actions={
          <Link href="/quality/programs/tools">
            <Button size="sm" variant="outline">← Tool Control</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={report.kind} />
        <StatusBadge status={report.status} />
        <span className="text-slate-500">Opened {formatDate(report.createdAt)}</span>
        {report.item?.location && <span className="text-slate-500">· Last at {report.item.location}</span>}
      </div>

      {report.description && (
        <Card>
          <CardContent className="p-4 text-sm text-slate-300">{report.description}</CardContent>
        </Card>
      )}

      {/* FOD linkage (missing tools + unrecoverable pieces) */}
      {report.fodEventId && (
        <Card className="border-amber-500/30">
          <CardContent className="flex items-center justify-between gap-2 p-4 text-sm">
            <span className="text-amber-300">
              A FOD incident has been opened for this report — it runs the FOD disposition process.
            </span>
            <Link href="/quality/programs/fod">
              <Button size="sm" variant="outline">Open FOD</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* BROKEN: gather pieces + replacement PR */}
      {report.kind === "BROKEN" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recover broken pieces</CardTitle>
              <p className="text-xs text-slate-500">
                Account for every fragment. Anything that can&rsquo;t be found becomes a FOD incident.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <ChecklistEditor
                action={actionUpdateToolReportPieces}
                hiddenFields={{ reportId: report.id }}
                fieldName="pieces"
                labelKey="piece"
                checkedKey="gathered"
                initial={pieces}
                addPlaceholder="Add a piece to recover…"
                checkedLabel="gathered"
                submitLabel="Save pieces"
                readOnly={!canManage || closed}
              />
              {canManage && !report.fodEventId && !closed && (
                <form action={actionDeclarePieceUnrecoverable} className="border-t border-slate-800 pt-3">
                  <input type="hidden" name="reportId" value={report.id} />
                  <Button type="submit" size="sm" variant="outline" className="text-rose-300">
                    A piece can&rsquo;t be recovered → open FOD incident
                  </Button>
                </form>
              )}
              {allGathered && (
                <p className="text-xs text-emerald-400">All pieces accounted for.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Replacement</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {report.replacementPrNumber ? (
                <p className="text-sm text-slate-300">
                  Replacement PR{" "}
                  <Link href="/purchasing" className="font-mono text-teal-400 hover:underline">
                    {report.replacementPrNumber}
                  </Link>{" "}
                  created (DRAFT — route it in Purchasing).
                </p>
              ) : canManage && !closed ? (
                <form action={actionPlaceReplacementPr} className="flex items-end gap-2">
                  <input type="hidden" name="reportId" value={report.id} />
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase tracking-wide text-slate-500">Est. unit cost</label>
                    <Input name="estimatedCost" type="number" step="0.01" placeholder="0.00" className="h-9 w-32" />
                  </div>
                  <Button type="submit" size="sm" className="h-9">Place replacement PR</Button>
                </form>
              ) : (
                <p className="text-sm text-slate-500">No replacement PR.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Next-step process (all kinds, customizable) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Next steps</CardTitle>
          <p className="text-xs text-slate-500">Customize the process for this report and check steps off as you go.</p>
        </CardHeader>
        <CardContent>
          <ChecklistEditor
            action={actionUpdateToolReportSteps}
            hiddenFields={{ reportId: report.id }}
            fieldName="steps"
            labelKey="step"
            checkedKey="done"
            initial={steps}
            addPlaceholder="Add a step…"
            checkedLabel="done"
            submitLabel="Save steps"
            readOnly={!canManage || closed}
          />
        </CardContent>
      </Card>

      {/* Status */}
      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Report status</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionSetToolReportStatus} className="flex items-end gap-2">
              <input type="hidden" name="reportId" value={report.id} />
              <select
                name="status"
                defaultValue={report.status}
                className="h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
              >
                <option value="OPEN">Open</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
              </select>
              <Button type="submit" size="sm" className="h-9">Update</Button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              Resolving/closing a broken or worn report returns the tool to service. Missing-tool
              reports stay out of service until the tool is found.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
