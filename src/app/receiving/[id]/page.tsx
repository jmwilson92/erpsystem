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
import {
  GitBranch,
  History,
  MapPin,
  FlaskConical,
  Package,
  ClipboardList,
  FileText,
  Camera,
} from "lucide-react";

export const dynamic = "force-dynamic";

function fmtWhen(d: Date | string | null | undefined) {
  if (!d) return "—";
  return formatDate(d, "MMM d, yyyy HH:mm");
}

type TimelineEvent = {
  at: Date;
  kind: string;
  title: string;
  detail?: string;
  href?: string;
  status?: string;
  meta?: string;
};

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
            include: {
              lines: true,
            },
          },
        },
      },
      receipts: {
        orderBy: { receivedAt: "desc" },
        include: {
          lines: true,
        },
      },
    },
  });
  if (!traveler) notFound();

  const isGfpTraveler = !traveler.purchaseOrderId;
  const po = traveler.purchaseOrder;
  const receipts = isGfpTraveler ? traveler.receipts : po?.receipts || [];
  const receiptIds = receipts.map((r) => r.id);
  const lotNumbers = [
    ...new Set(
      receipts
        .flatMap((r) => r.lines.map((l) => l.lotNumber))
        .filter((x): x is string => !!x)
    ),
  ];
  const partIdsFromReceipts = [
    ...new Set(
      receipts
        .flatMap((r) => r.lines.map((l) => l.partId))
        .filter((x): x is string => !!x)
    ),
  ];

  const [
    photos,
    docs,
    allInspections,
    materialTxns,
    inventoryByLot,
    receivers,
  ] = await Promise.all([
    prisma.receivingPhoto.findMany({
      where: traveler.purchaseOrderId
        ? { purchaseOrderId: traveler.purchaseOrderId }
        : { receiptId: { in: receiptIds } },
      orderBy: { takenAt: "desc" },
      take: 48,
    }),
    prisma.receivingDocument.findMany({
      where: {
        OR: [
          ...(traveler.purchaseOrderId
            ? [{ purchaseOrderId: traveler.purchaseOrderId }]
            : []),
          { receiptId: { in: receiptIds } },
          ...(receiptIds.length
            ? [{ inspection: { receiptId: { in: receiptIds } } }]
            : []),
        ],
      },
      orderBy: { uploadedAt: "desc" },
      take: 60,
    }),
    receiptIds.length > 0
      ? prisma.inspection.findMany({
          where: {
            OR: [
              { receiptId: { in: receiptIds } },
              ...(traveler.purchaseOrderId
                ? [{ purchaseOrderId: traveler.purchaseOrderId }]
                : []),
            ],
          },
          include: {
            results: true,
            documents: true,
            ncrs: {
              include: {
                mrbCases: { select: { id: true, number: true, status: true } },
              },
            },
            workOrder: {
              select: {
                id: true,
                number: true,
                workCenter: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        })
      : Promise.resolve([]),
    prisma.materialTransaction.findMany({
      where: {
        OR: [
          ...(traveler.purchaseOrderId
            ? [{ purchaseOrderId: traveler.purchaseOrderId }]
            : []),
          { reference: traveler.number },
          ...(receipts.length
            ? [{ reference: { in: receipts.map((r) => r.number) } }]
            : []),
          ...(lotNumbers.length ? [{ lotNumber: { in: lotNumbers } }] : []),
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 80,
    }),
    lotNumbers.length || partIdsFromReceipts.length
      ? prisma.inventoryItem.findMany({
          where: {
            OR: [
              ...(lotNumbers.length
                ? [{ lotNumber: { in: lotNumbers } }]
                : []),
              ...(partIdsFromReceipts.length
                ? [
                    {
                      partId: { in: partIdsFromReceipts },
                      ...(traveler.purchaseOrderId
                        ? {}
                        : { ownership: { in: ["GOVERNMENT", "CUSTOMER"] } }),
                    },
                  ]
                : []),
            ],
          },
          include: {
            part: { select: { partNumber: true, description: true } },
            location: { include: { warehouse: true } },
            mrbCase: { select: { number: true, status: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 40,
        })
      : Promise.resolve([]),
    // Resolve receivedBy names
    (() => {
      const ids = [
        ...new Set(
          receipts
            .map((r) => r.receivedById)
            .filter((x): x is string => !!x)
        ),
      ];
      if (!ids.length) return Promise.resolve([] as { id: string; name: string }[]);
      return prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
    })(),
  ]);

  const userNameById = Object.fromEntries(receivers.map((u) => [u.id, u.name]));

  const inspPartIds = [
    ...new Set(
      allInspections.map((i) => i.partId).filter((id): id is string => !!id)
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

  // Enrich inventory with part numbers from receipts when part match is loose
  const stockRows = inventoryByLot.filter((inv) => {
    if (lotNumbers.length && inv.lotNumber && lotNumbers.includes(inv.lotNumber))
      return true;
    if (partIdsFromReceipts.includes(inv.partId) && inv.quantityOnHand > 0)
      return true;
    return lotNumbers.length === 0 && partIdsFromReceipts.includes(inv.partId);
  });

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
  const isComplete = ["COMPLETE", "CLOSED"].includes(traveler.status);

  const canCloseGfp =
    isGfpTraveler && allReceived && traveler.status === "COMPLETE";

  const locations = await prisma.location.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
  });

  const openInspections = allInspections
    .filter((i) => ["PENDING", "IN_PROGRESS"].includes(i.status))
    .map((i) => ({
      ...i,
      partNumber: i.partId ? partNumById[i.partId] : undefined,
    }));
  const qaPending = openInspections.filter((i) =>
    ["VISUAL", "GDT"].includes(i.type)
  );
  const testPending = openInspections.filter((i) => i.type === "FUNCTIONAL");

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
      locationHref = "/qa";
    } else if (testPending.length > 0) {
      const wc =
        testPending[0].workOrder?.workCenter ||
        testPending[0].workCenter ||
        "TEST-01";
      locationLabel = `Test Center — ${wc}`;
      locationDetail = `Functional / power test in progress (${testPending.length} open)`;
      locationHref = "/test-center";
    } else {
      locationLabel = "QA / Test handoff";
      locationDetail =
        "No open inspections found — check QA or Test Center queues";
      locationHref = "/qa";
    }
  }

  // ── Build chronological history timeline ─────────────────
  const timeline: TimelineEvent[] = [];

  timeline.push({
    at: traveler.createdAt,
    kind: "CREATED",
    title: `Traveler ${traveler.number} created`,
    detail: isGfpTraveler
      ? `GFP / ${traveler.travelerType}${traveler.customer ? ` · ${traveler.customer.name}` : ""}`
      : `PO ${po?.number} · ${po?.supplier.name}`,
    status: "CREATED",
  });

  if (traveler.parent) {
    timeline.push({
      at: traveler.createdAt,
      kind: "SPLIT",
      title: `Split from parent ${traveler.parent.number}`,
      href: `/receiving/${traveler.parent.id}`,
      status: "SPLIT",
    });
  }

  for (const r of [...receipts].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  )) {
    const who = r.receivedById
      ? userNameById[r.receivedById] || "Receiver"
      : "Receiver";
    const lineSummary = r.lines
      .map(
        (l) =>
          `${l.quantityReceived}× ${l.description.slice(0, 40)}${
            l.lotNumber ? ` lot ${l.lotNumber}` : ""
          }`
      )
      .join("; ");
    timeline.push({
      at: r.receivedAt,
      kind: "RECEIPT",
      title: `Received ${r.number}`,
      detail: lineSummary || r.notes || undefined,
      meta: `${who}${r.dd1149Attached ? " · DD1149" : ""}`,
      status: r.status,
    });
  }

  for (const insp of allInspections) {
    const partNo = insp.partId ? partNumById[insp.partId] : "—";
    const wc =
      insp.workOrder?.workCenter ||
      insp.workCenter ||
      (["VISUAL", "GDT"].includes(insp.type) ? "QA" : "TEST");
    const typeLabel =
      insp.type === "GDT"
        ? "GD&T"
        : insp.type === "VISUAL"
          ? "Visual"
          : insp.type === "FUNCTIONAL"
            ? "Functional / power"
            : insp.type;
    timeline.push({
      at: insp.createdAt,
      kind: "INSPECTION_OPENED",
      title: `${typeLabel} inspection opened · ${insp.number}`,
      detail: `Part ${partNo} · station ${wc}${insp.lotNumber ? ` · lot ${insp.lotNumber}` : ""}`,
      href: insp.workOrderId
        ? `/work-orders/${insp.workOrderId}`
        : undefined,
      status: "PENDING",
      meta: insp.workOrder?.number,
    });
    if (insp.completedAt) {
      const resultBits = insp.results
        .map((r) => `${r.characteristic}: ${r.result}${r.measuredValue ? ` (${r.measuredValue})` : ""}`)
        .join("; ");
      timeline.push({
        at: insp.completedAt,
        kind: "INSPECTION_DONE",
        title: `${typeLabel} ${insp.status.toLowerCase()} · ${insp.number}`,
        detail:
          resultBits ||
          `Qty pass ${insp.quantityPassed} / fail ${insp.quantityFailed}`,
        status: insp.status,
        meta: wc,
      });
    }
    for (const ncr of insp.ncrs) {
      timeline.push({
        at: ncr.createdAt,
        kind: "NCR",
        title: `NCR ${ncr.number} · ${ncr.title}`,
        detail: ncr.mrbCases[0]
          ? `MRB ${ncr.mrbCases[0].number} (${ncr.mrbCases[0].status})`
          : ncr.status,
        status: ncr.severity,
        href: "/quality",
      });
    }
  }

  for (const tx of materialTxns) {
    timeline.push({
      at: tx.createdAt,
      kind: tx.type,
      title: `${tx.type.replace(/_/g, " ")}${tx.quantity ? ` · qty ${tx.quantity}` : ""}`,
      detail: [
        tx.fromLocation && tx.toLocation
          ? `${tx.fromLocation} → ${tx.toLocation}`
          : tx.toLocation
            ? `→ ${tx.toLocation}`
            : tx.fromLocation || null,
        tx.lotNumber ? `Lot ${tx.lotNumber}` : null,
        tx.serialNumber ? `S/N ${tx.serialNumber}` : null,
        tx.notes,
      ]
        .filter(Boolean)
        .join(" · "),
      meta: tx.reference || undefined,
      status: tx.type,
    });
  }

  for (const c of traveler.children) {
    timeline.push({
      at: c.createdAt,
      kind: "CHILD",
      title: `Child traveler ${c.number}`,
      detail: `Remainder / split · ${c.status}`,
      href: `/receiving/${c.id}`,
      status: c.status,
    });
  }

  if (isComplete) {
    timeline.push({
      at: traveler.updatedAt,
      kind: "COMPLETE",
      title: `Traveler ${traveler.status.toLowerCase()}`,
      detail: "Receiving lifecycle finished",
      status: traveler.status,
    });
  }

  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  const completedInspections = allInspections.filter((i) =>
    ["PASSED", "FAILED", "WAIVED"].includes(i.status)
  );

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
        {isComplete && (
          <span className="rounded border border-emerald-500/30 px-2 py-0.5 text-[10px] text-emerald-400">
            Full history below
          </span>
        )}
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
            <form
              action={actionCompleteReceivingPutaway}
              className="flex flex-wrap gap-2"
            >
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

      {/* ═══════════════ FULL HISTORY (esp. completed) ═══════════════ */}
      <Card className="border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-teal-400" />
            Full history timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-slate-500">No history events yet.</p>
          ) : (
            <ol className="relative space-y-0 border-l border-slate-800 pl-4">
              {timeline.map((evt, idx) => (
                <li key={`${evt.kind}-${idx}-${evt.at.getTime()}`} className="relative pb-4 last:pb-0">
                  <span
                    className={`absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full border ${
                      evt.kind.includes("INSPECTION")
                        ? "border-violet-500 bg-violet-500/40"
                        : evt.kind === "RECEIPT"
                          ? "border-teal-500 bg-teal-500/40"
                          : evt.kind === "PUTAWAY" || evt.kind === "COMPLETE"
                            ? "border-emerald-500 bg-emerald-500/40"
                            : evt.kind === "NCR"
                              ? "border-amber-500 bg-amber-500/40"
                              : "border-slate-500 bg-slate-700"
                    }`}
                  />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm text-slate-100">
                      {evt.href ? (
                        <Link
                          href={evt.href}
                          className="hover:text-sky-400 hover:underline"
                        >
                          {evt.title}
                        </Link>
                      ) : (
                        evt.title
                      )}
                    </p>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      {fmtWhen(evt.at)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    {evt.status && <StatusBadge status={evt.status} />}
                    {evt.meta && (
                      <span className="text-[11px] text-slate-500">{evt.meta}</span>
                    )}
                  </div>
                  {evt.detail && (
                    <p className="mt-1 text-xs text-slate-400">{evt.detail}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Receipts with line detail */}
      {receipts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4 w-4 text-teal-400" />
              Receipts ({receipts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {receipts.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-teal-400">{r.number}</span>
                    <StatusBadge status={r.status} />
                    {r.dd1149Attached && (
                      <span className="text-[10px] text-violet-400">DD1149</span>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    {fmtWhen(r.receivedAt)}
                    {r.receivedById
                      ? ` · ${userNameById[r.receivedById] || ""}`
                      : ""}
                  </span>
                </div>
                {r.notes && (
                  <p className="mt-1 text-xs text-slate-500">{r.notes}</p>
                )}
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-slate-600">
                      <th className="py-1">Description</th>
                      <th className="py-1 text-right">Ordered</th>
                      <th className="py-1 text-right">Received</th>
                      <th className="py-1">Lot / serial</th>
                      <th className="py-1">Ownership</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.lines.map((l) => (
                      <tr key={l.id} className="border-t border-slate-800/60">
                        <td className="py-1.5 text-slate-300">{l.description}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-500">
                          {l.quantityOrdered}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-emerald-400">
                          {l.quantityReceived}
                        </td>
                        <td className="py-1.5 font-mono text-slate-400">
                          {l.lotNumber || "—"}
                          {l.serialNumbers
                            ? ` · ${l.serialNumbers.slice(0, 40)}`
                            : ""}
                        </td>
                        <td className="py-1.5">
                          <StatusBadge status={l.ownership} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Inspections / tests */}
      {allInspections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-violet-400" />
              Inspections &amp; tests ({allInspections.length})
              {completedInspections.length > 0 && (
                <span className="font-normal text-xs text-slate-500">
                  · {completedInspections.filter((i) => i.status === "PASSED").length}{" "}
                  passed
                  {completedInspections.filter((i) => i.status === "FAILED").length
                    ? ` · ${completedInspections.filter((i) => i.status === "FAILED").length} failed`
                    : ""}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allInspections.map((insp) => {
              const partNo = insp.partId ? partNumById[insp.partId] : "—";
              const wc =
                insp.workOrder?.workCenter ||
                insp.workCenter ||
                (["VISUAL", "GDT"].includes(insp.type) ? "QA-01" : "TEST-01");
              const area = ["VISUAL", "GDT", "RECEIVING"].includes(insp.type)
                ? "QA"
                : "Test";
              return (
                <div
                  key={insp.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sky-400">
                          {insp.number}
                        </span>
                        <StatusBadge status={insp.type} />
                        <StatusBadge status={insp.status} />
                        <span className="font-mono text-[10px] text-slate-500">
                          @ {area} · {wc}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-teal-400">{partNo}</p>
                      <p className="text-xs text-slate-500">
                        Qty {insp.quantity}
                        {insp.lotNumber ? ` · Lot ${insp.lotNumber}` : ""}
                        {insp.serialNumber ? ` · S/N ${insp.serialNumber}` : ""}
                        {insp.plannedPutawayCode
                          ? ` · Planned putaway ${insp.plannedPutawayCode}`
                          : ""}
                      </p>
                      {insp.workOrder && (
                        <Link
                          href={`/work-orders/${insp.workOrder.id}`}
                          className="mt-0.5 inline-block font-mono text-xs text-sky-400 hover:underline"
                        >
                          WO {insp.workOrder.number}
                        </Link>
                      )}
                    </div>
                    <div className="text-right text-[10px] text-slate-600">
                      <p>Opened {fmtWhen(insp.createdAt)}</p>
                      {insp.completedAt && (
                        <p>Done {fmtWhen(insp.completedAt)}</p>
                      )}
                      {(insp.quantityPassed > 0 || insp.quantityFailed > 0) && (
                        <p className="text-slate-400">
                          Pass {insp.quantityPassed} / Fail {insp.quantityFailed}
                        </p>
                      )}
                    </div>
                  </div>
                  {insp.results.length > 0 && (
                    <div className="mt-2 space-y-1 rounded border border-slate-800/80 p-2">
                      <p className="text-[10px] uppercase text-slate-600">
                        Results
                      </p>
                      {insp.results.map((r) => (
                        <div
                          key={r.id}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="text-slate-300">
                            {r.characteristic}
                            {r.specification ? (
                              <span className="text-slate-500">
                                {" "}
                                ({r.specification})
                              </span>
                            ) : null}
                          </span>
                          <span className="flex items-center gap-2">
                            {r.measuredValue && (
                              <span className="font-mono text-slate-400">
                                {r.measuredValue}
                              </span>
                            )}
                            <StatusBadge status={r.result} />
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {insp.notes && (
                    <p className="mt-1 text-xs text-slate-500">{insp.notes}</p>
                  )}
                  {insp.documents.length > 0 && (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {insp.documents.length} document(s) on inspection
                    </p>
                  )}
                  {insp.ncrs.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {insp.ncrs.map((ncr) => (
                        <div
                          key={ncr.id}
                          className="rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-100"
                        >
                          NCR {ncr.number}: {ncr.title}
                          {ncr.mrbCases[0]
                            ? ` · MRB ${ncr.mrbCases[0].number}`
                            : ""}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Where stored */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="h-4 w-4 text-sky-400" />
            Stock locations
            {stockRows.length > 0 && (
              <span className="font-normal text-xs text-slate-500">
                ({stockRows.length} inventory line{stockRows.length === 1 ? "" : "s"})
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stockRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              {isComplete
                ? "No matching inventory lines found for this traveler’s lots/parts (may have been issued or adjusted)."
                : "Material not in stock locations yet — complete receive, inspections, and putaway."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Part</th>
                    <th className="px-3 py-2 text-left">Location</th>
                    <th className="px-3 py-2 text-right">On hand</th>
                    <th className="px-3 py-2 text-right">Available</th>
                    <th className="px-3 py-2 text-left">Lot / serial</th>
                    <th className="px-3 py-2 text-left">Ownership</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-t border-slate-800/60"
                    >
                      <td className="px-3 py-2">
                        <span className="font-mono text-teal-400">
                          {inv.part.partNumber}
                        </span>
                        <p className="text-[11px] text-slate-500">
                          {inv.part.description}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        <span className="font-mono text-sky-400">
                          {inv.location.warehouse.code}/{inv.location.code}
                        </span>
                        <span className="ml-1 text-[10px] text-slate-600">
                          {inv.location.type}
                          {inv.location.name ? ` · ${inv.location.name}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {inv.quantityOnHand}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                        {inv.quantityAvailable}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {inv.lotNumber || inv.serialNumber || "—"}
                        {inv.mrbCase && (
                          <p className="text-orange-400">{inv.mrbCase.number}</p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={inv.ownership} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {materialTxns.filter((t) =>
            ["PUTAWAY", "RECEIPT", "TRANSFER", "QUARANTINE", "RELEASE"].includes(
              t.type
            )
          ).length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-[10px] uppercase text-slate-500">
                Material movements
              </p>
              {materialTxns
                .filter((t) =>
                  [
                    "PUTAWAY",
                    "RECEIPT",
                    "TRANSFER",
                    "QUARANTINE",
                    "RELEASE",
                  ].includes(t.type)
                )
                .map((tx) => (
                  <div
                    key={tx.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800/60 px-2 py-1.5 text-xs"
                  >
                    <span>
                      <StatusBadge status={tx.type} className="mr-2" />
                      {tx.fromLocation || tx.toLocation ? (
                        <span className="text-slate-300">
                          {tx.fromLocation || "—"} → {tx.toLocation || "—"}
                        </span>
                      ) : (
                        <span className="text-slate-500">qty {tx.quantity}</span>
                      )}
                      {tx.lotNumber && (
                        <span className="ml-2 font-mono text-slate-500">
                          Lot {tx.lotNumber}
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {fmtWhen(tx.createdAt)}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {docs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-slate-400" />
              Attached documents ({docs.length})
            </CardTitle>
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
                  {d.lotNumber && (
                    <span className="ml-2 font-mono text-[10px] text-slate-600">
                      Lot {d.lotNumber}
                    </span>
                  )}
                </span>
                <span className="text-[10px] text-slate-600">
                  {fmtWhen(d.uploadedAt)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4 text-slate-400" />
              Receiving photos ({photos.length})
            </CardTitle>
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
                <p className="text-[10px] text-slate-600">
                  {fmtWhen(p.takenAt)}
                  {p.lotNumber ? ` · ${p.lotNumber}` : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Summary strip for complete */}
      {isComplete && (
        <Card className="border-emerald-900/30 bg-emerald-500/5">
          <CardContent className="flex flex-wrap gap-4 p-4 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              {receipts.length} receipt(s)
            </span>
            <span className="flex items-center gap-1">
              <FlaskConical className="h-3.5 w-3.5" />
              {allInspections.length} inspection(s)
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" />
              {stockRows.length} stock line(s)
            </span>
            <span className="flex items-center gap-1">
              <History className="h-3.5 w-3.5" />
              {timeline.length} timeline event(s)
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
