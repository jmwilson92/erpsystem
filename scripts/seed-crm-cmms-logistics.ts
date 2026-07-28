/**
 * Seed sample CRM, maintenance, and logistics data.
 *
 * Idempotent, and everything it creates is distinctively named so it's easy to
 * spot and delete: OPP-9xxx opportunities, CNC-DEMO / PRS-DEMO equipment, and
 * DEMOCAR / DEMOPCL carriers.
 *
 * Usage:
 *   npx tsx scripts/seed-crm-cmms-logistics.ts                 # public
 *   npx tsx scripts/seed-crm-cmms-logistics.ts --schema demo_template
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
}

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() + n * DAY);

async function main() {
  const schema = arg("--schema") || "public";
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.error("No DATABASE_URL or DIRECT_URL set.");
    process.exit(1);
  }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }, { schema }) });

  try {
    console.log(`Seeding CRM / maintenance / logistics into "${schema}"…`);
    const users = await db.user.findMany({
      where: { isActive: true },
      take: 3,
      select: { id: true },
      orderBy: { name: "asc" },
    });
    const owner = users[0]?.id ?? null;

    // ── CRM ────────────────────────────────────────────────
    const leadSpecs = [
      {
        company: "Northwind Aerospace",
        contactName: "Priya Raman",
        email: "priya@northwind.example",
        phone: "555-0188",
        source: "Trade show",
        status: "NEW",
      },
      {
        company: "Cascade Hydraulics",
        contactName: "Tom Okafor",
        email: "tom@cascade.example",
        source: "Website",
        status: "WORKING",
      },
    ];
    for (const spec of leadSpecs) {
      const found = await db.lead.findFirst({ where: { company: spec.company } });
      const data = { ...spec, ownerId: owner };
      if (found) await db.lead.update({ where: { id: found.id }, data });
      else await db.lead.create({ data });
    }
    console.log(`  leads: ${leadSpecs.length}`);

    const oppSpecs = [
      {
        number: "OPP-9001",
        name: "Acme — 500 unit bracket order",
        stage: "PROPOSAL",
        value: 82_500,
        probability: 50,
        expectedCloseAt: days(21),
        source: "Referral",
      },
      {
        number: "OPP-9002",
        name: "Cascade — hydraulic manifold retrofit",
        stage: "QUALIFY",
        value: 34_000,
        probability: 25,
        expectedCloseAt: days(45),
        source: "Website",
      },
      {
        number: "OPP-9003",
        name: "Northwind — machined housings, annual",
        stage: "NEGOTIATION",
        value: 240_000,
        probability: 75,
        expectedCloseAt: days(-3), // deliberately past its close date
        source: "Trade show",
      },
      {
        number: "OPP-9004",
        name: "Beacon Robotics — prototype run",
        stage: "LOST",
        value: 18_000,
        probability: 0,
        lostReason: "Lead time — competitor quoted 3 weeks",
        closedAt: days(-12),
      },
      {
        number: "OPP-9005",
        name: "Harbor Marine — deck fittings",
        stage: "WON",
        value: 56_000,
        probability: 100,
        closedAt: days(-20),
      },
    ];
    for (const spec of oppSpecs) {
      const data = { ...spec, ownerId: owner };
      await db.opportunity.upsert({
        where: { number: spec.number },
        create: data,
        update: data,
      });
    }
    console.log(`  opportunities: ${oppSpecs.length}`);

    const opp = await db.opportunity.findUnique({ where: { number: "OPP-9001" } });
    if (opp && (await db.crmActivity.count({ where: { opportunityId: opp.id } })) === 0) {
      await db.crmActivity.createMany({
        data: [
          {
            opportunityId: opp.id,
            type: "CALL",
            subject: "Discovery call — volumes and tolerances",
            userId: owner,
            occurredAt: days(-9),
          },
          {
            opportunityId: opp.id,
            type: "EMAIL",
            subject: "Sent budgetary quote",
            userId: owner,
            occurredAt: days(-4),
          },
          {
            opportunityId: opp.id,
            type: "TASK",
            subject: "Follow up on quote",
            userId: owner,
            dueAt: days(-1), // shows as overdue
          },
        ],
      });
      console.log("  activities: 3");
    }

    // ── CMMS ───────────────────────────────────────────────
    const workCenters = await db.workCenter.findMany({ take: 3, select: { id: true } });
    const equipSpecs = [
      {
        assetTag: "CNC-DEMO-01",
        name: "Haas VF-2SS vertical mill",
        manufacturer: "Haas",
        model: "VF-2SS",
        meter: 12_480,
        meterUnit: "HOURS",
        criticality: "CRITICAL",
        location: "Bay 3",
      },
      {
        assetTag: "CNC-DEMO-02",
        name: "Mazak QT-200 lathe",
        manufacturer: "Mazak",
        model: "QT-200",
        meter: 8_910,
        meterUnit: "HOURS",
        criticality: "HIGH",
        location: "Bay 4",
      },
      {
        assetTag: "PRS-DEMO-01",
        name: "60-ton hydraulic press",
        manufacturer: "Dake",
        meter: 402_000,
        meterUnit: "CYCLES",
        criticality: "MEDIUM",
        location: "Fab",
      },
    ];
    const equipment: Record<string, string> = {};
    for (const [i, spec] of equipSpecs.entries()) {
      const data = { ...spec, workCenterId: workCenters[i]?.id ?? null };
      const e = await db.equipment.upsert({
        where: { assetTag: spec.assetTag },
        create: data,
        update: data,
      });
      equipment[spec.assetTag] = e.id;
    }
    console.log(`  equipment: ${equipSpecs.length}`);

    const pmSpecs = [
      {
        equipmentId: equipment["CNC-DEMO-01"],
        type: "PM",
        description: "Way lube, filters, spindle taper check",
        dueMeter: 12_400, // already passed → overdue by meter
        intervalMeter: 500,
      },
      {
        equipmentId: equipment["CNC-DEMO-02"],
        type: "CALIBRATION",
        description: "Annual ballbar and probe calibration",
        dueAt: days(9), // due soon
        intervalDays: 365,
      },
      {
        equipmentId: equipment["PRS-DEMO-01"],
        type: "INSPECTION",
        description: "Guarding and light curtain inspection",
        dueAt: days(120),
        intervalDays: 180,
      },
    ];
    for (const pm of pmSpecs) {
      const found = await db.equipmentMaintenance.findFirst({
        where: { equipmentId: pm.equipmentId, type: pm.type, status: "SCHEDULED" },
      });
      if (found) await db.equipmentMaintenance.update({ where: { id: found.id }, data: pm });
      else await db.equipmentMaintenance.create({ data: pm });
    }
    console.log(`  PM schedules: ${pmSpecs.length}`);

    if ((await db.downtimeEvent.count()) === 0) {
      await db.downtimeEvent.createMany({
        data: [
          {
            equipmentId: equipment["CNC-DEMO-01"],
            reason: "BREAKDOWN",
            description: "Spindle alarm F0231",
            startedAt: new Date(Date.now() - 6 * DAY),
            endedAt: new Date(Date.now() - 6 * DAY + 4.5 * 3_600_000),
          },
          {
            equipmentId: equipment["CNC-DEMO-01"],
            reason: "SETUP",
            description: "Fixture changeover",
            startedAt: new Date(Date.now() - 3 * DAY),
            endedAt: new Date(Date.now() - 3 * DAY + 1.5 * 3_600_000),
          },
          {
            equipmentId: equipment["CNC-DEMO-02"],
            reason: "MATERIAL",
            description: "Waiting on bar stock",
            startedAt: new Date(Date.now() - 2 * DAY),
            endedAt: new Date(Date.now() - 2 * DAY + 3 * 3_600_000),
          },
          {
            equipmentId: equipment["PRS-DEMO-01"],
            reason: "QUALITY",
            description: "Dimensional drift, re-shimming die",
            startedAt: new Date(Date.now() - 1 * DAY),
            endedAt: new Date(Date.now() - 1 * DAY + 2 * 3_600_000),
          },
        ],
      });
      console.log("  downtime events: 4");
    }

    // ── Logistics ──────────────────────────────────────────
    const carrierSpecs = [
      {
        code: "DEMOCAR",
        name: "Demo Freight Co",
        mode: "LTL",
        accountNumber: "DF-40182",
        trackingUrl: "https://example.com/track?n={tracking}",
      },
      { code: "DEMOPCL", name: "Demo Parcel", mode: "PARCEL" },
    ];
    const carriers: Record<string, string> = {};
    for (const spec of carrierSpecs) {
      const c = await db.carrier.upsert({
        where: { code: spec.code },
        create: spec,
        update: spec,
      });
      carriers[spec.code] = c.id;
    }
    console.log(`  carriers: ${carrierSpecs.length}`);

    if ((await db.freightCost.count()) === 0) {
      await db.freightCost.createMany({
        data: [
          {
            carrierId: carriers["DEMOPCL"],
            direction: "OUTBOUND",
            trackingNumber: "1Z-DEMO-0001",
            service: "Ground",
            weight: 42,
            cost: 88.4,
            billedAmount: 95,
            shippedAt: days(-8),
          },
          {
            carrierId: carriers["DEMOCAR"],
            direction: "OUTBOUND",
            trackingNumber: "LTL-DEMO-7742",
            service: "LTL standard",
            weight: 860,
            cost: 612.0,
            billedAmount: 450, // under-recovered on purpose
            shippedAt: days(-5),
          },
          {
            carrierId: carriers["DEMOCAR"],
            direction: "INBOUND",
            trackingNumber: "LTL-DEMO-9910",
            weight: 1200,
            cost: 740.0,
            shippedAt: days(-11),
          },
        ],
      });
      console.log("  freight: 3");
    }

    // Landed cost against the newest receipt that has lines.
    const receipt = await db.receipt.findFirst({
      where: { lines: { some: {} } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, number: true },
    });
    if (!receipt) {
      console.log("  (no receipts with lines — skipping landed cost)");
    } else {
      const existing = await db.landedCostCharge.findFirst({
        where: { receiptId: receipt.id, description: "Demo ocean freight" },
      });
      if (!existing) {
        await db.landedCostCharge.create({
          data: {
            receiptId: receipt.id,
            type: "FREIGHT",
            description: "Demo ocean freight",
            amount: 450,
            allocation: "VALUE",
            vendor: "Demo Freight Co",
          },
        });
        await db.landedCostCharge.create({
          data: {
            receiptId: receipt.id,
            type: "DUTY",
            description: "Demo import duty",
            amount: 128.5,
            allocation: "QUANTITY",
            vendor: "Customs broker",
          },
        });
      }
      console.log(`  landed cost: 2 charges on receipt ${receipt.number}`);
    }

    console.log("Done.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
