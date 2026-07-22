/**
 * ForgeRP rich seed data — demonstrates all integrated manufacturing flows.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function daysFromNow(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log("🔥 Seeding ForgeRP...");

  // Wipe in dependency order (SQLite)
  const tables = [
    "TicketComment", "EngineeringTicket", "Sprint",
    "CompanySettings", "TimesheetApproval", "Timesheet", "PayrollPolicy", "ReviewPolicy", "AccountingSettings", "EmployeeDocument", "TrainingRequirement", "TrainingRecord", "FeedbackNote", "GoalCheckIn", "EmployeeGoal", "PerformanceReview", "ExpenseLine", "ExpenseReport", "PtoRequest", "TimeEntry",
    "GfpConsumption", "GfpCheckout", "GfpAuditRecord", "GfpDocument",
    "ComplianceCheck", "GovernmentProperty",
    "VirtualAssetAssignment", "VirtualAsset",
    "JournalAttachment",
    "WorkCenterStaff",
    "TraceEvent", "ReceivingDocument", "ReceivingPhoto", "KitOrderLine", "KitOrder",
    "RmaLine", "Rma", "SerialInstall", "KitSerialAssignment", "WorkOrderUnit", "SerialNumber",
    "BudgetCharge", "BudgetForecast", "Budget",
    "ShipmentLine", "Shipment", "SalesOrderLine", "SalesOrder",
    "QuoteLine", "Quote",
    "ApPayment", "ApInvoice", "ArPayment", "ArInvoiceLine", "ArInvoice",
    "Rfq", "ReceivingTravelerLine", "ReceivingTraveler", "ReceiptLine", "Receipt", "PurchaseOrderLine", "PurchaseOrder",
    "Customer",
    "AssetCheckout", "Asset",
    "BankTransaction", "BankAccount", "EmailMessage", "AuthSession", "UserInvite",
    "BackgroundCheck", "EmployeeOnboarding", "Candidate", "JobRequisition",
    "CycleCountLine", "CycleCount", "PermissionRequest", "ScheduledReport", "RecurringJournal", "JournalLine", "JournalEntry", "Account",
    "PurchaseRequestLine", "PurchaseRequest",
    "SupplierScorecardHistory", "SupplierCertification", "AslPolicy", "Supplier",
    "Lot", "MaterialTransaction", "InventoryItem", "Location", "Warehouse",
    "CarActivityLog", "MrbDisposition", "MrbCase", "NonConformance", "InspectionResult", "Inspection",
    "EngAlert", "EngDependency", "WorkTimeScan", "EngTask", "ProductionEngIssue", "Saga", "EngSprint", "PlanningQuarter", "EngSwimLane", "Campaign",
    "BusinessPriority", "UserPermission", "UserPermissionGroup", "PermissionGroupMember", "PermissionGroup", "Permission",
    "ProjectCostEntry", "PiFeature", "PiIncrement", "ProjectWikiPage",
    "ProjectCommunication", "ProjectRaciEntry", "ProjectRequirement", "ProjectProduct",
    "ProjectMember", "ProjectIssue", "ProjectRisk", "Milestone", "ProjectTask", "WbsElement", "Project",
    "Program",
    "ProductMilestone", "ProductRequirement", "ProductVariant", "ProductDocument",
    "ProductPart", "ProductMember", "ProductLifecycleEvent", "Product",
    "CmNumberRegistry", "CmNumberRequest", "CmNumberScheme",
    "CmDocument", "CmFolder", "CmBoardMember", "ChangeRequestComment", "ChangeRequest",
    "WorkOrderStatusHistory", "WorkOrderStepCompletion", "WorkOrderInstruction", "WorkOrder",
    "WorkInstructionSignOff", "WorkInstructionStep", "WorkInstruction",
    "TestProcedureStep", "TestProcedure", "RequirementTrace", "Requirement",
    "PartVendor", "BomLine", "BomHeader", "Part",
    "UomConversion", "UomUnit",
    // ensure clean suppliers even if FK order was partial
    "Approval", "ApprovalPolicyStep", "ApprovalPolicy",
    "AuditLog", "WorkCenter", "ValueStreamMetric", "User",
  ];
  // FK enforcement off during the wipe so table order can't strand rows
  // (failed deletes were silently caught and caused unique-constraint
  // errors on the next insert pass).
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {
      /* table may not exist yet */
    }
  }
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");

  // ── Users ──────────────────────────────────────────────────
  const users = await Promise.all(
    [
      { email: "admin@forge.erp", name: "Alex Morgan", role: "ADMIN", department: "Operations", title: "ERP Admin" },
      { email: "eng.lead@forge.erp", name: "Jordan Lee", role: "ENGINEERING", department: "Engineering", title: "Chief Engineer" },
      { email: "cm@forge.erp", name: "Sam Rivera", role: "CM", department: "Configuration Management", title: "CM Manager" },
      { email: "quality@forge.erp", name: "Casey Nguyen", role: "QUALITY", department: "Quality", title: "Quality Manager" },
      { email: "buyer@forge.erp", name: "Taylor Brooks", role: "PURCHASING", department: "Supply Chain", title: "Senior Buyer" },
      { email: "prod@forge.erp", name: "Morgan Ellis", role: "PRODUCTION", department: "Production", title: "Production Supervisor" },
      { email: "acct@forge.erp", name: "Riley Chen", role: "ACCOUNTING", department: "Finance", title: "Controller" },
      { email: "hr@forge.erp", name: "Avery Park", role: "HR", department: "Human Resources", title: "HR Manager" },
      { email: "tech1@forge.erp", name: "Chris Walsh", role: "OPERATOR", department: "Assembly", title: "Assembler II", skills: JSON.stringify(["Torque", "IPC-A-610", "First Article"]) },
      { email: "tech2@forge.erp", name: "Dana Kim", role: "OPERATOR", department: "Machining", title: "Machinist", skills: JSON.stringify(["CNC", "CMM", "GD&T"]) },
      { email: "insp@forge.erp", name: "Pat Okonkwo", role: "QUALITY", department: "Quality", title: "Inspector" },
      { email: "pm@forge.erp", name: "Quinn Foster", role: "PM", department: "Programs", title: "Program Manager" },
      { email: "ceo@forge.erp", name: "Morgan Blake", role: "EXECUTIVE", department: "Executive", title: "CEO" },
      { email: "cfo@forge.erp", name: "Harper Quinn", role: "EXECUTIVE", department: "Finance", title: "CFO" },
    ].map((u, idx) =>
      prisma.user.create({
        data: {
          ...u,
          // Demo PINs for WI step sign-off (techs 1234, quality 5678, etc.)
          pinCode:
            u.role === "OPERATOR"
              ? "1234"
              : u.role === "QUALITY"
                ? "5678"
                : u.role === "PRODUCTION"
                  ? "2468"
                  : String(1000 + idx).padStart(4, "0"),
          certifications: JSON.stringify([
            { name: "Security Clearance", expires: "2027-06-01" },
            { name: "ESD Awareness", expires: "2026-12-01" },
          ]),
        },
      })
    )
  );
  const [admin, engLead, cmMgr, qualityMgr, buyer, prodSup, controller, hrMgr, tech1, tech2, inspector, pm, ceo, cfo] = users;
  console.log(`  ✓ ${users.length} users`);

  // ── Permission catalog + default groups ────────────────────
  const permDefs = [
    { code: "engineering.lane.manage", name: "Manage swim lanes", module: "engineering" },
    { code: "engineering.task.create", name: "Create eng tasks", module: "engineering" },
    { code: "engineering.task.scan", name: "Scan into tasks", module: "engineering" },
    { code: "pmo.quarter.manage", name: "Manage PI quarters/sprints", module: "pmo" },
    { code: "pmo.project.manage", name: "Manage projects", module: "pmo" },
    { code: "pmo.alerts.read", name: "Read PM dependency alerts", module: "pmo" },
    { code: "leadership.priority.manage", name: "Publish business priorities", module: "leadership" },
    { code: "leadership.priority.read", name: "Read business priorities", module: "leadership" },
    { code: "accounting.journal.post", name: "Post journal entries", module: "accounting" },
    { code: "accounting.reports.read", name: "View GAAP reports", module: "accounting" },
    { code: "cm.ecr.manage", name: "Manage ECRs", module: "cm" },
    { code: "admin.permissions", name: "Assign permissions", module: "admin" },
  ];
  const permRows = [];
  for (const p of permDefs) {
    permRows.push(
      await prisma.permission.create({
        data: { code: p.code, name: p.name, module: p.module },
      })
    );
  }
  const permByCode = Object.fromEntries(permRows.map((p) => [p.code, p]));
  const grpPm = await prisma.permissionGroup.create({
    data: {
      code: "GRP_PM",
      name: "Project Managers",
      baseRole: "PM",
      description: "PMO + dependency alerts",
    },
  });
  const grpExec = await prisma.permissionGroup.create({
    data: {
      code: "GRP_EXEC",
      name: "Senior Leadership",
      baseRole: "EXECUTIVE",
      description: "CEO/CFO/VP priorities",
    },
  });
  const grpAcct = await prisma.permissionGroup.create({
    data: {
      code: "GRP_ACCT",
      name: "Accounting",
      baseRole: "ACCOUNTING",
    },
  });
  async function linkGroup(groupId: string, codes: string[]) {
    for (const code of codes) {
      const perm = permByCode[code];
      if (!perm) continue;
      await prisma.permissionGroupMember.create({
        data: { groupId, permissionId: perm.id },
      });
    }
  }
  await linkGroup(grpPm.id, [
    "pmo.alerts.read",
    "pmo.project.manage",
    "pmo.quarter.manage",
    "leadership.priority.read",
    "engineering.task.create",
  ]);
  await linkGroup(grpExec.id, [
    "leadership.priority.manage",
    "leadership.priority.read",
    "accounting.reports.read",
    "pmo.alerts.read",
  ]);
  await linkGroup(grpAcct.id, [
    "accounting.journal.post",
    "accounting.reports.read",
  ]);
  await prisma.userPermissionGroup.createMany({
    data: [
      { userId: pm.id, groupId: grpPm.id },
      { userId: ceo.id, groupId: grpExec.id },
      { userId: cfo.id, groupId: grpExec.id },
      { userId: controller.id, groupId: grpAcct.id },
    ],
  });
  await prisma.businessPriority.createMany({
    data: [
      {
        number: "BP-001",
        title: "On-time delivery > 95%",
        description: "Improve schedule adherence across production and supply chain.",
        category: "OPERATIONAL",
        status: "PUBLISHED",
        priority: 1,
        ownerRole: "COO",
        publishedAt: new Date(),
        createdById: ceo.id,
      },
      {
        number: "BP-002",
        title: "Gross margin expansion",
        description: "Reduce scrap and rework; hit target gross margin for radiator product line.",
        category: "FINANCIAL",
        status: "PUBLISHED",
        priority: 2,
        ownerRole: "CFO",
        publishedAt: new Date(),
        createdById: cfo.id,
      },
      {
        number: "BP-003",
        title: "Digital engineering throughput",
        description: "Draft — increase campaign/saga velocity via PI planning discipline.",
        category: "STRATEGIC",
        status: "DRAFT",
        priority: 3,
        ownerRole: "VP_ENG",
        createdById: ceo.id,
      },
    ],
  });
  console.log("  ✓ permissions, groups, leadership priorities");

  // ── PR approval policy — the routed pipeline, seeded directly so a PR
  //    created before anyone visits /purchasing still routes correctly:
  //    charge/budget owner confirms → purchasing packages → same owner
  //    approves to purchase → $ thresholds.
  await prisma.approvalPolicy.create({
    data: {
      name: "Demand → buyer package → purchase",
      entityType: "PurchaseRequest",
      description:
        "1) Charge owner confirms demand. 2) Buyer verifies prices, sole-source, quotes, docs and packages the PR. 3) Same charge owner approves to purchase. 4+) Company $ thresholds (program/product escalation, finance).",
      isActive: true,
      isDefault: true,
      steps: {
        create: [
          { stepOrder: 1, name: "Confirm demand", minAmount: 0, routingKey: "REQUEST_CONFIRM", approverRole: "PURCHASING" },
          { stepOrder: 2, name: "Buyer package", minAmount: 0, routingKey: "BUYER_PACKAGE", approverRole: "PURCHASING" },
          { stepOrder: 3, name: "Approve to purchase", minAmount: 0, routingKey: "PURCHASE_APPROVAL", approverRole: "PURCHASING" },
          { stepOrder: 4, name: "Threshold escalation", minAmount: 10000, routingKey: "CHARGE_ESCALATION", approverRole: "EXECUTIVE" },
          { stepOrder: 5, name: "Finance / controller", minAmount: 25000, routingKey: "ROLE", approverRole: "ACCOUNTING", approverUserId: cfo.id },
        ],
      },
    },
  });
  console.log("  ✓ PR approval policy (owner → buyer package → owner → thresholds)");

  // ── Work Centers ───────────────────────────────────────────
  const workCenters = await Promise.all(
    [
      { code: "ASM-01", name: "Assembly Cell 1", area: "MANUFACTURING", department: "Assembly", capacityHoursPerDay: 16, isDefault: true, sortOrder: 1 },
      { code: "ASM-02", name: "Assembly Cell 2", area: "MANUFACTURING", department: "Assembly", capacityHoursPerDay: 16, sortOrder: 2 },
      { code: "MCH-01", name: "CNC Mill", area: "MANUFACTURING", department: "Machining", capacityHoursPerDay: 20, sortOrder: 3 },
      { code: "QA-01", name: "QA Lab (visual / GD&T / continuity)", area: "QA", department: "Quality", capacityHoursPerDay: 16, isDefault: true, sortOrder: 1 },
      { code: "TEST-01", name: "Functional / Power Test", area: "TEST", department: "Test", capacityHoursPerDay: 8, isDefault: true, sortOrder: 1 },
      { code: "SHIP-01", name: "Shipping Dock", area: "SHIPPING", department: "Logistics", capacityHoursPerDay: 16, isDefault: true, sortOrder: 1 },
      { code: "RCV-01", name: "Receiving Dock", area: "RECEIVING", department: "Logistics", capacityHoursPerDay: 16, isDefault: true, sortOrder: 1 },
    ].map((w) => prisma.workCenter.create({ data: w }))
  );
  const wc = Object.fromEntries(workCenters.map((w) => [w.code, w]));
  console.log(`  ✓ ${workCenters.length} work centers (Mfg / QA / Test / Shipping / Receiving)`);

  // Staff assignments for capacity planning
  const asm01 = workCenters.find((w) => w.code === "ASM-01")!;
  const qa01 = workCenters.find((w) => w.code === "QA-01")!;
  await prisma.workCenterStaff.createMany({
    data: [
      { workCenterId: asm01.id, userId: tech1.id, hoursPerDay: 8 },
      { workCenterId: asm01.id, userId: tech2.id, hoursPerDay: 8 },
      { workCenterId: qa01.id, userId: inspector.id, hoursPerDay: 8 },
    ],
  });
  console.log("  ✓ Work center staff for capacity planning");

  // ── Chart of Accounts ──────────────────────────────────────
  const accounts = await Promise.all(
    [
      { code: "1000", name: "Cash", type: "ASSET", balance: 850000 },
      { code: "1100", name: "Accounts Receivable", type: "ASSET", balance: 245000 },
      { code: "1200", name: "Inventory - Raw Materials", type: "ASSET", balance: 420000 },
      { code: "1210", name: "Inventory - WIP", type: "ASSET", balance: 185000 },
      { code: "1220", name: "Inventory - Finished Goods", type: "ASSET", balance: 310000 },
      { code: "1500", name: "Equipment", type: "ASSET", balance: 1200000 },
      { code: "2000", name: "Accounts Payable", type: "LIABILITY", balance: 178000 },
      { code: "2050", name: "Credit Card Payable", type: "LIABILITY", balance: 8400 },
      { code: "2100", name: "Accrued Expenses", type: "LIABILITY", balance: 45000 },
      { code: "3000", name: "Retained Earnings", type: "EQUITY", balance: 2100000 },
      { code: "3100", name: "Common Stock & Paid-in Capital", type: "EQUITY", balance: 769000 },
      { code: "4000", name: "Sales Revenue", type: "REVENUE", balance: 3200000 },
      { code: "5000", name: "Cost of Goods Sold", type: "COGS", balance: 1850000 },
      { code: "6000", name: "Salaries & Wages", type: "EXPENSE", balance: 980000 },
      { code: "6100", name: "Facilities", type: "EXPENSE", balance: 240000 },
      { code: "6200", name: "Materials Variance", type: "EXPENSE", balance: 12000 },
    ].map((a) => prisma.account.create({ data: a }))
  );
  console.log(`  ✓ ${accounts.length} GL accounts`);

  // ── Connected bank + credit-card accounts with feeds ───────
  const acctByCode = (code: string) => accounts.find((a) => a.code === code);
  const checking = await prisma.bankAccount.create({
    data: {
      name: "Operating Checking",
      institution: "First National Bank",
      kind: "CHECKING",
      last4: "4821",
      glAccountId: acctByCode("1000")?.id,
      currentBalance: 850000,
    },
  });
  const creditCard = await prisma.bankAccount.create({
    data: {
      name: "Business Visa",
      institution: "First National Bank",
      kind: "CREDIT_CARD",
      last4: "7733",
      glAccountId: acctByCode("2050")?.id,
      currentBalance: -8400,
    },
  });
  const bankFeed = [
    { acct: checking.id, days: 2, desc: "GRAINGER INDUSTRIAL SUPPLY", amount: -1284.5 },
    { acct: checking.id, days: 3, desc: "CITY OF HUNTSVILLE UTILITIES", amount: -842.17 },
    { acct: checking.id, days: 5, desc: "CUSTOMER DEPOSIT — NORTHSTAR", amount: 25000 },
    { acct: checking.id, days: 6, desc: "MCMASTER-CARR", amount: -503.88 },
    { acct: creditCard.id, days: 1, desc: "AMAZON BUSINESS", amount: -218.44 },
    { acct: creditCard.id, days: 2, desc: "DIGIKEY ELECTRONICS", amount: -1147.02 },
    { acct: creditCard.id, days: 4, desc: "UNITED AIRLINES — TRADE SHOW", amount: -612.4 },
  ];
  for (const t of bankFeed) {
    const date = daysAgo(t.days);
    await prisma.bankTransaction.create({
      data: {
        bankAccountId: t.acct,
        date,
        description: t.desc,
        amount: t.amount,
        externalId: `${t.acct}:${date.toISOString().slice(0, 10)}:${t.desc.toLowerCase().replace(/[^a-z0-9]/g, "")}:${t.amount}`,
      },
    });
  }
  console.log("  ✓ 2 bank accounts + feed");

  // ── Company assets (tools, test equipment, demo units) ─────
  const assetDefs = [
    { name: "Fluke 87V Multimeter", category: "TEST_EQUIPMENT", serialNumber: "FL87-2231", manufacturer: "Fluke", locationScope: "IN_HOUSE_ONLY", homeLocation: "Cal Lab", purchaseValue: 450 },
    { name: "Keysight DSOX1204G Oscilloscope", category: "TEST_EQUIPMENT", serialNumber: "KS-DSOX-8841", manufacturer: "Keysight", locationScope: "IN_HOUSE_ONLY", homeLocation: "Test Bench 2", purchaseValue: 1800 },
    { name: "Block 5 Demo Unit", category: "DEMO_UNIT", serialNumber: "DEMO-B5-001", locationScope: "OFFSITE_OK", homeLocation: "Demo Cage", purchaseValue: 25000 },
    { name: "Torque Wrench Set (calibrated)", category: "TOOL", manufacturer: "Snap-on", locationScope: "IN_HOUSE_ONLY", homeLocation: "Tool Crib", purchaseValue: 620 },
    { name: "Field Laptop — Trade Shows", category: "IT", serialNumber: "LT-FIELD-04", locationScope: "OFFSITE_OK", homeLocation: "IT", purchaseValue: 1400 },
    { name: "Environmental Chamber", category: "TEST_EQUIPMENT", manufacturer: "Thermotron", locationScope: "IN_HOUSE_ONLY", homeLocation: "Env Lab", purchaseValue: 42000 },
  ];
  let assetN = 0;
  for (const a of assetDefs) {
    assetN++;
    await prisma.asset.create({
      data: {
        assetTag: `AST-${String(assetN).padStart(5, "0")}`,
        name: a.name,
        category: a.category,
        serialNumber: a.serialNumber || null,
        manufacturer: a.manufacturer || null,
        locationScope: a.locationScope,
        homeLocation: a.homeLocation,
        purchaseValue: a.purchaseValue,
      },
    });
  }
  // Check the demo unit out, offsite, to the buyer for a trade show
  const demoUnit = await prisma.asset.findFirst({ where: { category: "DEMO_UNIT" } });
  if (demoUnit) {
    await prisma.assetCheckout.create({
      data: {
        assetId: demoUnit.id,
        userId: buyer.id,
        purpose: "AUSA trade show demo",
        offsite: true,
        destination: "Washington, DC",
        dueAt: daysFromNow(6),
      },
    });
    await prisma.asset.update({
      where: { id: demoUnit.id },
      data: { status: "CHECKED_OUT", assignedToUserId: buyer.id },
    });
  }
  console.log(`  ✓ ${assetN} assets`);

  // ── UOM master + conversions ───────────────────────────────
  const uomDefs = [
    { code: "EA", name: "Each", category: "COUNT", sortOrder: 1 },
    { code: "PC", name: "Piece", category: "COUNT", sortOrder: 2 },
    { code: "SET", name: "Set", category: "COUNT", sortOrder: 3 },
    { code: "LB", name: "Pound", category: "WEIGHT", sortOrder: 10 },
    { code: "KG", name: "Kilogram", category: "WEIGHT", sortOrder: 11 },
    { code: "OZ", name: "Ounce", category: "WEIGHT", sortOrder: 12 },
    { code: "FT", name: "Foot", category: "LENGTH", sortOrder: 20 },
    { code: "IN", name: "Inch", category: "LENGTH", sortOrder: 21 },
    { code: "M", name: "Meter", category: "LENGTH", sortOrder: 22 },
    { code: "MM", name: "Millimeter", category: "LENGTH", sortOrder: 23 },
    { code: "GAL", name: "Gallon", category: "VOLUME", sortOrder: 30 },
    { code: "L", name: "Liter", category: "VOLUME", sortOrder: 31 },
    { code: "HR", name: "Hour", category: "TIME", sortOrder: 40 },
    { code: "MIN", name: "Minute", category: "TIME", sortOrder: 41 },
    // Measurement / electrical for WI recordings
    { code: "VDC", name: "Volts DC", category: "ELECTRICAL", sortOrder: 50 },
    { code: "VAC", name: "Volts AC", category: "ELECTRICAL", sortOrder: 51 },
    { code: "OHM", name: "Ohm", category: "ELECTRICAL", sortOrder: 52 },
    { code: "MOHM", name: "Milliohm", category: "ELECTRICAL", sortOrder: 53 },
    { code: "KOHM", name: "Kilohm", category: "ELECTRICAL", sortOrder: 54 },
    { code: "A", name: "Ampere", category: "ELECTRICAL", sortOrder: 55 },
    { code: "MA", name: "Milliampere", category: "ELECTRICAL", sortOrder: 56 },
    { code: "HZ", name: "Hertz", category: "ELECTRICAL", sortOrder: 57 },
    { code: "NM", name: "Newton-meter (torque)", category: "MEASURE", sortOrder: 60 },
    { code: "PSI", name: "Pounds per square inch", category: "MEASURE", sortOrder: 61 },
    { code: "DEG_C", name: "Degrees Celsius", category: "MEASURE", sortOrder: 62 },
  ];
  const uoms = await Promise.all(
    uomDefs.map((u) => prisma.uomUnit.create({ data: u }))
  );
  const uom = Object.fromEntries(uoms.map((u) => [u.code, u]));
  const convPairs: [string, string, number, string][] = [
    ["FT", "IN", 12, "1 FT = 12 IN"],
    ["M", "MM", 1000, "1 M = 1000 MM"],
    ["M", "FT", 3.28084, "1 M ≈ 3.28084 FT"],
    ["KG", "LB", 2.20462, "1 KG ≈ 2.20462 LB"],
    ["LB", "OZ", 16, "1 LB = 16 OZ"],
    ["GAL", "L", 3.78541, "1 GAL ≈ 3.78541 L"],
  ];
  for (const [from, to, factor, notes] of convPairs) {
    await prisma.uomConversion.create({
      data: {
        fromUomId: uom[from].id,
        toUomId: uom[to].id,
        factor,
        notes,
      },
    });
    await prisma.uomConversion.create({
      data: {
        fromUomId: uom[to].id,
        toUomId: uom[from].id,
        factor: 1 / factor,
        notes: `Inverse of: ${notes}`,
      },
    });
  }
  console.log(`  ✓ ${uoms.length} UOM units + ${convPairs.length * 2} conversions`);

  const invRm = accounts.find((a) => a.code === "1200")!;
  const cogs = accounts.find((a) => a.code === "5000")!;

  // ── Parts / item cards ─────────────────────────────────────
  const partsData = [
    {
      partNumber: "ASM-1000",
      description: "Avionics Control Module Assembly",
      revision: "C",
      partType: "ASSEMBLY",
      sourcingMethod: "BUILD",
      itemStructure: "TOP_LEVEL_ASSEMBLY",
      standardCost: 12500,
      averageCost: 12480,
      isSerialized: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
      inventoryAccountId: invRm.id,
      cogsAccountId: cogs.id,
    },
    {
      partNumber: "PCB-2200",
      description: "Main Control PCB",
      revision: "B",
      partType: "MAKE",
      sourcingMethod: "BUILD",
      itemStructure: "SUB_ASSEMBLY",
      standardCost: 850,
      averageCost: 842,
      isLotControlled: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
      inventoryAccountId: invRm.id,
    },
    {
      partNumber: "HSG-3100",
      description: "Aluminum Housing CNC",
      revision: "A",
      partType: "MAKE",
      sourcingMethod: "BUILD",
      itemStructure: "SUB_ASSEMBLY",
      standardCost: 420,
      averageCost: 415,
      isSerialized: true,
      requiresGdtInspection: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "CON-4400",
      description: "MIL-DTL Circular Connector",
      revision: "A",
      partType: "BUY",
      sourcingMethod: "PURCHASE",
      itemStructure: "RAW_MATERIAL",
      standardCost: 185,
      lastBuyCost: 192,
      averageCost: 188,
      leadTimeDays: 45,
      requiresFunctionalTest: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
      inventoryAccountId: invRm.id,
    },
    {
      partNumber: "RES-0805-10K",
      description: "Resistor 10K 0805 1%",
      revision: "A",
      partType: "BUY",
      sourcingMethod: "PURCHASE",
      itemStructure: "RAW_MATERIAL",
      standardCost: 0.12,
      lastBuyCost: 0.11,
      averageCost: 0.115,
      leadTimeDays: 14,
      isLotControlled: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "IC-STM32",
      description: "STM32H7 MCU",
      revision: "A",
      partType: "BUY",
      sourcingMethod: "PURCHASE",
      itemStructure: "RAW_MATERIAL",
      standardCost: 18.5,
      lastBuyCost: 19.2,
      averageCost: 18.8,
      leadTimeDays: 21,
      isLotControlled: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "SCR-M3-10",
      description: "Screw M3x10 SS",
      revision: "A",
      partType: "BUY",
      sourcingMethod: "PURCHASE",
      itemStructure: "RAW_MATERIAL",
      standardCost: 0.08,
      lastBuyCost: 0.07,
      averageCost: 0.075,
      leadTimeDays: 7,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "GASK-5500",
      description: "EMI Gasket",
      revision: "B",
      partType: "BUY",
      sourcingMethod: "PURCHASE",
      itemStructure: "RAW_MATERIAL",
      standardCost: 24,
      lastBuyCost: 26,
      averageCost: 25,
      leadTimeDays: 30,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "CBL-6600",
      description: "Harness Assembly Interface",
      revision: "A",
      partType: "MAKE",
      sourcingMethod: "BUILD",
      itemStructure: "SUB_ASSEMBLY",
      standardCost: 320,
      averageCost: 318,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "BRK-7700",
      description: "Mounting Bracket Ti-6Al-4V",
      revision: "A",
      partType: "MAKE",
      sourcingMethod: "BUILD",
      itemStructure: "SUB_ASSEMBLY",
      standardCost: 890,
      averageCost: 885,
      isSerialized: true,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "FW-1000",
      description: "Firmware Image ACM",
      revision: "C",
      partType: "PHANTOM",
      sourcingMethod: "BUILD",
      itemStructure: "N_A",
      standardCost: 0,
      uom: "EA",
      uomUnitId: uom.EA.id,
    },
    {
      partNumber: "FAI-PROTO",
      description: "First Article Prototype Kit",
      revision: "A",
      partType: "ASSEMBLY",
      sourcingMethod: "BUILD",
      itemStructure: "TOP_LEVEL_ASSEMBLY",
      standardCost: 15000,
      averageCost: 15200,
      isSerialized: true,
      uom: "SET",
      uomUnitId: uom.SET.id,
    },
  ];
  const parts = await Promise.all(partsData.map((p) => prisma.part.create({ data: p })));
  const part = Object.fromEntries(parts.map((p) => [p.partNumber, p]));
  console.log(`  ✓ ${parts.length} item cards (parts)`);

  // ── BOMs: multi-level + prototype → certified flow ─────────
  // Rev A PROTOTYPE (obsolete path), Rev B CERTIFIED, Rev C PROTOTYPE for next
  await prisma.bomHeader.create({
    data: {
      partId: part["ASM-1000"].id,
      revision: "A",
      status: "OBSOLETE",
      isPrototype: false,
      description: "Initial release — superseded",
      obsoleteDate: daysAgo(90),
      certifiedAt: daysAgo(180),
      certifiedById: cmMgr.id,
      lines: {
        create: [
          { componentPartId: part["PCB-2200"].id, quantity: 1, findNumber: "1", sortOrder: 1 },
          { componentPartId: part["HSG-3100"].id, quantity: 1, findNumber: "2", sortOrder: 2 },
          { componentPartId: part["CON-4400"].id, quantity: 2, findNumber: "3", sortOrder: 3 },
          { componentPartId: part["SCR-M3-10"].id, quantity: 8, findNumber: "4", sortOrder: 4 },
        ],
      },
    },
  });

  const bomB = await prisma.bomHeader.create({
    data: {
      partId: part["ASM-1000"].id,
      revision: "B",
      status: "CERTIFIED",
      isPrototype: false,
      description: "Production certified — EMI gasket added",
      certifiedAt: daysAgo(60),
      certifiedById: cmMgr.id,
      effectiveDate: daysAgo(60),
      lines: {
        create: [
          { componentPartId: part["PCB-2200"].id, quantity: 1, findNumber: "1", sortOrder: 1 },
          { componentPartId: part["HSG-3100"].id, quantity: 1, findNumber: "2", sortOrder: 2 },
          { componentPartId: part["CON-4400"].id, quantity: 2, findNumber: "3", sortOrder: 3 },
          { componentPartId: part["GASK-5500"].id, quantity: 1, findNumber: "4", sortOrder: 4 },
          { componentPartId: part["SCR-M3-10"].id, quantity: 12, findNumber: "5", sortOrder: 5 },
          { componentPartId: part["CBL-6600"].id, quantity: 1, findNumber: "6", sortOrder: 6 },
        ],
      },
    },
  });

  const bomCProto = await prisma.bomHeader.create({
    data: {
      partId: part["ASM-1000"].id,
      revision: "C",
      status: "PROTOTYPE",
      isPrototype: true,
      description: "Prototype — titanium bracket + firmware rev",
      notes: "First article build required before certification",
      lines: {
        create: [
          { componentPartId: part["PCB-2200"].id, quantity: 1, findNumber: "1", sortOrder: 1 },
          { componentPartId: part["HSG-3100"].id, quantity: 1, findNumber: "2", sortOrder: 2 },
          { componentPartId: part["CON-4400"].id, quantity: 2, findNumber: "3", sortOrder: 3 },
          { componentPartId: part["GASK-5500"].id, quantity: 1, findNumber: "4", sortOrder: 4 },
          { componentPartId: part["SCR-M3-10"].id, quantity: 12, findNumber: "5", sortOrder: 5 },
          { componentPartId: part["CBL-6600"].id, quantity: 1, findNumber: "6", sortOrder: 6 },
          { componentPartId: part["BRK-7700"].id, quantity: 1, findNumber: "7", sortOrder: 7 },
          { componentPartId: part["FW-1000"].id, quantity: 1, findNumber: "8", sortOrder: 8 },
        ],
      },
    },
  });

  // PCB sub-BOM
  await prisma.bomHeader.create({
    data: {
      partId: part["PCB-2200"].id,
      revision: "B",
      status: "CERTIFIED",
      certifiedAt: daysAgo(100),
      certifiedById: cmMgr.id,
      lines: {
        create: [
          { componentPartId: part["IC-STM32"].id, quantity: 1, findNumber: "U1", sortOrder: 1 },
          { componentPartId: part["RES-0805-10K"].id, quantity: 24, findNumber: "R1-R24", sortOrder: 2 },
        ],
      },
    },
  });
  console.log("  ✓ BOMs (incl. prototype → certified flow)");

  // ── Work Instructions ──────────────────────────────────────
  const wiAsm = await prisma.workInstruction.create({
    data: {
      documentNumber: "WI-ASM-1000",
      revision: "B",
      title: "Avionics Control Module Assembly",
      status: "RELEASED",
      partId: part["ASM-1000"].id,
      bomRevision: "B",
      workCenter: "ASM-01",
      estimatedMinutes: 240,
      createdById: engLead.id,
      releasedAt: daysAgo(55),
      steps: {
        create: [
          { stepNumber: 1, title: "Kit Verification", instructions: "Verify all kit components against certified BOM Rev B. Check lot traceability labels.", requiredArea: "MANUFACTURING", workCenter: "ASM-01", estimatedMinutes: 20, requiresSignOff: true, sortOrder: 1 },
          { stepNumber: 2, title: "Install PCB into Housing", instructions: "Place PCB-2200 into HSG-3100. Torque M3 screws to 0.6 N·m ±0.05. ESD precautions required.", requiredArea: "MANUFACTURING", workCenter: "ASM-01", estimatedMinutes: 45, requiresSignOff: true, sortOrder: 2, drawingLinks: JSON.stringify(["DWG-HSG-3100-A"]) },
          { stepNumber: 3, title: "Install Connectors", instructions: "Install CON-4400 connectors per MIL-DTL torque spec. Apply threadlocker.", requiredArea: "MANUFACTURING", estimatedMinutes: 30, requiresSignOff: true, sortOrder: 3 },
          { stepNumber: 4, title: "EMI Gasket Installation", instructions: "Install GASK-5500 ensuring full contact along sealing surface. No gaps >0.1mm.", requiredArea: "MANUFACTURING", estimatedMinutes: 25, requiresSignOff: true, sortOrder: 4 },
          // Continuity = DMM → QA (general area; default QA station unless locked specific)
          { stepNumber: 5, title: "Continuity Test", instructions: "Perform pin-to-pin continuity per TP-ASM-1000 with DMM. Record resistance values.", isTestStep: true, testCriteria: "All pins < 0.5 Ω", expectedValue: "<0.5Ω", requiredArea: "QA", workCenter: "QA-01", routeLock: false, estimatedMinutes: 30, requiresSignOff: true, sortOrder: 5 },
          // Functional = power applied → Test (can lock to a specific TEST cell if needed)
          { stepNumber: 6, title: "Functional Power-On Test", instructions: "Apply 28V DC. Verify boot sequence and BIT pass. Capture serial log.", isTestStep: true, testCriteria: "BIT PASS, voltage 27-29V", expectedValue: "PASS", requiredArea: "TEST", workCenter: "TEST-01", routeLock: false, estimatedMinutes: 40, requiresSignOff: true, sortOrder: 6 },
          { stepNumber: 7, title: "Final Visual & Package", instructions: "Final FOD inspection. Apply serial label and UID. Stage for QA.", requiredArea: "MANUFACTURING", estimatedMinutes: 20, requiresSignOff: true, sortOrder: 7 },
        ],
      },
    },
    include: { steps: true },
  });

  const wiTask = await prisma.workInstruction.create({
    data: {
      documentNumber: "WI-5S-DAILY",
      revision: "A",
      title: "Daily 5S Area Cleanliness Check",
      status: "RELEASED",
      workCenter: "ASM-01",
      estimatedMinutes: 30,
      createdById: prodSup.id,
      releasedAt: daysAgo(30),
      steps: {
        create: [
          { stepNumber: 1, title: "Sort — Remove non-essential items", instructions: "Clear benches of non-job materials.", requiresSignOff: true, sortOrder: 1 },
          { stepNumber: 2, title: "Set in Order — Tools shadowed", instructions: "Return all tools to shadow board.", requiresSignOff: true, sortOrder: 2 },
          { stepNumber: 3, title: "Shine — Wipe surfaces", instructions: "Clean work surfaces and floors.", requiresSignOff: true, sortOrder: 3 },
          { stepNumber: 4, title: "Standardize & Sustain sign-off", instructions: "Photo checklist complete. Supervisor sign-off.", requiresSignOff: true, sortOrder: 4 },
        ],
      },
    },
    include: { steps: true },
  });

  const wiDraft = await prisma.workInstruction.create({
    data: {
      documentNumber: "WI-ASM-1000",
      revision: "C",
      title: "Avionics Control Module Assembly (Rev C Prototype)",
      status: "ENGINEERING_REVIEW",
      partId: part["ASM-1000"].id,
      bomRevision: "C",
      workCenter: "ASM-01",
      estimatedMinutes: 280,
      createdById: engLead.id,
      steps: {
        create: [
          { stepNumber: 1, title: "Kit Verification Rev C", instructions: "Include BRK-7700 titanium bracket and FW-1000 flash.", requiresSignOff: true, sortOrder: 1 },
          { stepNumber: 2, title: "Bracket Install", instructions: "Install BRK-7700 with aerospace-grade fasteners.", requiresSignOff: true, sortOrder: 2 },
          { stepNumber: 3, title: "Firmware Flash", instructions: "Flash FW-1000 Rev C. Verify checksum.", isTestStep: true, testCriteria: "Checksum match", expectedValue: "MATCH", requiresSignOff: true, sortOrder: 3 },
        ],
      },
    },
  });
  console.log("  ✓ Work Instructions");

  // ── Warehouses / Locations ─────────────────────────────────
  const whMain = await prisma.warehouse.create({
    data: {
      code: "MAIN",
      name: "Main Plant Warehouse",
      locations: {
        create: [
          { code: "RCV-01", name: "Receiving Dock", type: "RECEIVING" },
          { code: "STG-A1", name: "Storage Aisle A1", type: "STORAGE" },
          { code: "STG-B2", name: "Storage Aisle B2", type: "STORAGE" },
          { code: "QUAR-01", name: "Quarantine Cage", type: "QUARANTINE" },
          { code: "WIP-ASM", name: "Assembly WIP", type: "WIP" },
          { code: "SHIP-01", name: "Shipping Staging", type: "SHIPPING" },
          // GFP area — material instances here are government-owned (P/N is not inherently GFP)
          { code: "GFP-01", name: "Government Property Cage", type: "GFP" },
          // Kit staging — picked kits wait here before the line (kittingLocation)
          { code: "STAGE-01", name: "Kit Staging", type: "STAGING" },
          // Work-center floor locations — WIP kits travel here during production
          { code: "WC-ASM-01", name: "Assembly Cell 1 floor", type: "WIP", workCenterId: wc["ASM-01"].id },
          { code: "WC-ASM-02", name: "Assembly Cell 2 floor", type: "WIP", workCenterId: wc["ASM-02"].id },
          { code: "WC-MCH-01", name: "CNC Mill floor", type: "WIP", workCenterId: wc["MCH-01"].id },
          { code: "WC-QA-01", name: "QA Lab floor", type: "WIP", workCenterId: wc["QA-01"].id },
          { code: "WC-TEST-01", name: "Functional Test floor", type: "WIP", workCenterId: wc["TEST-01"].id },
        ],
      },
    },
    include: { locations: true },
  });
  const loc = Object.fromEntries(whMain.locations.map((l) => [l.code, l]));

  // Inventory
  const invItems = await Promise.all([
    prisma.inventoryItem.create({ data: { partId: part["CON-4400"].id, locationId: loc["STG-A1"].id, quantityOnHand: 48, quantityAvailable: 40, quantityCommitted: 8, unitCost: 185, lotNumber: "LOT-CON-2401", ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["RES-0805-10K"].id, locationId: loc["STG-A1"].id, quantityOnHand: 5000, quantityAvailable: 4800, quantityCommitted: 200, unitCost: 0.12, lotNumber: "LOT-RES-9901", ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["IC-STM32"].id, locationId: loc["STG-B2"].id, quantityOnHand: 120, quantityAvailable: 100, quantityCommitted: 20, unitCost: 18.5, lotNumber: "LOT-IC-5512", ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["GASK-5500"].id, locationId: loc["STG-A1"].id, quantityOnHand: 35, quantityAvailable: 30, quantityCommitted: 5, unitCost: 24, ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["SCR-M3-10"].id, locationId: loc["STG-A1"].id, quantityOnHand: 2000, quantityAvailable: 2000, unitCost: 0.08, ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["HSG-3100"].id, locationId: loc["STG-B2"].id, quantityOnHand: 12, quantityAvailable: 8, quantityCommitted: 4, unitCost: 420, ownership: "COMPANY" } }),
    prisma.inventoryItem.create({ data: { partId: part["PCB-2200"].id, locationId: loc["WIP-ASM"].id, quantityOnHand: 6, quantityAvailable: 2, quantityCommitted: 4, unitCost: 850, lotNumber: "LOT-PCB-88", ownership: "COMPANY" } }),
    // Government furnished
    prisma.inventoryItem.create({ data: { partId: part["CON-4400"].id, locationId: loc["GFP-01"].id, quantityOnHand: 10, quantityAvailable: 10, unitCost: 0, ownership: "GOVERNMENT", serialNumber: "GFP-CON-001" } }),
  ]);
  console.log(`  ✓ Inventory (${invItems.length} stock records)`);

  // ── Suppliers ──────────────────────────────────────────────
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        code: "SUP-AERO",
        name: "AeroConnect Industries",
        status: "APPROVED",
        isApprovedVendor: true,
        approvedAt: daysAgo(200),
        contactName: "Lisa Hart",
        contactEmail: "lisa@aeroconnect.example",
        category: "Connectors",
        onTimeDeliveryPct: 96.5,
        qualityPpm: 120,
        costVariancePct: 1.2,
        overallScore: 94.2,
        rating: "A",
      },
    }),
    prisma.supplier.create({
      data: {
        code: "SUP-CHIP",
        name: "SiliconForge Semiconductors",
        status: "APPROVED",
        isApprovedVendor: true,
        approvedAt: daysAgo(150),
        contactName: "Raj Patel",
        contactEmail: "raj@siliconforge.example",
        category: "Electronics",
        onTimeDeliveryPct: 88.0,
        qualityPpm: 850,
        costVariancePct: 3.5,
        overallScore: 82.1,
        rating: "B",
      },
    }),
    prisma.supplier.create({
      data: {
        code: "SUP-METAL",
        name: "PrecisionMetals LLC",
        status: "CONDITIONAL",
        isApprovedVendor: true,
        approvedAt: daysAgo(60),
        contactName: "Mike Torres",
        contactEmail: "mike@pmetals.example",
        category: "Machined Parts",
        onTimeDeliveryPct: 72.0,
        qualityPpm: 4200,
        costVariancePct: 8.0,
        overallScore: 68.5,
        rating: "C",
      },
    }),
    prisma.supplier.create({
      data: {
        code: "SUP-FAST",
        name: "FastenRight Corp",
        status: "APPROVED",
        isApprovedVendor: true,
        approvedAt: daysAgo(300),
        contactName: "Amy Zhou",
        contactEmail: "amy@fastenright.example",
        category: "Hardware",
        onTimeDeliveryPct: 99.1,
        qualityPpm: 50,
        costVariancePct: 0.5,
        overallScore: 98.0,
        rating: "A",
      },
    }),
  ]);
  const [supAero, supChip, supMetal, supFast] = suppliers;

  for (const s of suppliers) {
    for (let m = 5; m >= 0; m--) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      const period = d.toISOString().slice(0, 7);
      const jitter = (Math.random() - 0.5) * 8;
      await prisma.supplierScorecardHistory.create({
        data: {
          supplierId: s.id,
          period,
          onTimeDeliveryPct: Math.min(100, Math.max(50, s.onTimeDeliveryPct + jitter)),
          qualityPpm: Math.max(0, s.qualityPpm + jitter * 50),
          costVariancePct: s.costVariancePct,
          overallScore: Math.min(100, Math.max(50, s.overallScore + jitter)),
          rating: s.rating,
          ncrCount: s.rating === "C" ? 3 : s.rating === "B" ? 1 : 0,
          poCount: 4 + Math.floor(Math.random() * 6),
        },
      });
    }
  }
  console.log(`  ✓ ${suppliers.length} suppliers + scorecard history (ASL)`);

  // ── Part vendor catalog (item card vendor lines) ───────────
  await Promise.all([
    prisma.partVendor.create({
      data: {
        partId: part["CON-4400"].id,
        supplierId: supAero.id,
        vendorPartNumber: "ACI-MDTL-38999",
        vendorDescription: "MIL-DTL circular connector, shell size 17",
        vendorSku: "SKU-CON-4400-A",
        manufacturer: "AeroConnect",
        manufacturerPn: "AC-38999-17",
        unitCost: 192,
        leadTimeDays: 45,
        isPreferred: true,
      },
    }),
    prisma.partVendor.create({
      data: {
        partId: part["IC-STM32"].id,
        supplierId: supChip.id,
        vendorPartNumber: "STM32H743VIT6",
        vendorDescription: "STM32H7 MCU LQFP100",
        vendorSku: "SF-STM32H7",
        manufacturer: "STMicroelectronics",
        manufacturerPn: "STM32H743VIT6",
        unitCost: 19.2,
        leadTimeDays: 21,
        isPreferred: true,
      },
    }),
    prisma.partVendor.create({
      data: {
        partId: part["RES-0805-10K"].id,
        supplierId: supChip.id,
        vendorPartNumber: "RC0805FR-0710KL",
        vendorDescription: "Thick film 10K 1% 0805",
        vendorSku: "SF-RES-10K",
        unitCost: 0.11,
        leadTimeDays: 14,
        minOrderQty: 100,
        isPreferred: true,
      },
    }),
    prisma.partVendor.create({
      data: {
        partId: part["SCR-M3-10"].id,
        supplierId: supFast.id,
        vendorPartNumber: "FR-M3X10-SS",
        vendorDescription: "M3x10 stainless pan head",
        vendorSku: "FAST-M3-10",
        unitCost: 0.07,
        leadTimeDays: 7,
        minOrderQty: 100,
        isPreferred: true,
      },
    }),
    prisma.partVendor.create({
      data: {
        partId: part["GASK-5500"].id,
        supplierId: supAero.id,
        vendorPartNumber: "ACI-EMI-GASK-55",
        vendorDescription: "EMI gasket conductive",
        vendorSku: "SKU-GASK-55",
        unitCost: 26,
        leadTimeDays: 30,
        isPreferred: true,
      },
    }),
  ]);
  console.log("  ✓ Part vendor catalog lines (ASL only)");

  // ── Expanded item catalog — a realistic working set to run the system
  //    with: electronics, interconnect, hardware, machined metal,
  //    consumables, and a few make-items. BUY parts get an ASL vendor
  //    line (so they're immediately purchasable) and most get stock.
  {
    type CatSpec = {
      pn: string;
      desc: string;
      cost: number;
      lead: number;
      sup: typeof supAero;
      mfr?: string;
      lot?: boolean;
      ser?: boolean;
      test?: boolean;
      stock?: number;
      make?: boolean;
    };
    const catalog: CatSpec[] = [
      // Electronics (SiliconForge)
      { pn: "RES-0603-1K", desc: "Resistor 1K 0603 1%", cost: 0.09, lead: 14, sup: supChip, lot: true, stock: 8000 },
      { pn: "RES-0603-100R", desc: "Resistor 100R 0603 1%", cost: 0.09, lead: 14, sup: supChip, lot: true, stock: 6500 },
      { pn: "CAP-0805-100N", desc: "Capacitor 100nF X7R 0805", cost: 0.11, lead: 14, sup: supChip, lot: true, stock: 9000 },
      { pn: "CAP-ELEC-47U", desc: "Capacitor 47uF electrolytic 25V", cost: 0.34, lead: 21, sup: supChip, lot: true, stock: 1200 },
      { pn: "IC-OPAMP-2", desc: "Dual precision op-amp SOIC-8", cost: 2.4, lead: 28, sup: supChip, lot: true, stock: 400 },
      { pn: "IC-CAN-XCVR", desc: "CAN FD transceiver SOIC-8", cost: 3.1, lead: 35, sup: supChip, lot: true, stock: 350 },
      { pn: "IC-FPGA-A7", desc: "Artix-7 FPGA FGG484", cost: 96, lead: 90, sup: supChip, lot: true, stock: 24 },
      { pn: "XTAL-25M", desc: "Crystal 25 MHz 3225", cost: 0.62, lead: 21, sup: supChip, lot: true, stock: 900 },
      { pn: "LED-0603-GRN", desc: "LED green 0603", cost: 0.08, lead: 14, sup: supChip, lot: true, stock: 4000 },
      { pn: "DIO-TVS-24V", desc: "TVS diode 24V SMB", cost: 0.42, lead: 21, sup: supChip, lot: true, stock: 1500 },
      { pn: "REG-BUCK-5V", desc: "Buck regulator module 5V/3A", cost: 6.8, lead: 35, sup: supChip, lot: true, stock: 220 },
      { pn: "SEN-IMU-9AX", desc: "9-axis IMU sensor module", cost: 38, lead: 45, sup: supChip, lot: true, ser: true, test: true, stock: 30 },
      // Interconnect (AeroConnect)
      { pn: "CON-D38999-11", desc: "D38999 connector shell size 11", cost: 96, lead: 42, sup: supAero, test: true, stock: 40 },
      { pn: "CON-D38999-25", desc: "D38999 connector shell size 25", cost: 210, lead: 49, sup: supAero, test: true, stock: 16 },
      { pn: "CON-BACKSHELL-11", desc: "EMI backshell size 11", cost: 34, lead: 35, sup: supAero, stock: 60 },
      { pn: "CON-SMA-BLKHD", desc: "SMA bulkhead jack", cost: 8.5, lead: 28, sup: supAero, stock: 120 },
      { pn: "CBL-COAX-RG316", desc: "RG316 coax cable assembly 500mm", cost: 22, lead: 30, sup: supAero, stock: 80 },
      { pn: "CBL-PWR-16AWG", desc: "Power harness 16AWG 2-cond shielded", cost: 15, lead: 30, sup: supAero, stock: 90 },
      { pn: "WIRE-22AWG-WHT", desc: "Hookup wire 22AWG white MIL-W-22759 (100 ft)", cost: 28, lead: 14, sup: supAero, lot: true, stock: 45 },
      { pn: "PIN-CONTACT-20", desc: "Crimp contact pin size 20 (bag of 100)", cost: 46, lead: 28, sup: supAero, stock: 55 },
      // Hardware (FastenRight)
      { pn: "SCR-M4-12", desc: "M4x12 socket head cap screw SS", cost: 0.11, lead: 7, sup: supFast, stock: 3000 },
      { pn: "SCR-M2-6", desc: "M2x6 pan head screw SS", cost: 0.06, lead: 7, sup: supFast, stock: 5000 },
      { pn: "NUT-M3-NYLOC", desc: "M3 nyloc nut SS", cost: 0.05, lead: 7, sup: supFast, stock: 4000 },
      { pn: "WASH-M3-FLAT", desc: "M3 flat washer SS", cost: 0.02, lead: 7, sup: supFast, stock: 8000 },
      { pn: "WASH-M3-LOCK", desc: "M3 split lock washer SS", cost: 0.03, lead: 7, sup: supFast, stock: 6000 },
      { pn: "INS-M3-BRASS", desc: "M3 heat-set threaded insert brass", cost: 0.18, lead: 14, sup: supFast, stock: 2500 },
      { pn: "STD-M3-10-HEX", desc: "M3x10 hex standoff brass", cost: 0.22, lead: 14, sup: supFast, stock: 1800 },
      { pn: "PIN-DOWEL-3X8", desc: "Dowel pin 3x8mm hardened", cost: 0.35, lead: 14, sup: supFast, stock: 800 },
      { pn: "RIV-POP-3MM", desc: "Pop rivet 3mm aluminum", cost: 0.04, lead: 7, sup: supFast, stock: 5000 },
      { pn: "CLMP-CBL-6MM", desc: "Cable clamp 6mm cushioned", cost: 0.55, lead: 14, sup: supFast, stock: 900 },
      // Machined / metals (PrecisionMetals)
      { pn: "PLT-AL-6061-3T", desc: "Aluminum plate 6061-T6 3mm 300x300", cost: 42, lead: 21, sup: supMetal, lot: true, stock: 25 },
      { pn: "BRKT-L-STEEL", desc: "L-bracket steel zinc plated", cost: 3.2, lead: 21, sup: supMetal, stock: 300 },
      { pn: "HSNK-EXTR-40", desc: "Heatsink extrusion 40x40x20", cost: 4.8, lead: 28, sup: supMetal, stock: 250 },
      { pn: "CHAS-1U-AL", desc: "1U aluminum chassis blank", cost: 88, lead: 35, sup: supMetal, stock: 18 },
      { pn: "SHIM-SS-0.1", desc: "Stainless shim stock 0.1mm sheet", cost: 12, lead: 21, sup: supMetal, lot: true, stock: 40 },
      { pn: "STK-AL-ROD-25", desc: "Aluminum rod 25mm dia (1m)", cost: 18, lead: 21, sup: supMetal, lot: true, stock: 30 },
      { pn: "PNL-FR4-2MM", desc: "FR4 panel stock 2mm 450x300", cost: 9.5, lead: 21, sup: supMetal, lot: true, stock: 60 },
      { pn: "EXT-RAIL-200", desc: "Extruded rail 20x20 200mm", cost: 6.4, lead: 21, sup: supMetal, stock: 140 },
      // Consumables / chemicals
      { pn: "CHEM-EPOXY-2P", desc: "Two-part structural epoxy 50ml", cost: 21, lead: 14, sup: supFast, lot: true, stock: 35 },
      { pn: "CHEM-LOCTITE-243", desc: "Threadlocker medium strength 10ml", cost: 9.8, lead: 14, sup: supFast, lot: true, stock: 50 },
      { pn: "SOLD-SAC305-05", desc: "Solder wire SAC305 0.5mm 250g", cost: 32, lead: 14, sup: supChip, lot: true, stock: 28 },
      { pn: "CHEM-CONF-COAT", desc: "Conformal coating acrylic 1L", cost: 54, lead: 21, sup: supChip, lot: true, stock: 12 },
      { pn: "ESD-BAG-100", desc: "ESD shielding bags 100x150 (pack of 100)", cost: 14, lead: 7, sup: supFast, stock: 65 },
      { pn: "LBL-POLY-THT", desc: "Polyimide thermal-transfer labels (roll)", cost: 26, lead: 14, sup: supFast, stock: 40 },
      // Make items (no vendor — built in-house)
      { pn: "MCH-HSG-SMALL", desc: "Machined housing, small sensor", cost: 145, lead: 0, sup: supMetal, make: true, ser: true, stock: 6 },
      { pn: "HARN-MAIN-01", desc: "Main harness assembly", cost: 210, lead: 0, sup: supAero, make: true, test: true, stock: 4 },
      { pn: "PNL-FRONT-1U", desc: "Front panel 1U machined + silkscreen", cost: 64, lead: 0, sup: supMetal, make: true, stock: 8 },
      { pn: "ASM-PSU-24V", desc: "Power supply sub-assembly 24V", cost: 380, lead: 0, sup: supChip, make: true, ser: true, test: true, stock: 3 },
    ];

    let lotSeq = 100;
    for (const c of catalog) {
      const p = await prisma.part.create({
        data: {
          partNumber: c.pn,
          description: c.desc,
          revision: "A",
          partType: c.make ? "MAKE" : "BUY",
          sourcingMethod: c.make ? "BUILD" : "PURCHASE",
          itemStructure: c.make ? "SUB_ASSEMBLY" : "RAW_MATERIAL",
          standardCost: c.cost,
          lastBuyCost: c.make ? 0 : c.cost * 1.03,
          averageCost: c.cost,
          leadTimeDays: c.lead,
          isLotControlled: !!c.lot,
          isSerialized: !!c.ser,
          requiresFunctionalTest: !!c.test,
          uom: "EA",
          uomUnitId: uom.EA.id,
          inventoryAccountId: invRm.id,
        },
      });
      if (!c.make) {
        await prisma.partVendor.create({
          data: {
            partId: p.id,
            supplierId: c.sup.id,
            vendorPartNumber: `${c.sup.code.replace("SUP-", "")}-${c.pn}`,
            vendorDescription: c.desc,
            manufacturer: c.mfr,
            unitCost: Math.round(c.cost * 1.03 * 100) / 100,
            leadTimeDays: c.lead,
            isPreferred: true,
          },
        });
      }
      if (c.stock) {
        await prisma.inventoryItem.create({
          data: {
            partId: p.id,
            locationId: (lotSeq % 2 ? loc["STG-A1"] : loc["STG-B2"]).id,
            quantityOnHand: c.stock,
            quantityAvailable: c.stock,
            unitCost: c.cost,
            lotNumber: c.lot ? `LOT-${c.pn.slice(0, 8)}-${lotSeq}` : undefined,
            ownership: "COMPANY",
          },
        });
      }
      lotSeq++;
    }
    // Cover the ASM-1000 BOM so a build can actually be kitted out of the
    // box (these were short: PCB-2200 ×2, CBL-6600/BRK-7700/FW-1000 ×0).
    const topUps: [string, number, number][] = [
      ["PCB-2200", 20, 610],
      ["CBL-6600", 25, 320],
      ["BRK-7700", 25, 890],
      ["FW-1000", 50, 0],
    ];
    for (const [pn, qty, cost] of topUps) {
      const p = part[pn];
      if (!p) continue;
      await prisma.inventoryItem.create({
        data: {
          partId: p.id,
          locationId: loc["STG-A1"].id,
          quantityOnHand: qty,
          quantityAvailable: qty,
          unitCost: cost,
          lotNumber: `LOT-${pn}-SEED`,
          ownership: "COMPANY",
        },
      });
    }
    console.log(`  ✓ Expanded catalog: ${catalog.length} additional items (ASL-linked + stocked) + BOM stock top-ups`);
  }

  // ── Purchase Requests → POs → Receipts → Inspection/MRB ────
  const pr1 = await prisma.purchaseRequest.create({
    data: {
      number: "PR-00001",
      status: "CONVERTED",
      requestedById: prodSup.id,
      department: "Production",
      neededBy: daysFromNow(14),
      justification: "Reorder connectors for ASM-1000 production",
      totalEstimate: 9250,
      supplierId: supAero.id,
      approvedById: buyer.id,
      approvedAt: daysAgo(20),
      lines: {
        create: [
          { partId: part["CON-4400"].id, description: "MIL-DTL Circular Connector", quantity: 50, estimatedUnitCost: 185 },
        ],
      },
    },
  });

  const pr2 = await prisma.purchaseRequest.create({
    data: {
      number: "PR-00002",
      // PO-00003 below is cut from this PR, so it seeds as CONVERTED
      status: "CONVERTED",
      requestedById: engLead.id,
      department: "Engineering",
      neededBy: daysFromNow(30),
      justification: "MCU stock for PCB builds",
      totalEstimate: 3700,
      supplierId: supChip.id,
      approvedById: buyer.id,
      approvedAt: daysAgo(5),
      lines: {
        create: [
          { partId: part["IC-STM32"].id, description: "STM32H7 MCU", quantity: 200, estimatedUnitCost: 18.5 },
        ],
      },
    },
  });

  const prPolicy = await prisma.approvalPolicy.findFirst({
    where: { isDefault: true },
    include: { steps: { orderBy: { stepOrder: "asc" } } },
  });
  const pr3 = await prisma.purchaseRequest.create({
    data: {
      number: "PR-00003",
      status: "SUBMITTED",
      requestedById: prodSup.id,
      department: "Machining",
      neededBy: daysFromNow(45),
      justification: "Housing blanks for next lot",
      totalEstimate: 8400,
      supplierId: supMetal.id,
      approvalPolicyId: prPolicy?.id,
      currentStepOrder: 1,
      lines: {
        create: [
          { partId: part["HSG-3100"].id, description: "Aluminum Housing CNC blanks", quantity: 20, estimatedUnitCost: 420 },
        ],
      },
    },
  });
  // Multi-step approvals: $8400 → buyer + finance (skip admin $25k)
  if (prPolicy) {
    for (const step of prPolicy.steps.filter((s) => 8400 >= s.minAmount)) {
      await prisma.approval.create({
        data: {
          entityType: "PurchaseRequest",
          entityId: pr3.id,
          stage: step.name,
          stepOrder: step.stepOrder,
          minAmount: step.minAmount,
          policyStepId: step.id,
          status: "PENDING",
        },
      });
    }
  }

  // PO fully received OK
  const po1 = await prisma.purchaseOrder.create({
    data: {
      number: "PO-00001",
      status: "RECEIVED",
      supplierId: supAero.id,
      purchaseRequestId: pr1.id,
      orderDate: daysAgo(18),
      promisedDate: daysAgo(3),
      acknowledgedAt: daysAgo(16),
      totalAmount: 9250,
      buyerId: buyer.id,
      lines: {
        create: [
          { partId: part["CON-4400"].id, description: "MIL-DTL Circular Connector", quantity: 50, quantityReceived: 50, unitCost: 185, lineNumber: 1, promisedDate: daysAgo(3) },
        ],
      },
    },
    include: { lines: true },
  });

  const rcv1 = await prisma.receipt.create({
    data: {
      number: "RCV-00001",
      purchaseOrderId: po1.id,
      receivedAt: daysAgo(2),
      receivedById: inspector.id,
      packingSlip: "PS-AERO-88421",
      status: "COMPLETE",
      lines: {
        create: [
          { poLineId: po1.lines[0].id, partId: part["CON-4400"].id, description: "MIL-DTL Circular Connector", quantityOrdered: 50, quantityReceived: 50, lotNumber: "LOT-CON-2501", unitCost: 185 },
        ],
      },
    },
  });

  await prisma.inspection.create({
    data: {
      number: "INSP-00001",
      type: "RECEIVING",
      status: "PASSED",
      partId: part["CON-4400"].id,
      purchaseOrderId: po1.id,
      lotNumber: "LOT-CON-2501",
      quantity: 50,
      quantityPassed: 50,
      inspectorId: inspector.id,
      completedAt: daysAgo(2),
      results: {
        create: [
          { characteristic: "Visual", specification: "No damage", measuredValue: "OK", result: "PASS" },
          { characteristic: "Dimensional", specification: "Per drawing", measuredValue: "OK", result: "PASS" },
          { characteristic: "Documentation", specification: "CoC required", measuredValue: "CoC present", result: "PASS" },
        ],
      },
    },
  });

  // PO with failed inspection → NCR → MRB (open)
  const po2 = await prisma.purchaseOrder.create({
    data: {
      number: "PO-00002",
      status: "PARTIAL_RECEIPT",
      supplierId: supMetal.id,
      orderDate: daysAgo(25),
      promisedDate: daysAgo(5),
      acknowledgedAt: daysAgo(22),
      totalAmount: 8900,
      buyerId: buyer.id,
      notes: "Housing lot — watch quality",
      lines: {
        create: [
          { partId: part["HSG-3100"].id, description: "Aluminum Housing CNC", quantity: 20, quantityReceived: 10, unitCost: 420, lineNumber: 1, promisedDate: daysAgo(5) },
          { partId: part["BRK-7700"].id, description: "Mounting Bracket Ti-6Al-4V", quantity: 5, quantityReceived: 0, unitCost: 890, lineNumber: 2, promisedDate: daysFromNow(10) },
        ],
      },
    },
    include: { lines: true },
  });

  await prisma.receipt.create({
    data: {
      number: "RCV-00002",
      purchaseOrderId: po2.id,
      receivedAt: daysAgo(4),
      receivedById: inspector.id,
      packingSlip: "PS-PM-1120",
      status: "DISCREPANCY",
      notes: "Surface finish non-conformance on 3 of 10",
      lines: {
        create: [
          { poLineId: po2.lines[0].id, partId: part["HSG-3100"].id, description: "Aluminum Housing CNC", quantityOrdered: 20, quantityReceived: 10, lotNumber: "LOT-HSG-BAD", unitCost: 420 },
        ],
      },
    },
  });

  const inspFail = await prisma.inspection.create({
    data: {
      number: "INSP-00002",
      type: "RECEIVING",
      status: "FAILED",
      partId: part["HSG-3100"].id,
      purchaseOrderId: po2.id,
      lotNumber: "LOT-HSG-BAD",
      quantity: 10,
      quantityPassed: 7,
      quantityFailed: 3,
      inspectorId: inspector.id,
      completedAt: daysAgo(4),
      notes: "Surface Ra exceeds max on sealing face",
      results: {
        create: [
          { characteristic: "Visual", specification: "No nicks/scratches", measuredValue: "Scratches on 3 units", result: "FAIL" },
          { characteristic: "Surface Finish", specification: "Ra ≤ 1.6 μm", measuredValue: "2.4 μm", result: "FAIL" },
          { characteristic: "Dimensional", specification: "±0.05mm", measuredValue: "OK", result: "PASS" },
        ],
      },
    },
  });

  const ncr1 = await prisma.nonConformance.create({
    data: {
      number: "NCR-00001",
      title: "Housing surface finish non-conformance",
      description: "3 of 10 housings from PrecisionMetals fail surface finish. Lot LOT-HSG-BAD quarantined.",
      status: "MRB",
      severity: "MAJOR",
      source: "RECEIVING",
      partId: part["HSG-3100"].id,
      inspectionId: inspFail.id,
      supplierId: supMetal.id,
      quantity: 3,
      lotNumber: "LOT-HSG-BAD",
      createdById: inspector.id,
    },
  });

  const mrb1 = await prisma.mrbCase.create({
    data: {
      number: "MRB-00001",
      ncrId: ncr1.id,
      status: "IN_REVIEW",
      chairId: qualityMgr.id,
      boardDate: daysFromNow(1),
      notes: "Awaiting supplier response on root cause",
    },
  });

  // Quarantine inventory for MRB
  const quarItem = await prisma.inventoryItem.create({
    data: {
      partId: part["HSG-3100"].id,
      locationId: loc["QUAR-01"].id,
      quantityOnHand: 3,
      quantityAvailable: 0,
      quantityQuarantine: 3,
      unitCost: 420,
      lotNumber: "LOT-HSG-BAD",
      ownership: "COMPANY",
      mrbCaseId: mrb1.id,
    },
  });

  await prisma.materialTransaction.create({
    data: {
      type: "QUARANTINE",
      partId: part["HSG-3100"].id,
      inventoryItemId: quarItem.id,
      purchaseOrderId: po2.id,
      quantity: 3,
      unitCost: 420,
      toLocation: "QUAR-01",
      lotNumber: "LOT-HSG-BAD",
      reference: mrb1.number,
      notes: "Auto-hold from failed receiving inspection",
      userId: inspector.id,
    },
  });

  // Closed NCR/MRB for scorecard history
  const ncr2 = await prisma.nonConformance.create({
    data: {
      number: "NCR-00002",
      title: "MCU lot documentation incomplete",
      description: "Missing CoC for lot LOT-IC-OLD",
      status: "CLOSED",
      severity: "MINOR",
      source: "RECEIVING",
      partId: part["IC-STM32"].id,
      supplierId: supChip.id,
      quantity: 25,
      createdById: inspector.id,
      rootCause: "Supplier shipping process gap",
      closedAt: daysAgo(30),
    },
  });
  const mrb2 = await prisma.mrbCase.create({
    data: {
      number: "MRB-00002",
      ncrId: ncr2.id,
      status: "CLOSED",
      chairId: qualityMgr.id,
      closedAt: daysAgo(28),
    },
  });
  await prisma.mrbDisposition.create({
    data: {
      mrbCaseId: mrb2.id,
      disposition: "USE_AS_IS",
      quantity: 25,
      justification: "Electrical test passed; CoC obtained after the fact",
      decidedById: qualityMgr.id,
      carNumber: "CAR-00001",
      carStatus: "CLOSED",
    },
  });

  // Open POs
  await prisma.purchaseOrder.create({
    data: {
      number: "PO-00003",
      status: "ISSUED",
      supplierId: supChip.id,
      purchaseRequestId: pr2.id,
      orderDate: daysAgo(4),
      promisedDate: daysFromNow(18),
      totalAmount: 3700,
      buyerId: buyer.id,
      lines: {
        create: [
          { partId: part["IC-STM32"].id, description: "STM32H7 MCU", quantity: 200, unitCost: 18.5, lineNumber: 1, promisedDate: daysFromNow(18) },
        ],
      },
    },
  });

  await prisma.purchaseOrder.create({
    data: {
      number: "PO-00004",
      status: "ACKNOWLEDGED",
      supplierId: supFast.id,
      orderDate: daysAgo(10),
      promisedDate: daysFromNow(5),
      acknowledgedAt: daysAgo(8),
      totalAmount: 400,
      buyerId: buyer.id,
      shipToAddress:
        "Forge Dynamics LLC\nReceiving Dock\n1200 Precision Way\nHuntsville, AL 35806",
      lines: {
        create: [
          { partId: part["SCR-M3-10"].id, description: "Screw M3x10 SS", quantity: 5000, unitCost: 0.08, lineNumber: 1 },
        ],
      },
    },
  });

  // Receiving travelers for every PO (dock queue)
  const allPosSeed = await prisma.purchaseOrder.findMany({ orderBy: { number: "asc" } });
  let rcvTi = 0;
  for (const p of allPosSeed) {
    rcvTi += 1;
    const tStatus =
      p.status === "RECEIVED"
        ? "COMPLETE"
        : p.status === "PARTIAL_RECEIPT"
          ? "PARTIAL"
          : "WAITING";
    await prisma.receivingTraveler.create({
      data: {
        number: `RCV-T-${String(rcvTi).padStart(5, "0")}`,
        purchaseOrderId: p.id,
        status: tStatus,
        expectedDate: p.promisedDate,
        notes: `Receiving traveler for ${p.number}`,
      },
    });
  }
  console.log("  ✓ Purchasing flow (PR→PO→Receipt→MRB) + receiving travelers");

  // ── PMO: Programs + Projects ───────────────────────────────
  const programAero = await prisma.program.create({
    data: {
      code: "PRG-AERO",
      name: "Avionics Portfolio",
      description: "Airborne electronics programs — control modules and interfaces",
      status: "ACTIVE",
      portfolio: "Defense",
      ownerId: pm.id,
      budgetCost: 5000000,
      startDate: daysAgo(200),
      endDate: daysFromNow(400),
    },
  });

  const project = await prisma.project.create({
    data: {
      number: "PRJ-AERO-01",
      name: "Block 5 Avionics Upgrade",
      description: "Design and produce next-gen avionics control modules for Block 5 platforms",
      status: "ACTIVE",
      methodology: "HYBRID",
      phase: "EXECUTION",
      programId: programAero.id,
      customerName: "DoD / Prime Contractor",
      contractValue: 4500000,
      budgetCost: 3200000,
      actualCost: 1450000,
      plannedValue: 1600000,
      earnedValue: 1520000,
      developmentBudget: 900000,
      developmentActual: 620000,
      startDate: daysAgo(120),
      endDate: daysFromNow(180),
      percentComplete: 48,
      charterStatus: "APPROVED",
      charterApprovedAt: daysAgo(110),
      businessCase: "Replace legacy controllers with CM-1000 family for Block 5 platforms under firm-fixed CLIN.",
      objectives: "Complete qualification, FAI, and LRIP of 10 units; establish production rate.",
      scopeIn: "Design, qualification, LRIP, tech data package, training.",
      scopeOut: "Platform integration flight test (customer-owned).",
      successCriteria: "FAI accepted; SPI/CPI ≥ 0.95; zero escape NCRs on LRIP.",
      sponsorId: pm.id,
      projectManagerId: pm.id,
      members: {
        create: [
          { userId: pm.id, role: "PM" },
          { userId: engLead.id, role: "TECH_LEAD" },
          { userId: prodSup.id, role: "MEMBER" },
          { userId: qualityMgr.id, role: "STAKEHOLDER" },
        ],
      },
      wbsElements: {
        create: [
          { code: "1.0", name: "Program Management", kind: "CONTROL_ACCOUNT", level: 0, budgetCost: 200000, actualCost: 95000, percentComplete: 50, sortOrder: 1, description: "PM, EVMS, reporting, customer interface", deliverables: "Monthly status, risk register updates" },
          { code: "2.0", name: "Engineering Design", kind: "CONTROL_ACCOUNT", level: 0, budgetCost: 800000, actualCost: 720000, percentComplete: 90, sortOrder: 2, description: "Systems, mechanical, electrical design through CDR", deliverables: "ICD, drawings, analysis packages" },
          { code: "3.0", name: "Procurement", kind: "CONTROL_ACCOUNT", level: 0, budgetCost: 600000, actualCost: 280000, percentComplete: 45, sortOrder: 3 },
          { code: "4.0", name: "Production", kind: "CONTROL_ACCOUNT", level: 0, budgetCost: 1200000, actualCost: 280000, percentComplete: 25, sortOrder: 4 },
          { code: "5.0", name: "Test & Qualification", kind: "CONTROL_ACCOUNT", level: 0, budgetCost: 400000, actualCost: 75000, percentComplete: 15, sortOrder: 5 },
        ],
      },
      milestones: {
        create: [
          { name: "PDR Complete", kind: "PDR", dueDate: daysAgo(60), actualDate: daysAgo(60), status: "ACHIEVED" },
          { name: "CDR Complete", kind: "CDR", dueDate: daysAgo(20), actualDate: daysAgo(20), status: "ACHIEVED" },
          { name: "First Article Complete", kind: "FAI", dueDate: daysFromNow(30), status: "PENDING" },
          { name: "LRIP Delivery", kind: "RELEASE", dueDate: daysFromNow(120), status: "PENDING" },
        ],
      },
      risks: {
        create: [
          {
            number: "RSK-001",
            title: "Connector long lead",
            description: "CON-4400 lead time stretch risk",
            category: "SUPPLY",
            probability: "MEDIUM",
            impact: "HIGH",
            score: 6,
            status: "MITIGATING",
            mitigation: "Dual-source evaluation + safety stock",
            contingency: "Use interim connector with EC waiver",
          },
          {
            number: "RSK-002",
            title: "Firmware certification delay",
            category: "TECHNICAL",
            probability: "LOW",
            impact: "HIGH",
            score: 3,
            status: "OPEN",
            mitigation: "Parallel lab path",
          },
        ],
      },
      issues: {
        create: [
          {
            number: "ISS-001",
            title: "PrecisionMetals quality trend",
            description: "Rising NCR rate on housings",
            status: "IN_PROGRESS",
            priority: "HIGH",
            category: "QUALITY",
          },
        ],
      },
      raciEntries: {
        create: [
          { activity: "Design freeze", responsible: "Jordan Lee", accountable: "Quinn Foster", consulted: "Quality", informed: "Production", sortOrder: 0 },
          { activity: "FAI package", responsible: "Casey Nguyen", accountable: "Quinn Foster", consulted: "Engineering", informed: "Customer", sortOrder: 1 },
          { activity: "Supplier selection", responsible: "Taylor Brooks", accountable: "Quinn Foster", consulted: "Quality, Engineering", informed: "Program", sortOrder: 2 },
        ],
      },
      communications: {
        create: [
          { audience: "Core team", purpose: "Standup / blockers", frequency: "DAILY", channel: "MEETING", ownerName: "Quinn Foster", sortOrder: 0 },
          { audience: "Customer PM", purpose: "Status & risks", frequency: "WEEKLY", channel: "REPORT", ownerName: "Quinn Foster", sortOrder: 1 },
          { audience: "Steering committee", purpose: "Gate decisions", frequency: "MILESTONE", channel: "MEETING", ownerName: "Alex Morgan", sortOrder: 2 },
        ],
      },
      requirements: {
        create: [
          { number: "PREQ-001", title: "Block 5 interface compatibility", category: "INTERFACE", status: "APPROVED", priority: "CRITICAL", source: "Customer SOW" },
          { number: "PREQ-002", title: "Thermal envelope for sealed housing", category: "PERFORMANCE", status: "APPROVED", priority: "HIGH" },
        ],
      },
      wikiPages: {
        create: [
          {
            slug: "home",
            title: "Home",
            body: "# Block 5 Avionics Upgrade\n\nPMO wiki home for PRJ-AERO-01.\n\n- [Decision log](decisions)\n- CDR package locked Rev B\n",
            sortOrder: 0,
          },
          {
            slug: "decisions",
            title: "Decision log",
            body: "# Decision log\n\n| Date | Decision | Owner |\n|------|----------|-------|\n| 2025-Q4 | Select CM-1000 as TLA | Eng |\n| 2026-Q1 | Dual-source connector | Supply |\n",
            sortOrder: 1,
          },
        ],
      },
      piIncrements: {
        create: [
          {
            name: "PI-2 Production ramp",
            number: 2,
            goals: "Complete FAI prep; lock supplier capacity for LRIP.",
            status: "ACTIVE",
            startDate: daysAgo(20),
            endDate: daysFromNow(40),
            capacityPoints: 80,
            committedPoints: 65,
            features: {
              create: [
                { name: "FAI traveler automation", status: "IN_PROGRESS", storyPoints: 13, sortOrder: 0 },
                { name: "Supplier scorecard dashboard", status: "COMMITTED", storyPoints: 8, sortOrder: 1 },
              ],
            },
          },
        ],
      },
      costEntries: {
        create: [
          { category: "LABOR", description: "Engineering design hours Q1", amount: 280000, hours: 2200, entryDate: daysAgo(90), source: "TIMESHEET" },
          { category: "NRE", description: "Tooling for housing", amount: 120000, entryDate: daysAgo(70), source: "PO" },
          { category: "TEST", description: "EMI chamber rental", amount: 45000, entryDate: daysAgo(40), source: "MANUAL" },
          { category: "LABOR", description: "Proto build labor", amount: 175000, hours: 1400, entryDate: daysAgo(15), source: "TIMESHEET" },
        ],
      },
    },
    include: { wbsElements: true },
  });

  const wbsProd = project.wbsElements.find((w) => w.code === "4.0")!;
  const wbsEng = project.wbsElements.find((w) => w.code === "2.0")!;

  // Sub-WBS under Engineering Design
  const wbsMech = await prisma.wbsElement.create({
    data: {
      projectId: project.id,
      parentId: wbsEng.id,
      code: "2.1",
      name: "Mechanical design",
      kind: "WORK_PACKAGE",
      level: 1,
      budgetCost: 250000,
      actualCost: 210000,
      percentComplete: 85,
      description: "Housing, gasket, thermal path",
      deliverables: "Housing drawings, thermal analysis",
      acceptanceCriteria: "CDR package approved; drawing rev released via CM",
      sortOrder: 0,
    },
  });
  await prisma.wbsElement.create({
    data: {
      projectId: project.id,
      parentId: wbsEng.id,
      code: "2.2",
      name: "Electronics / firmware",
      kind: "WORK_PACKAGE",
      level: 1,
      budgetCost: 350000,
      actualCost: 300000,
      percentComplete: 90,
      deliverables: "PCB Gerbers, FW build",
      sortOrder: 1,
    },
  });
  await prisma.wbsElement.create({
    data: {
      projectId: project.id,
      parentId: wbsEng.id,
      code: "2.3",
      name: "Systems integration",
      kind: "WORK_PACKAGE",
      level: 1,
      budgetCost: 200000,
      actualCost: 210000,
      percentComplete: 95,
      sortOrder: 2,
    },
  });

  // Campaign → sagas → tasks
  const camp1 = await prisma.campaign.create({
    data: {
      projectId: project.id,
      wbsElementId: wbsMech.id,
      number: "CMP-001",
      name: "Housing & thermal package",
      description: "Complete mechanical design through production release",
      definitionOfDone: "Drawings released in CM; thermal report signed; DFM review complete",
      status: "IN_PROGRESS",
      priority: "HIGH",
      ownerId: pm.id,
      startDate: daysAgo(90),
      endDate: daysFromNow(30),
      dueDate: daysFromNow(30),
      estimatedHours: 800,
      actualHours: 620,
      storyPoints: 40,
      percentComplete: 70,
    },
  });
  const sagaMech = await prisma.saga.create({
    data: {
      projectId: project.id,
      campaignId: camp1.id,
      number: "SAG-001",
      name: "Housing CAD & detailing",
      discipline: "MECHANICAL",
      definitionOfDone: "All housing models in PLM; GD&T applied; peer review done",
      status: "IN_PROGRESS",
      priority: "HIGH",
      ownerId: engLead.id,
      startDate: daysAgo(80),
      dueDate: daysFromNow(14),
      estimatedHours: 320,
      actualHours: 280,
      storyPoints: 21,
      percentComplete: 75,
    },
  });
  const sagaSys = await prisma.saga.create({
    data: {
      projectId: project.id,
      campaignId: camp1.id,
      number: "SAG-002",
      name: "Thermal / systems analysis",
      discipline: "SYSTEMS",
      definitionOfDone: "Thermal model correlates to test; report baselined",
      status: "IN_REVIEW",
      priority: "HIGH",
      ownerId: engLead.id,
      estimatedHours: 160,
      actualHours: 150,
      storyPoints: 13,
      percentComplete: 90,
    },
  });
  await prisma.engTask.createMany({
    data: [
      {
        projectId: project.id,
        campaignId: camp1.id,
        sagaId: sagaMech.id,
        number: "TSK-0001",
        name: "Update housing model for gasket groove",
        status: "DONE",
        discipline: "MECHANICAL",
        assigneeId: engLead.id,
        estimatedHours: 40,
        actualHours: 38,
        storyPoints: 5,
        percentComplete: 100,
        startDate: daysAgo(40),
        endDate: daysAgo(20),
      },
      {
        projectId: project.id,
        campaignId: camp1.id,
        sagaId: sagaMech.id,
        number: "TSK-0002",
        name: "Detail machining drawings Rev B",
        status: "IN_PROGRESS",
        discipline: "MECHANICAL",
        assigneeId: engLead.id,
        estimatedHours: 60,
        actualHours: 42,
        storyPoints: 8,
        percentComplete: 60,
        dueDate: daysFromNow(7),
      },
      {
        projectId: project.id,
        campaignId: camp1.id,
        sagaId: sagaSys.id,
        number: "TSK-0003",
        name: "Run thermal FEA load cases",
        status: "DONE",
        discipline: "SYSTEMS",
        estimatedHours: 24,
        actualHours: 28,
        storyPoints: 5,
        percentComplete: 100,
      },
      {
        projectId: project.id,
        campaignId: camp1.id,
        sagaId: sagaSys.id,
        number: "TSK-0004",
        name: "Write thermal correlation report",
        status: "IN_REVIEW",
        discipline: "SYSTEMS",
        estimatedHours: 16,
        actualHours: 12,
        storyPoints: 3,
        percentComplete: 80,
        dueDate: daysFromNow(3),
      },
    ],
  });

  const camp2 = await prisma.campaign.create({
    data: {
      projectId: project.id,
      wbsElementId: wbsProd.id,
      number: "CMP-002",
      name: "LRIP readiness",
      definitionOfDone: "FAI package complete; line capable of 10 units",
      status: "PLANNED",
      priority: "HIGH",
      ownerId: pm.id,
      startDate: daysAgo(7),
      dueDate: daysFromNow(45),
      estimatedHours: 400,
      storyPoints: 34,
    },
  });
  await prisma.saga.create({
    data: {
      projectId: project.id,
      campaignId: camp2.id,
      number: "SAG-001",
      name: "Cyber / secure boot checklist",
      discipline: "CYBER",
      status: "BACKLOG",
      definitionOfDone: "Secure boot verified on 3 units; checklist signed",
      estimatedHours: 80,
      storyPoints: 8,
    },
  });
  await prisma.saga.create({
    data: {
      projectId: project.id,
      campaignId: camp2.id,
      number: "SAG-002",
      name: "Network interface bring-up",
      discipline: "NETWORK",
      status: "TODO",
      estimatedHours: 60,
      storyPoints: 5,
    },
  });
  const sagaSw = await prisma.saga.create({
    data: {
      projectId: project.id,
      campaignId: camp2.id,
      number: "SAG-003",
      name: "Production firmware branch",
      discipline: "SOFTWARE",
      status: "BACKLOG",
      estimatedHours: 100,
      storyPoints: 13,
    },
  });

  // PI quarter + PMO sprints (lanes pull work into these)
  const piQuarter = await prisma.planningQuarter.create({
    data: {
      code: "2026-Q3",
      name: "FY2026 Q3 PI",
      year: 2026,
      quarter: 3,
      startDate: daysAgo(14),
      endDate: daysFromNow(75),
      status: "ACTIVE",
      goals: "Ship radiator Gen2 · close mechanical drawings · firmware branch readiness",
    },
  });
  const engSprint = await prisma.engSprint.create({
    data: {
      name: "Sprint 25 — mech closeout",
      goal: "Finish housing drawings; unblock firmware",
      discipline: "MECHANICAL",
      projectId: project.id,
      quarterId: piQuarter.id,
      status: "ACTIVE",
      createdByPmo: true,
      startDate: daysAgo(7),
      endDate: daysFromNow(7),
    },
  });
  await prisma.engSprint.create({
    data: {
      name: "Sprint 26 — multi-lane",
      goal: "Cross-discipline PI sprint",
      projectId: project.id,
      quarterId: piQuarter.id,
      status: "PLANNED",
      createdByPmo: true,
      startDate: daysFromNow(8),
      endDate: daysFromNow(21),
    },
  });
  await prisma.engTask.updateMany({
    where: { number: { in: ["TSK-0002"] } },
    data: { engSprintId: engSprint.id },
  });
  await prisma.saga.update({
    where: { id: sagaMech.id },
    data: { engSprintId: engSprint.id },
  });

  const mechDrawing = await prisma.engTask.findFirst({
    where: { number: "TSK-0002" },
  });
  if (mechDrawing) {
    await prisma.engDependency.create({
      data: {
        type: "FINISH_TO_START",
        notes: "Firmware needs released housing envelope",
        sourceTaskId: mechDrawing.id,
        targetSagaId: sagaSw.id,
      },
    });
  }

  // Link open POs to program / CLIN for list view
  await prisma.purchaseOrder.updateMany({
    where: { number: { in: ["PO-00001", "PO-00002", "PO-00003", "PO-00004"] } },
    data: {
      projectId: project.id,
      wbsElementId: wbsProd.id,
      clin: "0001AA",
      shipToAddress:
        "Forge Dynamics LLC\nReceiving Dock\n1200 Precision Way\nHuntsville, AL 35806",
    },
  });

  await prisma.projectTask.createMany({
    data: [
      { projectId: project.id, wbsElementId: wbsProd.id, name: "Build LRIP lot 1 (qty 10)", status: "IN_PROGRESS", priority: "HIGH", kind: "TASK", assigneeId: prodSup.id, startDate: daysAgo(14), endDate: daysFromNow(21), estimatedHours: 400, actualHours: 180, percentComplete: 40 },
      { projectId: project.id, wbsElementId: wbsProd.id, name: "First article inspection package", status: "TODO", priority: "HIGH", kind: "TASK", assigneeId: qualityMgr.id, startDate: daysFromNow(7), endDate: daysFromNow(30), estimatedHours: 80, percentComplete: 0 },
      { projectId: project.id, name: "Supplier scorecard review", status: "DONE", priority: "NORMAL", kind: "STORY", storyPoints: 5, sprintLabel: "Sprint 24", assigneeId: buyer.id, estimatedHours: 8, actualHours: 6, percentComplete: 100 },
    ],
  });

  await prisma.project.create({
    data: {
      number: "PRJ-INT-02",
      name: "Internal Tooling Upgrade",
      status: "ACTIVE",
      methodology: "WATERFALL",
      phase: "EXECUTION",
      programId: programAero.id,
      budgetCost: 150000,
      actualCost: 45000,
      plannedValue: 60000,
      earnedValue: 52000,
      developmentBudget: 80000,
      developmentActual: 32000,
      percentComplete: 35,
      startDate: daysAgo(40),
      endDate: daysFromNow(50),
      projectManagerId: engLead.id,
      charterStatus: "APPROVED",
      wikiPages: {
        create: {
          slug: "home",
          title: "Home",
          body: "# Internal Tooling Upgrade\n\nShop floor tooling modernization.",
        },
      },
    },
  });
  console.log("  ✓ PMO programs + projects");

  // ── Work Orders ────────────────────────────────────────────
  const wo1 = await prisma.workOrder.create({
    data: {
      number: "WO-00001",
      type: "PRODUCTION",
      status: "IN_PROGRESS",
      priority: "HIGH",
      partId: part["ASM-1000"].id,
      bomHeaderId: bomB.id,
      quantity: 5,
      quantityCompleted: 1,
      projectId: project.id,
      wbsElementId: wbsProd.id,
      workCenter: "ASM-01",
      department: "Assembly",
      assigneeId: tech1.id,
      createdById: prodSup.id,
      plannedStart: daysAgo(7),
      plannedEnd: daysFromNow(14),
      actualStart: daysAgo(6),
      standardCost: 12500 * 5,
      actualCost: 18200,
      description: "LRIP lot 1 — Block 5 ACM",
      requiresInspection: true,
      statusHistory: {
        create: [
          { fromStatus: null, toStatus: "PLANNED", userId: prodSup.id, createdAt: daysAgo(10) },
          { fromStatus: "PLANNED", toStatus: "RELEASED", userId: prodSup.id, createdAt: daysAgo(7) },
          { fromStatus: "RELEASED", toStatus: "IN_PROGRESS", userId: tech1.id, createdAt: daysAgo(6) },
        ],
      },
    },
  });

  await prisma.workOrderInstruction.create({
    data: { workOrderId: wo1.id, workInstructionId: wiAsm.id, sequence: 1 },
  });

  // Step completions — partial progress
  for (let i = 0; i < wiAsm.steps.length; i++) {
    const step = wiAsm.steps[i];
    const done = i < 4;
    await prisma.workOrderStepCompletion.create({
      data: {
        workOrderId: wo1.id,
        stepId: step.id,
        status: done ? "SIGNED" : i === 4 ? "IN_PROGRESS" : "PENDING",
        result: done ? (step.isTestStep ? "PASS" : "NA") : null,
        measuredValue: done && step.isTestStep ? "0.12Ω" : null,
        signedById: done ? tech1.id : null,
        signedAt: done ? daysAgo(5 - i) : null,
      },
    });
    if (done) {
      await prisma.workInstructionSignOff.create({
        data: {
          stepId: step.id,
          workInstructionId: wiAsm.id,
          workOrderId: wo1.id,
          userId: tech1.id,
          result: step.isTestStep ? "PASS" : "NA",
          signedAt: daysAgo(5 - i),
        },
      });
    }
  }

  const wo2 = await prisma.workOrder.create({
    data: {
      number: "WO-00002",
      type: "PRODUCTION",
      status: "RELEASED",
      priority: "NORMAL",
      partId: part["ASM-1000"].id,
      bomHeaderId: bomB.id,
      quantity: 3,
      projectId: project.id,
      workCenter: "ASM-02",
      department: "Assembly",
      assigneeId: tech1.id,
      createdById: prodSup.id,
      plannedStart: daysFromNow(1),
      plannedEnd: daysFromNow(20),
      standardCost: 12500 * 3,
      description: "LRIP lot 1 continuation",
    },
  });
  await prisma.workOrderInstruction.create({
    data: { workOrderId: wo2.id, workInstructionId: wiAsm.id, sequence: 1 },
  });
  for (const step of wiAsm.steps) {
    await prisma.workOrderStepCompletion.create({
      data: { workOrderId: wo2.id, stepId: step.id, status: "PENDING" },
    });
  }

  // Prototype WO on Rev C BOM
  await prisma.workOrder.create({
    data: {
      number: "WO-00003",
      type: "PROTOTYPE",
      status: "PLANNED",
      priority: "HIGH",
      partId: part["ASM-1000"].id,
      bomHeaderId: bomCProto.id,
      quantity: 1,
      projectId: project.id,
      workCenter: "ASM-01",
      department: "Engineering",
      assigneeId: engLead.id,
      createdById: engLead.id,
      plannedStart: daysFromNow(7),
      plannedEnd: daysFromNow(28),
      standardCost: 15000,
      description: "First article prototype — BOM Rev C (uncertified)",
      notes: "Cannot use for production deliveries. Certify BOM after FAI success.",
    },
  });

  // Task-only WO (5S)
  const woTask = await prisma.workOrder.create({
    data: {
      number: "WO-00004",
      type: "TASK_ONLY",
      status: "IN_PROGRESS",
      priority: "LOW",
      quantity: 1,
      workCenter: "ASM-01",
      department: "Assembly",
      assigneeId: tech2.id,
      createdById: prodSup.id,
      plannedStart: daysAgo(0),
      plannedEnd: daysAgo(0),
      description: "Daily 5S — Assembly Cell 1",
    },
  });
  await prisma.workOrderInstruction.create({
    data: { workOrderId: woTask.id, workInstructionId: wiTask.id, sequence: 1 },
  });
  const taskSteps = await prisma.workInstructionStep.findMany({ where: { workInstructionId: wiTask.id } });
  for (const step of taskSteps) {
    await prisma.workOrderStepCompletion.create({
      data: { workOrderId: woTask.id, stepId: step.id, status: "PENDING" },
    });
  }

  // Machine WO
  await prisma.workOrder.create({
    data: {
      number: "WO-00005",
      type: "PRODUCTION",
      status: "IN_PROGRESS",
      priority: "NORMAL",
      partId: part["HSG-3100"].id,
      quantity: 8,
      workCenter: "MCH-01",
      department: "Machining",
      assigneeId: tech2.id,
      createdById: prodSup.id,
      plannedStart: daysAgo(3),
      plannedEnd: daysFromNow(5),
      actualStart: daysAgo(3),
      standardCost: 3360,
      actualCost: 2100,
      description: "CNC housing lot",
    },
  });

  await prisma.workOrder.create({
    data: {
      number: "WO-00006",
      type: "PRODUCTION",
      status: "ON_HOLD",
      priority: "CRITICAL",
      partId: part["ASM-1000"].id,
      bomHeaderId: bomB.id,
      quantity: 2,
      workCenter: "ASM-02",
      department: "Assembly",
      assigneeId: tech1.id,
      createdById: prodSup.id,
      plannedStart: daysAgo(2),
      plannedEnd: daysFromNow(10),
      actualStart: daysAgo(2),
      standardCost: 25000,
      description: "Held — awaiting MRB disposition on housings",
      notes: "Material shortage due to quarantine LOT-HSG-BAD",
      statusHistory: {
        create: [
          { toStatus: "PLANNED", userId: prodSup.id },
          { fromStatus: "PLANNED", toStatus: "RELEASED", userId: prodSup.id },
          { fromStatus: "RELEASED", toStatus: "IN_PROGRESS", userId: tech1.id },
          { fromStatus: "IN_PROGRESS", toStatus: "ON_HOLD", userId: qualityMgr.id, notes: "Material hold MRB-00001" },
        ],
      },
    },
  });

  await prisma.workOrder.create({
    data: {
      number: "WO-00007",
      type: "INSPECTION",
      status: "RELEASED",
      priority: "NORMAL",
      partId: part["ASM-1000"].id,
      quantity: 1,
      workCenter: "QA-01",
      department: "Quality",
      assigneeId: inspector.id,
      createdById: qualityMgr.id,
      description: "Final QA for WO-00001 unit 1",
      requiresInspection: true,
    },
  });
  console.log("  ✓ Work Orders (production, prototype, task-only, hold)");

  // ── Customers / Sales / Shipping ───────────────────────────
  const customer = await prisma.customer.create({
    data: {
      code: "CUST-PRIME",
      name: "NorthStar Defense Systems",
      contactName: "Jamie Ortiz",
      contactEmail: "procurement@northstar.example",
      contactPhone: "(256) 555-8800",
      billToAddress: "Accounts Payable\nNorthStar Defense Systems\n400 Contract Way\nHuntsville, AL 35805",
      shipToAddress: "NorthStar Defense, Building 4\nReceiving Dock B\nHuntsville, AL 35806",
      paymentTerms: "NET45",
      creditLimit: 2000000,
    },
  });

  const so = await prisma.salesOrder.create({
    data: {
      number: "SO-00001",
      customerId: customer.id,
      status: "IN_PRODUCTION",
      orderDate: daysAgo(40),
      requiredDate: daysFromNow(60),
      shipDate: daysFromNow(50),
      allowEarlyShip: false,
      shipNotBefore: daysFromNow(45),
      customerPo: "NS-PO-88421",
      paymentTerms: "NET45",
      isFob: true,
      fobPoint: "ORIGIN",
      billToName: "NorthStar Defense Systems",
      billToAddress: customer.billToAddress,
      shipToName: "NorthStar Defense — Bldg 4",
      shipToAddress: "NorthStar Defense, Building 4, Huntsville AL",
      contactName: "Jamie Ortiz",
      contactEmail: "procurement@northstar.example",
      totalAmount: 187500,
      lines: {
        create: [
          {
            partId: part["ASM-1000"].id,
            description: "Avionics Control Module",
            quantity: 15,
            quantityShipped: 0,
            quantityAllocated: 0,
            unitPrice: 12500,
            workOrderId: wo1.id,
            fulfillmentStatus: "MAKE_ORDERED",
          },
        ],
      },
    },
    include: { lines: true },
  });

  // Link primary production WO to SO / line for traveler continuity
  await prisma.workOrder.update({
    where: { id: wo1.id },
    data: {
      salesOrderId: so.id,
      salesOrderLineId: so.lines[0].id,
      salesOrderRef: so.number,
      dueDate: so.requiredDate,
      estimatedMinutes: 240,
      kitStatus: "KITTED",
      travelerNotes: [
        "DIGITAL TRAVELER",
        `Sales order: ${so.number}`,
        `Customer PO: ${so.customerPo}`,
        `Due: ${so.requiredDate?.toISOString().slice(0, 10)}`,
        "Contains: BOM Rev B, WI-ASM-1000, kit list, sign-offs, material trace",
      ].join("\n"),
    },
  });

  // Demo SO that will need full make + buy path (no FG stock for large qty)
  const so2 = await prisma.salesOrder.create({
    data: {
      number: "SO-00002",
      customerId: customer.id,
      status: "OPEN",
      orderDate: daysAgo(1),
      requiredDate: daysFromNow(21),
      shipDate: daysFromNow(18),
      allowEarlyShip: true,
      customerPo: "NS-PO-90102",
      paymentTerms: "NET45",
      isFob: false,
      billToName: "NorthStar Defense Systems",
      billToAddress: customer.billToAddress,
      shipToName: "NorthStar Defense — Bldg 4",
      shipToAddress: "NorthStar Defense, Building 4, Huntsville AL",
      totalAmount: 25000,
      notes: "Demo: Plan fulfillment for stock-check → WO → shortage PRs",
      lines: {
        create: [
          {
            partId: part["ASM-1000"].id,
            description: "Avionics Control Module",
            quantity: 2,
            unitPrice: 12500,
            fulfillmentStatus: "OPEN",
          },
        ],
      },
    },
  });

  // Open quote ready to accept → SO
  await prisma.quote.create({
    data: {
      number: "QT-00001",
      customerId: customer.id,
      status: "SENT",
      quoteDate: daysAgo(3),
      validUntil: daysFromNow(11),
      requiredDate: daysFromNow(35),
      shipDate: daysFromNow(28),
      customerPo: "RFQ-NS-4410",
      paymentTerms: "NET45",
      isFob: true,
      fobPoint: "ORIGIN",
      billToName: "NorthStar Defense Systems",
      billToAddress: customer.billToAddress,
      shipToName: "NorthStar Defense — Bldg 4",
      shipToAddress: customer.shipToAddress,
      contactName: "Jamie Ortiz",
      contactEmail: "procurement@northstar.example",
      totalAmount: 12500,
      notes: "Demo: Accept to convert into a sales order",
      lines: {
        create: [
          {
            partId: part["ASM-1000"].id,
            description: "Avionics Control Module",
            quantity: 1,
            unitPrice: 12500,
            lineNumber: 1,
          },
        ],
      },
    },
  });

  await prisma.shipment.create({
    data: {
      number: "SHP-00001",
      salesOrderId: so.id,
      status: "DRAFT",
      shipToAddress: "NorthStar Defense, Building 4, Huntsville AL",
      carrier: "FedEx Priority",
      notes: "Held — early ship not allowed until shipNotBefore",
      lines: {
        create: [
          { partId: part["ASM-1000"].id, description: "Avionics Control Module", quantity: 1 },
        ],
      },
    },
  });

  await prisma.traceEvent.createMany({
    data: [
      {
        eventType: "SO_CREATED",
        salesOrderId: so.id,
        notes: `Seed SO ${so.number} linked to production traveler`,
      },
      {
        eventType: "SO_CREATED",
        salesOrderId: so2.id,
        notes: `Seed SO ${so2.number} ready for plan fulfillment demo`,
      },
    ],
  });

  // AR Invoice
  await prisma.arInvoice.create({
    data: {
      number: "INV-00001",
      customerId: customer.id,
      invoiceDate: daysAgo(15),
      dueDate: daysFromNow(30),
      status: "OPEN",
      subtotal: 25000,
      tax: 0,
      total: 25000,
      lines: {
        create: [
          { description: "Engineering services — CDR support", quantity: 1, unitPrice: 25000, amount: 25000 },
        ],
      },
    },
  });

  await prisma.apInvoice.create({
    data: {
      number: "AP-00001",
      supplierId: supAero.id,
      purchaseOrderId: po1.id,
      invoiceDate: daysAgo(1),
      dueDate: daysFromNow(29),
      status: "OPEN",
      subtotal: 9250,
      total: 9250,
    },
  });

  // Journal entries
  await prisma.journalEntry.create({
    data: {
      number: "JE-00001",
      date: daysAgo(1),
      description: "PO receipt inventory capitalization",
      status: "POSTED",
      source: "INVENTORY",
      postedAt: daysAgo(1),
      lines: {
        create: [
          { accountId: accounts.find((a) => a.code === "1200")!.id, debit: 9250, credit: 0, memo: "Raw materials" },
          { accountId: accounts.find((a) => a.code === "2000")!.id, debit: 0, credit: 9250, memo: "AP accrual" },
        ],
      },
    },
  });
  console.log("  ✓ Sales, shipping, AR/AP, journal entries");

  // ── Government Property ────────────────────────────────────
  const gfpInv = invItems[invItems.length - 1];
  const gfp1 = await prisma.governmentProperty.create({
    data: {
      assetTag: "GFP-2024-0042",
      uid: "D1234ABCDE1234567890",
      serialNumber: "GFP-CON-001",
      description: "Government Furnished MIL Connectors (lot)",
      partNumber: "CON-4400",
      acquisitionCost: 0,
      acquisitionDate: daysAgo(200),
      propertyType: "GFP",
      classification: "MATERIAL",
      status: "ACTIVE",
      contractNumber: "FA8621-24-C-0001",
      custodialCode: "CAGE-7X9A2",
      location: "GFP-01",
      inventoryItemId: gfpInv.id,
      lastInventoryDate: daysAgo(15),
      auditIntervalDays: 90,
      nextAuditDue: daysFromNow(75),
      condition: "SERVICEABLE",
      dfarsCompliant: true,
      complianceChecks: {
        create: [
          { checkType: "PHYSICAL_INVENTORY", status: "PASS", checkedById: qualityMgr.id, checkedAt: daysAgo(15), notes: "Count verified" },
          { checkType: "UID_VERIFY", status: "PASS", checkedById: qualityMgr.id, checkedAt: daysAgo(15) },
          { checkType: "DOCUMENTATION", status: "PASS", checkedById: qualityMgr.id, notes: "DD Form 1149 on file" },
        ],
      },
      documents: {
        create: [
          {
            docType: "DD1149",
            formNumber: "DD1149-2024-0042",
            fileName: "DD1149_GFP-CON-001.pdf",
            url: "https://example.com/forms/dd1149-gfp-con-001.pdf",
            caption: "Original GFP transfer",
            contractNumber: "FA8621-24-C-0001",
            formDate: daysAgo(200),
            uploadedById: qualityMgr.id,
          },
        ],
      },
      auditRecords: {
        create: [
          {
            scheduledFor: daysFromNow(75),
            status: "SCHEDULED",
          },
        ],
      },
    },
  });

  await prisma.governmentProperty.create({
    data: {
      assetTag: "CAP-2025-0011",
      uid: "D1234ABCDE0987654321",
      serialNumber: "CMM-SN-8841",
      description: "Contractor Acquired CMM Probe Set",
      propertyType: "CAP",
      classification: "EQUIPMENT",
      status: "IN_USE",
      contractNumber: "FA8621-24-C-0001",
      acquisitionCost: 45000,
      acquisitionDate: daysAgo(90),
      location: "QA-01",
      auditIntervalDays: 180,
      nextAuditDue: daysFromNow(90),
      condition: "SERVICEABLE",
      dfarsCompliant: true,
      documents: {
        create: [
          {
            docType: "DD1149",
            formNumber: "DD1149-CAP-0011",
            fileName: "DD1149_CMM_probe.pdf",
            url: "https://example.com/forms/dd1149-cap-0011.pdf",
            contractNumber: "FA8621-24-C-0001",
            formDate: daysAgo(90),
            uploadedById: qualityMgr.id,
          },
        ],
      },
    },
  });

  await prisma.gfpDocument.create({
    data: {
      docType: "DD1149",
      formNumber: "DD1149-MASTER-0001",
      fileName: "Contract_FA8621_master_DD1149.pdf",
      url: "https://example.com/forms/dd1149-master-0001.pdf",
      caption: "Contract-level master DD1149",
      contractNumber: "FA8621-24-C-0001",
      formDate: daysAgo(210),
      uploadedById: qualityMgr.id,
    },
  });

  await prisma.virtualAsset.createMany({
    data: [
      {
        assetTag: "VA-00001",
        name: "SolidWorks Professional",
        description: "CAD seat pool",
        assetType: "LICENSE",
        status: "AVAILABLE",
        vendor: "Dassault",
        seats: 10,
        seatsUsed: 0,
        cost: 4500,
        expiresAt: daysFromNow(200),
      },
      {
        assetTag: "VA-00002",
        name: "Altium Designer",
        description: "ECAD license",
        assetType: "LICENSE",
        status: "AVAILABLE",
        vendor: "Altium",
        seats: 5,
        seatsUsed: 0,
        cost: 7200,
        expiresAt: daysFromNow(120),
      },
      {
        assetTag: "VA-00003",
        name: "IPC-A-610 Training Package",
        description: "Digital training download",
        assetType: "DOWNLOAD",
        status: "AVAILABLE",
        vendor: "IPC",
        cost: 890,
      },
    ],
  });
  console.log("  ✓ Government property + DD1149 + virtual assets");
  void gfp1;

  // ── CM Change Requests ─────────────────────────────────────
  await prisma.changeRequest.create({
    data: {
      number: "ECR-00001",
      title: "Add titanium bracket to ASM-1000",
      description: "Engineering change to incorporate BRK-7700 for vibration improvement",
      type: "BOM",
      status: "REVIEW_BOARD",
      priority: "HIGH",
      requestedById: engLead.id,
      impactAnalysis: "Affects BOM Rev C, WI-ASM-1000 Rev C, work center ASM-01 cycle time +15 min. Supplier: PrecisionMetals for bracket blanks.",
      affectedParts: JSON.stringify(["ASM-1000", "BRK-7700"]),
      bomHeaderId: bomCProto.id,
      workInstructionId: wiDraft.id,
      boardDate: daysFromNow(3),
      boardMembers: {
        create: [
          { userId: cmMgr.id, role: "CHAIR" },
          // No pre-cast votes — every approver gets the same Approve/Reject controls
          { userId: engLead.id, role: "ENGINEERING" },
          { userId: qualityMgr.id, role: "QUALITY" },
          { userId: prodSup.id, role: "PRODUCTION" },
          { userId: buyer.id, role: "PURCHASING" },
        ],
      },
    },
  });

  await prisma.changeRequest.create({
    data: {
      number: "ECR-00002",
      title: "Update torque spec on connector install",
      description: "Align WI step 3 with latest MIL-DTL guidance",
      type: "WORK_INSTRUCTION",
      status: "IMPLEMENTED",
      priority: "NORMAL",
      requestedById: engLead.id,
      workInstructionId: wiAsm.id,
      decidedAt: daysAgo(50),
      decisionNotes: "Approved and released in WI Rev B",
    },
  });
  console.log("  ✓ CM change requests");

  // ── CM number schemes + master registry ────────────────────
  const schemeDefs = [
    { code: "PART", name: "Part number", appliesTo: "PART", prefix: "PN", padLength: 5, nextSequence: 10001, sortOrder: 0 },
    { code: "DRAWING", name: "Drawing", appliesTo: "DOCUMENT", prefix: "DWG", padLength: 4, nextSequence: 1001, sortOrder: 1 },
    { code: "POLICY", name: "Company policy", appliesTo: "DOCUMENT", prefix: "POL", padLength: 3, nextSequence: 10, sortOrder: 2 },
    { code: "FORM", name: "Form", appliesTo: "DOCUMENT", prefix: "FORM", padLength: 4, nextSequence: 100, sortOrder: 3 },
    { code: "TEST", name: "Test / ATP / FAT", appliesTo: "DOCUMENT", prefix: "TP", padLength: 4, nextSequence: 50, sortOrder: 4 },
    { code: "SPEC", name: "Specification", appliesTo: "DOCUMENT", prefix: "SPEC", padLength: 4, nextSequence: 20, sortOrder: 5 },
    { code: "PROCEDURE", name: "Procedure", appliesTo: "DOCUMENT", prefix: "PROC", padLength: 4, nextSequence: 15, sortOrder: 6 },
    { code: "WI", name: "Work instruction", appliesTo: "DOCUMENT", prefix: "WI", padLength: 4, nextSequence: 100, sortOrder: 7 },
    { code: "OTHER", name: "Other document", appliesTo: "DOCUMENT", prefix: "DOC", padLength: 4, nextSequence: 1, sortOrder: 8 },
  ];
  const schemes = await Promise.all(
    schemeDefs.map((s) =>
      prisma.cmNumberScheme.create({
        data: {
          ...s,
          separator: "-",
          example: `${s.prefix}-${String(s.nextSequence).padStart(s.padLength, "0")}`,
          description: `Default ${s.name.toLowerCase()} scheme — edit on CM → Numbers → schemes.`,
          isActive: true,
        },
      })
    )
  );
  const schemeByCode = Object.fromEntries(schemes.map((s) => [s.code, s]));

  // Sample pending request
  await prisma.cmNumberRequest.create({
    data: {
      requestNumber: "NREQ-00001",
      status: "PENDING",
      category: "DRAWING",
      schemeId: schemeByCode["DRAWING"].id,
      title: "EMI gasket install drawing",
      description: "New drawing for GASK-5500 install on housing assembly",
      productName: "Control Module",
      requestedById: engLead.id,
      requestedByName: engLead.name,
    },
  });

  // Assigned request + registry entry
  const assignedReq = await prisma.cmNumberRequest.create({
    data: {
      requestNumber: "NREQ-00002",
      status: "ASSIGNED",
      category: "DRAWING",
      schemeId: schemeByCode["DRAWING"].id,
      title: "Housing machining drawing",
      description: "HSG-3100 machine finish drawing",
      productName: "Control Module",
      assignedNumber: "DWG-1000",
      assignedAt: daysAgo(5),
      assignedById: cmMgr.id,
      requestedById: engLead.id,
      requestedByName: engLead.name,
    },
  });
  await prisma.cmNumberRegistry.create({
    data: {
      number: "DWG-1000",
      category: "DRAWING",
      schemeId: schemeByCode["DRAWING"].id,
      title: "Housing machining drawing",
      description: "HSG-3100 machine finish drawing",
      status: "RESERVED",
      productName: "Control Module",
      sequenceValue: 1000,
      requestId: assignedReq.id,
      requestedById: engLead.id,
      assignedById: cmMgr.id,
      assignedAt: daysAgo(5),
    },
  });

  // Legacy / active part numbers on master list (bootstrap)
  for (const [pn, title] of [
    ["ASM-1000", "Control module top assembly"],
    ["PCB-2200", "Main control PCB"],
    ["HSG-3100", "Aluminum housing"],
  ] as const) {
    await prisma.cmNumberRegistry.create({
      data: {
        number: pn,
        category: "PART",
        schemeId: schemeByCode["PART"].id,
        title,
        status: "ACTIVE",
        partId: part[pn]?.id,
        assignedById: cmMgr.id,
        assignedAt: daysAgo(200),
        notes: "Legacy part registered on master list",
      },
    });
  }

  await prisma.cmNumberRegistry.create({
    data: {
      number: "POL-001",
      category: "POLICY",
      schemeId: schemeByCode["POLICY"].id,
      title: "Document control policy",
      status: "RELEASED",
      assignedById: cmMgr.id,
      assignedAt: daysAgo(120),
      notes: "QMS document control",
    },
  });

  console.log("  ✓ CM number schemes + master registry");

  // ── PLM Products ───────────────────────────────────────────
  const cmFolderControl = await prisma.cmFolder.create({
    data: {
      name: "Control Module",
      kind: "PRODUCT",
      productName: "Control Module",
      productTag: "PRD-0001",
      description: "CM library for Control Module product family",
      sortOrder: 0,
      createdById: cmMgr.id,
    },
  });

  const productControl = await prisma.product.create({
    data: {
      code: "PRD-0001",
      name: "Control Module",
      description: "Ruggedized avionics control module for flight systems",
      overview:
        "The Control Module (ASM-1000 family) is a sealed electronics assembly providing digital I/O, power conditioning, and environmental protection for airborne platforms. Designed for AS9100 production with full configuration control through CM.",
      productFamily: "Avionics",
      productLine: "Control Modules",
      modelNumber: "CM-1000",
      revision: "B",
      lifecyclePhase: "PRODUCTION",
      phaseEnteredAt: daysAgo(60),
      status: "ACTIVE",
      marketSegment: "Defense / Aerospace",
      customerName: "Prime Aerospace",
      productOwnerId: pm.id,
      engineeringLeadId: engLead.id,
      cmOwnerId: cmMgr.id,
      topLevelPartId: part["ASM-1000"].id,
      cmFolderId: cmFolderControl.id,
      targetCost: 12500,
      standardCost: 11800,
      estimatedWeight: 4.2,
      weightUom: "LB",
      targetLeadDays: 45,
      itarControlled: true,
      exportControl: "ITAR",
      qualityStandard: "AS9100",
      conceptDate: daysAgo(400),
      designStartDate: daysAgo(350),
      developmentStartDate: daysAgo(280),
      qualificationStartDate: daysAgo(120),
      firstArticleDate: daysAgo(90),
      productionReleaseDate: daysAgo(60),
      createdById: engLead.id,
      notes: "Primary production product — linked to BOM Rev B certified.",
      lifecycleEvents: {
        create: [
          { fromPhase: null, toPhase: "CONCEPT", notes: "Product initiated", userId: engLead.id, createdAt: daysAgo(400) },
          { fromPhase: "CONCEPT", toPhase: "DESIGN", notes: "PDR complete", userId: engLead.id, createdAt: daysAgo(350) },
          { fromPhase: "DESIGN", toPhase: "DEVELOPMENT", notes: "CDR complete", userId: engLead.id, createdAt: daysAgo(280) },
          { fromPhase: "DEVELOPMENT", toPhase: "QUALIFICATION", notes: "Prototype build complete", userId: qualityMgr.id, createdAt: daysAgo(120) },
          { fromPhase: "QUALIFICATION", toPhase: "PRODUCTION", notes: "FAI accepted; production release", userId: cmMgr.id, createdAt: daysAgo(60) },
        ],
      },
      partLinks: {
        create: [
          { partId: part["ASM-1000"].id, role: "TOP_LEVEL", sortOrder: 0 },
          { partId: part["PCB-2200"].id, role: "MAJOR_ASSEMBLY", sortOrder: 1 },
          { partId: part["HSG-3100"].id, role: "MAJOR_ASSEMBLY", sortOrder: 2 },
          { partId: part["GASK-5500"].id, role: "RELATED", sortOrder: 3 },
        ],
      },
      requirements: {
        create: [
          {
            number: "REQ-001",
            title: "Operating temperature range",
            description: "Operate continuously from -40°C to +85°C ambient",
            category: "ENVIRONMENTAL",
            status: "VERIFIED",
            priority: "CRITICAL",
            source: "Customer SOW §3.2",
            verificationMethod: "TEST",
          },
          {
            number: "REQ-002",
            title: "EMI sealing",
            description: "Maintain EMI containment with gasketed housing interface",
            category: "PERFORMANCE",
            status: "APPROVED",
            priority: "HIGH",
            source: "MIL-STD-461",
            verificationMethod: "TEST",
          },
          {
            number: "REQ-003",
            title: "Configuration control",
            description: "All design artifacts under CM with ECR for changes",
            category: "REGULATORY",
            status: "VERIFIED",
            priority: "HIGH",
            source: "QMS / AS9100",
            verificationMethod: "INSPECTION",
          },
        ],
      },
      variants: {
        create: [
          {
            code: "STD",
            name: "Standard production",
            description: "Baseline certified configuration (BOM Rev B)",
            isDefault: true,
            topLevelPartId: part["ASM-1000"].id,
          },
          {
            code: "PROTO",
            name: "Prototype / development",
            description: "Development builds (BOM Rev C prototype)",
            isDefault: false,
            topLevelPartId: part["ASM-1000"].id,
          },
        ],
      },
      milestones: {
        create: [
          { name: "PDR", kind: "REVIEW", status: "COMPLETE", targetDate: daysAgo(360), actualDate: daysAgo(350), sortOrder: 0 },
          { name: "CDR", kind: "REVIEW", status: "COMPLETE", targetDate: daysAgo(290), actualDate: daysAgo(280), sortOrder: 1 },
          { name: "FAI", kind: "GATE", status: "COMPLETE", targetDate: daysAgo(95), actualDate: daysAgo(90), sortOrder: 2 },
          { name: "Production release", kind: "RELEASE", status: "COMPLETE", targetDate: daysAgo(60), actualDate: daysAgo(60), sortOrder: 3 },
        ],
      },
      documentLinks: {
        create: [
          { docType: "DRAWING", number: "DWG-1000", title: "Housing machining drawing", revision: "A", status: "RESERVED" },
          { docType: "BOM", number: "ASM-1000", title: "Control module BOM", revision: "B", status: "CERTIFIED" },
          { docType: "WI", number: "WI-ASM-1000", title: "Assembly work instruction", revision: "B", status: "RELEASED" },
        ],
      },
      members: {
        create: [
          { userId: qualityMgr.id, role: "QUALITY" },
          { userId: prodSup.id, role: "MANUFACTURING" },
          { userId: buyer.id, role: "SUPPLY_CHAIN" },
        ],
      },
    },
  });

  // Concept-stage product for demo pipeline
  await prisma.product.create({
    data: {
      code: "PRD-0002",
      name: "Next-gen power interface",
      description: "Concept study for modular power interface option",
      overview: "Early concept for a field-replaceable power interface module compatible with CM-1000 envelope.",
      productFamily: "Avionics",
      productLine: "Control Modules",
      modelNumber: "CM-PI-200",
      lifecyclePhase: "CONCEPT",
      status: "ACTIVE",
      productOwnerId: engLead.id,
      engineeringLeadId: engLead.id,
      cmOwnerId: cmMgr.id,
      conceptDate: daysAgo(14),
      itarControlled: true,
      exportControl: "ITAR",
      createdById: engLead.id,
      lifecycleEvents: {
        create: {
          fromPhase: null,
          toPhase: "CONCEPT",
          notes: "Concept kickoff",
          userId: engLead.id,
        },
      },
      requirements: {
        create: {
          number: "REQ-001",
          title: "Drop-in envelope compatibility",
          description: "Fit within existing CM-1000 connector bay without chassis redesign",
          category: "INTERFACE",
          status: "DRAFT",
          priority: "HIGH",
        },
      },
    },
  });

  // Tie primary project to product + roll NRE
  await prisma.project.update({
    where: { id: project.id },
    data: { productId: productControl.id },
  });
  await prisma.projectProduct.create({
    data: {
      projectId: project.id,
      productId: productControl.id,
      role: "PRIMARY",
      syncRequirements: true,
      syncMilestones: true,
      syncCosts: true,
    },
  });
  await prisma.projectCostEntry.updateMany({
    where: { projectId: project.id },
    data: { productId: productControl.id },
  });
  await prisma.product.update({
    where: { id: productControl.id },
    data: {
      developmentBudget: 900000,
      developmentActual: 620000,
    },
  });
  // Sync sample project reqs into product (those not already there)
  for (const preq of [
    {
      number: "PREQ-001",
      title: "Block 5 interface compatibility",
      category: "INTERFACE",
      status: "APPROVED",
      priority: "CRITICAL",
      source: "Project PRJ-AERO-01",
    },
  ]) {
    const exists = await prisma.productRequirement.findUnique({
      where: {
        productId_number: { productId: productControl.id, number: preq.number },
      },
    });
    if (!exists) {
      await prisma.productRequirement.create({
        data: { productId: productControl.id, ...preq },
      });
    }
  }

  // Product sustainment + production→ME issue (MFG_ENG lane)
  await prisma.engTask.create({
    data: {
      productId: productControl.id,
      projectId: null,
      number: "TSK-SUS-001",
      name: "Update BOM spare kit for field support",
      description: "Sustainment: add recommended spares list to BOM notes / kit option",
      kind: "SUSTAINMENT",
      discipline: "MFG_ENG",
      status: "TODO",
      priority: "NORMAL",
      estimatedHours: 8,
      dueDate: daysFromNow(21),
    },
  });
  const pei = await prisma.productionEngIssue.create({
    data: {
      number: "PEI-00001",
      title: "Torque callout unclear on connector install step",
      description:
        "Assemblers asking whether 0.6 N·m is wet or dry torque. WI and drawing appear inconsistent.",
      category: "DOCUMENT",
      status: "OPEN",
      priority: "HIGH",
      reportedByName: "Production floor",
      productId: productControl.id,
      projectId: project.id,
      sourceArea: "STATION",
      workCenter: "ASM-01",
    },
  });
  void pei;
  console.log(`  ✓ PLM products (${productControl.code} + concept) linked to PMO + MFG_ENG`);

  // ── Engineering tickets ────────────────────────────────────
  const sprint = await prisma.sprint.create({
    data: {
      name: "Sprint 24",
      goal: "Complete Rev C prototype package",
      startDate: daysAgo(7),
      endDate: daysFromNow(7),
      status: "ACTIVE",
    },
  });

  await prisma.engineeringTicket.createMany({
    data: [
      { number: "ENG-101", title: "Vibration test plan for bracket", type: "STORY", status: "IN_PROGRESS", priority: "HIGH", assigneeId: engLead.id, createdById: pm.id, sprintId: sprint.id, storyPoints: 5, linkedBomId: bomCProto.id },
      { number: "ENG-102", title: "Update WI for firmware flash step", type: "TASK", status: "IN_REVIEW", priority: "MEDIUM", assigneeId: engLead.id, createdById: engLead.id, sprintId: sprint.id, storyPoints: 3, linkedWiId: wiDraft.id },
      { number: "ENG-103", title: "Supplier CAR follow-up PrecisionMetals", type: "TASK", status: "TODO", priority: "HIGH", assigneeId: buyer.id, createdById: qualityMgr.id, sprintId: sprint.id, storyPoints: 2 },
      { number: "ENG-104", title: "CMM program for HSG sealing face", type: "TASK", status: "BACKLOG", priority: "MEDIUM", assigneeId: tech2.id, createdById: qualityMgr.id, storyPoints: 8 },
      { number: "ENG-105", title: "Bit polarity bug in bootloader", type: "BUG", status: "BLOCKED", priority: "CRITICAL", assigneeId: engLead.id, createdById: engLead.id, sprintId: sprint.id, storyPoints: 5, labels: JSON.stringify(["firmware", "blocker"]) },
      { number: "ENG-106", title: "DFARS property inventory automation", type: "STORY", status: "DONE", priority: "LOW", assigneeId: qualityMgr.id, createdById: admin.id, storyPoints: 3 },
    ],
  });
  console.log("  ✓ Engineering tracker");

  // ── HR ─────────────────────────────────────────────────────
  await prisma.timeEntry.createMany({
    data: [
      { userId: tech1.id, workOrderId: wo1.id, projectId: project.id, date: daysAgo(1), hours: 8, type: "REGULAR", description: "Assembly WO-00001", status: "APPROVED" },
      { userId: tech1.id, workOrderId: wo1.id, projectId: project.id, date: daysAgo(2), hours: 7.5, type: "REGULAR", status: "APPROVED" },
      { userId: tech2.id, workOrderId: woTask.id, date: daysAgo(0), hours: 0.5, type: "REGULAR", description: "5S check", status: "SUBMITTED" },
      { userId: tech2.id, date: daysAgo(1), hours: 8, type: "REGULAR", description: "CNC lot WO-00005", status: "SUBMITTED" },
      { userId: engLead.id, projectId: project.id, date: daysAgo(1), hours: 6, type: "REGULAR", description: "CDR closeout docs", status: "APPROVED" },
    ],
  });

  await prisma.ptoRequest.create({
    data: {
      userId: tech1.id,
      type: "PTO",
      startDate: daysFromNow(14),
      endDate: daysFromNow(18),
      hours: 40,
      status: "PENDING",
      reason: "Family travel",
    },
  });

  await prisma.expenseReport.create({
    data: {
      userId: engLead.id,
      number: "EXP-00001",
      title: "Customer design review travel",
      status: "SUBMITTED",
      totalAmount: 1240,
      submittedAt: daysAgo(2),
      lines: {
        create: [
          { date: daysAgo(10), category: "Airfare", description: "Huntsville roundtrip", amount: 480 },
          { date: daysAgo(9), category: "Hotel", description: "2 nights", amount: 420 },
          { date: daysAgo(9), category: "Meals", description: "Per diem", amount: 180 },
          { date: daysAgo(8), category: "Ground Transport", description: "Rental car", amount: 160 },
        ],
      },
    },
  });

  await prisma.performanceReview.create({
    data: {
      employeeId: tech1.id,
      reviewerId: prodSup.id,
      period: "2026-Q1",
      status: "COMPLETED",
      overallRating: 4.2,
      strengths: "Excellent workmanship, strong IPC skills, reliable sign-offs",
      improvements: "Cross-train on TEST-01 procedures",
      careerNotes: "Ready for Assembler III consideration",
      aiSuggestions: JSON.stringify([
        "Pursue IPC-A-610 CIS certification within 6 months",
        "Shadow environmental test runs on TEST-01",
        "Lead one 5S improvement kaizen this quarter",
      ]),
      completedAt: daysAgo(20),
    },
  });

  await prisma.employeeGoal.createMany({
    data: [
      { userId: tech1.id, title: "Earn Assembler III", category: "CAREER", progress: 60, status: "ACTIVE", targetDate: daysFromNow(90) },
      { userId: tech1.id, title: "Complete IPC-A-610 CIS", category: "CERTIFICATION", progress: 30, status: "ACTIVE", targetDate: daysFromNow(120) },
      { userId: engLead.id, title: "Close Rev C certification", category: "PERFORMANCE", progress: 45, status: "ACTIVE", targetDate: daysFromNow(45) },
    ],
  });
  // ── Org chart (manager assignments) ───────────────────────
  const orgChart: [string, string | null][] = [
    [ceo.id, null],
    [cfo.id, ceo.id],
    [admin.id, ceo.id],
    [engLead.id, ceo.id],
    [qualityMgr.id, ceo.id],
    [hrMgr.id, ceo.id],
    [pm.id, ceo.id],
    [controller.id, cfo.id],
    [cmMgr.id, engLead.id],
    [prodSup.id, admin.id],
    [buyer.id, admin.id],
    [tech1.id, prodSup.id],
    [tech2.id, prodSup.id],
    [inspector.id, qualityMgr.id],
  ];
  for (const [userId, managerId] of orgChart) {
    await prisma.user.update({ where: { id: userId }, data: { managerId } });
  }

  // ── Employee documents ─────────────────────────────────────
  await prisma.employeeDocument.createMany({
    data: [
      { userId: tech1.id, title: "Offer letter", kind: "OFFER_LETTER", note: "Assembler II, signed" },
      { userId: tech1.id, title: "IPC-A-610 certificate", kind: "CERTIFICATION", note: "Expires 2027-06-01" },
      { userId: tech1.id, title: "Employee handbook acknowledgment", kind: "POLICY_ACK" },
      { userId: tech2.id, title: "Offer letter", kind: "OFFER_LETTER", note: "Machinist, signed" },
      { userId: tech2.id, title: "CMM operator training record", kind: "TRAINING" },
      { userId: inspector.id, title: "GD&T Level II certificate", kind: "CERTIFICATION", note: "Expires 2027-06-01" },
      { userId: engLead.id, title: "Employee handbook acknowledgment", kind: "POLICY_ACK" },
      { userId: prodSup.id, title: "Leadership training completion", kind: "TRAINING" },
    ],
  });

  // ── Training records (with attachable evidence) ────────────
  await prisma.trainingRecord.createMany({
    data: [
      {
        userId: tech1.id, name: "IPC-A-610 Class 3 Acceptance", type: "CERTIFICATION",
        provider: "IPC EDGE", status: "COMPLETED", completedAt: daysAgo(200), expiresAt: daysFromNow(530),
        attachments: JSON.stringify([{ name: "IPC-A-610 certificate.pdf", url: "https://files.example/ipc-610-tech1.pdf" }]),
        createdById: hrMgr.id,
      },
      {
        userId: tech1.id, name: "ESD awareness refresher", type: "COMPLIANCE",
        status: "COMPLETED", completedAt: daysAgo(30), expiresAt: daysFromNow(335),
        createdById: hrMgr.id,
      },
      {
        userId: tech1.id, name: "Forklift operator", type: "SAFETY",
        status: "EXPIRED", completedAt: daysAgo(1200), expiresAt: daysAgo(105),
        notes: "Renewal needed before next warehouse rotation",
        createdById: prodSup.id,
      },
      {
        userId: tech2.id, name: "CMM operator level 1", type: "COURSE",
        provider: "Hexagon", status: "COMPLETED", completedAt: daysAgo(400),
        attachments: JSON.stringify([{ name: "CMM-L1 completion.pdf", url: "https://files.example/cmm-l1-tech2.pdf" }]),
        createdById: hrMgr.id,
      },
      {
        userId: tech2.id, name: "5-axis programming fundamentals", type: "COURSE",
        provider: "Mastercam U", status: "IN_PROGRESS",
        createdById: prodSup.id,
      },
      {
        userId: inspector.id, name: "GD&T Level II", type: "CERTIFICATION",
        status: "COMPLETED", completedAt: daysAgo(300), expiresAt: daysFromNow(430),
        attachments: JSON.stringify([{ name: "GDT-II certificate.pdf", url: "https://files.example/gdt2-inspector.pdf" }]),
        createdById: hrMgr.id,
      },
    ],
  });

  // ── Recurring training cycles (compliance matrix drives HR alerts) ──
  await prisma.trainingRequirement.createMany({
    data: [
      {
        name: "Forklift operator", type: "SAFETY", frequencyMonths: 12,
        department: "Assembly",
        description: "Annual forklift certification for warehouse rotations",
        createdById: hrMgr.id,
      },
      {
        name: "ESD awareness refresher", type: "COMPLIANCE", frequencyMonths: 12,
        department: "Assembly",
        description: "Annual ESD handling refresher for electronics benches",
        createdById: hrMgr.id,
      },
      {
        name: "Annual safety training", type: "SAFETY", frequencyMonths: 12,
        description: "Company-wide OSHA general awareness",
        createdById: hrMgr.id,
      },
    ],
  });

  // ── Goal check-ins + continuous feedback ───────────────────
  const assemblerGoal = await prisma.employeeGoal.findFirst({
    where: { userId: tech1.id, title: "Earn Assembler III" },
  });
  if (assemblerGoal) {
    await prisma.employeeGoal.update({
      where: { id: assemblerGoal.id },
      data: { alignedTo: "Grow bench strength for Block 5 ramp" },
    });
    await prisma.goalCheckIn.createMany({
      data: [
        { goalId: assemblerGoal.id, authorId: tech1.id, progress: 25, note: "Completed soldering module; scheduling harness practical", createdAt: daysAgo(60) },
        { goalId: assemblerGoal.id, authorId: prodSup.id, progress: 45, note: "Practical passed first try — pair with Dana on cable prep next", createdAt: daysAgo(30) },
        { goalId: assemblerGoal.id, authorId: tech1.id, progress: 60, note: "Cable prep signed off; written exam left", createdAt: daysAgo(7) },
      ],
    });
  }
  await prisma.feedbackNote.createMany({
    data: [
      { aboutUserId: tech1.id, authorId: prodSup.id, kind: "PRAISE", body: "Caught a reversed connector on SWO-00002 before pot & cure — saved a rework loop.", createdAt: daysAgo(12) },
      { aboutUserId: tech1.id, authorId: qualityMgr.id, kind: "PRAISE", body: "Torque log discipline is the best on the floor. Zero findings in the last audit.", createdAt: daysAgo(40) },
      { aboutUserId: tech2.id, authorId: prodSup.id, kind: "COACHING", body: "Setup sheets need photos of the fixture state — next machinist can't reproduce from notes alone.", createdAt: daysAgo(9) },
      { aboutUserId: tech2.id, authorId: prodSup.id, kind: "NOTE", visibility: "MANAGER_ONLY", body: "Discussed lead-machinist track; revisit after Q3 review.", createdAt: daysAgo(5) },
    ],
  });

  // ── Upcoming / in-flight reviews (self-assessment window open) ──
  const reviewQs = JSON.stringify([
    "How well did you meet your goals this period?",
    "What accomplishment are you most proud of?",
    "Where do you need more support or training?",
    "How would you rate your collaboration with the team?",
    "What should your goals be for the next period?",
  ]);
  await prisma.performanceReview.create({
    data: {
      employeeId: tech1.id,
      reviewerId: prodSup.id,
      period: "2026-Q3",
      status: "SELF_REVIEW",
      dueDate: daysFromNow(25),
      questions: reviewQs,
    },
  });
  await prisma.performanceReview.create({
    data: {
      employeeId: tech2.id,
      reviewerId: prodSup.id,
      period: "2026-Q2",
      status: "AWAITING_SIGNOFF",
      dueDate: daysFromNow(10),
      questions: reviewQs,
      selfRatings: JSON.stringify([
        { question: "How well did you meet your goals this period?", rating: 4, comment: "Hit setup time targets" },
        { question: "What accomplishment are you most proud of?", rating: 5, comment: "First-pass yield on housing lot" },
        { question: "Where do you need more support or training?", rating: 3, comment: "5-axis programming" },
        { question: "How would you rate your collaboration with the team?", rating: 4 },
        { question: "What should your goals be for the next period?", rating: 4, comment: "Lead a junior machinist" },
      ]),
      selfSubmittedAt: daysAgo(5),
      overallRating: 4.1,
      strengths: "Strong CNC setup times; quality-first mindset",
      improvements: "Document setup sheets more thoroughly",
      careerNotes: "Candidate for lead machinist track",
    },
  });

  // A second pending PTO + goal for the manager demo queue
  await prisma.ptoRequest.create({
    data: {
      userId: tech2.id,
      type: "SICK",
      startDate: daysFromNow(2),
      endDate: daysFromNow(2),
      hours: 8,
      status: "PENDING",
      reason: "Medical appointment",
    },
  });
  await prisma.employeeGoal.createMany({
    data: [
      { userId: tech2.id, title: "CNC probe macro library", category: "SKILL", progress: 20, status: "ACTIVE", targetDate: daysFromNow(75) },
    ],
  });

  // ── Payroll policy + a submitted timesheet for the approvals demo ──
  await prisma.payrollPolicy.create({
    data: {
      id: "default",
      timesheetFrequency: "WEEKLY",
      weekStartsOn: 1,
      ptoAccrualHoursPerPeriod: 4,
      sickHoursPerYear: 40,
      holidays: JSON.stringify([
        { date: "2026-07-03", name: "Independence Day (observed)" },
        { date: "2026-09-07", name: "Labor Day" },
        { date: "2026-11-26", name: "Thanksgiving" },
        { date: "2026-11-27", name: "Day after Thanksgiving" },
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2027-01-01", name: "New Year's Day" },
      ]),
    },
  });
  await prisma.reviewPolicy.create({
    data: {
      id: "default",
      frequencyMonths: 12,
      selfReviewLeadDays: 30,
      questions: JSON.stringify([
        "How well did you meet your goals this period?",
        "What accomplishment are you most proud of?",
        "Where do you need more support or training?",
        "How would you rate your collaboration with the team?",
        "What should your goals be for the next period?",
      ]),
    },
  });
  await prisma.accountingSettings.create({
    data: { id: "default", basis: "ACCRUAL", fiscalYearStartMonth: 1 },
  });
  await prisma.companySettings.create({
    data: {
      id: "default",
      name: "ForgeRP",
      tagline: "Manufacturing",
      departments: JSON.stringify([
        "Production", "Manufacturing", "Assembly", "Machining",
        "Engineering", "Quality", "Supply Chain", "Programs",
        "Finance", "Human Resources", "Operations", "Executive",
        "Configuration Management",
      ]),
      // Government Property module is off by default until ITAR-compliant
      // hosting ships (self-host / Enterprise upgrade).
      disabledModules: JSON.stringify(["government"]),
      // Demo instance runs as a live Business account (never trial-gated)
      plan: "BUSINESS",
      subscriptionStatus: "ACTIVE",
      currentPeriodEnd: new Date(Date.now() + 365 * 86_400_000),
      // Kitting stages picked kits at this location (matches STAGE-01 above)
      kittingLocation: "STAGE-01",
      // Default company breaks — power the header break/lunch countdown
      breaksConfig: JSON.stringify([
        { name: "Morning break", minutes: 15 },
        { name: "Lunch", minutes: 30 },
        { name: "Afternoon break", minutes: 15 },
      ]),
      // Left false so the dashboard invites new companies into the wizard
      setupCompleted: false,
    },
  });

  // Dana Kim's current-week timesheet, submitted for approval
  {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const back = (day.getDay() - 1 + 7) % 7; // Monday start
    const periodStart = new Date(day.getTime() - back * 86_400_000);
    const periodEnd = new Date(periodStart.getTime() + 6 * 86_400_000);
    const sheet = await prisma.timesheet.create({
      data: {
        userId: tech2.id,
        periodStart,
        periodEnd,
        status: "SUBMITTED",
        submittedAt: now,
      },
    });
    await prisma.timeEntry.updateMany({
      where: { userId: tech2.id, status: "SUBMITTED" },
      data: { timesheetId: sheet.id },
    });
    // Routed approval bucket: Dana's entries are direct charges, so the
    // department manager (her supervisor) approves them.
    const danaHours = await prisma.timeEntry.aggregate({
      where: { timesheetId: sheet.id },
      _sum: { hours: true },
    });
    await prisma.timesheetApproval.create({
      data: {
        timesheetId: sheet.id,
        category: "DIRECT",
        refId: tech2.department || "Machining",
        label: `${tech2.department || "Machining"} direct charges`,
        hours: danaHours._sum.hours || 0,
        approverId: prodSup.id,
      },
    });
  }

  console.log("  ✓ HR data (org chart, documents, reviews, timesheets)");

  // ── Budgets (enacted charge-code budgets) ──────────────────
  const budgetOwnerId =
    (await prisma.user.findFirst({
      where: { role: { in: ["ADMIN", "ACCOUNTING", "HR"] }, isActive: true },
      select: { id: true },
    }))?.id || null;
  await prisma.budget.createMany({
    data: [
      {
        number: "BDGT-00001",
        name: "Production Materials (sample)",
        sourceType: "STANDALONE",
        costClass: "INDIRECT",
        status: "ENACTED",
        chargeCode: "IND-BDGT-00001",
        ownerId: budgetOwnerId,
        totalAmount: 1500000,
        materialBudget: 1500000,
        laborHoursBudget: 0,
        actualMaterial: 620000,
        actualTotal: 620000,
        enactedAt: new Date(),
      },
      {
        number: "BDGT-00002",
        name: "Engineering Labor (sample)",
        sourceType: "STANDALONE",
        costClass: "INDIRECT",
        status: "ENACTED",
        chargeCode: "IND-BDGT-00002",
        ownerId: budgetOwnerId,
        totalAmount: 900000,
        laborBudget: 900000,
        laborHoursBudget: 12000,
        actualLabor: 410000,
        actualLaborHours: 5500,
        actualTotal: 410000,
        enactedAt: new Date(),
      },
      {
        number: "BDGT-00003",
        name: "Quality Ops (sample)",
        sourceType: "STANDALONE",
        costClass: "INDIRECT",
        status: "ENACTED",
        chargeCode: "IND-BDGT-00003",
        ownerId: budgetOwnerId,
        totalAmount: 350000,
        otherBudget: 350000,
        actualOther: 148000,
        actualTotal: 148000,
        enactedAt: new Date(),
      },
    ],
  });

  // ── Value stream snapshot metrics ──────────────────────────
  await prisma.valueStreamMetric.createMany({
    data: [
      { stage: "SUPPLIER", metricKey: "avg_otd", metricValue: 88.9, unit: "%" },
      { stage: "PO", metricKey: "open_count", metricValue: 3, unit: "" },
      { stage: "RECEIVING", metricKey: "pending", metricValue: 2, unit: "" },
      { stage: "INSPECTION", metricKey: "open", metricValue: 0, unit: "" },
      { stage: "MRB", metricKey: "open_cases", metricValue: 1, unit: "" },
      { stage: "INVENTORY", metricKey: "raw_value", metricValue: 420000, unit: "$" },
      { stage: "PRODUCTION", metricKey: "active_wos", metricValue: 5, unit: "" },
      { stage: "SHIPPING", metricKey: "queue", metricValue: 1, unit: "" },
    ],
  });

  // Audit samples
  await prisma.auditLog.createMany({
    data: [
      { entityType: "BomHeader", entityId: bomB.id, action: "CERTIFIED", userId: cmMgr.id, changes: JSON.stringify({ revision: "B", status: "CERTIFIED" }) },
      { entityType: "PurchaseOrder", entityId: po1.id, action: "RECEIVED", userId: inspector.id, metadata: JSON.stringify({ receipt: rcv1.number }) },
      { entityType: "MrbCase", entityId: mrb1.id, action: "CREATED", userId: inspector.id },
      { entityType: "WorkOrder", entityId: wo1.id, action: "STATUS_CHANGE", userId: tech1.id, changes: JSON.stringify({ from: "RELEASED", to: "IN_PROGRESS" }) },
      { entityType: "WorkOrderStep", entityId: wo1.id, action: "SIGN_OFF", userId: tech1.id, metadata: JSON.stringify({ step: 1 }) },
    ],
  });

  // ── Test procedures (CM-controlled) — parts exist by now ───
  const acmPart = await prisma.part.findFirst({ where: { partNumber: { contains: "ASM-1000" } } });
  await prisma.testProcedure.create({
    data: {
      number: "TP-00001",
      revision: "A",
      title: "Avionics Control Module — Acceptance Test (ATP)",
      category: "ATP",
      status: "RELEASED",
      isLocked: true,
      releasedAt: daysAgo(30),
      partId: acmPart?.id,
      equipment: "ATE Station 2, 28VDC supply, DMM (Fluke 87V)",
      purpose: "Verify ACM meets electrical acceptance criteria before ship.",
      acceptanceCriteria: "All parameters within spec; no anomalies.",
      steps: {
        create: [
          { stepNumber: 1, parameter: "Idle current draw", method: "DMM in series, 28VDC applied", spec: "≤ 250 mA", minValue: 0, maxValue: 250, units: "mA", sortOrder: 0 },
          { stepNumber: 2, parameter: "Output voltage — CH1", method: "DMM at J3-4 ref J3-1", spec: "5.0 ±0.1 V", minValue: 4.9, maxValue: 5.1, units: "VDC", sortOrder: 1 },
          { stepNumber: 3, parameter: "Bus comm BIT", method: "Run built-in test, read status", spec: "PASS", sortOrder: 2 },
        ],
      },
    },
  });
  const conPart = await prisma.part.findFirst({ where: { partNumber: { contains: "CON-4400" } } });
  if (conPart) {
    const funcTp = await prisma.testProcedure.create({
      data: {
        number: "TP-00002",
        revision: "A",
        title: "Circular Connector — Incoming Functional Check",
        category: "FUNCTIONAL",
        status: "RELEASED",
        isLocked: true,
        releasedAt: daysAgo(20),
        partId: conPart.id,
        equipment: "Continuity tester, pin gauge",
        steps: {
          create: [
            { stepNumber: 1, parameter: "Pin continuity (all)", method: "Continuity tester pin-to-pin", spec: "< 1 Ω", minValue: 0, maxValue: 1, units: "Ω", sortOrder: 0 },
            { stepNumber: 2, parameter: "Insertion force", method: "Mate with gauge, measure", spec: "≤ 5 lbf", minValue: 0, maxValue: 5, units: "lbf", sortOrder: 1 },
          ],
        },
      },
    });
    await prisma.part.update({
      where: { id: conPart.id },
      data: { requiresFunctionalTest: true, functionalTestProcedureId: funcTp.id },
    });
  }
  console.log("  ✓ test procedures (ATP + functional)");

  // ── Requirements (JAMA-style) traced into the engineering boards ──
  {
    const tsk2 = await prisma.engTask.findUnique({ where: { number: "TSK-0002" } });
    const sagaSysRow = await prisma.saga.findFirst({ where: { discipline: "SYSTEMS" } });
    const atpTp = await prisma.testProcedure.findFirst({ where: { number: "TP-00001" } });
    const prod = await prisma.product.findFirst();

    const reqSys = await prisma.requirement.create({
      data: {
        number: "REQ-00001",
        title: "Operating temperature range",
        statement: "The assembly shall operate continuously from -40 °C to +71 °C without performance degradation.",
        rationale: "Contract environmental spec (MIL-STD-810H tailored)",
        category: "ENVIRONMENTAL",
        status: "APPROVED",
        priority: "CRITICAL",
        verificationMethod: "TEST",
        source: "Customer SOW §3.2.1",
        productId: prod?.id,
        testProcedureId: atpTp?.id,
        createdById: engLead.id,
      },
    });
    const reqChild = await prisma.requirement.create({
      data: {
        number: "REQ-00002",
        title: "Thermal analysis load cases",
        statement: "Thermal FEA shall demonstrate ≥ 10 °C margin at the hottest component under worst-case ambient.",
        category: "PERFORMANCE",
        status: "VERIFIED",
        verificationMethod: "ANALYSIS",
        parentId: reqSys.id,
        productId: prod?.id,
        verifiedAt: daysAgo(12),
        createdById: engLead.id,
      },
    });
    await prisma.requirement.create({
      data: {
        number: "REQ-00003",
        title: "Housing sealing",
        statement: "The housing shall maintain IP67 sealing after 500 mate/demate cycles.",
        category: "FUNCTIONAL",
        status: "DRAFT",
        priority: "HIGH",
        source: "Internal derived",
        productId: prod?.id,
        createdById: engLead.id,
      },
    });
    if (sagaSysRow) {
      await prisma.requirementTrace.create({
        data: { requirementId: reqSys.id, sagaId: sagaSysRow.id, createdById: engLead.id },
      });
      await prisma.requirementTrace.create({
        data: { requirementId: reqChild.id, sagaId: sagaSysRow.id, createdById: engLead.id },
      });
    }
    if (tsk2) {
      await prisma.requirementTrace.create({
        data: { requirementId: reqSys.id, engTaskId: tsk2.id, createdById: engLead.id },
      });
    }
    console.log("  ✓ requirements (traced to eng board)");
  }

  // ── Retain CM master copies for released work instructions ─────────
  {
    const releasedWis = await prisma.workInstruction.findMany({
      where: { status: "RELEASED" },
      include: { part: { select: { partNumber: true } }, _count: { select: { steps: true } } },
    });
    if (releasedWis.length > 0) {
      // Ensure Admin → Work Instructions folder
      let admin = await prisma.cmFolder.findFirst({
        where: { kind: "ADMIN", parentId: null },
      });
      if (!admin) {
        admin = await prisma.cmFolder.create({
          data: {
            name: "Admin",
            kind: "ADMIN",
            isSystem: true,
            description: "Company internal documents, policies, and QMS records",
            sortOrder: -1,
          },
        });
      }
      let wiFolder = await prisma.cmFolder.findFirst({
        where: { parentId: admin.id, name: "Work Instructions" },
      });
      if (!wiFolder) {
        wiFolder = await prisma.cmFolder.create({
          data: {
            name: "Work Instructions",
            parentId: admin.id,
            kind: "ADMIN",
            isSystem: true,
            description: "Released work instruction master copies (CM controlled)",
            sortOrder: 5,
          },
        });
      }
      for (const wi of releasedWis) {
        const exists = await prisma.cmDocument.findFirst({
          where: { docType: "WI", workInstructionId: wi.id },
        });
        if (exists) continue;
        await prisma.cmDocument.create({
          data: {
            folderId: wiFolder.id,
            docType: "WI",
            number: wi.documentNumber,
            title: wi.title,
            revision: wi.revision,
            status: "RELEASED",
            description: `Work instruction master — ${wi._count.steps} step${
              wi._count.steps === 1 ? "" : "s"
            }${wi.part ? ` · part ${wi.part.partNumber}` : ""}. Controlled copy; edit via new revision only.`,
            fileUrl: `/work-instructions/${wi.id}?cm=1`,
            fileName: `${wi.documentNumber} Rev ${wi.revision}`,
            productTag: wi.part?.partNumber || null,
            partId: wi.partId || null,
            bomHeaderId: wi.bomHeaderId || null,
            workInstructionId: wi.id,
          },
        });
      }
      console.log("  ✓ CM master copies for released work instructions");
    }
  }

  console.log("✅ ForgeRP seed complete — all modules linked.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
