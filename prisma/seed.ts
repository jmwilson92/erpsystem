/**
 * ForgeERP rich seed data — demonstrates all integrated manufacturing flows.
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
  console.log("🔥 Seeding ForgeERP...");

  // Wipe in dependency order (SQLite)
  const tables = [
    "TicketComment", "EngineeringTicket", "Sprint",
    "EmployeeGoal", "PerformanceReview", "ExpenseLine", "ExpenseReport", "PtoRequest", "TimeEntry",
    "ComplianceCheck", "GovernmentProperty",
    "TraceEvent", "ReceivingPhoto", "KitOrderLine", "KitOrder",
    "ShipmentLine", "Shipment", "SalesOrderLine", "SalesOrder",
    "QuoteLine", "Quote",
    "Budget", "ApPayment", "ApInvoice", "ArPayment", "ArInvoiceLine", "ArInvoice", "Customer",
    "JournalLine", "JournalEntry", "Account",
    "Rfq", "ReceivingTraveler", "ReceiptLine", "Receipt", "PurchaseOrderLine", "PurchaseOrder",
    "PurchaseRequestLine", "PurchaseRequest",
    "SupplierScorecardHistory", "Supplier",
    "SerialNumber", "Lot", "MaterialTransaction", "InventoryItem", "Location", "Warehouse",
    "MrbDisposition", "MrbCase", "NonConformance", "InspectionResult", "Inspection",
    "ProjectMember", "ProjectIssue", "ProjectRisk", "Milestone", "ProjectTask", "WbsElement", "Project",
    "CmBoardMember", "ChangeRequest",
    "WorkOrderStatusHistory", "WorkOrderStepCompletion", "WorkOrderInstruction", "WorkOrder",
    "WorkInstructionSignOff", "WorkInstructionStep", "WorkInstruction",
    "BomLine", "BomHeader", "Part",
    "Approval", "AuditLog", "WorkCenter", "ValueStreamMetric", "User",
  ];
  for (const t of tables) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {
      /* table may not exist yet */
    }
  }

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
      { email: "pm@forge.erp", name: "Quinn Foster", role: "ENGINEERING", department: "Programs", title: "Program Manager" },
    ].map((u) =>
      prisma.user.create({
        data: {
          ...u,
          certifications: JSON.stringify([
            { name: "Security Clearance", expires: "2027-06-01" },
            { name: "ESD Awareness", expires: "2026-12-01" },
          ]),
        },
      })
    )
  );
  const [admin, engLead, cmMgr, qualityMgr, buyer, prodSup, controller, hrMgr, tech1, tech2, inspector, pm] = users;
  console.log(`  ✓ ${users.length} users`);

  // ── Work Centers ───────────────────────────────────────────
  const workCenters = await Promise.all(
    [
      { code: "ASM-01", name: "Assembly Cell 1", department: "Assembly", capacityHoursPerDay: 16 },
      { code: "ASM-02", name: "Assembly Cell 2", department: "Assembly", capacityHoursPerDay: 16 },
      { code: "MCH-01", name: "CNC Mill", department: "Machining", capacityHoursPerDay: 20 },
      { code: "QA-01", name: "Inspection Lab", department: "Quality", capacityHoursPerDay: 16 },
      { code: "TEST-01", name: "Environmental Test", department: "Test", capacityHoursPerDay: 8 },
      { code: "SHIP-01", name: "Shipping Dock", department: "Logistics", capacityHoursPerDay: 16 },
    ].map((w) => prisma.workCenter.create({ data: w }))
  );
  console.log(`  ✓ ${workCenters.length} work centers`);

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
      { code: "2100", name: "Accrued Expenses", type: "LIABILITY", balance: 45000 },
      { code: "3000", name: "Retained Earnings", type: "EQUITY", balance: 2100000 },
      { code: "4000", name: "Sales Revenue", type: "REVENUE", balance: 3200000 },
      { code: "5000", name: "Cost of Goods Sold", type: "COGS", balance: 1850000 },
      { code: "6000", name: "Salaries & Wages", type: "EXPENSE", balance: 980000 },
      { code: "6100", name: "Facilities", type: "EXPENSE", balance: 240000 },
      { code: "6200", name: "Materials Variance", type: "EXPENSE", balance: 12000 },
    ].map((a) => prisma.account.create({ data: a }))
  );
  console.log(`  ✓ ${accounts.length} GL accounts`);

  // ── Parts ──────────────────────────────────────────────────
  const partsData = [
    { partNumber: "ASM-1000", description: "Avionics Control Module Assembly", revision: "C", partType: "ASSEMBLY", standardCost: 12500, isSerialized: true },
    { partNumber: "PCB-2200", description: "Main Control PCB", revision: "B", partType: "MAKE", standardCost: 850, isLotControlled: true },
    { partNumber: "HSG-3100", description: "Aluminum Housing CNC", revision: "A", partType: "MAKE", standardCost: 420, isSerialized: true },
    { partNumber: "CON-4400", description: "MIL-DTL Circular Connector", revision: "A", partType: "BUY", standardCost: 185, leadTimeDays: 45 },
    { partNumber: "RES-0805-10K", description: "Resistor 10K 0805 1%", revision: "A", partType: "BUY", standardCost: 0.12, leadTimeDays: 14, isLotControlled: true },
    { partNumber: "IC-STM32", description: "STM32H7 MCU", revision: "A", partType: "BUY", standardCost: 18.5, leadTimeDays: 21, isLotControlled: true },
    { partNumber: "SCR-M3-10", description: "Screw M3x10 SS", revision: "A", partType: "BUY", standardCost: 0.08, leadTimeDays: 7 },
    { partNumber: "GASK-5500", description: "EMI Gasket", revision: "B", partType: "BUY", standardCost: 24, leadTimeDays: 30 },
    { partNumber: "CBL-6600", description: "Harness Assembly Interface", revision: "A", partType: "MAKE", standardCost: 320 },
    { partNumber: "BRK-7700", description: "Mounting Bracket Ti-6Al-4V", revision: "A", partType: "MAKE", standardCost: 890, isSerialized: true },
    { partNumber: "FW-1000", description: "Firmware Image ACM", revision: "C", partType: "PHANTOM", standardCost: 0 },
    { partNumber: "FAI-PROTO", description: "First Article Prototype Kit", revision: "A", partType: "ASSEMBLY", standardCost: 15000, isSerialized: true },
  ];
  const parts = await Promise.all(partsData.map((p) => prisma.part.create({ data: p })));
  const part = Object.fromEntries(parts.map((p) => [p.partNumber, p]));
  console.log(`  ✓ ${parts.length} parts`);

  // ── BOMs: multi-level + prototype → certified flow ─────────
  // Rev A PROTOTYPE (obsolete path), Rev B CERTIFIED, Rev C PROTOTYPE for next
  const bomA = await prisma.bomHeader.create({
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
          { stepNumber: 1, title: "Kit Verification", instructions: "Verify all kit components against certified BOM Rev B. Check lot traceability labels.", workCenter: "ASM-01", estimatedMinutes: 20, requiresSignOff: true, sortOrder: 1 },
          { stepNumber: 2, title: "Install PCB into Housing", instructions: "Place PCB-2200 into HSG-3100. Torque M3 screws to 0.6 N·m ±0.05. ESD precautions required.", workCenter: "ASM-01", estimatedMinutes: 45, requiresSignOff: true, sortOrder: 2, drawingLinks: JSON.stringify(["DWG-HSG-3100-A"]) },
          { stepNumber: 3, title: "Install Connectors", instructions: "Install CON-4400 connectors per MIL-DTL torque spec. Apply threadlocker.", workCenter: "ASM-01", estimatedMinutes: 30, requiresSignOff: true, sortOrder: 3 },
          { stepNumber: 4, title: "EMI Gasket Installation", instructions: "Install GASK-5500 ensuring full contact along sealing surface. No gaps >0.1mm.", workCenter: "ASM-01", estimatedMinutes: 25, requiresSignOff: true, sortOrder: 4 },
          { stepNumber: 5, title: "Continuity Test", instructions: "Perform pin-to-pin continuity per TP-ASM-1000. Record resistance values.", isTestStep: true, testCriteria: "All pins < 0.5 Ω", expectedValue: "<0.5Ω", workCenter: "TEST-01", estimatedMinutes: 30, requiresSignOff: true, sortOrder: 5 },
          { stepNumber: 6, title: "Functional Power-On Test", instructions: "Apply 28V DC. Verify boot sequence and BIT pass. Capture serial log.", isTestStep: true, testCriteria: "BIT PASS, voltage 27-29V", expectedValue: "PASS", workCenter: "TEST-01", estimatedMinutes: 40, requiresSignOff: true, sortOrder: 6 },
          { stepNumber: 7, title: "Final Visual & Package", instructions: "Final FOD inspection. Apply serial label and UID. Stage for QA.", workCenter: "ASM-01", estimatedMinutes: 20, requiresSignOff: true, sortOrder: 7 },
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
          { code: "GFP-01", name: "Government Property Cage", type: "STORAGE" },
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
    prisma.supplier.create({ data: { code: "SUP-AERO", name: "AeroConnect Industries", status: "APPROVED", contactName: "Lisa Hart", contactEmail: "lisa@aeroconnect.example", category: "Connectors", onTimeDeliveryPct: 96.5, qualityPpm: 120, costVariancePct: 1.2, overallScore: 94.2, rating: "A" } }),
    prisma.supplier.create({ data: { code: "SUP-CHIP", name: "SiliconForge Semiconductors", status: "APPROVED", contactName: "Raj Patel", contactEmail: "raj@siliconforge.example", category: "Electronics", onTimeDeliveryPct: 88.0, qualityPpm: 850, costVariancePct: 3.5, overallScore: 82.1, rating: "B" } }),
    prisma.supplier.create({ data: { code: "SUP-METAL", name: "PrecisionMetals LLC", status: "CONDITIONAL", contactName: "Mike Torres", contactEmail: "mike@pmetals.example", category: "Machined Parts", onTimeDeliveryPct: 72.0, qualityPpm: 4200, costVariancePct: 8.0, overallScore: 68.5, rating: "C" } }),
    prisma.supplier.create({ data: { code: "SUP-FAST", name: "FastenRight Corp", status: "APPROVED", contactName: "Amy Zhou", contactEmail: "amy@fastenright.example", category: "Hardware", onTimeDeliveryPct: 99.1, qualityPpm: 50, costVariancePct: 0.5, overallScore: 98.0, rating: "A" } }),
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
  console.log(`  ✓ ${suppliers.length} suppliers + scorecard history`);

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
      status: "APPROVED",
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

  const pr3 = await prisma.purchaseRequest.create({
    data: {
      number: "PR-00003",
      status: "SUBMITTED",
      requestedById: prodSup.id,
      department: "Machining",
      neededBy: daysFromNow(45),
      justification: "Housing blanks for next lot",
      totalEstimate: 8400,
      lines: {
        create: [
          { partId: part["HSG-3100"].id, description: "Aluminum Housing CNC blanks", quantity: 20, estimatedUnitCost: 420 },
        ],
      },
    },
  });

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

  // ── Projects with EVM ──────────────────────────────────────
  const project = await prisma.project.create({
    data: {
      number: "PRJ-AERO-01",
      name: "Block 5 Avionics Upgrade",
      description: "Design and produce next-gen avionics control modules for Block 5 platforms",
      status: "ACTIVE",
      customerName: "DoD / Prime Contractor",
      contractValue: 4500000,
      budgetCost: 3200000,
      actualCost: 1450000,
      plannedValue: 1600000,
      earnedValue: 1520000,
      startDate: daysAgo(120),
      endDate: daysFromNow(180),
      percentComplete: 48,
      members: {
        create: [
          { userId: pm.id, role: "PM" },
          { userId: engLead.id, role: "MEMBER" },
          { userId: prodSup.id, role: "MEMBER" },
          { userId: qualityMgr.id, role: "STAKEHOLDER" },
        ],
      },
      wbsElements: {
        create: [
          { code: "1.0", name: "Program Management", budgetCost: 200000, actualCost: 95000, percentComplete: 50, sortOrder: 1 },
          { code: "2.0", name: "Engineering Design", budgetCost: 800000, actualCost: 720000, percentComplete: 90, sortOrder: 2 },
          { code: "3.0", name: "Procurement", budgetCost: 600000, actualCost: 280000, percentComplete: 45, sortOrder: 3 },
          { code: "4.0", name: "Production", budgetCost: 1200000, actualCost: 280000, percentComplete: 25, sortOrder: 4 },
          { code: "5.0", name: "Test & Qualification", budgetCost: 400000, actualCost: 75000, percentComplete: 15, sortOrder: 5 },
        ],
      },
      milestones: {
        create: [
          { name: "PDR Complete", dueDate: daysAgo(60), status: "ACHIEVED" },
          { name: "CDR Complete", dueDate: daysAgo(20), status: "ACHIEVED" },
          { name: "First Article Complete", dueDate: daysFromNow(30), status: "PENDING" },
          { name: "LRIP Delivery", dueDate: daysFromNow(120), status: "PENDING" },
        ],
      },
      risks: {
        create: [
          { title: "Connector long lead", description: "CON-4400 lead time stretch risk", probability: "MEDIUM", impact: "HIGH", status: "MITIGATING", mitigation: "Dual-source evaluation + safety stock" },
          { title: "Firmware certification delay", probability: "LOW", impact: "HIGH", status: "OPEN" },
        ],
      },
      issues: {
        create: [
          { title: "PrecisionMetals quality trend", description: "Rising NCR rate on housings", status: "IN_PROGRESS", priority: "HIGH" },
        ],
      },
    },
    include: { wbsElements: true },
  });

  const wbsProd = project.wbsElements.find((w) => w.code === "4.0")!;

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
      { projectId: project.id, wbsElementId: wbsProd.id, name: "Build LRIP lot 1 (qty 10)", status: "IN_PROGRESS", priority: "HIGH", assigneeId: prodSup.id, startDate: daysAgo(14), endDate: daysFromNow(21), estimatedHours: 400, actualHours: 180, percentComplete: 40 },
      { projectId: project.id, wbsElementId: wbsProd.id, name: "First article inspection package", status: "TODO", priority: "HIGH", assigneeId: qualityMgr.id, startDate: daysFromNow(7), endDate: daysFromNow(30), estimatedHours: 80, percentComplete: 0 },
      { projectId: project.id, name: "Supplier scorecard review", status: "DONE", priority: "NORMAL", assigneeId: buyer.id, estimatedHours: 8, actualHours: 6, percentComplete: 100 },
    ],
  });

  const project2 = await prisma.project.create({
    data: {
      number: "PRJ-INT-02",
      name: "Internal Tooling Upgrade",
      status: "ACTIVE",
      budgetCost: 150000,
      actualCost: 45000,
      plannedValue: 60000,
      earnedValue: 52000,
      percentComplete: 35,
      startDate: daysAgo(40),
      endDate: daysFromNow(50),
    },
  });
  console.log("  ✓ Projects + EVM data");

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
  const woProto = await prisma.workOrder.create({
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
  const je = await prisma.journalEntry.create({
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
  await prisma.governmentProperty.create({
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
      condition: "SERVICEABLE",
      dfarsCompliant: true,
      complianceChecks: {
        create: [
          { checkType: "PHYSICAL_INVENTORY", status: "PASS", checkedById: qualityMgr.id, checkedAt: daysAgo(15), notes: "Count verified" },
          { checkType: "UID_VERIFY", status: "PASS", checkedById: qualityMgr.id, checkedAt: daysAgo(15) },
          { checkType: "DOCUMENTATION", status: "PASS", checkedById: qualityMgr.id, notes: "DD Form 1149 on file" },
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
      condition: "SERVICEABLE",
      dfarsCompliant: true,
    },
  });
  console.log("  ✓ Government property");

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
          { userId: engLead.id, role: "ENGINEERING", vote: "APPROVE", comments: "Vibration data supports change", votedAt: daysAgo(1) },
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
  console.log("  ✓ HR data");

  // ── Budgets ────────────────────────────────────────────────
  await prisma.budget.createMany({
    data: [
      { name: "Production Materials", fiscalYear: 2026, department: "Production", accountCode: "1200", amount: 1500000, actual: 620000, period: "YTD" },
      { name: "Engineering Labor", fiscalYear: 2026, department: "Engineering", accountCode: "6000", amount: 900000, actual: 410000, period: "YTD" },
      { name: "Quality Ops", fiscalYear: 2026, department: "Quality", amount: 350000, actual: 148000, period: "YTD" },
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

  console.log("✅ ForgeERP seed complete — all modules linked.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
