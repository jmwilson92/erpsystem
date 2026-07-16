/**
 * Next-move guidance for QA / Test operators after receiving station work.
 * Pure helpers + batch resolver for queue UIs.
 */
import { prisma } from "@/lib/db";

export type StationNextKind =
  | "TO_TEST"
  | "TO_QA"
  | "TO_DOCK"
  | "PUTAWAY"
  | "HOLD"
  | "WORK";

export type StationNextGuide = {
  kind: StationNextKind;
  title: string;
  detail: string;
  href?: string;
  label?: string;
  travelerNumber?: string | null;
  travelerId?: string | null;
};

/**
 * After this inspection is worked (or while open), where should material go next?
 */
export function guideForReceivingInspection(params: {
  inspectionType: string;
  inspectionStatus: string;
  /** Other open inspections on same inventory (not this one) */
  siblingOpenTypes: string[];
  partRequiresGdt?: boolean;
  partRequiresFunctional?: boolean;
  travelerNumber?: string | null;
  travelerId?: string | null;
  travelerStatus?: string | null;
}): StationNextGuide {
  const tNum = params.travelerNumber || "this traveler";
  const tHref = params.travelerId
    ? `/receiving/${params.travelerId}`
    : undefined;

  if (params.inspectionStatus === "FAILED") {
    return {
      kind: "HOLD",
      title: "Hold for NCR / MRB",
      detail: `Do not move to stock. Keep material with ${tNum} until disposition.`,
      href: "/quality",
      label: "Open Quality",
      travelerNumber: params.travelerNumber,
      travelerId: params.travelerId,
    };
  }

  const open = new Set(params.siblingOpenTypes);
  // Also count this inspection if still open
  if (["PENDING", "IN_PROGRESS"].includes(params.inspectionStatus)) {
    open.add(params.inspectionType);
  }

  const hasOpenQa = [...open].some((t) => ["VISUAL", "GDT"].includes(t));
  const hasOpenTest = open.has("FUNCTIONAL");
  const willNeedTest =
    hasOpenTest ||
    (params.partRequiresFunctional &&
      params.inspectionType !== "FUNCTIONAL" &&
      !["PASSED", "FAILED", "WAIVED"].includes(params.inspectionStatus));

  // Traveler already ready for putaway
  if (params.travelerStatus === "READY_TO_STOCK") {
    return {
      kind: "PUTAWAY",
      title: "Take material back to the dock — put away",
      detail: `Walk ${tNum} to Receiving. Put away on the traveler card — then it is stocked.`,
      href: tHref,
      label: tNum !== "this traveler" ? `Open ${tNum}` : "Open traveler",
      travelerNumber: params.travelerNumber,
      travelerId: params.travelerId,
    };
  }

  // Still working this station
  if (["PENDING", "IN_PROGRESS"].includes(params.inspectionStatus)) {
    if (["VISUAL", "GDT", "RECEIVING"].includes(params.inspectionType)) {
      if (willNeedTest || hasOpenTest) {
        return {
          kind: "WORK",
          title: "Complete QA, then send to Test Center",
          detail: `Finish visual / GD&T on ${tNum}. After Pass, take the material and traveler to Test Center for functional / power.`,
          href: "/test-center",
          label: "Test Center queue",
          travelerNumber: params.travelerNumber,
          travelerId: params.travelerId,
        };
      }
      return {
        kind: "WORK",
        title: "Complete QA, then return to dock",
        detail: `Finish visual / GD&T on ${tNum}. After Pass, take material back to Receiving and put away.`,
        href: tHref,
        label: tNum !== "this traveler" ? `Open ${tNum}` : "Receiving",
        travelerNumber: params.travelerNumber,
        travelerId: params.travelerId,
      };
    }
    if (params.inspectionType === "FUNCTIONAL") {
      return {
        kind: "WORK",
        title: "Complete functional test, then return to dock",
        detail: `Run the called-out procedure on ${tNum}. After Pass, take material back to Receiving and put away.`,
        href: tHref,
        label: tNum !== "this traveler" ? `Open ${tNum}` : "Receiving",
        travelerNumber: params.travelerNumber,
        travelerId: params.travelerId,
      };
    }
  }

  // Passed this inspection — look at siblings
  if (hasOpenQa && params.inspectionType === "FUNCTIONAL") {
    return {
      kind: "TO_QA",
      title: "Still needs QA",
      detail: `Visual / GD&T still open on ${tNum}. Take material to QA.`,
      href: "/qa",
      label: "QA queue",
      travelerNumber: params.travelerNumber,
      travelerId: params.travelerId,
    };
  }
  if (hasOpenTest || (params.partRequiresFunctional && hasOpenQa === false && params.inspectionType !== "FUNCTIONAL")) {
    // After QA pass with functional still required
    if (["VISUAL", "GDT"].includes(params.inspectionType) || hasOpenTest) {
      return {
        kind: "TO_TEST",
        title: "Take material to Test Center",
        detail: `Walk ${tNum} and the material to the Test lab for functional / power. Do not put away yet.`,
        href: "/test-center",
        label: "Test Center queue",
        travelerNumber: params.travelerNumber,
        travelerId: params.travelerId,
      };
    }
  }

  return {
    kind: "TO_DOCK",
    title: "Take material back to the dock — put away",
    detail: `Station work is clear for ${tNum}. Return to Receiving, put away on the traveler, then it is stocked.`,
    href: tHref,
    label: tNum !== "this traveler" ? `Open ${tNum}` : "Open traveler",
    travelerNumber: params.travelerNumber,
    travelerId: params.travelerId,
  };
}

/** Batch next-move guides for a list of receiving inspections. */
export async function batchStationNextGuides(
  inspections: {
    id: string;
    type: string;
    status: string;
    inventoryItemId: string | null;
    partId: string | null;
  }[],
  travelerByInspId: Record<
    string,
    {
      id: string;
      number: string;
      status?: string | null;
    } | null
  >
): Promise<Record<string, StationNextGuide>> {
  const invIds = [
    ...new Set(
      inspections
        .map((i) => i.inventoryItemId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const partIds = [
    ...new Set(
      inspections
        .map((i) => i.partId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [siblings, parts] = await Promise.all([
    invIds.length
      ? prisma.inspection.findMany({
          where: {
            inventoryItemId: { in: invIds },
            status: { in: ["PENDING", "IN_PROGRESS"] },
          },
          select: {
            id: true,
            type: true,
            inventoryItemId: true,
          },
        })
      : Promise.resolve([]),
    partIds.length
      ? prisma.part.findMany({
          where: { id: { in: partIds } },
          select: {
            id: true,
            requiresGdtInspection: true,
            requiresFunctionalTest: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const partMap = Object.fromEntries(parts.map((p) => [p.id, p]));
  const openByInv = new Map<string, { id: string; type: string }[]>();
  for (const s of siblings) {
    if (!s.inventoryItemId) continue;
    const arr = openByInv.get(s.inventoryItemId) || [];
    arr.push({ id: s.id, type: s.type });
    openByInv.set(s.inventoryItemId, arr);
  }

  const out: Record<string, StationNextGuide> = {};
  for (const insp of inspections) {
    const trav = travelerByInspId[insp.id];
    const part = insp.partId ? partMap[insp.partId] : null;
    const openSiblings = (insp.inventoryItemId
      ? openByInv.get(insp.inventoryItemId) || []
      : []
    )
      .filter((s) => s.id !== insp.id)
      .map((s) => s.type);

    out[insp.id] = guideForReceivingInspection({
      inspectionType: insp.type,
      inspectionStatus: insp.status,
      siblingOpenTypes: openSiblings,
      partRequiresGdt: part?.requiresGdtInspection,
      partRequiresFunctional: part?.requiresFunctionalTest,
      travelerNumber: trav?.number,
      travelerId: trav?.id,
      travelerStatus: trav?.status,
    });
  }
  return out;
}
