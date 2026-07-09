import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import {
  actionSubmitWiToCm,
  actionCreateWiRevision,
  actionUpdateWiStepRouting,
  actionAddWiStep,
  actionLinkWiToBom,
  actionSaveUomUnit,
} from "@/app/actions";
import { listWorkCenters } from "@/lib/services/workcenters";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [wi, workCenters, boms, measureUoms] = await Promise.all([
    prisma.workInstruction.findUnique({
      where: { id },
      include: {
        part: true,
        bomHeader: { include: { part: true } },
        createdBy: true,
        steps: { orderBy: { stepNumber: "asc" } },
        signOffs: {
          take: 10,
          orderBy: { signedAt: "desc" },
          include: { user: true },
        },
        changeRequests: { orderBy: { createdAt: "desc" }, take: 5 },
        supersedes: true,
      },
    }),
    listWorkCenters({ activeOnly: true }),
    prisma.bomHeader.findMany({
      where: { status: { in: ["CERTIFIED", "PRODUCTION", "PROTOTYPE"] } },
      include: { part: { select: { partNumber: true } } },
      orderBy: { revision: "desc" },
      take: 60,
    }),
    prisma.uomUnit.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
    }),
  ]);
  if (!wi) notFound();

  const editable =
    !wi.isLocked &&
    !["RELEASED", "OBSOLETE", "CM_REVIEW"].includes(wi.status);
  const selectClass =
    "flex h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${wi.documentNumber} Rev ${wi.revision}`}
        description={wi.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/work-instructions">
              <Button size="sm" variant="outline">
                All WIs
              </Button>
            </Link>
            {editable && (
              <form action={actionSubmitWiToCm}>
                <input type="hidden" name="id" value={wi.id} />
                <Button type="submit" size="sm">
                  Submit to CM
                </Button>
              </form>
            )}
            {wi.status === "CM_REVIEW" && (
              <Link href="/cm">
                <Button size="sm" variant="secondary">
                  Open CM board
                </Button>
              </Link>
            )}
            {(wi.status === "RELEASED" || wi.isLocked) && (
              <form action={actionCreateWiRevision}>
                <input type="hidden" name="id" value={wi.id} />
                <Button type="submit" size="sm">
                  Update (new revision)
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wi.status} />
        {wi.isLocked && <StatusBadge status="LOCKED" />}
        {wi.part && (
          <Link
            href={`/items/${wi.part.id}`}
            className="text-sm text-sky-400 hover:underline"
          >
            {wi.part.partNumber}
          </Link>
        )}
        {wi.bomHeader && (
          <Link
            href={`/bom/${wi.bomHeader.id}`}
            className="text-sm text-teal-400 hover:underline"
          >
            BOM {wi.bomHeader.part.partNumber} Rev {wi.bomHeader.revision}
          </Link>
        )}
        {wi.supersedes && (
          <Link
            href={`/work-instructions/${wi.supersedes.id}`}
            className="text-xs text-slate-500 hover:underline"
          >
            Based on Rev {wi.supersedes.revision}
          </Link>
        )}
      </div>

      {wi.isLocked && (
        <Card className="border-amber-900/40">
          <CardContent className="p-4 text-sm text-amber-100/90">
            This revision is <strong>released and locked</strong>. Content cannot
            be edited. Use <strong>Update (new revision)</strong> to create an
            in-development copy; the locked revision stays for production.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {["DRAFT", "ENGINEERING_REVIEW", "CM_REVIEW", "RELEASED"].map((s) => (
          <span
            key={s}
            className={`rounded-full border px-3 py-1 ${
              wi.status === s
                ? "border-teal-500 bg-teal-500/10 text-teal-400"
                : "border-slate-800 text-slate-600"
            }`}
          >
            {s.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      {wi.status === "RELEASED" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link to BOM</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionLinkWiToBom} className="flex flex-wrap gap-2">
              <input type="hidden" name="workInstructionId" value={wi.id} />
              <select
                name="bomHeaderId"
                required
                className={selectClass}
                defaultValue={wi.bomHeaderId || ""}
              >
                <option value="">— Select released BOM —</option>
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.part.partNumber} Rev {b.revision} ({b.status})
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm">
                Link BOM
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Steps</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {wi.steps.map((step) => (
            <div
              key={step.id}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 font-mono text-xs text-teal-400">
                  {step.stepNumber}
                </span>
                <span className="font-medium text-slate-100">{step.title}</span>
                {step.isTestStep && <StatusBadge status="TEST" />}
                {step.passFailRequired && <StatusBadge status="PASS_FAIL" />}
                {step.measureUom && (
                  <span className="font-mono text-[10px] text-sky-400">
                    {step.measureUom}
                    {step.expectedValue ? ` · ${step.expectedValue}` : ""}
                  </span>
                )}
                {step.cureTimeMinutes ? (
                  <span className="text-[10px] text-amber-400">
                    Cure {step.cureTimeMinutes} min
                  </span>
                ) : null}
                {step.requiredArea && (
                  <StatusBadge status={step.requiredArea} />
                )}
                {step.workCenter && (
                  <span className="font-mono text-xs text-slate-500">
                    {step.workCenter}
                  </span>
                )}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-400">
                {step.instructions}
              </p>
              {editable && (
                <form
                  action={actionUpdateWiStepRouting}
                  className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2"
                >
                  <input type="hidden" name="stepId" value={step.id} />
                  <input type="hidden" name="workInstructionId" value={wi.id} />
                  <div>
                    <label className="text-[10px] uppercase text-slate-600">
                      Area
                    </label>
                    <select
                      name="requiredArea"
                      className={`${selectClass} mt-0.5`}
                      defaultValue={step.requiredArea || ""}
                    >
                      <option value="">—</option>
                      <option value="MANUFACTURING">Manufacturing</option>
                      <option value="QA">QA</option>
                      <option value="TEST">Test</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-600">
                      Station
                    </label>
                    <select
                      name="workCenter"
                      className={`${selectClass} mt-0.5`}
                      defaultValue={step.workCenter || ""}
                    >
                      <option value="">—</option>
                      {workCenters.map((c) => (
                        <option key={c.id} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-1 text-[10px] text-slate-500">
                    <input
                      type="checkbox"
                      name="routeLock"
                      defaultChecked={step.routeLock}
                      className="rounded border-slate-600"
                    />
                    Lock route
                  </label>
                  <Button type="submit" size="sm" variant="outline">
                    Save routing
                  </Button>
                </form>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {editable && (
        <Card className="border-teal-900/40">
          <CardHeader>
            <CardTitle>Add step</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionAddWiStep} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="workInstructionId" value={wi.id} />
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Title *
                </label>
                <Input name="title" required className="mt-1" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Instructions *
                </label>
                <Textarea name="instructions" required rows={3} className="mt-1" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="passFailRequired"
                  className="rounded border-slate-600"
                />
                Pass / Fail required
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="isTestStep"
                  className="rounded border-slate-600"
                />
                Test / measurement
              </label>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Measure UOM
                </label>
                <select name="measureUom" className={`${selectClass} mt-1 w-full`}>
                  <option value="">—</option>
                  {measureUoms.map((u) => (
                    <option key={u.id} value={u.code}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Expected value
                </label>
                <Input name="expectedValue" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Cure time (minutes)
                </label>
                <Input name="cureTimeMinutes" type="number" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Area
                </label>
                <select
                  name="requiredArea"
                  className={`${selectClass} mt-1 w-full`}
                >
                  <option value="">—</option>
                  <option value="MANUFACTURING">Manufacturing</option>
                  <option value="QA">QA</option>
                  <option value="TEST">Test</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm">
                  Add step
                </Button>
              </div>
            </form>
            <div className="mt-4 border-t border-slate-800 pt-3">
              <p className="mb-2 text-xs text-slate-500">
                Quick-add measure UOM if missing
              </p>
              <form action={actionSaveUomUnit} className="flex flex-wrap gap-2">
                <input
                  type="hidden"
                  name="returnPath"
                  value={`/work-instructions/${wi.id}`}
                />
                <Input
                  name="code"
                  placeholder="VDC"
                  className="h-8 w-24 font-mono"
                  required
                />
                <Input
                  name="name"
                  placeholder="Volts DC"
                  className="h-8 w-40"
                  required
                />
                <input type="hidden" name="category" value="ELECTRICAL" />
                <input type="hidden" name="isActive" value="on" />
                <Button type="submit" size="sm" variant="outline">
                  Add UOM
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {wi.changeRequests.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>CM change requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {wi.changeRequests.map((cr) => (
              <Link
                key={cr.id}
                href="/cm"
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm hover:border-teal-700"
              >
                <span className="font-mono text-teal-400">{cr.number}</span>
                <StatusBadge status={cr.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {wi.signOffs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent sign-offs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-slate-500">
            {wi.signOffs.map((s) => (
              <div key={s.id}>
                {s.user.name} · {s.result}
                {s.measuredValue
                  ? ` · ${s.measuredValue}${s.measureUom ? ` ${s.measureUom}` : ""}`
                  : ""}
                {s.pinVerified ? " · PIN ok" : ""} · {formatDate(s.signedAt)}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
