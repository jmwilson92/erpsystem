/**
 * Pure helpers for receiving traveler UI — next action + stepper state.
 * No DB; safe for client/server components.
 */

import type { NextStepKind } from "@/components/receiving/receiving-next-step";
import type { StepKey } from "@/components/receiving/receiving-stepper";
import type { TravelerPurpose } from "@/lib/services/receiving";

export function nextActionForTraveler(params: {
  status: string;
  purpose: TravelerPurpose;
  canReceive: boolean;
  canCompleteStock: boolean;
  inInspection: boolean;
  hasQaPending: boolean;
  hasTestPending: boolean;
  hasPendingDockAttest: boolean;
  isComplete: boolean;
  /** Open remainder child the handler should work instead of this card */
  followChildNumber?: string | null;
  followChildId?: string | null;
  /** Child in QA/Test the material handler should walk */
  inspectionChildNumber?: string | null;
  inspectionChildId?: string | null;
  inspectionChildWhere?: "QA" | "TEST" | "STATION" | null;
  /** Child already parked at QA/Test — info only when no other MH work */
  waitingChildNumber?: string | null;
  waitingChildId?: string | null;
  waitingChildWhere?: "QA" | "TEST" | "STATION" | null;
  waitingChildStation?: string | null;
  waitingChildCount?: number;
  /** Child READY_TO_STOCK — put away now (priority over waiting) */
  putawayChildNumber?: string | null;
  putawayChildId?: string | null;
  /** This traveler is already at a station */
  atStationCode?: string | null;
  atStationArea?: "QA" | "TEST" | "DOCK" | null;
  /** Needs deliver handoff (not yet at station) */
  needsDeliver?: boolean;
  deliverArea?: "QA" | "TEST" | null;
  poId?: string | null;
}): {
  kind: NextStepKind;
  title: string;
  detail: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  childNumber?: string;
  primaryIsAnchor?: boolean;
  /** Server actions: deliver form */
  showDeliverButton?: boolean;
  deliverArea?: "QA" | "TEST" | null;
} {
  if (params.followChildId && params.followChildNumber) {
    return {
      kind: "FOLLOW_CHILD",
      title: "Work the child traveler",
      detail: `Open remainder is on ${params.followChildNumber}. Dock more material there — not on this parent card.`,
      primaryHref: `/receiving/${params.followChildId}`,
      primaryLabel: `Open ${params.followChildNumber}`,
      childNumber: params.followChildNumber,
    };
  }

  // 1) Put away children that are ready — don't block on other kids at QA
  if (params.putawayChildId && params.putawayChildNumber) {
    return {
      kind: "PUTAWAY",
      title: `Put away ${params.putawayChildNumber}`,
      detail:
        "This child passed station work and is ready for stock. Open it and put away — other children can still be at QA/Test.",
      primaryHref: `/receiving/${params.putawayChildId}`,
      primaryLabel: `Open ${params.putawayChildNumber}`,
      childNumber: params.putawayChildNumber,
    };
  }

  // 2) Next undelivered child — keep MH moving while others wait at station
  if (params.inspectionChildId && params.inspectionChildNumber) {
    const where =
      params.inspectionChildWhere === "TEST"
        ? "Test Center"
        : params.inspectionChildWhere === "QA"
          ? "QA"
          : "QA / Test";
    const waitingNote =
      params.waitingChildCount && params.waitingChildCount > 0
        ? ` (${params.waitingChildCount} other child(ren) already at a station — no need to wait on them).`
        : "";
    return {
      kind: "FOLLOW_CHILD",
      title: `Take material with ${params.inspectionChildNumber}`,
      detail: `Walk this child to ${where} and tap Delivered when you drop it off.${waitingNote}`,
      primaryHref: `/receiving/${params.inspectionChildId}`,
      primaryLabel: `Open ${params.inspectionChildNumber}`,
      secondaryHref:
        params.inspectionChildWhere === "TEST" ? "/test-center" : "/qa",
      secondaryLabel:
        params.inspectionChildWhere === "TEST" ? "Test Center queue" : "QA queue",
      childNumber: params.inspectionChildNumber,
    };
  }

  // 3) This card is parked at a station — inspector should scan in
  if (
    params.atStationCode &&
    params.atStationArea &&
    params.atStationArea !== "DOCK" &&
    (params.inInspection || params.status === "IN_INSPECTION")
  ) {
    const where = params.atStationArea === "TEST" ? "Test Center" : "QA";
    return {
      kind: params.atStationArea === "TEST" ? "AT_TEST" : "AT_QA",
      title: `At ${params.atStationCode} — scan in to work`,
      detail: `Material is at ${where}. Scan into this traveler to start your time, complete the open work, then the system will guide putaway or the next station.`,
      primaryHref: params.atStationArea === "TEST" ? "/test-center" : "/qa",
      primaryLabel: `Open ${where} queue`,
    };
  }

  // 4) Child needs deliver handoff before station work starts
  if (params.needsDeliver && params.deliverArea) {
    const where = params.deliverArea === "TEST" ? "Test Center" : "QA";
    return {
      kind: "DELIVER",
      title: `Take material to ${where}`,
      detail: `Walk this traveler and the material to ${where}. Tap “Delivered to ${where}” when you drop it off — that parks the traveler at the station and stops dock time.`,
      showDeliverButton: true,
      deliverArea: params.deliverArea,
      secondaryHref: params.deliverArea === "TEST" ? "/test-center" : "/qa",
      secondaryLabel: `${where} queue`,
    };
  }

  // 5) Only when nothing else to deliver/putaway — wait on station return
  if (params.waitingChildId && params.waitingChildNumber) {
    const where =
      params.waitingChildWhere === "TEST"
        ? "Test lab"
        : params.waitingChildWhere === "QA"
          ? "QA"
          : "station";
    const st = params.waitingChildStation
      ? ` @ ${params.waitingChildStation}`
      : "";
    return {
      kind: "WAITING_STATION",
      title: `Waiting on ${where} to send back`,
      detail: `${params.waitingChildNumber} is at ${where}${st}. All other dock moves are done — when ${where} finishes, put away (or take it to the next station).`,
      primaryHref: `/receiving/${params.waitingChildId}`,
      primaryLabel: `Open ${params.waitingChildNumber}`,
      secondaryHref:
        params.waitingChildWhere === "TEST" ? "/test-center" : "/qa",
      secondaryLabel:
        params.waitingChildWhere === "TEST" ? "Test queue" : "QA queue",
      childNumber: params.waitingChildNumber,
    };
  }

  if (params.hasPendingDockAttest) {
    return {
      kind: "ATTEST",
      title: "Sign dock acceptance",
      detail:
        "Material is received but dock acceptance was not signed. Attest below to clear putaway.",
      primaryHref: "#dock-attest",
      primaryLabel: "Go to attest",
      primaryIsAnchor: true,
    };
  }

  if (params.canCompleteStock || params.status === "READY_TO_STOCK") {
    return {
      kind: "PUTAWAY",
      title: "Put away to stock",
      detail:
        "Inspections passed. Choose a stock location and put away — then this traveler is done.",
      primaryHref: "#putaway-form",
      primaryLabel: "Put away now",
      primaryIsAnchor: true,
    };
  }

  if (params.inInspection || params.status === "IN_INSPECTION") {
    // Child traveler is agnostic — next place follows open inspections
    if (params.hasTestPending && !params.hasQaPending) {
      return {
        kind: "AT_TEST",
        title: "Open work: Test Center",
        detail:
          "This traveler needs functional / power testing. Complete it in Test Center, then put away here when READY TO STOCK.",
        primaryHref: "/test-center",
        primaryLabel: "Open Test Center",
      };
    }
    if (params.hasQaPending && params.hasTestPending) {
      return {
        kind: "AT_QA",
        title: "Open work: QA then Test",
        detail:
          "This traveler needs visual / GD&T first, then functional. Finish QA, then Test Center — put away only after all pass.",
        primaryHref: "/qa",
        primaryLabel: "Open QA queue",
        secondaryHref: "/test-center",
        secondaryLabel: "Test Center",
      };
    }
    return {
      kind: "AT_QA",
      title: "Open work: QA",
      detail:
        "This traveler has open visual / GD&T work. Complete it in QA, then put away here when READY TO STOCK.",
      primaryHref: "/qa",
      primaryLabel: "Open QA queue",
    };
  }

  if (params.canReceive) {
    return {
      kind: "RECEIVE",
      title: "Receive on the dock",
      detail:
        "Enter qty that arrived, attach paperwork, then receive. Mixed lines split into child travelers for you.",
      primaryHref: "#receive-form",
      primaryLabel: "Start receive",
      primaryIsAnchor: true,
      secondaryHref: params.poId ? `/purchasing/po/${params.poId}` : undefined,
      secondaryLabel: params.poId ? "Open PO" : undefined,
    };
  }

  if (params.isComplete) {
    return {
      kind: "DONE",
      title: "Traveler complete",
      detail: "Receiving lifecycle finished. History and stock locations are below.",
      secondaryHref: params.poId ? `/purchasing/po/${params.poId}` : "/receiving",
      secondaryLabel: params.poId ? "Open PO" : "All travelers",
    };
  }

  return {
    kind: "DONE",
    title: "No dock action right now",
    detail: "Check child travelers or history if something looks missing.",
    primaryHref: "/receiving",
    primaryLabel: "All travelers",
  };
}

export function stepperState(params: {
  status: string;
  needsQa: boolean;
  needsTest: boolean;
  isComplete: boolean;
  hasReceipt: boolean;
  hasQaPending: boolean;
  hasTestPending: boolean;
  canCompleteStock: boolean;
}): { steps: StepKey[]; active: StepKey | null; completed: StepKey[] } {
  const steps: StepKey[] = ["DOCK"];
  if (params.needsQa) steps.push("QA");
  if (params.needsTest) steps.push("TEST");
  steps.push("PUTAWAY", "STOCKED");

  const completed: StepKey[] = [];
  let active: StepKey | null = "DOCK";

  if (params.isComplete) {
    return {
      steps,
      active: null,
      completed: [...steps],
    };
  }

  if (params.hasReceipt || params.status !== "WAITING") {
    completed.push("DOCK");
  }

  if (params.status === "IN_INSPECTION") {
    if (params.hasQaPending || (params.needsQa && !params.hasTestPending)) {
      active = "QA";
    } else if (params.hasTestPending || params.needsTest) {
      if (params.needsQa) completed.push("QA");
      active = "TEST";
    } else {
      active = params.needsQa ? "QA" : "TEST";
    }
  } else if (params.status === "READY_TO_STOCK" || params.canCompleteStock) {
    if (params.needsQa) completed.push("QA");
    if (params.needsTest) completed.push("TEST");
    if (!completed.includes("DOCK")) completed.push("DOCK");
    active = "PUTAWAY";
  } else if (params.status === "PARTIAL" || params.status === "WAITING") {
    active = "DOCK";
    // strip DOCK from completed if still waiting first receive
    if (params.status === "WAITING" && !params.hasReceipt) {
      const i = completed.indexOf("DOCK");
      if (i >= 0) completed.splice(i, 1);
    }
  }

  return { steps, active, completed };
}

/** Human next-label for list column — status + open work, not dash-number silos */
export function listNextLabel(params: {
  status: string;
  purpose?: TravelerPurpose;
  hasQaPending?: boolean;
  hasTestPending?: boolean;
}): string {
  if (params.status === "READY_TO_STOCK") return "Put away";
  if (params.status === "IN_INSPECTION") {
    // Child is agnostic: show what's actually open
    if (params.hasQaPending && params.hasTestPending) return "QA + Test";
    if (params.hasTestPending) return "At Test";
    if (params.hasQaPending) return "At QA";
    return "In process";
  }
  if (params.status === "WAITING" || params.status === "PARTIAL") {
    if (params.purpose === "REMAINDER") return "Receive remainder";
    return "Receive";
  }
  if (params.status === "COMPLETE" || params.status === "CLOSED") return "Done";
  return params.status;
}
