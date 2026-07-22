/**
 * Interactive guided tours. Pure data (no imports) so it's usable from client
 * and server. Each step optionally spotlights a DOM element (CSS selector),
 * can navigate to a route first, and shows a note box with what to do + why.
 *
 * Add a tour for anything by appending to TOURS. Target elements with a stable
 * `data-tour="<id>"` attribute (preferred) or any CSS selector. Steps with no
 * selector render as a centered card (intros / conclusions).
 *
 * Reliable anchors that exist on (almost) every screen:
 *   [data-tour="page-header"]   the page title block — present on every module
 *   [data-tour="sidebar"]        the whole nav rail
 *   [data-tour="nav-group-*"]    a nav area, e.g. nav-group-manufacturing
 *   [data-tour="global-search"], [data-tour="notifications"],
 *   [data-tour="account-menu"], [data-tour="help"]  — the top bar
 *
 * Never put a query string in `route` (the engine compares against the bare
 * pathname and would navigate in a loop). Describe tabs/views in the body text
 * instead.
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

const HEADER = '[data-tour="page-header"]';

export const TOURS: Tour[] = [
  // ─────────────────────────────── Basics ───────────────────────────────
  {
    id: "getting-started",
    title: "Getting started with ForgeRP",
    description: "A guided lap around the whole system — every area and how it connects.",
    category: "Basics",
    minutes: 4,
    steps: [
      {
        title: "Welcome to ForgeRP 👋",
        body: "This tour walks the whole system, area by area. Use Next/Back to move, or the X to leave anytime. Turn on the speaker to have each step read aloud.",
        why: "ForgeRP runs your entire shop — sales, engineering, purchasing, production, quality, and accounting — as one connected flow, so data entered once follows the work everywhere.",
      },
      {
        selector: '[data-tour="sidebar"]',
        title: "The sidebar is your map",
        body: "Every module lives here, grouped by area. Click a group heading to collapse it; the rail remembers what you close.",
        placement: "right",
      },
      {
        selector: '[data-tour="global-search"]',
        title: "Search anything, fast",
        body: "Press ⌘K / Ctrl-K from anywhere to jump to a work order, PO, part, customer, or module by name or keyword.",
        why: "You rarely need to hunt through menus — search is the fastest way to anything.",
        placement: "bottom",
      },
      {
        selector: '[data-tour="notifications"]',
        title: "Your action items",
        body: "The bell shows what's waiting on you — approvals, MRB holds, buyer packages, overdue reviews. The badge is the count.",
        placement: "bottom",
      },
      {
        route: "/",
        selector: '[data-tour="nav-group-manufacturing"]',
        title: "Manufacturing",
        body: "Work Orders, Workcenters, the Test Center, Kitting, and Planning/MRP — where jobs are built and tracked on the floor.",
        placement: "right",
      },
      {
        route: "/",
        selector: '[data-tour="nav-group-engineering-plm"]',
        title: "Engineering & PLM",
        body: "Requirements, BOMs, Work Instructions, Test Procedures, Products, and Configuration Management — the controlled product definition.",
        placement: "right",
      },
      {
        route: "/",
        selector: '[data-tour="nav-group-supply-chain"]',
        title: "Supply Chain",
        body: "Items, Purchasing, Receiving, Suppliers/ASL, Inventory, Government Property, and Assets — everything about buying and holding material.",
        placement: "right",
      },
      {
        route: "/",
        selector: '[data-tour="nav-group-quality-compliance"]',
        title: "Quality & Compliance",
        body: "QA inspection, NCR/MRB/CAR, RMA, serial trace, and the Quality Programs suite (calibration, tool control, ESD, FOD, HAZMAT, safety, audits, counterfeit).",
        placement: "right",
      },
      {
        route: "/",
        selector: '[data-tour="nav-group-programs-business"]',
        title: "Programs & Business",
        body: "Reports, PMO & PI planning, Budgets, Accounting, Payroll, and HR — the money and program side of the house.",
        placement: "right",
      },
      {
        selector: '[data-tour="help"]',
        title: "Guides live here",
        body: "This ? button opens the Guides hub any time. The tours below walk real end-to-end flows — try 'Order to cash' or 'Work order lifecycle' next.",
        placement: "bottom",
      },
    ],
  },
  {
    id: "my-work",
    title: "Your daily workspace: approvals & timecard",
    description: "Where your own to-dos, approvals, and time entry live.",
    category: "Basics",
    minutes: 2,
    steps: [
      {
        route: "/approvals",
        selector: HEADER,
        title: "My Approvals",
        body: "Everything waiting on your decision collects here — PTO, timesheets, expenses, and purchasing approvals — so nothing sits in an inbox.",
        why: "Approvals route to the person who owns the decision, not to a generic queue, so accountability is always clear.",
      },
      {
        route: "/hr/timesheet",
        selector: HEADER,
        title: "My Timesheet",
        body: "Log hours by day against charge codes / work orders and submit for the pay period. Your manager approves from their own queue.",
        why: "Time charged here feeds job cost, budgets, and payroll — one entry, many downstream uses.",
      },
      {
        route: "/account",
        selector: HEADER,
        title: "My Account",
        body: "Change your password, manage sessions, and set your sign-off PIN used to electronically sign inspections and approvals.",
      },
    ],
  },

  // ───────────────────────── Sales & Customers ─────────────────────────
  {
    id: "order-to-cash",
    title: "Order to cash: quote → sales order → ship",
    description: "Follow a customer order from quotation through shipment.",
    category: "Sales & Customers",
    minutes: 4,
    steps: [
      {
        route: "/customers",
        selector: HEADER,
        title: "It starts with a customer",
        body: "Customers hold accounts, credit limits, and payment terms. Quotes and sales orders both pull from here, and credit is checked before an order books.",
      },
      {
        route: "/sales/quotes",
        selector: '[data-tour="quote-new"]',
        title: "Draft a quote",
        body: "Start a new quote here — add line items and pricing, then email it to the customer straight from the module. The lifecycle is Draft → sent → customer PO recorded.",
        why: "Quotes capture what you promised at what price — the basis for the order and later margin analysis.",
        placement: "bottom",
      },
      {
        route: "/sales/quotes",
        selector: HEADER,
        title: "Record their PO → sales order",
        body: "When the customer accepts, record their PO number and convert the quote into a sales order in one step.",
        why: "No re-keying — pricing and lines flow straight from the accepted quote onto the order.",
      },
      {
        route: "/sales",
        selector: '[data-tour="so-table"]',
        title: "The sales order drives production",
        body: "Sales Orders track each order through Open/Planned → In Production → Ready to Ship → Shipped. From here work orders are created to build what was sold.",
        placement: "top",
      },
      {
        route: "/shipping",
        selector: HEADER,
        title: "Pack & ship",
        body: "Ready orders land in the shipping queue. Pack them, generate the packing list, and record the shipment against the sales order.",
        why: "Shipping closes the loop back to the order and to accounting for invoicing.",
      },
    ],
  },

  // ──────────────────────────── Manufacturing ──────────────────────────
  {
    id: "work-order-lifecycle",
    title: "Work order lifecycle: release → kit → build → test → done",
    description: "How a job moves from release through the floor to completion.",
    category: "Manufacturing",
    minutes: 5,
    steps: [
      {
        route: "/work-orders",
        selector: '[data-tour="wo-create"]',
        title: "Work Orders run the build",
        body: "Create a production WO straight from a BOM (or a task-only WO for non-BOM work). The WO carries what to build, how many, the routing of steps, and its traveler.",
        why: "The WO is the spine of the shop — kitting, labor, test, and quality all attach to it.",
        placement: "bottom",
      },
      {
        route: "/kitting",
        selector: HEADER,
        title: "Kitting pulls the material",
        body: "When a WO is ready, kitting picks its BOM components. A complete kit pulls everything; a short kit does a partial pick and flags the shortage.",
        why: "Picked material stages to a real location tagged to the WO, so you can see exactly where a kit is sitting.",
      },
      {
        route: "/floor",
        selector: HEADER,
        title: "The Production Floor is live",
        body: "The floor view shows every active job and where it is right now. Operators move a WO between work centers as they work it.",
      },
      {
        route: "/workcenters",
        selector: HEADER,
        title: "Work centers do the work",
        body: "Each work center (cell, machine, or station) has capacity and a queue. Labor is clocked against the WO at the center where the step runs.",
        why: "Clocked labor feeds job cost and the capacity picture Planning uses.",
      },
      {
        route: "/test-center",
        selector: HEADER,
        title: "Powered functional test",
        body: "Work in the TEST area runs through the Test Center — run acceptance/functional procedures against a unit and record pass/fail results.",
        why: "Test results attach to the serial's as-built record for traceability.",
      },
      {
        route: "/work-orders",
        selector: HEADER,
        title: "Completion closes it out",
        body: "A finished WO reports completion at Receiving putaway, relieves its kit, and moves finished goods into inventory ready to ship.",
      },
    ],
  },
  {
    id: "planning-mrp",
    title: "Planning & MRP: forecast → material sheets → dated WOs",
    description: "Rough-cut capacity and the forecast-to-work-order flow.",
    category: "Manufacturing",
    minutes: 3,
    steps: [
      {
        route: "/planning",
        selector: HEADER,
        title: "Planning balances demand & capacity",
        body: "Planning shows rough-cut capacity across the horizon — scheduled load vs. available hours — against a working calendar, and flags late or undated work.",
      },
      {
        route: "/planning",
        selector: HEADER,
        title: "Forecast → MRS → MWO",
        body: "A forecast drives material requirement sheets (MRS), which release dated manufacturing work orders (MWOs). Buy demand flows on to Purchasing.",
        why: "This is how demand becomes both the jobs to build and the parts to buy, with real need-by dates.",
      },
    ],
  },
  {
    id: "shop-visibility",
    title: "Live shop visibility: floor, radiators, value stream",
    description: "The big-screen and flow views that show shop state at a glance.",
    category: "Manufacturing",
    minutes: 2,
    steps: [
      {
        route: "/radiators",
        selector: HEADER,
        title: "Info Radiators",
        body: "Wall-display dashboards for the floor — throughput, WIP, and exceptions sized for a big screen.",
      },
      {
        route: "/value-stream",
        selector: HEADER,
        title: "Value Stream Map",
        body: "See the end-to-end flow and where the constraint is — where work piles up between steps.",
        why: "Managing the constraint is how you actually move the whole line faster.",
      },
    ],
  },

  // ────────────────────────── Engineering & PLM ────────────────────────
  {
    id: "product-definition",
    title: "Product definition: requirements → BOM → WI → test",
    description: "How the controlled product definition is built and released.",
    category: "Engineering & PLM",
    minutes: 5,
    steps: [
      {
        route: "/requirements",
        selector: HEADER,
        title: "Requirements come first",
        body: "Capture 'shall' statements, trace each to the work that implements it, and record the verification method. Coverage shows what's still uncovered.",
        why: "Traceability from requirement to verification is the backbone of an auditable design.",
      },
      {
        route: "/bom",
        selector: HEADER,
        title: "BOMs define structure",
        body: "Bills of material hold the product structure and revisions. Part numbers themselves live in Items — the BOM references them and shows where-used.",
      },
      {
        route: "/work-instructions",
        selector: HEADER,
        title: "Work Instructions tell the floor how",
        body: "Step-by-step build instructions with photos, tools, and sign-offs. Released WIs are retained as controlled masters in CM.",
      },
      {
        route: "/test-procedures",
        selector: HEADER,
        title: "Test Procedures define acceptance",
        body: "Acceptance and functional test procedures (ATPs) are CM-controlled and run at the Test Center, recording results per step.",
      },
      {
        route: "/products",
        selector: HEADER,
        title: "Products tie it together (PLM)",
        body: "The product record links its BOM, WIs, procedures, and program — the single lifecycle view of what you make.",
      },
    ],
  },
  {
    id: "change-management",
    title: "Configuration Management & the change process",
    description: "Controlled documents, numbering, and the ECR/ECO workflow.",
    category: "Engineering & PLM",
    minutes: 4,
    steps: [
      {
        route: "/cm",
        selector: '[data-tour="cm-tabs"]',
        title: "Submissions, Library & Numbers",
        body: "CM has three tabs: Submissions (change requests in flight), Library (released controlled documents with revision chains), and Numbers (schemes + the master registry).",
        why: "Nothing on the floor should reference an uncontrolled copy; CM guarantees one released master per number.",
        placement: "bottom",
      },
      {
        route: "/cm",
        selector: '[data-tour="cm-tabs"]',
        title: "Changes go through an ECR",
        body: "A change is proposed as a submission (ECR), routed to approvers, and released — which revs the document and archives the prior master. Numbering ensures every document draws from a controlled sequence.",
        why: "This is the same controlled path Quality Program policies now follow — submit a policy and it lands here as an ECR until released.",
        placement: "bottom",
      },
      {
        route: "/engineering",
        selector: HEADER,
        title: "Engineering executes the work",
        body: "The Engineering board tracks design tasks by discipline (systems, mechanical, electrical, software, and more), tying effort back to requirements and changes.",
      },
    ],
  },

  // ──────────────────────────── Supply Chain ───────────────────────────
  {
    id: "procure-to-receive",
    title: "Procure to receive: PR → approval → PO → receiving",
    description: "A buy from request through approval, buyer packaging, PO, and receipt.",
    category: "Supply Chain",
    minutes: 5,
    steps: [
      {
        route: "/purchasing/pr/new",
        selector: HEADER,
        title: "Every buy starts as a PR",
        body: "A purchase request captures what's needed, the quantity, and the charge (project/WBS, work order, or overhead). Manufacturing and project buys must use catalog parts.",
        why: "Charging the buy correctly here is what keeps job cost and budgets honest downstream.",
      },
      {
        route: "/purchasing",
        selector: '[data-tour="pr-po-tabs"]',
        title: "Approvals route to the charge owner",
        body: "The PR routes to whoever owns the charge — a WBS owner, program, or budget holder — never to purchasing itself. Toggle between Purchase orders and Purchase requests here; each PR shows its approval status.",
        why: "Spend is controlled by the person accountable for the money, not the person doing the buying.",
        placement: "bottom",
      },
      {
        route: "/purchasing",
        selector: HEADER,
        title: "A buyer packages it",
        body: "An assigned buyer confirms prices, attaches the supplier quote, notes any sole-source justification, then converts the approved PR into a purchase order.",
      },
      {
        route: "/receiving",
        selector: HEADER,
        title: "Receiving with travelers",
        body: "Incoming material is received against the PO on a dock traveler, inspected, and put away. Government-furnished property is flagged separately.",
      },
      {
        route: "/inventory",
        selector: HEADER,
        title: "Stock lands in Inventory",
        body: "After put-away, material shows by location — on-hand, available, committed, and quarantine.",
        why: "Material only becomes 'available' after put-away, so kitting never grabs stock still on the dock.",
      },
    ],
  },
  {
    id: "items-inventory",
    title: "Items & inventory: the part master and stock",
    description: "Part numbers, sourcing, and how on-hand stock is tracked.",
    category: "Supply Chain",
    minutes: 3,
    steps: [
      {
        route: "/items",
        selector: HEADER,
        title: "Items are the part master",
        body: "Part numbers, sourcing, standard costs, and approved vendors live here — separate from BOMs, which reference these items.",
      },
      {
        route: "/inventory",
        selector: HEADER,
        title: "Inventory by location",
        body: "On-hand by bin with lot/serial tracking, government-furnished vs. company stock, and quarantine for held material.",
        why: "Lot and serial tracking is what makes full genealogy and recalls possible.",
      },
      {
        route: "/inventory",
        selector: HEADER,
        title: "Kanban replenishment",
        body: "Parts at or below their minimum with nothing on order surface as shortages — a Kanban signal that raises a replenishment PR before you run out.",
      },
    ],
  },
  {
    id: "suppliers-property",
    title: "Suppliers, ASL & government property",
    description: "Approved suppliers, scorecards, and DFARS-tracked GFP.",
    category: "Supply Chain",
    minutes: 3,
    steps: [
      {
        route: "/suppliers",
        selector: HEADER,
        title: "Approved Supplier List",
        body: "Each supplier's ASL line items, POs, invoices, QMS certifications, and a performance scorecard live on their profile.",
        why: "Buying from an approved, scored supplier is a flow-down requirement in AS9100 shops.",
      },
      {
        route: "/government-property",
        selector: HEADER,
        title: "Government property (GFP)",
        body: "Government-furnished property is tracked apart from company stock with UID, DD-1149 movement, and DFARS accountability.",
      },
      {
        route: "/assets",
        selector: HEADER,
        title: "Asset tracker",
        body: "Tools, test equipment, and demo units with check-out/check-in. Intangibles like software licenses live under Virtual Assets.",
      },
    ],
  },

  // ─────────────────────────── Quality & Compliance ────────────────────
  {
    id: "quality-escape",
    title: "Quality escape: inspection → NCR → MRB → CAR",
    description: "How a defect is caught, dispositioned, and prevented from recurring.",
    category: "Quality",
    minutes: 5,
    steps: [
      {
        route: "/qa",
        selector: HEADER,
        title: "QA catches it first",
        body: "Visual, GD&T, and continuity inspections run in the QA queue (powered functional test is the Test Center). A failure here becomes a nonconformance.",
      },
      {
        route: "/quality",
        selector: HEADER,
        title: "Nonconformances & yield",
        body: "The Quality module logs NCRs and tracks yield and inspection trends. A significant NCR escalates to the Material Review Board.",
      },
      {
        route: "/mrb",
        selector: HEADER,
        title: "The MRB dispositions material",
        body: "The board decides: use-as-is, rework, repair, scrap, or return to supplier — with justification. Scrap can auto-raise a replacement PR; rework/repair open a linked work order.",
      },
      {
        route: "/mrb",
        selector: '[data-tour="mrb-quality-links"]',
        title: "Link the case to the quality programs",
        body: "On each case you can pin a suspect calibration tool (and decide to pull it for recal), or flag the failure as ESD/FOD/counterfeit-caused — which auto-opens an incident in that program that runs its disposition steps.",
        why: "This closes the loop from a defect back to its systemic cause instead of just dispositioning the parts.",
        placement: "top",
      },
      {
        route: "/mrb",
        selector: HEADER,
        title: "A CAR prevents recurrence",
        body: "Switch to the CAR view (Corrective Action) from the toggle at the top. A disposition can open a CAR — root cause, corrective action, and verification — so the problem doesn't come back.",
      },
    ],
  },
  {
    id: "rma-trace",
    title: "Returns & traceability: RMA and serial genealogy",
    description: "Handle a customer return and trace a serial's full as-built history.",
    category: "Quality",
    minutes: 3,
    steps: [
      {
        route: "/rma",
        selector: HEADER,
        title: "RMA handles returns",
        body: "Log a return authorization, receive the unit, and route it to MRB or a repair work order. The RMA links back to the original order and serial.",
      },
      {
        route: "/trace/serials",
        selector: HEADER,
        title: "Serial traceability",
        body: "Walk a serial's genealogy — its as-built tree, the lots and sub-serials that went into it, and every test and disposition it touched.",
        why: "Full genealogy answers 'what else is affected?' in a recall or escape investigation in seconds.",
      },
    ],
  },
  {
    id: "qms-calibration-tools",
    title: "Quality Programs: calibration & tool control",
    description: "Gage calibration, toolboxes, labels/DXF, and missing/broken tool reports.",
    category: "Quality",
    minutes: 6,
    steps: [
      {
        route: "/quality/programs",
        selector: HEADER,
        title: "The Quality Programs hub",
        body: "One place for the whole QMS suite — calibration, tool control, HAZMAT, ESD, FOD, safety, internal audits, and counterfeit — each a card showing overdue and due-soon counts.",
      },
      {
        route: "/quality/programs/calibration",
        selector: '[data-tour="qms-policy"]',
        title: "Every program has a controlled policy",
        body: "This card links the program's policy — a CM-controlled document. Submit a new one and it enters the CM change process as an ECR; or link an existing CM document. It publishes only when CM releases it.",
        why: "Policies follow the same controlled path as work instructions, so nothing on the floor references an uncontrolled copy.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/calibration",
        selector: '[data-tour="qms-add"]',
        title: "Add a gage — attach the certificate",
        body: "Enter the ID, interval, and next-due, then attach the calibration certificate as a file (not a link). Interval and next-due line up so it's quick to fill.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/calibration",
        selector: '[data-tour="qms-register"]',
        title: "The register + label / DXF",
        body: "Each gage shows its status and next-due. Log a passing calibration and the due date rolls forward automatically. Use the label link to print a tag or download a DXF to laser-etch the ID.",
        placement: "top",
      },
      {
        route: "/quality/programs/tools",
        selector: '[data-tour="tools-add"]',
        title: "Toolboxes & tools",
        body: "Add a toolbox (named by its workcenter location) and add tools to it. Toggle 'needs calibration' on a tool and it also appears on the Calibration register with its own cadence.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/tools",
        selector: HEADER,
        title: "Tool checks & missing/broken reports",
        body: "Run a toolbox inspection that ticks each tool and saves the report to history. From any tool, open a report: BROKEN gathers pieces and one-clicks a replacement PR; MISSING (or an unrecoverable piece) auto-opens a FOD incident.",
        why: "A lost tool is a foreign-object risk — the workflow forces it through the FOD process instead of being forgotten.",
      },
    ],
  },
  {
    id: "qms-inspections-audits",
    title: "Quality Programs: inspections, incidents & audits",
    description: "ESD/FOD walks, humidity, MRB-linked incidents, internal audits, and counterfeit.",
    category: "Quality",
    minutes: 7,
    steps: [
      {
        route: "/quality/programs/esd",
        selector: '[data-tour="qms-register"]',
        title: "ESD stations — inspect from the register",
        body: "Each station carries an 'Inspect' pill. Define the inspection template once (below the register) and it applies to every station; running one records pass/fail, notes, and photos to a clickable history.",
        placement: "top",
      },
      {
        route: "/quality/programs/esd",
        selector: HEADER,
        title: "Humidity tracking",
        body: "A humidity device can POST relative humidity per area to /api/esd/humidity (or you log it by hand). Readings show against the 30–70% ESD-safe band, flagging out-of-band areas.",
      },
      {
        route: "/quality/programs/fod",
        selector: '[data-tour="qms-add"]',
        title: "FOD walks",
        body: "Add FOD zones (no location needed — the zone is the place) and run walks with the same template workflow: customize what to look for, attach photos, and save each walk.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/audits",
        selector: '[data-tour="qms-add"]',
        title: "Internal audits",
        body: "Add an audit by picking the program you're auditing, then run it step-by-step. Mark each clause OK, OFI, or NCR with evidence photos — every NCR opens a tracked corrective action with a reinspect-by date.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/counterfeit",
        selector: '[data-tour="qms-add"]',
        title: "Counterfeit prevention",
        body: "Log a suspect part with photo evidence and optionally initiate an MRB case from it. Suspect-counterfeit findings in MRB flow back here to be tracked and dispositioned.",
        placement: "bottom",
      },
      {
        route: "/quality/programs/hazmat",
        selector: '[data-tour="qms-register"]',
        title: "HAZMAT — area & expiration",
        body: "HAZMAT materials are assigned to a workcenter/area, carry the SDS attached to the record, and track a material expiration date separately — expired and expiring items are flagged right in the register.",
        placement: "top",
      },
    ],
  },

  // ───────────────────────── Programs & Business ───────────────────────
  {
    id: "program-management",
    title: "Program management: PMO, PI planning & budgets",
    description: "Run programs with WBS, earned value, increments, and charge codes.",
    category: "Programs & Business",
    minutes: 4,
    steps: [
      {
        route: "/pmo",
        selector: HEADER,
        title: "The PMO runs programs",
        body: "Programs and projects with a work-breakdown structure and earned-value metrics (SPI/CPI) — schedule and cost performance at a glance.",
      },
      {
        route: "/pmo/pi",
        selector: HEADER,
        title: "PI planning",
        body: "Program-increment planning lays out the next block of work across teams — the SAFe-style cadence for committing scope.",
      },
      {
        route: "/pmo/alerts",
        selector: HEADER,
        title: "PM alerts",
        body: "Program risks and threshold breaches surface here (and on the bell) so a slipping program gets attention early.",
      },
      {
        route: "/budgets",
        selector: HEADER,
        title: "Budgets & charge codes",
        body: "The charge-code owner approves time and material against the budget. Forecast work is direct job cost; standalone budgets are company indirect.",
        why: "This is where PRs and timesheets actually hit a budget, tying execution to the money.",
      },
    ],
  },
  {
    id: "accounting-money",
    title: "Accounting: GL, AR/AP, payroll & banking",
    description: "The books — period close, receivables/payables, pay runs, and bank feeds.",
    category: "Programs & Business",
    minutes: 4,
    steps: [
      {
        route: "/accounting",
        selector: HEADER,
        title: "The general ledger & close",
        body: "Accounting runs on your basis (accrual/cash) and fiscal calendar — journals, P&L, balance sheet, AR, and AP. Month-end close locks the period so posted books can't shift.",
      },
      {
        route: "/accounting/banking",
        selector: HEADER,
        title: "Bank connections",
        body: "Link accounts via Plaid to pull transactions automatically and reconcile against the ledger.",
      },
      {
        route: "/accounting/payroll",
        selector: HEADER,
        title: "Payroll",
        body: "Run pay from approved timesheets — gross-to-net with withholdings and paystubs — posting the expense straight to the GL.",
        why: "Because time is charged to jobs and budgets, labor cost flows to both payroll and job cost from one source.",
      },
      {
        route: "/reports",
        selector: HEADER,
        title: "Reports & export",
        body: "Run any report on screen, download CSV for Excel, or print — aging, valuation, WIP, and more, on live data with no setup.",
      },
    ],
  },
  {
    id: "hr-hire-to-onboard",
    title: "HR & hiring: workforce → recruit → onboard",
    description: "The people side — workspace, hiring pipeline, and new-hire onboarding.",
    category: "Programs & Business",
    minutes: 4,
    steps: [
      {
        route: "/hr",
        selector: HEADER,
        title: "HR & Workforce",
        body: "Reviews, goals, training & certifications, time off, documents, and feedback — your workspace, plus team and company views for managers and HR. Recruiting and Onboarding open from the buttons up top.",
      },
      {
        route: "/recruiting",
        selector: HEADER,
        title: "Recruiting pipeline",
        body: "Open a job requisition, add candidates, and move them Applied → Screening → Interview → Offer → Hired.",
      },
      {
        route: "/recruiting",
        selector: HEADER,
        title: "Hiring starts onboarding",
        body: "Moving a candidate to Hired opens their onboarding record automatically — no re-keying their information.",
      },
      {
        route: "/hr/onboarding",
        selector: HEADER,
        title: "Onboarding checklist",
        body: "Personal info, IDs, a documents checklist (I-9, W-4, direct deposit), and background checks in one record with a completion gate before day one.",
      },
    ],
  },

  // ──────────────────────────── Administration ─────────────────────────
  {
    id: "admin-setup",
    title: "Admin & setup: company, roles, import, email",
    description: "Configure the company, control access, and get data in.",
    category: "Administration",
    minutes: 4,
    steps: [
      {
        route: "/setup",
        selector: HEADER,
        title: "Setup Wizard",
        body: "The plug-and-play wizard walks first-time configuration — company details, fiscal setup, and getting the essentials in place.",
      },
      {
        route: "/admin/settings",
        selector: HEADER,
        title: "Company Settings",
        body: "Company-wide preferences — fiscal year, accounting basis, and the toggles that shape how modules behave.",
      },
      {
        route: "/admin/permissions",
        selector: HEADER,
        title: "Roles & Permissions",
        body: "Role-based access control — decide who can see and do what, module by module.",
        why: "Permissions gate sensitive actions like MRB disposition, approvals, and payroll.",
      },
      {
        route: "/admin/import",
        selector: HEADER,
        title: "Data Import",
        body: "Bring your item master and other data in from CSV/Excel to migrate quickly instead of hand-keying.",
      },
      {
        route: "/email",
        selector: HEADER,
        title: "Email Center",
        body: "Inbound and outbound email — RFQ acknowledgements, supplier correspondence, and parsing — connected to the modules that use it.",
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
        selector: HEADER,
        title: "Plan & billing",
        body: "Your trial countdown, current plan, and the tiers live here — Starter, Growth, Business, or Enterprise — with seat limits shown per plan.",
        why: "Trials run 30 days with unlimited users; after that a plan keeps your data and access.",
      },
    ],
  },
];

export function getTour(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
