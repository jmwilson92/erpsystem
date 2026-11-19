/**
 * Guided “How do I …” flows: navigate to the page, explain one short step
 * at a time, highlight the control, and offer a supported Carina action.
 */
import type { AiGuideAction, AiPendingAction } from "@/lib/services/ai";
import type { TourStep } from "@/lib/guides";
import { carinaTargetSelector } from "./nav-registry";
import type { NavigateHighlight } from "./navigate";

export const HOWTO_PENDING_ACTION = "HOWTO_GUIDE";

export type HowtoStep = {
  title: string;
  body: string;
  route?: string;
  target?: string;
  label?: string;
};

export type HowtoOffer = {
  kind: string;
  prompt: string;
};

export type HowtoGuide = {
  id: string;
  title: string;
  steps: HowtoStep[];
  offer?: HowtoOffer;
};

export type HowtoTurn = {
  text: string;
  href?: string;
  highlight?: NavigateHighlight;
  guide?: AiGuideAction;
  pendingAction?: AiPendingAction | null;
  offer?: HowtoOffer;
  done: boolean;
};

export const HOWTO_GUIDES: HowtoGuide[] = [
  {
    id: "create-purchase-request",
    title: "Create a purchase request",
    steps: [
      {
        title: "Open purchase requests",
        body: "I’ve opened the purchase request list. Use the Purchase requests tab if you aren’t on it already.",
        route: "/purchasing?tab=prs",
        target: "pr-po-tabs",
        label: "Purchase requests tab",
      },
      {
        title: "Start a new request",
        body: "Click New purchase request. Manufacturing or project lines need a catalog part; facilities or other can use a free-text description.",
        route: "/purchasing?tab=prs",
        target: "new-purchase-request",
        label: "New purchase request",
      },
      {
        title: "Save as draft",
        body: "Add quantity, justification and any charge code, then save. It stays a draft until you submit it for approval.",
        route: "/purchasing/pr/new",
        target: "new-purchase-request",
        label: "New purchase request form",
      },
    ],
    offer: {
      kind: "CREATE_PURCHASE_REQUEST",
      prompt: "Want me to do it? Tell me what to buy and how many.",
    },
  },
  {
    id: "create-work-order",
    title: "Create a work order",
    steps: [
      {
        title: "Open work orders",
        body: "I’ve opened work orders. Production jobs need a certified BOM revision before you can release them.",
        route: "/work-orders",
        target: "wo-create",
        label: "New work order",
      },
      {
        title: "Fill the header",
        body: "Choose the part or BOM, quantity and due date, then save. The order starts in planned status so the floor can kit and release it later.",
        route: "/work-orders",
        target: "wo-create",
        label: "New work order",
      },
    ],
  },
  {
    id: "bom-prototype-settings",
    title: "Set the BOM prototype default",
    steps: [
      {
        title: "Open company settings",
        body: "I’ve opened company settings. The BOM certification default is in the BOM certification default card.",
        route: "/admin/settings",
        target: "bom-prototype-default",
        label: "BOM certification default",
      },
      {
        title: "Choose the path",
        body: "Pick Prototype required or Direct certification, then save. This applies to new BOM revisions; an authorized certifier can still choose a different path on a single BOM.",
        route: "/admin/settings",
        target: "bom-prototype-default",
        label: "New BOMs path",
      },
    ],
  },
  {
    id: "capacity-planning",
    title: "Review capacity planning",
    steps: [
      {
        title: "Open the capacity tab",
        body: "I’ve opened capacity planning. This shows load against work-center capacity for the selected week.",
        route: "/planning?tab=capacity",
        target: "planning-capacity",
        label: "Capacity planning",
      },
      {
        title: "Read the load",
        body: "Check centers over capacity, then adjust the week or span if you need a wider view. Say next if you want the calendar settings next.",
        route: "/planning?tab=capacity",
        target: "planning-capacity",
        label: "Capacity planning",
      },
    ],
  },
  {
    id: "plan-demand",
    title: "Plan demand for a build",
    steps: [
      {
        title: "Open planning",
        body: "I’ve opened planning. You can build a forecast and a planning worksheet here, or I can plan the demand for you.",
        route: "/planning?tab=forecast",
        target: "page-header",
        label: "Planning forecasts",
      },
      {
        title: "Give the demand",
        body: "Tell me the part, quantity and need-by date. I’ll explode the BOM, net supply, and ask you to confirm before creating drafts.",
        route: "/planning?tab=forecast",
      },
    ],
    offer: {
      kind: "PLAN_DEMAND",
      prompt: "Want me to do it? Tell me the part, quantity and need-by date.",
    },
  },
  {
    id: "post-cycle-count",
    title: "Post a cycle count",
    steps: [
      {
        title: "Open inventory",
        body: "I’ve opened inventory. Cycle counts adjust on-hand for a part and bin after you count it.",
        route: "/inventory",
        target: "inventory-table",
        label: "Inventory",
      },
      {
        title: "Record the count",
        body: "Find the part and bin, enter the counted quantity, and post the count. It needs inventory.cyclecount permission.",
        route: "/inventory",
        target: "inventory-table",
        label: "Inventory",
      },
    ],
    offer: {
      kind: "CYCLE_COUNT",
      prompt: "Want me to do it? Tell me the part, bin, and counted quantity.",
    },
  },
];

const HOWTO_RULES: [RegExp, string][] = [
  [/purchase request|purchasing request|\bprs?\b/, "create-purchase-request"],
  [/work order|\bwo\b|traveler/, "create-work-order"],
  [/bom prototype|prototype (required|default|setting)|certification default|direct certify/, "bom-prototype-settings"],
  [/capacity planning|work ?center capacity/, "capacity-planning"],
  [/plan (this )?demand|plan (and process )?demand|planning worksheet|material requisition/, "plan-demand"],
  [/cycle ?count|physical count|adjust (the )?count/, "post-cycle-count"],
];

export function matchHowtoGuide(question: string): HowtoGuide | null {
  const t = question.toLowerCase();
  for (const [re, id] of HOWTO_RULES) {
    if (re.test(t)) return HOWTO_GUIDES.find((g) => g.id === id) || null;
  }
  return null;
}

export function isNextStepUtterance(text: string): boolean {
  const t = text.trim().toLowerCase();
  return /^(next|next step|continue|what'?s next|and then|keep going)([.!]*)?$/.test(t);
}

export function isHowtoOfferAccept(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(do it|yes,? do it|yes please|please do|go ahead|want you to do it)([.!]*)?$/.test(t) ||
    /\b(want you to do it|do it for me|yes,? (do it|please))\b/.test(t)
  );
}

export function isHowtoPending(
  pending?: AiPendingAction | null
): pending is AiPendingAction & { action: typeof HOWTO_PENDING_ACTION; partial: NonNullable<AiPendingAction["partial"]> } {
  return pending?.action === HOWTO_PENDING_ACTION && !!pending.partial?.guideId;
}

export function howtoSelector(step: HowtoStep): string | undefined {
  if (!step.target) return undefined;
  return carinaTargetSelector(step.target);
}

function highlightFor(step: HowtoStep): NavigateHighlight | undefined {
  const selector = howtoSelector(step);
  if (!selector && !step.target) return undefined;
  return {
    target: step.target || "",
    route: step.route,
    label: step.label || step.title,
    selector,
  };
}

function stepsToTour(guide: HowtoGuide, index: number): TourStep[] {
  return guide.steps.map((s, i) => ({
    selector: howtoSelector(s),
    route: s.route,
    title: s.title,
    body: s.body,
  })).slice(index);
}

export function formatHowtoTurn(
  guide: HowtoGuide,
  index: number,
  opts?: { voice?: boolean; includeOffer?: boolean }
): HowtoTurn {
  const step = guide.steps[index];
  if (!step) {
    return { text: "That’s the last step.", done: true, pendingAction: null };
  }
  const remaining = guide.steps.length - index - 1;
  const nextHint = remaining > 0 ? " Say next for the next step." : "";
  const offerHint =
    opts?.includeOffer !== false && remaining === 0 && guide.offer
      ? ` ${guide.offer.prompt}`
      : remaining > 0 && index === 0 && guide.offer
        ? ` ${guide.offer.prompt}`
        : "";
  const text = `${step.body}${nextHint}${offerHint}`.replace(/\s+/g, " ").trim();
  const highlight = highlightFor(step);
  const pending: AiPendingAction | null =
    remaining > 0 || guide.offer
      ? {
          action: HOWTO_PENDING_ACTION,
          phase: "clarify",
          partial: {
            guideId: guide.id,
            index: String(index),
            offerKind: guide.offer?.kind || "",
          },
        }
      : null;
  const guideAction: AiGuideAction = {
    stepByStep: true,
    steps: stepsToTour(guide, index),
  };
  return {
    text,
    href: step.route,
    highlight,
    guide: guideAction,
    pendingAction: pending,
    offer: guide.offer,
    done: remaining === 0 && !guide.offer,
  };
}

export function advanceHowto(pending: AiPendingAction, question: string): HowtoTurn | null {
  if (!isHowtoPending(pending)) return null;
  const guide = HOWTO_GUIDES.find((g) => g.id === pending.partial.guideId);
  if (!guide) return null;
  const current = Number(pending.partial.index || 0);
  if (isNextStepUtterance(question)) {
    return formatHowtoTurn(guide, current + 1);
  }
  return null;
}

export function startHowto(question: string, opts?: { voice?: boolean }): HowtoTurn | null {
  const guide = matchHowtoGuide(question);
  if (!guide) return null;
  return formatHowtoTurn(guide, 0, { voice: opts?.voice, includeOffer: true });
}
