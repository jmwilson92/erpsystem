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

/**
 * Test module queue = stations in area TEST (powered functional).
 * QA (continuity / GD&T / visual) is separate.
 */
export async function getTestCenterQueue() {
  const testCodes = await listWorkCenterCodesByArea("TEST");
  const testCodeList = testCodes.length ? testCodes : ["TEST-01"];

  const [receivingInspections, testCenterWos, productionTestSteps] =
    await Promise.all([
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
      prisma.workOrderStepCompletion.findMany({
        where: {
          status: { in: ["PENDING", "IN_PROGRESS"] },
          OR: [
            { assignedWorkCenter: { in: testCodeList } },
            {
              assignedWorkCenter: null,
              step: {
                OR: [
                  { workCenter: { in: testCodeList } },
                  { requiredArea: "TEST" },
                ],
              },
            },
          ],
          workOrder: {
            status: { in: [...ACTIVE_WO] },
            NOT: {
              AND: [
                { workCenter: { in: testCodeList } },
                { type: "INSPECTION" },
              ],
            },
          },
        },
        include: {
          step: true,
          workOrder: {
            include: {
              part: {
                select: { id: true, partNumber: true, description: true },
              },
              salesOrder: { select: { id: true, number: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
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
          traveler: { select: { id: true, number: true, travelerType: true } },
          purchaseOrder: { select: { id: true, number: true } },
        },
      })
    : [];
  const receiptMap = Object.fromEntries(receipts.map((r) => [r.id, r]));

  const testWoIds = new Set(testCenterWos.map((w) => w.id));
  const productionByWo = new Map<
    string,
    {
      workOrder: (typeof productionTestSteps)[0]["workOrder"];
      steps: typeof productionTestSteps;
    }
  >();
  for (const sc of productionTestSteps) {
    if (testWoIds.has(sc.workOrderId)) continue;
    const existing = productionByWo.get(sc.workOrderId);
    if (existing) existing.steps.push(sc);
    else
      productionByWo.set(sc.workOrderId, {
        workOrder: sc.workOrder,
        steps: [sc],
      });
  }

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
  for (const [, group] of productionByWo) {
    for (const s of group.steps) {
      loadHours += (s.step.estimatedMinutes || 30) / 60;
    }
  }

  return {
    receivingInspections,
    receivingByWo: Array.from(receivingByWo.values()),
    testCenterWos,
    productionTestGroups: Array.from(productionByWo.values()),
    partMap,
    receiptMap,
    stats: {
      openReceiving: receivingInspections.length,
      openInspectionWos: testCenterWos.filter((w) => w.type === "INSPECTION")
        .length,
      openProductionTests: productionByWo.size,
      onHold: testCenterWos.filter((w) => w.status === "ON_HOLD").length,
      totalQueue:
        receivingInspections.length +
        testCenterWos.length +
        productionByWo.size,
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

  const [qaInspections, qaWos, continuitySteps] = await Promise.all([
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
    prisma.workOrderStepCompletion.findMany({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        OR: [
          { assignedWorkCenter: { in: qaCodeList } },
          {
            assignedWorkCenter: null,
            step: {
              OR: [
                { workCenter: { in: qaCodeList } },
                { requiredArea: "QA" },
              ],
            },
          },
        ],
        workOrder: { status: { in: [...ACTIVE_WO] } },
      },
      include: {
        step: true,
        workOrder: {
          include: {
            part: { select: { partNumber: true, description: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
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

  // Also include open inspections on QA WOs even if workCenter field drifted
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

  return {
    qaInspections: allQaInspections,
    qaWos,
    continuitySteps,
    partMap,
    stats: {
      openInspections: allQaInspections.length,
      openWos: qaWos.length,
      openSteps: continuitySteps.length,
      total: allQaInspections.length + qaWos.length + continuitySteps.length,
    },
  };
}
