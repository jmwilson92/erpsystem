import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { actionDispositionMrb, actionCloseMrbCase } from "@/app/actions";
import { CarUpdateForm } from "@/components/mrb/car-update-form";
import Link from "next/link";
import { ClipboardList, AlertTriangle, CheckCircle2, FileWarning } from "lucide-react";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

export default async function MrbPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const highlightCar = pick(sp, "car");
  // Primary mode: mrb | cars — keeps the two workflows separated
  const view = pick(sp, "view") || (highlightCar ? "cars" : "mrb");
  // Sub-filters within each view
  const filter = pick(sp, "filter") || "open"; // open | all | closed

  const cases = await prisma.mrbCase.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      ncr: { include: { part: true, supplier: true, inspection: true } },
      dispositions: {
        include: {
          decidedBy: true,
          activityLog: {
            include: {
              user: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
            take: 50,
          },
        },
        orderBy: { decidedAt: "desc" },
      },
      inventoryHolds: true,
    },
  });

  // Open = still live: needs board attention OR dispositioned but not yet
  // formally closed out. A dispositioned case stays visible in Open until
  // someone closes it — closing is a distinct, deliberate step.
  const openCases = cases.filter((c) =>
    ["OPEN", "IN_REVIEW", "DISPOSITIONED"].includes(c.status)
  );
  // Closed = fully closed only.
  const closedCases = cases.filter((c) => c.status === "CLOSED");

  const cars = cases.flatMap((c) =>
    c.dispositions
      .filter((d) => d.carNumber)
      .map((d) => ({ disposition: d, mrb: c }))
  );
  // Treat null/empty status as open so newly created CARs always appear
  const openCars = cars.filter((c) => {
    const s = (c.disposition.carStatus || "OPEN").toUpperCase();
    return !["CLOSED", "VERIFIED"].includes(s);
  });
  const closedCars = cars.filter((c) => {
    const s = (c.disposition.carStatus || "").toUpperCase();
    return ["CLOSED", "VERIFIED"].includes(s);
  });

  // Never fall back to mixed statuses — empty filter shows empty state
  const mrbShown =
    filter === "all"
      ? cases
      : filter === "closed"
        ? closedCases
        : openCases;

  const carShown =
    filter === "all"
      ? cars
      : filter === "closed"
        ? closedCars
        : openCars;

  return (
    <div className="space-y-6">
      <PageHeader
        title={view === "cars" ? "Corrective Actions (CAR)" : "Material Review Board"}
        actions={
          <Link href="/quality">
            <Button size="sm" variant="outline">
              NCR list
            </Button>
          </Link>
        }
      />

      {/* Primary navigation: MRB vs CAR */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/mrb?view=mrb&filter=open"
          className={`rounded-xl border p-4 transition-colors ${
            view === "mrb"
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center gap-3">
            <ClipboardList
              className={`h-8 w-8 ${view === "mrb" ? "text-amber-400" : "text-slate-600"}`}
            />
            <div>
              <p className="font-semibold text-slate-100">MRB cases</p>
              <p className="text-xs text-slate-500">
                Board disposition of NCR material
              </p>
            </div>
            <span className="ml-auto text-2xl font-bold tabular-nums text-amber-400">
              {openCases.length}
            </span>
          </div>
        </Link>
        <Link
          href="/mrb?view=cars&filter=open"
          className={`rounded-xl border p-4 transition-colors ${
            view === "cars"
              ? "border-sky-500/50 bg-sky-500/10"
              : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
          }`}
        >
          <div className="flex items-center gap-3">
            <FileWarning
              className={`h-8 w-8 ${view === "cars" ? "text-sky-400" : "text-slate-600"}`}
            />
            <div>
              <p className="font-semibold text-slate-100">Corrective actions</p>
              <p className="text-xs text-slate-500">
                CAR follow-up · response · verification
              </p>
            </div>
            <span className="ml-auto text-2xl font-bold tabular-nums text-sky-400">
              {openCars.length}
            </span>
          </div>
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {view === "mrb" ? (
          <>
            <StatCard
              title="Open MRB"
              value={openCases.length}
              icon={AlertTriangle}
              accent="amber"
            />
            <StatCard
              title="Dispositioned / closed"
              value={closedCases.length}
              icon={CheckCircle2}
              accent="teal"
            />
            <StatCard
              title="Total cases"
              value={cases.length}
              icon={ClipboardList}
              accent="sky"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Open CARs"
              value={openCars.length}
              icon={FileWarning}
              accent="sky"
            />
            <StatCard
              title="Verified / closed"
              value={closedCars.length}
              icon={CheckCircle2}
              accent="teal"
            />
            <StatCard
              title="Total CARs"
              value={cars.length}
              icon={ClipboardList}
              accent="violet"
            />
          </>
        )}
      </div>

      {highlightCar && view === "cars" && (
        <Card className="border-sky-500/40 bg-sky-500/10">
          <CardContent className="p-4 text-sm text-sky-100">
            CAR <span className="font-mono font-semibold">{highlightCar}</span>{" "}
            created. Update status and supplier response below.
          </CardContent>
        </Card>
      )}

      {/* Sub-filters for current view */}
      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            { id: "open", label: view === "cars" ? "Open CARs" : "Open MRB" },
            { id: "closed", label: "Closed" },
            { id: "all", label: "All" },
          ] as const
        ).map((f) => (
          <Link
            key={f.id}
            href={`/mrb?view=${view}&filter=${f.id}`}
            className={`rounded border px-3 py-1.5 ${
              filter === f.id
                ? view === "cars"
                  ? "border-sky-500/50 bg-sky-500/10 text-sky-200"
                  : "border-amber-500/50 bg-amber-500/10 text-amber-200"
                : "border-slate-700 text-slate-400"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* ─── CAR VIEW ─────────────────────────────────────── */}
      {view === "cars" && (
        <div className="space-y-4">
          {carShown.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                No corrective actions match this filter. CARs are created when
                recording an MRB disposition with &quot;Create CAR&quot; checked.
              </CardContent>
            </Card>
          )}

          {carShown.map(({ disposition: d, mrb }) => (
            <Card
              key={d.id}
              className={
                highlightCar === d.carNumber
                  ? "border-sky-500/50"
                  : "border-slate-800"
              }
            >
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/mrb/cars/${d.id}`}>
                        <CardTitle className="font-mono text-lg text-sky-400 hover:underline">
                          {d.carNumber}
                        </CardTitle>
                      </Link>
                      <StatusBadge status={d.carStatus || "OPEN"} />
                      <StatusBadge status={d.disposition} />
                      <Link href={`/mrb/cars/${d.id}`}>
                        <Button size="sm" variant="outline">
                          Open detail
                        </Button>
                      </Link>
                      <Link href={`/mrb/cars/${d.id}#activity-log`}>
                        <Button size="sm" variant="ghost">
                          Activity log
                        </Button>
                      </Link>
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      {d.carTitle || mrb.ncr.title}
                    </p>
                    <p className="text-xs text-slate-500">
                      Linked MRB{" "}
                      <Link
                        href={`/mrb?view=mrb&filter=all`}
                        className="text-amber-400 hover:underline"
                      >
                        {mrb.number}
                      </Link>
                      {" · "}NCR {mrb.ncr.number}
                      {mrb.ncr.part ? ` · ${mrb.ncr.part.partNumber}` : ""}
                      {mrb.ncr.supplier
                        ? ` · ${mrb.ncr.supplier.name}`
                        : ""}
                      {d.carDueDate
                        ? ` · Due ${formatDate(d.carDueDate)}`
                        : ""}
                    </p>
                  </div>
                  {mrb.ncr.supplier && (
                    <Link href={`/suppliers/${mrb.ncr.supplierId}`}>
                      <Button size="sm" variant="outline">
                        Supplier
                      </Button>
                    </Link>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {d.carNotes && (
                  <p className="text-xs text-slate-400">{d.carNotes}</p>
                )}
                {d.carResponse && (
                  <p className="text-xs text-emerald-400/90">
                    Response: {d.carResponse}
                  </p>
                )}
                {d.reworkWorkOrderId && (
                  <Link
                    href={`/work-orders/${d.reworkWorkOrderId}`}
                    className="inline-block text-xs text-teal-400 hover:underline"
                  >
                    Rework WO →
                  </Link>
                )}

                {!["CLOSED", "VERIFIED"].includes(d.carStatus || "") && (
                  <div className="rounded-lg border border-sky-900/40 bg-slate-950/50 p-4">
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-sky-400">
                      Update CAR
                    </p>
                    <CarUpdateForm
                      dispositionId={d.id}
                      carStatus={d.carStatus || "OPEN"}
                      carResponse={d.carResponse || ""}
                      carNotes={d.carNotes || ""}
                      existingAttachments={
                        d.carAttachments
                          ? (JSON.parse(d.carAttachments) as {
                              url: string;
                              fileName?: string;
                              caption?: string;
                            }[])
                          : []
                      }
                    />
                  </div>
                )}

                {/* Traceability log — every create / update after push */}
                <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">
                    Traceability log
                    {d.activityLog?.length
                      ? ` · ${d.activityLog.length} event(s)`
                      : ""}
                  </p>
                  {!d.activityLog?.length ? (
                    <p className="text-xs text-slate-600">
                      No activity recorded yet. Updates appear here after each
                      save.
                    </p>
                  ) : (
                    <ol className="relative space-y-0 border-l border-slate-800 pl-4">
                      {d.activityLog.map((evt) => {
                        let changeLines: string[] = [];
                        if (evt.changes) {
                          try {
                            const ch = JSON.parse(evt.changes) as Record<
                              string,
                              { from?: unknown; to?: unknown } | unknown
                            >;
                            changeLines = Object.entries(ch).map(
                              ([field, val]) => {
                                if (
                                  val &&
                                  typeof val === "object" &&
                                  "from" in (val as object) &&
                                  "to" in (val as object)
                                ) {
                                  const v = val as {
                                    from: unknown;
                                    to: unknown;
                                  };
                                  if (field === "attachments") {
                                    const files = Array.isArray(v.to)
                                      ? (v.to as { fileName?: string }[])
                                          .map((f) => f.fileName || "file")
                                          .join(", ")
                                      : "file(s)";
                                    return `Attachments: +${files}`;
                                  }
                                  const from =
                                    v.from === null || v.from === ""
                                      ? "—"
                                      : String(v.from);
                                  const to =
                                    v.to === null || v.to === ""
                                      ? "—"
                                      : String(v.to);
                                  if (
                                    field === "response" ||
                                    field === "notes"
                                  ) {
                                    const preview = (s: string) =>
                                      s.length > 80
                                        ? `${s.slice(0, 80)}…`
                                        : s;
                                    return `${field}: “${preview(from)}” → “${preview(to)}”`;
                                  }
                                  return `${field}: ${from} → ${to}`;
                                }
                                return `${field}: ${JSON.stringify(val)}`;
                              }
                            );
                          } catch {
                            /* ignore bad JSON */
                          }
                        }
                        return (
                          <li key={evt.id} className="relative pb-4 last:pb-0">
                            <span
                              className={`absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full border ${
                                evt.action === "CREATED"
                                  ? "border-emerald-500 bg-emerald-500/40"
                                  : evt.action === "VERIFIED_CLOSED"
                                    ? "border-sky-500 bg-sky-500/40"
                                    : "border-slate-500 bg-slate-700"
                              }`}
                            />
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <p className="text-sm text-slate-200">
                                {evt.summary}
                              </p>
                              <span className="shrink-0 font-mono text-[10px] text-slate-600">
                                {formatDate(evt.createdAt)}
                                {evt.createdAt
                                  ? ` ${new Date(evt.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}`
                                  : ""}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              <StatusBadge
                                status={evt.action}
                                className="mr-1.5 align-middle"
                              />
                              {evt.user?.name || "System"}
                            </p>
                            {changeLines.length > 0 && (
                              <ul className="mt-1.5 space-y-0.5 text-[11px] text-slate-500">
                                {changeLines.map((line, i) => (
                                  <li key={i} className="font-mono">
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ─── MRB VIEW ─────────────────────────────────────── */}
      {view === "mrb" && (
        <div className="grid gap-4">
          {mrbShown.length === 0 && (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-500">
                No MRB cases match this filter.
              </CardContent>
            </Card>
          )}

          {mrbShown.map((mrb) => {
            const caseCars = mrb.dispositions.filter((d) => d.carNumber);
            return (
              <Card
                key={mrb.id}
                className={
                  mrb.status === "OPEN" || mrb.status === "IN_REVIEW"
                    ? "border-amber-500/30"
                    : ""
                }
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="font-mono text-amber-400">
                          {mrb.number}
                        </CardTitle>
                        <StatusBadge status={mrb.status} />
                        <StatusBadge status={mrb.ncr.severity} />
                      </div>
                      <p className="mt-1 text-sm text-slate-300">
                        {mrb.ncr.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        NCR {mrb.ncr.number} · {mrb.ncr.part?.partNumber} · Qty{" "}
                        {mrb.ncr.quantity}
                        {mrb.ncr.lotNumber ? ` · Lot ${mrb.ncr.lotNumber}` : ""}
                        {mrb.ncr.supplier
                          ? ` · ${mrb.ncr.supplier.name} (${mrb.ncr.supplier.rating})`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs text-slate-500">
                      <p>Opened {formatDate(mrb.createdAt)}</p>
                      {mrb.boardDate && (
                        <p>Board {formatDate(mrb.boardDate)}</p>
                      )}
                      {mrb.inventoryHolds.length > 0 && (
                        <p className="text-orange-400">
                          {mrb.inventoryHolds.length} inventory hold(s)
                        </p>
                      )}
                      {caseCars.length > 0 && (
                        <Link
                          href={`/mrb?view=cars&filter=all&car=${caseCars[0].carNumber}`}
                          className="mt-1 inline-block text-sky-400 hover:underline"
                        >
                          {caseCars.length} CAR(s) →
                        </Link>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-slate-400">{mrb.ncr.description}</p>
                  {mrb.notes && (
                    <p className="text-xs text-slate-500">Notes: {mrb.notes}</p>
                  )}

                  {mrb.dispositions.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium uppercase text-slate-500">
                        Dispositions
                      </p>
                      {mrb.dispositions.map((d) => (
                        <div
                          key={d.id}
                          className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={d.disposition} />
                            <span className="text-slate-400">
                              qty {d.quantity}
                            </span>
                            {d.carNumber && (
                              <Link
                                href={`/mrb?view=cars&filter=all&car=${d.carNumber}`}
                                className="font-mono text-xs text-sky-400 hover:underline"
                              >
                                {d.carNumber}
                                {d.carStatus ? ` · ${d.carStatus}` : ""}
                              </Link>
                            )}
                            {d.reworkWorkOrderId && (
                              <Link
                                href={`/work-orders/${d.reworkWorkOrderId}`}
                                className="text-xs text-teal-400 hover:underline"
                              >
                                Rework WO →
                              </Link>
                            )}
                            {d.repairWorkOrderId && (
                              <Link
                                href={`/work-orders/${d.repairWorkOrderId}`}
                                className="text-xs text-teal-400 hover:underline"
                              >
                                Repair WO →
                              </Link>
                            )}
                            {d.returnShipmentId && (
                              <Link
                                href={`/shipping/${d.returnShipmentId}`}
                                className="text-xs text-violet-400 hover:underline"
                              >
                                Return shipment →
                              </Link>
                            )}
                            {d.replacementPrId && (
                              <Link
                                href="/purchasing?tab=pr"
                                className="text-xs text-amber-400 hover:underline"
                              >
                                Replacement PR →
                              </Link>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {d.justification} · {d.decidedBy?.name} ·{" "}
                            {formatDate(d.decidedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {["OPEN", "IN_REVIEW"].includes(mrb.status) && (
                    <form
                      action={actionDispositionMrb}
                      className="space-y-3 rounded-lg border border-amber-900/40 bg-slate-950/50 p-4"
                    >
                      <p className="text-sm font-medium text-slate-200">
                        Board disposition
                      </p>
                      <input type="hidden" name="mrbCaseId" value={mrb.id} />
                      <input
                        type="hidden"
                        name="quantity"
                        value={String(mrb.ncr.quantity)}
                      />
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            "USE_AS_IS",
                            "REWORK",
                            "SCRAP",
                            "RETURN_TO_SUPPLIER",
                            "REPAIR",
                          ] as const
                        ).map((d) => (
                          <label
                            key={d}
                            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-700 px-2 py-1.5 text-xs hover:border-teal-500/50 has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500/10"
                          >
                            <input
                              type="radio"
                              name="disposition"
                              value={d}
                              defaultChecked={d === "RETURN_TO_SUPPLIER"}
                              className="accent-teal-500"
                            />
                            {d.replace(/_/g, " ")}
                          </label>
                        ))}
                      </div>
                      <Textarea
                        name="justification"
                        placeholder="Justification / root cause notes..."
                        required
                        defaultValue="Board disposition after review of inspection data and supplier history."
                      />
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          name="createCar"
                          value="true"
                          defaultChecked
                          className="accent-teal-500"
                        />
                        Create Corrective Action Request (CAR) — managed under
                        the CAR tab
                      </label>
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          name="createReplacementPr"
                          value="true"
                          defaultChecked
                          className="accent-teal-500"
                        />
                        If scrapped: raise a replacement purchase request for
                        the scrapped quantity (references this MRB)
                      </label>
                      <p className="text-[11px] text-slate-500">
                        Rework / repair create a linked work order · return to
                        supplier opens a return shipment with packing list ·
                        use-as-is releases stock back where it was.
                      </p>
                      <Button type="submit" size="sm">
                        Record disposition
                      </Button>
                    </form>
                  )}

                  {mrb.status === "DISPOSITIONED" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-900/40 bg-emerald-500/5 p-3">
                      <p className="text-xs text-slate-400">
                        Dispositioned — still open until closed. Verify the
                        disposition was carried out (return shipped, rework WO
                        complete, stock relieved), then close it out.
                      </p>
                      <form action={actionCloseMrbCase}>
                        <input type="hidden" name="mrbCaseId" value={mrb.id} />
                        <Button type="submit" size="sm" variant="secondary">
                          Close case
                        </Button>
                      </form>
                    </div>
                  )}

                  {mrb.ncr.supplier && (
                    <Link
                      href={`/suppliers/${mrb.ncr.supplierId}`}
                      className="text-xs text-teal-400 hover:underline"
                    >
                      View supplier profile →
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
