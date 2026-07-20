/**
 * ForgeRP PRODUCTION seed — configuration essentials only, no demo content.
 *
 * Loads the reference/config data the app needs to be usable on day one
 * without shipping any fake company data:
 *   • Permission catalog + assignable groups (no user links)
 *   • Purchase-request approval pipeline (routed, role-based)
 *   • Chart of accounts with ZERO opening balances
 *   • Unit-of-measure master + common conversions
 *   • Default company / accounting / payroll settings
 *
 * No users are created — the first admin claims the instance from the
 * login screen ("First boot — claim this instance"). No parts, suppliers,
 * customers, work orders, inventory, or journal history: the company
 * enters its own.
 *
 * Run:  npm run db:seed:prod   (or SEED_ON_FIRST_BOOT=prod in Docker)
 *
 * Idempotent: wipes the same tables as the demo seed first, so it is safe
 * to re-run and safe to point at a database that had the demo seed loaded.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "prisma", "dev.db");
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🏭 Seeding ForgeRP (production essentials)...");

  // Wipe in dependency order so this is safe to re-run or to run over a
  // database that previously held the demo dataset.
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
    "RecurringJournal", "JournalLine", "JournalEntry", "Account",
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
    "Approval", "ApprovalPolicyStep", "ApprovalPolicy",
    "AuditLog", "WorkCenter", "ValueStreamMetric", "User",
  ];
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of tables) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {
      /* table may not exist yet */
    }
  }
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");

  // ── Permission catalog + assignable groups (no user links) ─────
  // ADMIN implicitly holds every permission and each role carries sane
  // action defaults, so these rows exist to populate the Admin →
  // Permissions UI with a starting catalog and ready-to-assign groups.
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
    permRows.push(await prisma.permission.create({ data: p }));
  }
  const permByCode = Object.fromEntries(permRows.map((p) => [p.code, p]));

  const grpPm = await prisma.permissionGroup.create({
    data: { code: "GRP_PM", name: "Project Managers", baseRole: "PM", description: "PMO + dependency alerts" },
  });
  const grpExec = await prisma.permissionGroup.create({
    data: { code: "GRP_EXEC", name: "Senior Leadership", baseRole: "EXECUTIVE", description: "CEO/CFO/VP priorities" },
  });
  const grpAcct = await prisma.permissionGroup.create({
    data: { code: "GRP_ACCT", name: "Accounting", baseRole: "ACCOUNTING" },
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
    "pmo.alerts.read", "pmo.project.manage", "pmo.quarter.manage",
    "leadership.priority.read", "engineering.task.create",
  ]);
  await linkGroup(grpExec.id, [
    "leadership.priority.manage", "leadership.priority.read",
    "accounting.reports.read", "pmo.alerts.read",
  ]);
  await linkGroup(grpAcct.id, ["accounting.journal.post", "accounting.reports.read"]);
  console.log("  ✓ permission catalog + 3 assignable groups");

  // ── PR approval pipeline (routed, role-based) ──────────────────
  // Charge/budget owner confirms demand → purchasing packages the PR →
  // same owner approves to purchase → company $ thresholds. Steps route
  // by role; the app resolves the actual approver at runtime, so no user
  // reference is baked into the seed.
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
          { stepOrder: 5, name: "Finance / controller", minAmount: 25000, routingKey: "ROLE", approverRole: "ACCOUNTING" },
        ],
      },
    },
  });
  console.log("  ✓ PR approval pipeline");

  // ── Chart of Accounts — ZERO opening balances ──────────────────
  // A standard small-manufacturer chart. Balances start at 0; the company
  // records its own opening balances as a journal entry, and every account
  // is editable / extendable from Accounting → Chart of Accounts.
  const accounts = [
    { code: "1000", name: "Cash", type: "ASSET" },
    { code: "1100", name: "Accounts Receivable", type: "ASSET" },
    { code: "1200", name: "Inventory - Raw Materials", type: "ASSET" },
    { code: "1210", name: "Inventory - WIP", type: "ASSET" },
    { code: "1220", name: "Inventory - Finished Goods", type: "ASSET" },
    { code: "1500", name: "Equipment", type: "ASSET", subtype: "FIXED" },
    { code: "1510", name: "Accumulated Depreciation", type: "ASSET", subtype: "FIXED" },
    { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
    { code: "2050", name: "Credit Card Payable", type: "LIABILITY" },
    { code: "2100", name: "Accrued Expenses", type: "LIABILITY" },
    { code: "2110", name: "Wages Payable", type: "LIABILITY" },
    { code: "2200", name: "Federal Withholding Payable", type: "LIABILITY" },
    { code: "2210", name: "State Withholding Payable", type: "LIABILITY" },
    { code: "2220", name: "FICA Payable", type: "LIABILITY" },
    { code: "3000", name: "Retained Earnings", type: "EQUITY" },
    { code: "3100", name: "Common Stock & Paid-in Capital", type: "EQUITY" },
    { code: "4000", name: "Sales Revenue", type: "REVENUE" },
    { code: "5000", name: "Cost of Goods Sold", type: "COGS" },
    { code: "6000", name: "Salaries & Wages", type: "EXPENSE" },
    { code: "6010", name: "Payroll Tax Expense", type: "EXPENSE" },
    { code: "6100", name: "Facilities", type: "EXPENSE" },
    { code: "6200", name: "Materials Variance", type: "EXPENSE" },
  ];
  for (const a of accounts) {
    await prisma.account.create({ data: { ...a, balance: 0 } });
  }
  console.log(`  ✓ ${accounts.length} GL accounts (zero opening balances)`);

  // ── UOM master + conversions ───────────────────────────────────
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
      data: { fromUomId: uom[from].id, toUomId: uom[to].id, factor, notes },
    });
    await prisma.uomConversion.create({
      data: { fromUomId: uom[to].id, toUomId: uom[from].id, factor: 1 / factor, notes: `Inverse of: ${notes}` },
    });
  }
  console.log(`  ✓ ${uoms.length} UOM units + ${convPairs.length * 2} conversions`);

  // ── Default settings (rename Company from Admin → Company Settings) ──
  await prisma.companySettings.create({
    data: { id: "default", name: "Your Company", tagline: "Manufacturing", setupCompleted: false },
  });
  await prisma.accountingSettings.create({
    data: { id: "default", basis: "ACCRUAL", fiscalYearStartMonth: 1 },
  });
  await prisma.payrollPolicy.create({ data: { id: "default" } });
  console.log("  ✓ default company / accounting / payroll settings");

  console.log("✅ Production seed complete — claim the instance to create your admin.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
