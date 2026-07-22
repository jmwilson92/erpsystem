/**
 * Interactive guided tours. Pure data (no imports) so it's usable from client
 * and server. Each step optionally spotlights a DOM element (CSS selector),
 * can navigate to a route first, and shows a note box with what to do + why.
 *
 * Add a tour for anything by appending to TOURS. Target elements with a stable
 * `data-tour="<id>"` attribute (preferred) or any CSS selector. Steps with no
 * selector render as a centered card (intros / conclusions).
 */

export type TourStep = {
  /** CSS selector to spotlight. Omit for a centered card. */
  selector?: string;
  /** Navigate here before showing this step (waits for the selector). */
  route?: string;
  title: string;
  /** What to do. */
  body: string;
  /** Why it matters (optional, shown emphasized). */
  why?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
};

export type Tour = {
  id: string;
  title: string;
  description: string;
  category: string;
  minutes: number;
  steps: TourStep[];
};

export const TOURS: Tour[] = [
  {
    id: "getting-started",
    title: "Getting started with ForgeRP",
    description: "A 2-minute orientation to the whole system.",
    category: "Basics",
    minutes: 2,
    steps: [
      {
        title: "Welcome to ForgeRP 👋",
        body: "This quick tour shows you how the system is laid out. Use Next/Back to move, or Skip anytime. Turn on the speaker to have it read each step aloud.",
        why: "ForgeRP runs your whole shop — sales, engineering, purchasing, production, quality, and accounting — in one connected flow.",
      },
      {
        selector: '[data-tour="sidebar"]',
        title: "The sidebar is your map",
        body: "Every module lives here, grouped by area: Manufacturing, Engineering, Supply Chain, Quality, Programs & Business, and Administration.",
        placement: "right",
      },
      {
        selector: '[data-tour="global-search"]',
        title: "Search anything, fast",
        body: "Jump to any work order, PO, part, or module. Press ⌘K / Ctrl-K from anywhere.",
        why: "You rarely need to click through menus — just search.",
        placement: "bottom",
      },
      {
        selector: '[data-tour="notifications"]',
        title: "Your action items",
        body: "The bell shows what needs you — approvals, holds, and exceptions. The number is how many.",
        placement: "bottom",
      },
      {
        selector: '[data-tour="account-menu"]',
        title: "Account & sign out",
        body: "Your profile, sign-off PIN, and Sign out live here.",
        placement: "bottom",
      },
      {
        title: "That's the lay of the land",
        body: "Explore more guides any time from the ? menu or the Guides hub. Try the 'Purchase request → PO → receive' tour next to see a real flow end to end.",
      },
    ],
  },
  {
    id: "procure-to-receive",
    title: "Purchase request → PO → receive",
    description: "Follow a buy from request through approval, PO, and receiving.",
    category: "Supply Chain",
    minutes: 3,
    steps: [
      {
        route: "/purchasing",
        title: "Purchasing starts with a request",
        body: "Every buy begins as a purchase request (PR). This is the purchasing workbench.",
        why: "PRs route for approval by the person who owns the charge — never purchasing itself — so spend is controlled.",
      },
      {
        route: "/purchasing",
        selector: '[data-tour="pr-list"]',
        title: "The PR queue",
        body: "Open PRs show here with their approval status. A buyer packages each one — confirming prices, attaching quotes, and noting sole-source justification.",
        placement: "auto",
      },
      {
        route: "/inventory",
        selector: '[data-tour="page-header"]',
        title: "Received material lands in Inventory",
        body: "Once a PO is received and put away, stock appears here by location — on-hand, available, committed, and quarantine.",
        why: "Material is only 'available' after put-away, so kitting never grabs stock that's still on the dock.",
      },
    ],
  },
  {
    id: "kitting-wip",
    title: "Kitting & tracking a kit through the floor",
    description: "Pick a kit, stage it, and watch it move between work centers.",
    category: "Manufacturing",
    minutes: 3,
    steps: [
      {
        route: "/kitting",
        title: "Kitting pulls material for a build",
        body: "When a work order is ready, kitting picks its BOM components. Short kits offer a partial pick; complete kits pick everything.",
      },
      {
        route: "/kitting",
        selector: '[data-tour="page-header"]',
        title: "Kits stage at a real location",
        body: "Picked material moves to your staging location and shows in Inventory tagged to the work order.",
        why: "You can literally see where a kit is sitting — at staging, or at any work center — as it moves through production.",
      },
    ],
  },
  {
    id: "recruiting-onboarding",
    title: "Hire someone: requisition → candidate → onboarding",
    description: "Open a role, move a candidate to hired, and run onboarding.",
    category: "People",
    minutes: 3,
    steps: [
      {
        route: "/recruiting",
        title: "Recruiting is the hiring pipeline",
        body: "Open a job requisition, then add candidates and move them through Applied → Screening → Interview → Offer.",
      },
      {
        route: "/recruiting",
        selector: '[data-tour="page-header"]',
        title: "Hiring starts onboarding automatically",
        body: "Move a candidate to Hired and ForgeRP opens their onboarding record for you.",
        why: "No re-keying — the candidate's info flows straight into onboarding.",
      },
      {
        route: "/hr/onboarding",
        title: "Onboarding collects everything you need",
        body: "Personal info, IDs, and a documents checklist (I-9, W-4, direct deposit, and more), plus background checks — all in one record with a completion gate.",
      },
    ],
  },
  {
    id: "billing-plan",
    title: "Your plan & billing",
    description: "See your trial, choose a plan, and manage billing.",
    category: "Administration",
    minutes: 1,
    steps: [
      {
        route: "/billing",
        title: "Plan & billing",
        body: "Your trial countdown, current plan, and the tiers live here. Pick a plan any time — Starter, Growth, Business, or Enterprise.",
        why: "Trials run 30 days with unlimited users; after that a plan keeps your data and access.",
      },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
