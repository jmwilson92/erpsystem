import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionCloseGfpTraveler,
  actionCompleteReceivingPutaway,
} from "@/app/actions";
import { ReceiveForm } from "@/components/receiving/receive-form";
import Link from "next/link";
import { GitBranch } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReceivingTravelerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const traveler = await prisma.receivingTraveler.findUnique({
    where: { id },
    include: {
      parent: true,
      children: { orderBy: { createdAt: "asc" } },
      customer: true,
      lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
      purchaseOrder: {
        include: {
          supplier: true,
          lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
          project: true,
          wbsElement: true,
          receipts: {
            orderBy: { receivedAt: "desc" },
            include: { lines: true },
          },
        },
      },
      receipts: {
        orderBy: { receivedAt: "desc" },
        include: { lines: true },
      },
    },
  });
  if (!traveler) notFound();

  const photos = await prisma.receivingPhoto.findMany({
    where: traveler.purchaseOrderId
      ? { purchaseOrderId: traveler.purchaseOrderId }
      : { receiptId: { in: traveler.receipts.map((r) => r.id) } },
    orderBy: { takenAt: "desc" },
    take: 24,
  });

  const docs = await prisma.receivingDocument.findMany({
    where: {
      OR: [
        ...(traveler.purchaseOrderId
          ? [{ purchaseOrderId: traveler.purchaseOrderId }]
          : []),
        { receiptId: { in: traveler.receipts.map((r) => r.id) } },
      ],
    },
    orderBy: { uploadedAt: "desc" },
    take: 40,
  });

  const isGfpTraveler = !traveler.purchaseOrderId;
  const po = traveler.purchaseOrder;

  const displayLines = isGfpTraveler
    ? traveler.lines.map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        quantityReceived: l.quantityReceived,
        partNumber: l.part?.partNumber,
        partId: l.partId,
        uom: l.uom,
        requiresGdtInspection: l.part?.requiresGdtInspection ?? false,
        requiresFunctionalTest: l.part?.requiresFunctionalTest ?? false,
        isTravelerLine: true,
      }))
    : (po?.lines || []).map((l) => ({
        id: l.id,
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        quantityReceived: l.quantityReceived,
        partNumber: l.part?.partNumber,
        partId: l.partId,
        uom: l.uom,
        requiresGdtInspection: l.part?.requiresGdtInspection ?? false,
        requiresFunctionalTest: l.part?.requiresFunctionalTest ?? false,
        isTravelerLine: false,
      }));

  const allReceived = displayLines.every(
    (l) => l.quantityReceived >= l.quantity
  );
  const canReceive =
    ["WAITING", "PARTIAL"].includes(traveler.status) &&
    displayLines.some((l) => l.quantityReceived < l.quantity) &&
    (isGfpTraveler ||
      (po &&
        ["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "RECEIVED"].includes(
          po.status
        ) &&
        po.status !== "CLOSED" &&
        po.status !== "CANCELLED"));

  const canCompleteStock = traveler.status === "READY_TO_STOCK";
  const inInspection = traveler.status === "IN_INSPECTION";

  // Close PO is purchasing-only (PO module) — not available on the receiving traveler
  const canCloseGfp =
    isGfpTraveler &&
    allReceived &&
    traveler.status === "COMPLETE";

  const receipts = isGfpTraveler ? traveler.receipts : po?.receipts || [];
  const locations = await prisma.location.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });

  // Where is material right now (exact QA vs Test station)?
  const receiptIds = receipts.map((r) => r.id);
  const openInspectionsRaw =
    inInspection && receiptIds.length > 0
      ? await prisma.inspection.findMany({
          where: {
            receiptId: { in: receiptIds },
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
          include: {
            workOrder: {
              select: {
                id: true,
                number: true,
                workCenter: true,
                department: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const inspPartIds = [
    ...new Set(
      openInspectionsRaw.map((i) => i.partId).filter((id): id is string => !!id)
    ),
  ];
  const inspParts =
    inspPartIds.length > 0
      ? await prisma.part.findMany({
          where: { id: { in: inspPartIds } },
          select: { id: true, partNumber: true },
        })
      : [];
  const partNumById = Object.fromEntries(
    inspParts.map((p) => [p.id, p.partNumber])
  );
  const openInspections = openInspectionsRaw.map((i) => ({
    ...i,
    partNumber: i.partId ? partNumById[i.partId] : undefined,
  }));

  const qaPending = openInspections.filter((i) =>
    ["VISUAL", "GDT"].includes(i.type)
  );
  const testPending = openInspections.filter((i) => i.type === "FUNCTIONAL");

  // Prefer live open inspections; fall back to workcenter of any in-progress WO
  let locationLabel: string | null = null;
  let locationDetail: string | null = null;
  let locationHref: string | null = null;
  if (inInspection) {
    if (qaPending.length > 0) {
      const wc =
        qaPending[0].workOrder?.workCenter ||
        qaPending[0].workCenter ||
        "QA-01";
      locationLabel = `QA — ${wc}`;
      locationDetail = `Visual / GD&T in progress (${qaPending.length} open)`;
      locationHref = "/quality";
    } else if (testPending.length > 0) {
      const wc =
        testPending[0].workOrder?.workCenter ||
        testPending[0].workCenter ||
        "TEST-01";
      locationLabel = `Test Center — ${wc}`;
      locationDetail = `Functional / power test in progress (${testPending.length} open)`;
      locationHref = "/test-center";
    } else {
      // Between handoff or inspections just completed
      locationLabel = "QA / Test handoff";
      locationDetail =
        "No open inspections found — check Quality or Test Center queues";
      locationHref = "/quality";
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={traveler.number}
        description={
          isGfpTraveler
            ? `Customer / GFP traveler${traveler.customer ? ` · ${traveler.customer.name}` : ""}${
                traveler.contractNumber ? ` · ${traveler.contractNumber}` : ""
              }`
            : `Receiving traveler for ${po!.number} · ${po!.supplier.name}`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/receiving">
              <Button variant="outline" size="sm">
                All travelers
              </Button>
            </Link>
            {po && (
              <Link href={`/purchasing/po/${po.id}`}>
                <Button variant="secondary" size="sm">
                  Open PO
                </Button>
              </Link>
            )}
            {canCloseGfp && (
              <form action={actionCloseGfpTraveler}>
                <input type="hidden" name="travelerId" value={traveler.id} />
                <Button type="submit" size="sm">
                  Close GFP traveler
                </Button>
              </form>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={traveler.status} />
        <StatusBadge status={traveler.travelerType} />
        {po && <StatusBadge status={po.status} />}
        {traveler.parent && (
          <Link
            href={`/receiving/${traveler.parent.id}`}
            className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 text-xs text-sky-400 hover:underline"
          >
            <GitBranch className="h-3 w-3" />
            Child of {traveler.parent.number}
          </Link>
        )}
        <span className="text-xs text-slate-500">
          EDD {formatDate(traveler.expectedDate || po?.promisedDate)}
        </span>
      </div>

      {traveler.children.length > 0 && (
        <Card className="border-sky-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Child travelers (remainders)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {traveler.children.map((c) => (
              <Link
                key={c.id}
                href={`/receiving/${c.id}`}
                className="rounded border border-slate-700 px-2 py-1 font-mono text-xs text-sky-400 hover:border-sky-600"
              >
                {c.number} · <StatusBadge status={c.status} className="ml-1" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-700">
        <CardContent className="space-y-4 p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            {po ? (
              <>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">PO</p>
                  <Link
                    href={`/purchasing/po/${po.id}`}
                    className="font-mono text-teal-400"
                  >
                    {po.number}
                  </Link>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Vendor</p>
                  <p className="text-slate-200">{po.supplier.name}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">
                    Project / WBS
                  </p>
                  <p className="font-mono text-xs text-slate-300">
                    {po.project?.number || "—"}
                    {po.wbsElement ? ` / ${po.wbsElement.code}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Amount</p>
                  <p className="tabular-nums text-slate-200">
                    {formatCurrency(po.totalAmount)}
                  </p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Customer</p>
                  <p className="text-slate-200">
                    {traveler.customer?.name || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Contract</p>
                  <p className="font-mono text-xs text-slate-300">
                    {traveler.contractNumber || "—"}
                    {traveler.clin ? ` / CLIN ${traveler.clin}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Ship from</p>
                  <p className="text-xs text-slate-300">
                    {traveler.shipFromName || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase text-slate-500">Type</p>
                  <p className="text-slate-200">{traveler.travelerType}</p>
                </div>
              </>
            )}
          </div>

          {traveler.notes && (
            <p className="text-xs text-slate-500">{traveler.notes}</p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-[10px] uppercase text-slate-500">
                <th className="pb-2">#</th>
                <th className="pb-2">Part</th>
                <th className="pb-2 text-right">Ordered</th>
                <th className="pb-2 text-right">Received</th>
                <th className="pb-2 text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {displayLines.map((l) => {
                const open = Math.max(0, l.quantity - l.quantityReceived);
                return (
                  <tr key={l.id} className="border-b border-slate-800/60">
                    <td className="py-2 text-slate-500">{l.lineNumber}</td>
                    <td className="py-2">
                      <span className="font-mono text-teal-400">
                        {l.partNumber || "—"}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {l.description}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{l.quantity}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-400">
                      {l.quantityReceived}
                    </td>
                    <td
                      className={`py-2 text-right tabular-nums ${
                        open > 0 ? "text-amber-400" : "text-slate-600"
                      }`}
                    >
                      {open}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {inInspection && (
        <Card className="border-amber-900/40">
          <CardContent className="space-y-3 p-4 text-sm text-slate-300">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                Current location
              </p>
              <p className="text-lg font-semibold text-amber-300">
                {locationLabel}
              </p>
              {locationDetail && (
                <p className="mt-0.5 text-xs text-slate-400">{locationDetail}</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Traveler stays open until inspections pass, then returns here for
                putaway. Visual / GD&amp;T always run in QA first; functional runs
                in Test Center after QA passes.
              </p>
            </div>

            {(qaPending.length > 0 || testPending.length > 0) && (
              <div className="space-y-1.5 rounded border border-slate-800 bg-slate-950/50 p-2">
                {openInspections.map((insp) => {
                  const area = ["VISUAL", "GDT"].includes(insp.type)
                    ? "QA"
                    : "Test";
                  const wc =
                    insp.workOrder?.workCenter ||
                    insp.workCenter ||
                    (area === "QA" ? "QA-01" : "TEST-01");
                  return (
                    <div
                      key={insp.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <span>
                        <span className="font-mono text-teal-400">
                          {insp.partNumber || "—"}
                        </span>
                        <span className="ml-2 text-slate-400">
                          {insp.type === "GDT"
                            ? "GD&T"
                            : insp.type === "VISUAL"
                              ? "Visual"
                              : "Functional"}
                        </span>
                        <span className="ml-2 text-amber-200/90">
                          @ {area} · {wc}
                        </span>
                        {insp.workOrder && (
                          <Link
                            href={`/work-orders/${insp.workOrder.id}`}
                            className="ml-2 font-mono text-sky-400 hover:underline"
                          >
                            {insp.workOrder.number}
                          </Link>
                        )}
                      </span>
                      <StatusBadge status={insp.status} />
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {locationHref && (
                <Link href={locationHref}>
                  <Button size="sm" variant="secondary">
                    Go to {qaPending.length > 0 ? "QA" : "Test Center"}
                  </Button>
                </Link>
              )}
              <Link href="/quality">
                <Button size="sm" variant="outline">
                  QA queue
                </Button>
              </Link>
              <Link href="/test-center">
                <Button size="sm" variant="outline">
                  Test Center
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {canCompleteStock && (
        <Card className="border-teal-900/40">
          <CardHeader>
            <CardTitle>Complete putaway</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">
              Inspections passed — put away and close this receiving traveler.
            </p>
            <form action={actionCompleteReceivingPutaway} className="flex flex-wrap gap-2">
              <input type="hidden" name="travelerId" value={traveler.id} />
              <select
                name="putawayLocationCode"
                required
                className="flex h-9 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                defaultValue={
                  locations.find((l) => l.type === "GFP")?.code ||
                  locations.find((l) => l.type === "STORAGE")?.code ||
                  ""
                }
              >
                <option value="">Select stock location…</option>
                {locations
                  .filter((l) =>
                    ["STORAGE", "GFP", "WIP", "SHIPPING"].includes(l.type)
                  )
                  .map((l) => (
                    <option key={l.id} value={l.code}>
                      {l.code}
                      {l.name ? ` — ${l.name}` : ""} ({l.type})
                    </option>
                  ))}
              </select>
              <Button type="submit" size="sm">
                Put away &amp; complete traveler
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {canReceive && (
        <Card className="border-teal-900/40">
          <CardHeader>
            <CardTitle>Receive material</CardTitle>
          </CardHeader>
          <CardContent>
            <ReceiveForm
              purchaseOrderId={po?.id}
              travelerId={traveler.id}
              isGfpTraveler={isGfpTraveler}
              defaultContractNumber={
                traveler.contractNumber || po?.clin || ""
              }
              lines={displayLines}
              locations={locations.map((l) => ({
                code: l.code,
                name: l.name,
                type: l.type,
              }))}
            />
          </CardContent>
        </Card>
      )}

      {docs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Attached documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between border-b border-slate-800/60 py-1.5"
              >
                <span>
                  <StatusBadge status={d.docType} />
                  <span className="ml-2 text-xs text-slate-400">
                    {d.fileName || d.caption || "file"}
                  </span>
                </span>
                <span className="text-[10px] text-slate-600">
                  {formatDate(d.uploadedAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Receiving photos</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {photos.map((p) => (
              <div key={p.id} className="w-28 space-y-1">
                <div className="h-24 w-28 overflow-hidden rounded border border-slate-700 bg-slate-900">
                  {p.url.startsWith("data:") ||
                  p.url.startsWith("http") ||
                  p.url.startsWith("/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.url}
                      alt={p.caption || "Receiving"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center p-1 text-[10px] text-slate-600">
                      {p.caption || "photo"}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Receipt history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {receipts.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-teal-400">{r.number}</span>
                  <StatusBadge status={r.status} className="ml-2" />
                  {r.dd1149Attached && (
                    <span className="ml-2 text-[10px] text-violet-400">
                      DD1149
                    </span>
                  )}
                </div>
                <span className="text-xs text-slate-500">
                  {formatDate(r.receivedAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
