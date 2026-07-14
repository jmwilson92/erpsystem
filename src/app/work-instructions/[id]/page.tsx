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
import { StepPhotoFields } from "@/components/work-instructions/step-photo-fields";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WiDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const toolPrNotice = Array.isArray(sp.toolPr) ? sp.toolPr[0] : sp.toolPr;
  const cmView = (Array.isArray(sp.cm) ? sp.cm[0] : sp.cm) === "1";
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
        cmDocuments: {
          orderBy: { updatedAt: "desc" },
          include: {
            folder: { select: { id: true, name: true } },
          },
        },
        toolPurchaseRequests: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { lines: true },
        },
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

  type ToolJson = { name: string; partId?: string | null; qty?: number };
  let tools: ToolJson[] = [];
  if (wi.requiredTools) {
    try {
      tools = JSON.parse(wi.requiredTools) as ToolJson[];
    } catch {
      tools = [];
    }
  }

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

      {/* CM-style controlled-document title block (?cm=1 or released master) */}
      {(() => {
        const master = wi.cmDocuments.find((d) => !d.isArchived) || null;
        const isReleased = wi.status === "RELEASED" || wi.isLocked;
        if (!cmView && !master && !isReleased) return null;
        return (
          <div className="overflow-hidden rounded-2xl border border-teal-800/50 bg-slate-950/60">
            <div className="flex items-center justify-between border-b border-teal-800/40 bg-teal-500/5 px-5 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-300">
                Configuration-Controlled Master
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {master ? master.number : wi.documentNumber} ·{" "}
                {master ? master.status : wi.status}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Document
                </p>
                <p className="font-mono text-slate-100">{wi.documentNumber}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Revision
                </p>
                <p className="font-mono text-slate-100">{wi.revision}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Released
                </p>
                <p className="text-slate-100">
                  {wi.releasedAt ? formatDate(wi.releasedAt) : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Prepared by
                </p>
                <p className="text-slate-100">{wi.createdBy?.name || "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Title
                </p>
                <p className="text-slate-100">{wi.title}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Part
                </p>
                <p className="font-mono text-slate-100">
                  {wi.part?.partNumber || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  Supersedes
                </p>
                <p className="text-slate-100">
                  {wi.supersedes ? `Rev ${wi.supersedes.revision}` : "Original"}
                </p>
              </div>
            </div>
            {master && (
              <div className="flex items-center justify-between border-t border-slate-800 px-5 py-2 text-xs text-slate-500">
                <span>
                  Retained in CM library
                  {master.folder ? ` · ${master.folder.name}` : ""}
                </span>
                <Link href="/cm" className="text-teal-400 hover:underline">
                  Open CM library →
                </Link>
              </div>
            )}
          </div>
        );
      })()}

      {wi.isLocked && !cmView && (
        <Card className="border-amber-900/40">
          <CardContent className="p-4 text-sm text-amber-100/90">
            This revision is <strong>released and locked</strong>. Content cannot
            be edited. Use <strong>Update (new revision)</strong> to create an
            in-development copy; the locked revision stays for production.
          </CardContent>
        </Card>
      )}

      {toolPrNotice && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-3 text-sm text-amber-100">
            Tooling short — purchase request{" "}
            <Link href="/purchasing" className="font-mono font-semibold underline">
              {toolPrNotice}
            </Link>{" "}
            was opened for tools not in stock (needed for this WI).
          </CardContent>
        </Card>
      )}

      {/* Hazmat / drawings / tools */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Drawing</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-mono text-teal-400">
              {wi.drawingNumber || "—"}
            </p>
            {wi.drawingReferences && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">
                {wi.drawingReferences}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hazmat / PPE</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            {wi.hazmatRequired ? (
              <p className="whitespace-pre-wrap text-xs">{wi.hazmatRequired}</p>
            ) : (
              <p className="text-xs text-slate-600">None specified</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Required tools</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {tools.length === 0 && (
              <p className="text-slate-600">None specified</p>
            )}
            {tools.map((t, i) => (
              <div key={i} className="text-slate-300">
                <span className="font-medium">{t.name}</span>
                {t.qty ? ` × ${t.qty}` : ""}
                {t.partId && (
                  <Link
                    href={`/items/${t.partId}`}
                    className="ml-1 font-mono text-teal-500 hover:underline"
                  >
                    item
                  </Link>
                )}
              </div>
            ))}
            {wi.toolPurchaseRequests.length > 0 && (
              <div className="mt-2 border-t border-slate-800 pt-2">
                <p className="mb-1 text-[10px] uppercase text-amber-500">
                  Tooling PRs
                </p>
                {wi.toolPurchaseRequests.map((pr) => (
                  <Link
                    key={pr.id}
                    href="/purchasing"
                    className="block font-mono text-amber-400 hover:underline"
                  >
                    {pr.number} · {pr.status}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
                <StatusBadge
                  status={
                    step.stepType === "QA"
                      ? "QA"
                      : step.stepType === "TEST" || step.isTestStep
                        ? "TEST"
                        : "BUILD"
                  }
                />
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
              {(() => {
                let photos: string[] = [];
                if (step.attachmentUrls) {
                  try {
                    photos = JSON.parse(step.attachmentUrls) as string[];
                  } catch {
                    photos = [];
                  }
                }
                if (!photos.length) return null;
                return (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {photos.map((url, pi) =>
                      url.startsWith("data:") ||
                      url.startsWith("http") ||
                      url.startsWith("/") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={pi}
                          src={url}
                          alt={`Step ${step.stepNumber} photo ${pi + 1}`}
                          className="h-20 w-20 rounded border border-slate-700 object-cover"
                        />
                      ) : (
                        <span
                          key={pi}
                          className="rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-500"
                        >
                          {url}
                        </span>
                      )
                    )}
                  </div>
                );
              })()}
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
            <form action={actionAddWiStep} className="grid gap-3 sm:grid-cols-2" id="add-wi-step-form">
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
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Step type *
                </label>
                <select
                  name="stepType"
                  className={`${selectClass} mt-1 w-full`}
                  defaultValue="BUILD"
                >
                  <option value="BUILD">Build (manufacturing)</option>
                  <option value="QA">QA</option>
                  <option value="TEST">Test</option>
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-1 text-sm text-slate-400">
                <input
                  type="checkbox"
                  name="passFailRequired"
                  className="rounded border-slate-600"
                />
                Pass / Fail required
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
              <StepPhotoFields />
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
