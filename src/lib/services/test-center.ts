"use server";

import { prisma } from "@/lib/db";
import { listWorkCenterCodesByArea } from "@/lib/services/workcenters";

const ACTIVE_WO = [
  "PLANNED",
  "RELEASED",
  "IN_PROGRESS",
  "ON_HOLD",
  "WAITING_MATERIAL",
  "READY_TO_KIT",
  "KITTING",
  "KITTED",
] as const;

const DONE_STEP = ["PASSED", "FAILED", "SKIPPED", "SIGNED"] as const;

export type QueueReadiness = "AT_STATION" | "STEP_READY" | "UPCOMING";

function stepMatchesArea(
  step: {
    workCenter: string | null;
    requiredArea: string | null;
    isTestStep: boolean;
  },
  area: "QA" | "TEST",
  areaCodes: string[],
  otherCodes: string[]
): boolean {
  if (step.requiredArea === area) return true;
  if (step.workCenter && areaCodes.includes(step.workCenter)) return true;
  if (step.workCenter && otherCodes.includes(step.workCenter)) return false;
  if (step.requiredArea && step.requiredArea !== area) return false;
  // isTestStep defaults to TEST unless clearly QA-routed
  if (area === "TEST" && step.isTestStep) return true;
  return false;
}

function completionMatchesArea(
  sc: {
    assignedWorkCenter: string | null;
    step: {
      workCenter: string | null;
      requiredArea: string | null;
      isTestStep: boolean;
    };
  },
  area: "QA" | "TEST",
  areaCodes: string[],
  otherCodes: string[]
): boolean {
  if (sc.assignedWorkCenter && areaCodes.includes(sc.assignedWorkCenter)) {
    return true;
  }
  if (sc.assignedWorkCenter && otherCodes.includes(sc.assignedWorkCenter)) {
    return false;
  }
  return stepMatchesArea(sc.step, area, areaCodes, otherCodes);
}

/**
 * Prior steps (lower stepNumber) all complete → this step is "up" on the traveler.
 * Or WO already scanned into this area station.
 */
function computeReadiness(params: {
  stepNumber: number;
  allCompletions: { status: string; step: { stepNumber: number } }[];
  woWorkCenter: string | null | undefined;
  areaCodes: string[];
}): QueueReadiness {
  if (params.woWorkCenter && params.areaCodes.includes(params.woWorkCenter)) {
    return "AT_STATION";
  }
  const priorsDone = params.allCompletions
    .filter((c) => c.step.stepNumber < params.stepNumber)
    .every((c) => (DONE_STEP as readonly string[]).includes(c.status));
  return priorsDone ? "STEP_READY" : "UPCOMING";
}

/**
 * Pending QA/TEST steps for open WOs — includes steps not yet reached on the
 * traveler and WOs not yet scanned into the station (UPCOMING).
 */
async function loadAreaStepQueue(area: "QA" | "TEST") {
  const [areaCodes, otherCodes] = await Promise.all([
    listWorkCenterCodesByArea(area),
    listWorkCenterCodesByArea(area === "QA" ? "TEST" : "QA"),
  ]);
  const areaCodeList =
    areaCodes.length > 0
      ? areaCodes
      : area === "QA"
        ? ["QA-01"]
        : ["TEST-01"];
  const otherCodeList = otherCodes;

  // Broad fetch of open WO step completions; filter in JS for area match
  const allPending = await prisma.workOrderStepCompletion.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      workOrder: { status: { in: [...ACTIVE_WO] } },
      OR: [
        { assignedWorkCenter: { in: areaCodeList } },
        { step: { workCenter: { in: areaCodeList } } },
        { step: { requiredArea: area } },
        ...(area === "TEST"
          ? [{ step: { isTestStep: true } }]
          : []),
      ],
    },
    include: {
      step: true,
      workOrder: {
        include: {
          part: {
            select: { id: true, partNumber: true, description: true },
          },
          salesOrder: { select: { id: true, number: true } },
          stepCompletions: {
            include: { step: { select: { stepNumber: true } } },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const matched = allPending.filter((sc) =>
    completionMatchesArea(sc, area, areaCodeList, otherCodeList)
  );

  type Group = {
    workOrder: (typeof matched)[0]["workOrder"];
    steps: Array<
      (typeof matched)[0] & { readiness: QueueReadiness }
    >;
    readiness: QueueReadiness; // best (most ready) status across steps
  };

  const byWo = new Map<string, Group>();
  const rank: Record<QueueReadiness, number> = {
    AT_STATION: 0,
    STEP_READY: 1,
    UPCOMING: 2,
  };

  for (const sc of matched) {
    const readiness = computeReadiness({
      stepNumber: sc.step.stepNumber,
      allCompletions: sc.workOrder.stepCompletions,
      woWorkCenter: sc.workOrder.workCenter,
      areaCodes: areaCodeList,
    });
    const withReady = { ...sc, readiness };
    const existing = byWo.get(sc.workOrderId);
    if (existing) {
      existing.steps.push(withReady);
      if (rank[readiness] < rank[existing.readiness]) {
        existing.readiness = readiness;
      }
    } else {
      byWo.set(sc.workOrderId, {
        workOrder: sc.workOrder,
        steps: [withReady],
        readiness,
      });
    }
  }

  // Sort groups: at station → step ready → upcoming
  const groups = Array.from(byWo.values()).sort(
    (a, b) => rank[a.readiness] - rank[b.readiness]
  );

  return {
    areaCodeList,
    groups,
    flatSteps: groups.flatMap((g) => g.steps),
    stats: {
      atStation: groups.filter((g) => g.readiness === "AT_STATION").length,
      stepReady: groups.filter((g) => g.readiness === "STEP_READY").length,
      upcoming: groups.filter((g) => g.readiness === "UPCOMING").length,
      totalSteps: groups.reduce((s, g) => s + g.steps.length, 0),
    },
  };
}

/**
 * Test module queue = stations in area TEST (powered functional).
 * Includes traveler steps not yet "up" and WOs not yet scanned in.
 */
export async function getTestCenterQueue() {
  const testCodes = await listWorkCenterCodesByArea("TEST");
  const testCodeList = testCodes.length ? testCodes : ["TEST-01"];

  const [receivingInspections, testCenterWos, stepQueue] = await Promise.all([
    prisma.inspection.findMany({
      where: {
        workCenter: { in: testCodeList },
        status: { in: ["PENDING", "IN_PROGRESS"] },
        type: "FUNCTIONAL",
      },
      include: {
        results: true,
        documents: true,
        workOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            type: true,
            description: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workOrder.findMany({
      where: {
        workCenter: { in: testCodeList },
        status: { in: [...ACTIVE_WO] },
      },
      include: {
        part: { select: { id: true, partNumber: true, description: true } },
        salesOrder: { select: { id: true, number: true } },
        stepCompletions: {
          include: { step: true },
          orderBy: { step: { stepNumber: "asc" } },
        },
        inspections: {
          where: {
            status: { in: ["PENDING", "IN_PROGRESS"] },
            type: "FUNCTIONAL",
          },
          select: { id: true, number: true, type: true, status: true },
        },
      },
      orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "asc" }],
    }),
    loadAreaStepQueue("TEST"),
  ]);

  const partIds = [
    ...new Set(
      receivingInspections
        .map((i) => i.partId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const parts = partIds.length
    ? await prisma.part.findMany({
        where: { id: { in: partIds } },
        select: { id: true, partNumber: true, description: true },
      })
    : [];
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));

  const receiptIds = [
    ...new Set(
      receivingInspections
        .map((i) => i.receiptId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const receipts = receiptIds.length
    ? await prisma.receipt.findMany({
        where: { id: { in: receiptIds } },
        select: {
          id: true,
          number: true,
          travelerId: true,
          purchaseOrderId: true,
          traveler: {
            select: {
              id: true,
              number: true,
              travelerType: true,
              status: true,
              currentWorkCenter: true,
              parentId: true,
            },
          },
          purchaseOrder: { select: { id: true, number: true } },
        },
      })
    : [];
  const receiptMap = Object.fromEntries(receipts.map((r) => [r.id, r]));

  // Child travelers that own inventory when receipt.traveler is parent/null
  const invIdsForSnap = [
    ...new Set(
      receivingInspections
        .map((i) => i.inventoryItemId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const snapTravelers =
    invIdsForSnap.length > 0
      ? await prisma.receivingTraveler.findMany({
          where: {
            status: {
              in: ["IN_INSPECTION", "READY_TO_STOCK", "PARTIAL"],
            },
            OR: invIdsForSnap.map((id) => ({
              openLinesSnapshot: { contains: id },
            })),
          },
          select: {
            id: true,
            number: true,
            status: true,
            currentWorkCenter: true,
            parentId: true,
            openLinesSnapshot: true,
          },
        })
      : [];
  const travelerByInspId: Record<
    string,
    {
      id: string;
      number: string;
      status: string;
      currentWorkCenter: string | null;
      parentId: string | null;
    } | null
  > = {};
  for (const insp of receivingInspections) {
    const fromReceipt =
      (insp.receiptId && receiptMap[insp.receiptId]?.traveler) || null;
    let resolved: {
      id: string;
      number: string;
      status: string;
      currentWorkCenter: string | null;
      parentId: string | null;
    } | null = fromReceipt
      ? {
          id: fromReceipt.id,
          number: fromReceipt.number,
          status: fromReceipt.status,
          currentWorkCenter: fromReceipt.currentWorkCenter,
          parentId: fromReceipt.parentId,
        }
      : null;
    if (!resolved && insp.inventoryItemId) {
      const hit = snapTravelers.find(
        (s) =>
          s.openLinesSnapshot?.includes(insp.inventoryItemId!) &&
          !!s.parentId
      );
      if (hit) {
        resolved = {
          id: hit.id,
          number: hit.number,
          status: hit.status,
          currentWorkCenter: hit.currentWorkCenter,
          parentId: hit.parentId,
        };
      }
    }
    travelerByInspId[insp.id] = resolved;
  }

  // Production test groups = area steps for WOs not already listed as "at TEST station"
  const testWoIds = new Set(testCenterWos.map((w) => w.id));
  const productionTestGroups = stepQueue.groups.filter(
    (g) => !testWoIds.has(g.workOrder.id)
  );

  const receivingByWo = new Map<
    string,
    {
      workOrder: (typeof receivingInspections)[0]["workOrder"] | null;
      inspections: typeof receivingInspections;
    }
  >();
  for (const insp of receivingInspections) {
    const key = insp.workOrderId || `solo-${insp.id}`;
    const existing = receivingByWo.get(key);
    if (existing) existing.inspections.push(insp);
    else
      receivingByWo.set(key, {
        workOrder: insp.workOrder,
        inspections: [insp],
      });
  }

  const workCenters = await prisma.workCenter.findMany({
    where: { area: "TEST", isActive: true },
  });
  const capacity = workCenters.reduce(
    (s, w) => s + w.capacityHoursPerDay * w.efficiency,
    0
  );

  let loadHours = 0;
  for (const w of testCenterWos) {
    loadHours +=
      w.estimatedMinutes && w.estimatedMinutes > 0
        ? w.estimatedMinutes / 60
        : 1.5;
  }
  for (const group of productionTestGroups) {
    for (const s of group.steps) {
      loadHours += (s.step.estimatedMinutes || 30) / 60;
    }
  }

  return {
    receivingInspections,
    receivingByWo: Array.from(receivingByWo.values()),
    testCenterWos,
    productionTestGroups,
    /** All TEST-area steps including those on WOs already at station */
    testStepGroups: stepQueue.groups,
    partMap,
    receiptMap,
    travelerByInspId,
    stats: {
      openReceiving: receivingInspections.length,
      openInspectionWos: testCenterWos.filter((w) => w.type === "INSPECTION")
        .length,
      openProductionTests: productionTestGroups.length,
      upcomingTests: productionTestGroups.filter(
        (g) => g.readiness === "UPCOMING"
      ).length,
      readyTests: productionTestGroups.filter(
        (g) => g.readiness === "STEP_READY" || g.readiness === "AT_STATION"
      ).length,
      onHold: testCenterWos.filter((w) => w.status === "ON_HOLD").length,
      totalQueue:
        receivingInspections.length +
        testCenterWos.length +
        productionTestGroups.length,
      loadHours: Math.round(loadHours * 10) / 10,
      capacity: Math.round(capacity * 10) / 10,
      utilPct:
        capacity > 0
          ? Math.min(100, Math.round((loadHours / capacity) * 100))
          : 0,
    },
  };
}

/** QA module queue: visual, GD&T, continuity — stations in area QA. */
export async function getQaInspectionQueue() {
  const qaCodes = await listWorkCenterCodesByArea("QA");
  const qaCodeList = qaCodes.length ? qaCodes : ["QA-01"];

  const [qaInspections, qaWos, stepQueue] = await Promise.all([
    prisma.inspection.findMany({
      where: {
        workCenter: { in: qaCodeList },
        status: { in: ["PENDING", "IN_PROGRESS"] },
        type: { in: ["VISUAL", "GDT", "RECEIVING"] },
      },
      include: {
        results: true,
        documents: true,
        workOrder: {
          select: { id: true, number: true, status: true, description: true },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workOrder.findMany({
      where: {
        workCenter: { in: qaCodeList },
        status: { in: [...ACTIVE_WO] },
      },
      include: {
        part: { select: { partNumber: true, description: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    loadAreaStepQueue("QA"),
  ]);

  const partIds = [
    ...new Set(
      qaInspections.map((i) => i.partId).filter((id): id is string => Boolean(id))
    ),
  ];
  const parts = partIds.length
    ? await prisma.part.findMany({
        where: { id: { in: partIds } },
        select: { id: true, partNumber: true, description: true },
      })
    : [];
  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));

  const qaWoIds = new Set(qaWos.map((w) => w.id));
  const linkedMissing = await prisma.inspection.findMany({
    where: {
      workOrderId: { in: [...qaWoIds] },
      status: { in: ["PENDING", "IN_PROGRESS"] },
      type: { in: ["VISUAL", "GDT", "RECEIVING"] },
      id: { notIn: qaInspections.map((i) => i.id) },
    },
    include: {
      results: true,
      documents: true,
      workOrder: {
        select: { id: true, number: true, status: true, description: true },
      },
    },
  });
  const allQaInspections = [...qaInspections, ...linkedMissing];

  const extraPartIds = [
    ...new Set(
      linkedMissing
        .map((i) => i.partId)
        .filter((id): id is string => typeof id === "string" && !(id in partMap))
    ),
  ];
  if (extraPartIds.length) {
    const extraParts = await prisma.part.findMany({
      where: { id: { in: extraPartIds } },
      select: { id: true, partNumber: true, description: true },
    });
    for (const p of extraParts) partMap[p.id] = p;
  }

  // Continuity / QA steps: exclude WOs already listed as scanned into QA
  const continuityGroups = stepQueue.groups.filter(
    (g) => !qaWoIds.has(g.workOrder.id)
  );
  // Flat list for backward-compatible UI (all steps, with readiness)
  const continuitySteps = stepQueue.flatSteps.filter(
    (sc) => !qaWoIds.has(sc.workOrderId)
  );

  // Map inspections → receiving traveler (prefer child RCV-T-…-0N, not INSP-#####)
  const receiptIds = [
    ...new Set(
      allQaInspections
        .map((i) => i.receiptId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const invIds = [
    ...new Set(
      allQaInspections
        .map((i) => i.inventoryItemId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const receipts = receiptIds.length
    ? await prisma.receipt.findMany({
        where: { id: { in: receiptIds } },
        select: {
          id: true,
          number: true,
          travelerId: true,
          traveler: {
            select: {
              id: true,
              number: true,
              status: true,
              currentWorkCenter: true,
              parentId: true,
            },
          },
          purchaseOrder: { select: { id: true, number: true } },
        },
      })
    : [];
  const receiptMap = Object.fromEntries(receipts.map((r) => [r.id, r]));

  // Fallback: children that own inventory via openLinesSnapshot
  const snapTravelers =
    invIds.length > 0
      ? await prisma.receivingTraveler.findMany({
          where: {
            status: {
              in: ["IN_INSPECTION", "READY_TO_STOCK", "PARTIAL"],
            },
            OR: invIds.map((id) => ({
              openLinesSnapshot: { contains: id },
            })),
          },
          select: {
            id: true,
            number: true,
            status: true,
            currentWorkCenter: true,
            parentId: true,
            openLinesSnapshot: true,
          },
        })
      : [];

  type TravelerRef = {
    id: string;
    number: string;
    status: string;
    currentWorkCenter: string | null;
    parentId: string | null;
  };
  const travelerByInspId: Record<string, TravelerRef | null> = {};
  for (const insp of allQaInspections) {
    let t: TravelerRef | null = null;
    if (insp.receiptId && receiptMap[insp.receiptId]?.traveler) {
      t = receiptMap[insp.receiptId].traveler!;
    }
    if (!t && insp.inventoryItemId) {
      const hit = snapTravelers.find(
        (s) =>
          s.openLinesSnapshot?.includes(insp.inventoryItemId!) &&
          !!s.parentId
      );
      if (hit) {
        t = {
          id: hit.id,
          number: hit.number,
          status: hit.status,
          currentWorkCenter: hit.currentWorkCenter,
          parentId: hit.parentId,
        };
      }
    }
    travelerByInspId[insp.id] = t;
  }

  return {
    qaInspections: allQaInspections,
    qaWos,
    continuitySteps,
    continuityGroups,
    partMap,
    receiptMap,
    travelerByInspId,
    stats: {
      openInspections: allQaInspections.length,
      openWos: qaWos.length,
      openSteps: continuitySteps.length,
      upcomingSteps: continuitySteps.filter((s) => s.readiness === "UPCOMING")
        .length,
      readySteps: continuitySteps.filter(
        (s) => s.readiness === "STEP_READY" || s.readiness === "AT_STATION"
      ).length,
      total:
        allQaInspections.length + qaWos.length + continuitySteps.length,
    },
  };
}
