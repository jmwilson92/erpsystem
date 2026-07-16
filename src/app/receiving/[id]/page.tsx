import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  actionCloseGfpTraveler,
  actionCompleteReceivingPutaway,
  actionAttestDockAcceptance,
  actionScanIntoReceivingTraveler,
  actionScanOutReceivingTraveler,
  actionDeliverTravelerToStation,
} from "@/app/actions";
import { ReceiveForm } from "@/components/receiving/receive-form";
import { ReceivingNextStep } from "@/components/receiving/receiving-next-step";
import { ReceivingStepper } from "@/components/receiving/receiving-stepper";
import {
  nextActionForTraveler,
  stepperState,
} from "@/lib/services/receiving-ui";
import { travelerPurpose } from "@/lib/services/receiving";
import {
  inferDeliverArea,
  stationAreaOf,
} from "@/lib/services/receiving-time";
import { getCurrentUser } from "@/lib/auth";
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
import { ActivityTimeline } from "@/components/shared/activity-timeline";

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

  // Heal parent status if children finished while root was stuck PARTIAL
  if (!traveler.parentId && traveler.children.length > 0) {
    try {
      const { reconcileRootTravelerStatus } = await import(
        "@/lib/services/receiving"
      );
      const healed = await reconcileRootTravelerStatus({
        travelerId: traveler.id,
      });
      if (healed && healed.status !== traveler.status) {
        // Re-fetch full traveler after status heal
        const refreshed = await prisma.receivingTraveler.findUnique({
          where: { id: traveler.id },
          include: {
            parent: true,
            children: { orderBy: { createdAt: "asc" } },
            customer: true,
            lines: { include: { part: true }, orderBy: { lineNumber: "asc" } },
            purchaseOrder: {
              include: {
                supplier: true,
                lines: {
                  include: { part: true },
                  orderBy: { lineNumber: "asc" },
                },
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
        if (refreshed) {
          Object.assign(traveler, refreshed);
        }
      }
    } catch {
      /* non-fatal */
    }
  }

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

  const purpose = travelerPurpose(traveler);

  // GFP + in-process children: traveler lines. PO dock/remainder: PO lines (open only).
  const useChildLines =
    purpose === "CHILD" ||
    (!!traveler.parentId &&
      ["IN_INSPECTION", "READY_TO_STOCK"].includes(traveler.status));

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
    : useChildLines
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
      : (po?.lines || [])
          .filter((l) =>
            purpose === "REMAINDER" ? l.quantityReceived < l.quantity : true
          )
          .map((l) => ({
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

  const allReceived =
    displayLines.length > 0 &&
    displayLines.every((l) => l.quantityReceived >= l.quantity);

  // Prefer working remainder children instead of the parent umbrella
  const openRemainderChild = traveler.children.find((c) =>
    ["WAITING", "PARTIAL"].includes(c.status)
  );
  const parentHasOpenRemainderChild =
    !traveler.parentId && !!openRemainderChild;

  const canReceive =
    ["WAITING", "PARTIAL"].includes(traveler.status) &&
    !parentHasOpenRemainderChild &&
    purpose !== "CHILD" &&
    !["IN_INSPECTION", "READY_TO_STOCK"].includes(traveler.status) &&
    displayLines.some((l) => l.quantityReceived < l.quantity) &&
    (isGfpTraveler ||
      !po ||
      (["ISSUED", "ACKNOWLEDGED", "PARTIAL_RECEIPT", "RECEIVED"].includes(
        po.status
      ) &&
        po.status !== "CLOSED" &&
        po.status !== "CANCELLED"));

  // Functional procedures only on child travelers that actually need functional work
  const isChildTraveler = !!traveler.parentId || purpose === "CHILD";
  const functionalTestPartIds =
    isChildTraveler
      ? displayLines
          .filter((l) => l.requiresFunctionalTest && l.partId)
          .map((l) => l.partId as string)
      : [];
  const functionalTestCallouts = functionalTestPartIds.length
    ? await prisma.part.findMany({
        where: {
          id: { in: functionalTestPartIds },
          functionalTestProcedureId: { not: null },
        },
        select: {
          partNumber: true,
          functionalTestProcedure: {
            select: {
              id: true,
              number: true,
              revision: true,
              title: true,
              status: true,
            },
          },
        },
      })
    : [];

  const canCompleteStock = traveler.status === "READY_TO_STOCK";
  const inInspection = traveler.status === "IN_INSPECTION";
  const isComplete = ["COMPLETE", "CLOSED"].includes(traveler.status);

  // Parent: children still needing MH walk / waiting at station
  const openChildren = !traveler.parentId
    ? traveler.children.filter((c) =>
        ["IN_INSPECTION", "READY_TO_STOCK", "PARTIAL", "WAITING"].includes(
          c.status
        )
      )
    : [];
  // READY_TO_STOCK children — put away first (don't block on siblings at QA)
  const putawayChild =
    openChildren.find((c) => c.status === "READY_TO_STOCK") || null;
  // Already delivered / parked at a station
  const waitingAtStation = openChildren.filter(
    (c) => !!c.currentWorkCenter && c.status === "IN_INSPECTION"
  );
  const waitingChild = waitingAtStation[0] || null;
  // Next undelivered station child (priority over "waiting" message)
  const inspectionChild =
    openChildren.find(
      (c) =>
        c.status === "IN_INSPECTION" &&
        !c.currentWorkCenter &&
        c.id !== putawayChild?.id
    ) || null;

  const canCloseGfp =
    isGfpTraveler && allReceived && traveler.status === "COMPLETE";

  const [locations, currentUser] = await Promise.all([
    prisma.location.findMany({
      orderBy: [{ type: "asc" }, { code: "asc" }],
    }),
    getCurrentUser().catch(() => null),
  ]);

  // Scope open inspections to THIS traveler for next-step / station routing.
  // Parents may see PO-wide history, but children must not inherit sibling QA noise.
  const childInvIds = new Set<string>();
  if (isChildTraveler && traveler.openLinesSnapshot) {
    try {
      const snap = JSON.parse(traveler.openLinesSnapshot) as {
        inventoryItemIds?: string[];
      };
      for (const id of snap.inventoryItemIds || []) childInvIds.add(id);
    } catch {
      /* ignore */
    }
  }
  const childPartIds = new Set(
    displayLines.map((l) => l.partId).filter((id): id is string => !!id)
  );
  const childLots = new Set(
    displayLines
      .map((l) => ("notes" in l ? String((l as { notes?: string }).notes || "") : ""))
      .join(" ")
      .match(/Lot\s+(\S+)/gi)
      ?.map((m) => m.replace(/Lot\s+/i, "")) || []
  );
  // Also lot from traveler line notes
  for (const l of traveler.lines) {
    if (l.notes?.startsWith("Lot ")) childLots.add(l.notes.slice(4).trim());
  }
  const thisTravelerReceiptIds = new Set(traveler.receipts.map((r) => r.id));

  function inspectionBelongsHere(i: {
    type: string;
    inventoryItemId: string | null;
    partId: string | null;
    lotNumber: string | null;
    receiptId: string | null;
  }): boolean {
    if (!isChildTraveler) return true;
    if (i.inventoryItemId && childInvIds.has(i.inventoryItemId)) return true;
    if (i.lotNumber && childLots.has(i.lotNumber)) return true;
    // Receipt reassigned to this child
    if (i.receiptId && thisTravelerReceiptIds.has(i.receiptId)) return true;
    // Part match only when we have inv/lot empty (weak) — require part + no conflicting siblings
    if (
      childInvIds.size === 0 &&
      childLots.size === 0 &&
      i.partId &&
      childPartIds.has(i.partId)
    ) {
      return true;
    }
    return false;
  }

  const openInspections = allInspections
    .filter((i) => ["PENDING", "IN_PROGRESS"].includes(i.status))
    .filter(inspectionBelongsHere)
    .map((i) => ({
      ...i,
      partNumber: i.partId ? partNumById[i.partId] : undefined,
    }));
  const qaPending = openInspections.filter((i) =>
    ["VISUAL", "GDT"].includes(i.type)
  );
  const testPending = openInspections.filter((i) => i.type === "FUNCTIONAL");
  const pendingDockAttest = openInspections.filter(
    (i) => i.type === "RECEIVING"
  );
  // Part flags only for THIS traveler's lines (not whole PO)
  const needsQa = displayLines.some((l) => l.requiresGdtInspection);
  const needsTest = displayLines.some((l) => l.requiresFunctionalTest);
  // Stepper / next: open inspections win over part flags for station
  const needsQaFlow = qaPending.length > 0 || (needsQa && testPending.length === 0);
  const needsTestFlow =
    testPending.length > 0 || (needsTest && qaPending.length === 0);

  function childWhere(c: {
    notes: string | null;
    status: string;
    currentWorkCenter: string | null;
  }): "QA" | "TEST" | "STATION" {
    const area = stationAreaOf(c);
    if (area === "TEST") return "TEST";
    if (area === "QA") return "QA";
    const inferred = inferDeliverArea({ notes: c.notes });
    if (inferred === "TEST") return "TEST";
    if (inferred === "QA") return "QA";
    if (c.status === "IN_INSPECTION") return "STATION";
    return "STATION";
  }

  const inspectionChildWhere = inspectionChild
    ? childWhere(inspectionChild)
    : null;
  const waitingChildWhere = waitingChild ? childWhere(waitingChild) : null;

  const atStationArea = stationAreaOf(traveler);
  const deliverArea = isChildTraveler
    ? inferDeliverArea({
        notes: traveler.notes,
        // Only use part flags when we have no open insp on this child
        needsQa: qaPending.length === 0 && testPending.length === 0 ? needsQa : false,
        needsTest:
          qaPending.length === 0 && testPending.length === 0 ? needsTest : false,
        hasQaPending: qaPending.length > 0,
        hasTestPending: testPending.length > 0,
      })
    : null;
  const needsDeliver =
    isChildTraveler &&
    inInspection &&
    !traveler.currentWorkCenter &&
    (qaPending.length > 0 ||
      testPending.length > 0 ||
      needsQa ||
      needsTest);

  const nextStep = nextActionForTraveler({
    status: traveler.status,
    purpose,
    canReceive,
    canCompleteStock,
    inInspection,
    hasQaPending: qaPending.length > 0,
    hasTestPending: testPending.length > 0,
    hasPendingDockAttest: pendingDockAttest.length > 0 && !canReceive,
    isComplete,
    followChildNumber: parentHasOpenRemainderChild
      ? openRemainderChild!.number
      : null,
    followChildId: parentHasOpenRemainderChild
      ? openRemainderChild!.id
      : null,
    // Putaway-ready children first, then undelivered, then waiting-only
    putawayChildNumber: putawayChild?.number ?? null,
    putawayChildId: putawayChild?.id ?? null,
    inspectionChildNumber: inspectionChild?.number ?? null,
    inspectionChildId: inspectionChild?.id ?? null,
    inspectionChildWhere,
    waitingChildNumber:
      !inspectionChild && !putawayChild
        ? waitingChild?.number ?? null
        : null,
    waitingChildId:
      !inspectionChild && !putawayChild ? waitingChild?.id ?? null : null,
    waitingChildWhere:
      !inspectionChild && !putawayChild ? waitingChildWhere : null,
    waitingChildStation:
      !inspectionChild && !putawayChild
        ? waitingChild?.currentWorkCenter ?? null
        : null,
    waitingChildCount: waitingAtStation.length,
    atStationCode: traveler.currentWorkCenter,
    atStationArea,
    needsDeliver,
    deliverArea,
    poId: po?.id,
  });

  const iAmScannedIn =
    !!currentUser &&
    traveler.activeScanUserId === currentUser.id &&
    !!traveler.activeScanAt;
  const someoneScannedIn =
    !!traveler.activeScanUserId && !!traveler.activeScanAt;

  const stepState = stepperState({
    status: traveler.status,
    needsQa: needsQaFlow,
    needsTest: needsTestFlow,
    isComplete,
    hasReceipt: receipts.length > 0,
    hasQaPending: qaPending.length > 0,
    hasTestPending: testPending.length > 0,
    canCompleteStock,
  });

  let locationLabel: string | null = null;
  let locationDetail: string | null = null;
  let locationHref: string | null = null;
  if (inInspection) {
    const destHint =
      deliverArea ||
      stationAreaOf(traveler) ||
      (needsTest && !needsQa ? "TEST" : needsQa ? "QA" : null);
    if (traveler.currentWorkCenter) {
      const area =
        stationAreaOf(traveler) ||
        (traveler.currentWorkCenter.toUpperCase().includes("TEST")
          ? "TEST"
          : "QA");
      locationLabel =
        area === "TEST"
          ? `Test Center — ${traveler.currentWorkCenter}`
          : `QA — ${traveler.currentWorkCenter}`;
      locationDetail =
        area === "TEST"
          ? "Parked at Test for functional / power"
          : "Parked at QA for visual / GD&T";
      locationHref = area === "TEST" ? "/test-center" : "/qa";
    } else if (qaPending.length > 0) {
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
    } else if (destHint === "TEST") {
      locationLabel = "Test Center";
      locationDetail = "Functional / power — deliver to Test, not QA";
      locationHref = "/test-center";
    } else if (destHint === "QA") {
      locationLabel = "QA";
      locationDetail = "Visual / GD&T — deliver to QA workcenter";
      locationHref = "/qa";
    } else {
      locationLabel = "Station handoff";
      locationDetail = "Check child notes for QA vs Test Center";
      locationHref = "/receiving";
    }
  }

  // ── Slim material-handler timeline (traveler events — no INSP-#####) ──
  const timeline: TimelineEvent[] = [];

  timeline.push({
    at: traveler.createdAt,
    kind: "CREATED",
    title: `Traveler ${traveler.number} opened`,
    detail: isGfpTraveler
      ? `GFP${traveler.customer ? ` · ${traveler.customer.name}` : ""}`
      : `PO ${po?.number} · ${po?.supplier.name}`,
    status: "CREATED",
  });

  if (traveler.parent) {
    timeline.push({
      at: traveler.createdAt,
      kind: "SPLIT",
      title: `Split from ${traveler.parent.number}`,
      href: `/receiving/${traveler.parent.id}`,
      status: "CHILD",
      detail: "Work this card — parent is umbrella only",
    });
  }

  for (const r of [...receipts].sort(
    (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()
  )) {
    const who = r.receivedById
      ? userNameById[r.receivedById] || "Dock"
      : "Dock";
    const effectiveStatus =
      // Prefer live station work over stored status (legacy COMPLETE-with-open-insp)
      allInspections.some(
        (i) =>
          i.receiptId === r.id &&
          i.type !== "RECEIVING" &&
          ["PENDING", "IN_PROGRESS"].includes(i.status)
      )
        ? "AWAITING_INSPECTION"
        : r.status;
    const needsMore = ["AWAITING_INSPECTION", "PARTIAL"].includes(
      effectiveStatus
    );
    timeline.push({
      at: r.receivedAt,
      kind: "RECEIPT",
      title: needsMore
        ? `Docked ${r.number} — station work on child traveler(s)`
        : `Dock complete ${r.number}`,
      detail: r.lines
        .map(
          (l) =>
            `${l.quantityReceived}× ${l.description.slice(0, 36)}${
              l.lotNumber ? ` · ${l.lotNumber}` : ""
            }`
        )
        .join("; "),
      meta: who,
      status: effectiveStatus,
    });
  }

  // Station progress without INSP numbers
  const qaDone = allInspections.filter(
    (i) => ["VISUAL", "GDT"].includes(i.type) && i.status === "PASSED"
  );
  const testDone = allInspections.filter(
    (i) => i.type === "FUNCTIONAL" && i.status === "PASSED"
  );
  for (const insp of qaDone) {
    timeline.push({
      at: insp.completedAt || insp.createdAt,
      kind: "STATION",
      title: `QA passed · ${partNumById[insp.partId || ""] || "part"}`,
      detail: insp.lotNumber ? `Lot ${insp.lotNumber}` : undefined,
      status: "PASSED",
      meta: "QA",
    });
  }
  for (const insp of testDone) {
    timeline.push({
      at: insp.completedAt || insp.createdAt,
      kind: "STATION",
      title: `Test Center passed · ${partNumById[insp.partId || ""] || "part"}`,
      detail: insp.lotNumber ? `Lot ${insp.lotNumber}` : undefined,
      status: "PASSED",
      meta: "TEST",
    });
  }
  for (const insp of allInspections.filter((i) => i.status === "FAILED")) {
    timeline.push({
      at: insp.completedAt || insp.createdAt,
      kind: "NCR",
      title: `Failed at ${
        ["VISUAL", "GDT"].includes(insp.type) ? "QA" : "Test"
      } · ${partNumById[insp.partId || ""] || "part"}`,
      status: "FAILED",
      href: "/quality",
    });
  }

  for (const tx of materialTxns.filter((t) =>
    ["PUTAWAY", "RECEIPT"].includes(t.type)
  )) {
    if (tx.type === "RECEIPT") continue; // covered by receipt events
    timeline.push({
      at: tx.createdAt,
      kind: "PUTAWAY",
      title: `Put away · qty ${tx.quantity || ""}`.trim(),
      detail: [tx.fromLocation, tx.toLocation].filter(Boolean).join(" → "),
      status: "PUTAWAY",
    });
  }

  for (const c of traveler.children) {
    const notes = (c.notes || "").toLowerCase();
    const dest = notes.includes("functional")
      ? "→ Test Center"
      : notes.includes("visual") || notes.includes("gd")
        ? "→ QA"
        : notes.includes("remainder") || c.status === "WAITING"
          ? "dock remainder"
          : "station work";
    timeline.push({
      at: c.createdAt,
      kind: "CHILD",
      title: `Child ${c.number} created`,
      detail: dest,
      href: `/receiving/${c.id}`,
      status: c.status,
    });
  }

  if (isComplete) {
    timeline.push({
      at: traveler.updatedAt,
      kind: "COMPLETE",
      title: `${traveler.number} complete`,
      detail: "Receiving finished",
      status: traveler.status,
    });
  }

  timeline.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Station work (QA / Test) — keep RECEIVING dock records separate
  const stationWork = allInspections.filter((i) => i.type !== "RECEIVING");
  const dockWork = allInspections.filter((i) => i.type === "RECEIVING");
  const openStationWork = stationWork.filter((i) =>
    ["PENDING", "IN_PROGRESS"].includes(i.status)
  );
  const stationPassed = stationWork.filter((i) => i.status === "PASSED").length;
  const stationFailed = stationWork.filter((i) => i.status === "FAILED").length;

  // Effective receipt badge: never show COMPLETE while station work is still open
  const openInspByReceipt = new Map<string, number>();
  for (const i of openStationWork) {
    if (!i.receiptId) continue;
    openInspByReceipt.set(
      i.receiptId,
      (openInspByReceipt.get(i.receiptId) || 0) + 1
    );
  }
  function displayReceiptStatus(r: { id: string; status: string }) {
    if ((openInspByReceipt.get(r.id) || 0) > 0) return "AWAITING_INSPECTION";
    if (
      r.status === "COMPLETE" &&
      stationWork.some(
        (i) =>
          i.receiptId === r.id &&
          ["PENDING", "IN_PROGRESS"].includes(i.status)
      )
    ) {
      return "AWAITING_INSPECTION";
    }
    return r.status;
  }

  function childDestination(c: {
    notes: string | null;
    status: string;
    currentWorkCenter: string | null;
  }): { label: string; where: "QA" | "TEST" | "DOCK" | "STOCK" | "DONE" | "WAITING" } {
    const notes = (c.notes || "").toLowerCase();
    if (["COMPLETE", "CLOSED"].includes(c.status)) {
      return { label: "Done", where: "DONE" };
    }
    if (c.status === "READY_TO_STOCK") {
      return { label: "Ready — put away at dock", where: "STOCK" };
    }
    if (c.currentWorkCenter) {
      const area =
        stationAreaOf(c) ||
        (c.currentWorkCenter.toUpperCase().includes("TEST") ? "TEST" : "QA");
      if (area === "TEST") {
        return {
          label: `At ${c.currentWorkCenter} — waiting on Test lab`,
          where: "WAITING",
        };
      }
      return {
        label: `At ${c.currentWorkCenter} — waiting on QA`,
        where: "WAITING",
      };
    }
    if (notes.includes("remainder") || c.status === "WAITING") {
      return { label: "Dock — receive remainder", where: "DOCK" };
    }
    const dest = inferDeliverArea({ notes: c.notes });
    if (dest === "TEST") {
      return { label: "Take to Test Center / test lab", where: "TEST" };
    }
    // Both visual + functional in notes → QA first
    if (
      (/\bvisual\b/.test(notes) || notes.includes("gd&t")) &&
      /\bfunctional\b/.test(notes)
    ) {
      return { label: "Take to QA first, then Test lab", where: "QA" };
    }
    if (dest === "QA") {
      return { label: "Take to QA workcenter", where: "QA" };
    }
    if (c.status === "PARTIAL") {
      return { label: "Dock — partial", where: "DOCK" };
    }
    return { label: "Station work", where: "QA" };
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
            {inInspection && qaPending.length > 0 && (
              <Link href="/qa">
                <Button size="sm">Go to QA</Button>
              </Link>
            )}
            {inInspection && testPending.length > 0 && qaPending.length === 0 && (
              <Link href="/test-center">
                <Button size="sm">Go to Test</Button>
              </Link>
            )}
            {canCompleteStock && (
              <a href="#putaway-form">
                <Button size="sm">Put away</Button>
              </a>
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

      <ReceivingNextStep
        {...nextStep}
        deliverSlot={
          nextStep.showDeliverButton && nextStep.deliverArea ? (
            <form action={actionDeliverTravelerToStation}>
              <input type="hidden" name="travelerId" value={traveler.id} />
              <input type="hidden" name="area" value={nextStep.deliverArea} />
              <Button type="submit" size="sm">
                Delivered to{" "}
                {nextStep.deliverArea === "TEST" ? "Test Center" : "QA"}
              </Button>
            </form>
          ) : undefined
        }
      />

      {/* Labor scan strip */}
      {!isComplete && (
        <Card className="border-slate-700/80">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Time clock
              </p>
              {iAmScannedIn ? (
                <p className="text-teal-300">
                  You are scanned in
                  {traveler.activeScanAt
                    ? ` since ${fmtWhen(traveler.activeScanAt)}`
                    : ""}
                  {traveler.currentWorkCenter
                    ? ` · @ ${traveler.currentWorkCenter}`
                    : " · dock / traveler"}
                </p>
              ) : someoneScannedIn ? (
                <p className="text-amber-300">
                  Another user is scanned into this traveler
                </p>
              ) : (
                <p className="text-slate-400">
                  Scan in to charge time to the PO project / WBS. Scan out on
                  deliver, putaway, or when station work finishes.
                </p>
              )}
              {po && (
                <p className="mt-0.5 font-mono text-[10px] text-slate-600">
                  Charge · PO {po.number}
                  {po.project?.number ? ` · ${po.project.number}` : ""}
                  {po.wbsElement?.code ? ` / ${po.wbsElement.code}` : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!iAmScannedIn && !someoneScannedIn && (
                <form action={actionScanIntoReceivingTraveler}>
                  <input type="hidden" name="travelerId" value={traveler.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Scan in
                  </Button>
                </form>
              )}
              {iAmScannedIn && (
                <form action={actionScanOutReceivingTraveler}>
                  <input type="hidden" name="travelerId" value={traveler.id} />
                  <Button type="submit" size="sm" variant="outline">
                    Scan out
                  </Button>
                </form>
              )}
              {needsDeliver && nextStep.deliverArea && (
                <form action={actionDeliverTravelerToStation}>
                  <input type="hidden" name="travelerId" value={traveler.id} />
                  <input
                    type="hidden"
                    name="area"
                    value={nextStep.deliverArea}
                  />
                  <Button type="submit" size="sm">
                    Delivered to{" "}
                    {nextStep.deliverArea === "TEST" ? "Test Center" : "QA"}
                  </Button>
                </form>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <ReceivingStepper
        {...stepState}
        glideLabel={
          traveler.number.includes("-")
            ? traveler.number.split("-").slice(-1)[0]
            : traveler.number.replace(/^RCV-T-?/, "").slice(-4)
        }
      />

      {functionalTestCallouts.length > 0 && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">
            Functional test required — run the called-out procedure
          </p>
          <div className="mt-1.5 space-y-1">
            {functionalTestCallouts.map((c) =>
              c.functionalTestProcedure ? (
                <Link
                  key={c.functionalTestProcedure.id}
                  href="/test-procedures"
                  className="flex flex-wrap items-center gap-2 text-sm text-slate-300 hover:text-sky-300"
                >
                  <span className="font-mono text-teal-400">{c.partNumber}</span>
                  <span className="text-slate-500">→</span>
                  <span className="font-mono text-xs text-sky-400">
                    {c.functionalTestProcedure.number} Rev{" "}
                    {c.functionalTestProcedure.revision}
                  </span>
                  <span>{c.functionalTestProcedure.title}</span>
                  <StatusBadge status={c.functionalTestProcedure.status} />
                </Link>
              ) : null
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={traveler.status} />
        {traveler.parentId && (
          <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
            child
          </span>
        )}
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
            <CardTitle className="text-sm">
              Child travelers — walk these with the material
            </CardTitle>
            <p className="text-xs text-slate-500">
              Parent holds dock-complete lines only. For QA / functional work,
              take the physical material and the matching child traveler card
              to that workcenter. Put away only after the child is ready to stock.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {traveler.children.map((c) => {
              const dest = childDestination(c);
              const border =
                dest.where === "TEST"
                  ? "border-violet-700/50 hover:border-violet-500"
                  : dest.where === "QA"
                    ? "border-amber-700/50 hover:border-amber-500"
                    : dest.where === "WAITING"
                      ? "border-slate-600 hover:border-slate-400"
                      : dest.where === "STOCK"
                        ? "border-teal-700/50 hover:border-teal-500"
                        : dest.where === "DONE"
                          ? "border-slate-800"
                          : "border-slate-700 hover:border-sky-600";
              return (
                <Link
                  key={c.id}
                  href={`/receiving/${c.id}`}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 ${border}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-sky-400">
                      {c.number}
                    </span>
                    <StatusBadge status={c.status} />
                    {c.currentWorkCenter && (
                      <span className="font-mono text-[10px] text-slate-500">
                        @ {c.currentWorkCenter}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      dest.where === "TEST"
                        ? "text-violet-300"
                        : dest.where === "QA"
                          ? "text-amber-300"
                          : dest.where === "WAITING"
                            ? "text-slate-300"
                            : dest.where === "STOCK"
                              ? "text-teal-300"
                              : dest.where === "DONE"
                                ? "text-slate-500"
                                : "text-slate-400"
                    }`}
                  >
                    {dest.label}
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Material-handler walk card on child travelers still in station work */}
      {isChildTraveler && inInspection && (
        <Card
          className={
            traveler.currentWorkCenter
              ? "border-slate-600 bg-slate-800/30"
              : testPending.length > 0 && qaPending.length === 0
                ? "border-violet-500/40 bg-violet-500/5"
                : "border-amber-500/40 bg-amber-500/5"
          }
        >
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Material handler
            </p>
            {traveler.currentWorkCenter ? (
              <>
                <p className="text-base font-semibold text-slate-100">
                  Waiting on{" "}
                  {stationAreaOf(traveler) === "TEST"
                    ? "Test lab"
                    : "QA"}{" "}
                  to send back
                </p>
                <p className="text-xs text-slate-400">
                  Material is parked at{" "}
                  <span className="font-mono text-sky-400">
                    {traveler.currentWorkCenter}
                  </span>{" "}
                  with traveler{" "}
                  <span className="font-mono text-sky-400">
                    {traveler.number}
                  </span>
                  . No MH move until station work finishes — then put away (or
                  next station).
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-slate-100">
                  {testPending.length > 0 && qaPending.length === 0
                    ? "Send this material to the Test Center / test lab"
                    : testPending.length > 0 && qaPending.length > 0
                      ? "Send to QA first, then Test Center"
                      : "Send this material to the QA workcenter"}
                </p>
                <p className="text-xs text-slate-400">
                  Bring traveler{" "}
                  <span className="font-mono text-sky-400">
                    {traveler.number}
                  </span>{" "}
                  with the parts. Tap{" "}
                  <strong className="text-slate-300">Delivered</strong> when you
                  drop it off — that parks the traveler and stops dock time.
                </p>
              </>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {!traveler.currentWorkCenter && nextStep.deliverArea && (
                <form action={actionDeliverTravelerToStation}>
                  <input type="hidden" name="travelerId" value={traveler.id} />
                  <input
                    type="hidden"
                    name="area"
                    value={nextStep.deliverArea}
                  />
                  <Button type="submit" size="sm">
                    Delivered to{" "}
                    {nextStep.deliverArea === "TEST" ? "Test Center" : "QA"}
                  </Button>
                </form>
              )}
              {(qaPending.length > 0 ||
                (needsQa && testPending.length === 0) ||
                stationAreaOf(traveler) === "QA") && (
                <Link href="/qa">
                  <Button size="sm" variant="secondary">
                    Open QA queue
                  </Button>
                </Link>
              )}
              {(testPending.length > 0 ||
                needsTest ||
                stationAreaOf(traveler) === "TEST") && (
                <Link href="/test-center">
                  <Button size="sm" variant="secondary">
                    Open Test Center
                  </Button>
                </Link>
              )}
            </div>
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
        <Card id="putaway-form" className="border-teal-900/40">
          <CardHeader>
            <CardTitle>Complete putaway</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-slate-500">
              Inspections passed — put away and close this receiving traveler.
              Material is not available for kitting until this step finishes.
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
        <Card id="receive-form" className="border-teal-900/40">
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

      {/* ═══════════════ History (traveler-centric, no INSP-#####) ═══════════════ */}
      <Card className="border-slate-700">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-teal-400" />
            History
          </CardTitle>
          <p className="text-xs text-slate-500">
            Dock receipts, child travelers, station results, putaway — no
            inspection ticket numbers.
          </p>
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
                    <StatusBadge status={displayReceiptStatus(r)} />
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
                {displayReceiptStatus(r) === "AWAITING_INSPECTION" && (
                  <p className="mt-1 text-xs text-amber-300/90">
                    Dock qty received — QA / functional still open on child
                    traveler(s). Not complete until that work is put away.
                  </p>
                )}
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

      {/* Station work — no INSP-##### tickets; work lives on travelers */}
      {(stationWork.length > 0 || dockWork.some((i) => i.status === "PENDING")) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4 text-violet-400" />
              Station work
              {(stationPassed > 0 || stationFailed > 0 || openStationWork.length > 0) && (
                <span className="font-normal text-xs text-slate-500">
                  {openStationWork.length > 0
                    ? ` · ${openStationWork.length} open`
                    : ""}
                  {stationPassed > 0 ? ` · ${stationPassed} passed` : ""}
                  {stationFailed > 0 ? ` · ${stationFailed} failed` : ""}
                </span>
              )}
            </CardTitle>
            <p className="text-xs text-slate-500">
              QA (visual / GD&amp;T) and Test Center work for this receive.
              Work the matching{" "}
              <span className="text-slate-400">child traveler</span> — not a
              separate inspection ticket.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Pending dock attest only (rare) */}
            {dockWork
              .filter((i) => i.status === "PENDING")
              .map((insp) => (
                <div
                  key={insp.id}
                  className="rounded-lg border border-amber-900/40 bg-amber-500/5 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-amber-200">Dock acceptance</span>
                    <StatusBadge status={insp.status} />
                    <span className="font-mono text-teal-400">
                      {insp.partId ? partNumById[insp.partId] : "—"}
                    </span>
                  </div>
                  <form
                    id="dock-attest"
                    action={actionAttestDockAcceptance}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="inspectionId" value={insp.id} />
                    <input type="hidden" name="travelerId" value={id} />
                    <span className="text-[11px] text-amber-300">
                      Sign dock acceptance to clear putaway for dock-only lines.
                    </span>
                    <Input
                      name="notes"
                      placeholder="Note (optional)"
                      className="h-8 w-44 text-xs"
                    />
                    <Button type="submit" size="sm">
                      Attest & clear
                    </Button>
                  </form>
                </div>
              ))}

            {stationWork.map((insp) => {
              const partNo = insp.partId ? partNumById[insp.partId] : "—";
              const area = ["VISUAL", "GDT"].includes(insp.type) ? "QA" : "Test Center";
              const typeLabel =
                insp.type === "GDT"
                  ? "GD&T / visual"
                  : insp.type === "VISUAL"
                    ? "Visual"
                    : "Functional";
              // Prefer child traveler that owns this station work
              const linkedChild =
                traveler.children.find((c) =>
                  ["IN_INSPECTION", "READY_TO_STOCK", "COMPLETE"].includes(
                    c.status
                  )
                ) ||
                (isChildTraveler ? traveler : null);
              const workHref =
                area === "QA" ? "/qa" : "/test-center";
              return (
                <div
                  key={insp.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-200">
                          {typeLabel}
                        </span>
                        <StatusBadge status={insp.status} />
                        <span
                          className={`text-[11px] font-medium ${
                            area === "QA" ? "text-amber-300" : "text-violet-300"
                          }`}
                        >
                          @ {area}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-teal-400">{partNo}</p>
                      <p className="text-xs text-slate-500">
                        Qty {insp.quantity}
                        {insp.lotNumber ? ` · Lot ${insp.lotNumber}` : ""}
                        {insp.serialNumber ? ` · S/N ${insp.serialNumber}` : ""}
                      </p>
                      {isChildTraveler ? (
                        <p className="mt-1 text-xs text-sky-400/90">
                          On this traveler · {traveler.number}
                        </p>
                      ) : traveler.children.length > 0 ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Work on child traveler
                          {linkedChild ? (
                            <>
                              {" "}
                              <Link
                                href={`/receiving/${linkedChild.id}`}
                                className="font-mono text-sky-400 hover:underline"
                              >
                                {linkedChild.number}
                              </Link>
                            </>
                          ) : (
                            " (see children above)"
                          )}
                          {" · "}
                          <Link
                            href={workHref}
                            className="text-sky-400 hover:underline"
                          >
                            {area} queue
                          </Link>
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-[10px] text-slate-600">
                      {insp.completedAt ? (
                        <p>Done {fmtWhen(insp.completedAt)}</p>
                      ) : (
                        <p>Opened {fmtWhen(insp.createdAt)}</p>
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
              {stationWork.length} station check(s)
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

      <ActivityTimeline entityType="ReceivingTraveler" entityId={id} />
    </div>
  );
}
