/**
 * Seed sample field service, fleet, and shelf-life data so the new modules
 * have something to look at.
 *
 * Idempotent: re-running updates the same records rather than duplicating.
 * Everything it creates is prefixed/named distinctively so it's easy to spot
 * and delete.
 *
 * Usage:
 *   npx tsx scripts/seed-field-service.ts                 # public (dogfood)
 *   npx tsx scripts/seed-field-service.ts --schema demo_template
 *
 * Requires DATABASE_URL or DIRECT_URL.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertCheckoutCurrent } from "./lib/assert-current.mjs";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i < 0 ? undefined : process.argv[i + 1];
}

const DAY = 86_400_000;
const days = (n: number) => new Date(Date.now() + n * DAY);

async function main() {
  assertCheckoutCurrent(["prisma/schema.prisma"], "The field-service seed");

  const schema = arg("--schema") || "public";
  const connectionString =
    process.env.DIRECT_URL || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.error("No DATABASE_URL or DIRECT_URL set.");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString }, { schema });
  const db = new PrismaClient({ adapter });

  try {
    console.log(`Seeding field service / fleet / shelf life into "${schema}"…`);

    // ── Fleet ──────────────────────────────────────────────────
    const techs = await db.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 3,
      select: { id: true, name: true },
    });

    const vehicleSpecs = [
      {
        unitNumber: "VAN-01",
        name: "Service van 1",
        type: "VAN",
        make: "Ford",
        model: "Transit 250",
        year: 2022,
        licensePlate: "7ERP123",
        odometer: 48_200,
        registrationExpires: days(45),
        insuranceExpires: days(210),
        inspectionExpires: days(-12), // deliberately overdue
      },
      {
        unitNumber: "VAN-02",
        name: "Service van 2",
        type: "VAN",
        make: "Mercedes",
        model: "Sprinter 2500",
        year: 2021,
        licensePlate: "8ERP456",
        odometer: 71_940,
        registrationExpires: days(300),
        insuranceExpires: days(210),
        inspectionExpires: days(160),
      },
      {
        unitNumber: "FLT-01",
        name: "Warehouse forklift",
        type: "FORKLIFT",
        make: "Toyota",
        model: "8FGCU25",
        year: 2019,
        odometer: 4_180,
        odometerUnit: "HR",
        inspectionExpires: days(20),
      },
    ];

    const vehicles: Record<string, string> = {};
    for (const [i, spec] of vehicleSpecs.entries()) {
      const v = await db.vehicle.upsert({
        where: { unitNumber: spec.unitNumber },
        create: { ...spec, assignedToId: techs[i]?.id ?? null },
        update: { ...spec, assignedToId: techs[i]?.id ?? null },
      });
      vehicles[spec.unitNumber] = v.id;
    }
    console.log(`  vehicles: ${Object.keys(vehicles).length}`);

    // Preventive maintenance — one overdue by odometer, one due soon by date.
    const maintSpecs = [
      {
        vehicleId: vehicles["VAN-01"],
        type: "OIL_CHANGE",
        description: "5W-30 synthetic + filter",
        dueOdometer: 48_000,
        intervalDistance: 7_500,
      },
      {
        vehicleId: vehicles["VAN-02"],
        type: "TIRES",
        description: "Rotate and balance",
        dueAt: days(9),
        intervalDays: 180,
      },
      {
        vehicleId: vehicles["FLT-01"],
        type: "INSPECTION",
        description: "Annual OSHA powered-industrial-truck inspection",
        dueAt: days(20),
        intervalDays: 365,
      },
    ];
    for (const m of maintSpecs) {
      const existing = await db.vehicleMaintenance.findFirst({
        where: { vehicleId: m.vehicleId, type: m.type, status: "SCHEDULED" },
      });
      if (existing) {
        await db.vehicleMaintenance.update({ where: { id: existing.id }, data: m });
      } else {
        await db.vehicleMaintenance.create({ data: m });
      }
    }
    console.log(`  maintenance: ${maintSpecs.length}`);

    // Fuel history so cost-per-mile has something to chew on.
    const fuelCount = await db.fuelLog.count({
      where: { vehicleId: vehicles["VAN-01"] },
    });
    if (fuelCount === 0) {
      let odo = 46_100;
      for (let i = 6; i >= 1; i--) {
        odo += 340 + Math.round(Math.random() * 120);
        await db.fuelLog.create({
          data: {
            vehicleId: vehicles["VAN-01"],
            gallons: 18 + Math.random() * 4,
            cost: 62 + Math.random() * 14,
            odometer: odo,
            location: "Shell — Harbor Blvd",
            filledAt: new Date(Date.now() - i * 9 * DAY),
          },
        });
      }
      await db.vehicle.update({
        where: { id: vehicles["VAN-01"] },
        data: { odometer: Math.max(odo, 48_200) },
      });
      console.log("  fuel logs: 6");
    }

    // ── Field service ──────────────────────────────────────────
    const customers = await db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 2,
      select: { id: true, name: true },
    });

    if (customers.length === 0) {
      console.log("  (no customers — skipping service tickets and installed base)");
    } else {
      const asset = await (async () => {
        const found = await db.installedAsset.findFirst({
          where: { serialNumber: "SN-DEMO-0001" },
        });
        const data = {
          customerId: customers[0].id,
          serialNumber: "SN-DEMO-0001",
          siteName: "North plant — line 2",
          address: "1200 Industrial Way, Bay 4",
          installedAt: days(-400),
          warrantyEnds: days(330),
        };
        return found
          ? db.installedAsset.update({ where: { id: found.id }, data })
          : db.installedAsset.create({ data });
      })();
      console.log("  installed assets: 1");

      const ticketSpecs = [
        {
          number: "SVC-9001",
          customerId: customers[0].id,
          installedAssetId: asset.id,
          title: "Conveyor drive motor overheating",
          description:
            "Operator reports thermal trip after ~40 minutes of run time. Belt tension checked, no visible damage.",
          priority: "HIGH",
          serviceType: "REPAIR",
          status: "REQUEST",
          slaDueAt: days(1),
          siteAddress: "1200 Industrial Way, Bay 4",
          contactName: "Dana Ruiz",
          contactPhone: "555-0142",
        },
        {
          number: "SVC-9002",
          customerId: customers[Math.min(1, customers.length - 1)].id,
          title: "Quarterly PM — packaging cell",
          priority: "MEDIUM",
          serviceType: "PM",
          status: "SCHEDULED",
          slaDueAt: days(6),
        },
        {
          number: "SVC-9003",
          customerId: customers[0].id,
          title: "Controller replacement under warranty",
          priority: "URGENT",
          serviceType: "WARRANTY",
          status: "IN_PROGRESS",
          billable: false,
          slaDueAt: days(-1), // past SLA, shows the red flag working
        },
      ];

      for (const spec of ticketSpecs) {
        const t = await db.serviceTicket.upsert({
          where: { number: spec.number },
          create: spec,
          update: spec,
        });

        const hasVisit = await db.serviceVisit.count({ where: { ticketId: t.id } });
        if (hasVisit === 0 && spec.status !== "REQUEST") {
          const visit = await db.serviceVisit.create({
            data: {
              ticketId: t.id,
              technicianId: techs[0]?.id ?? null,
              vehicleId: vehicles["VAN-01"],
              scheduledFor: spec.status === "IN_PROGRESS" ? days(0) : days(3),
              status: spec.status === "IN_PROGRESS" ? "ON_SITE" : "SCHEDULED",
              startedAt: spec.status === "IN_PROGRESS" ? new Date() : null,
            },
          });
          if (spec.status === "IN_PROGRESS") {
            await db.serviceLabor.create({
              data: {
                visitId: visit.id,
                userId: techs[0]?.id ?? null,
                hours: 2.5,
                rate: 145,
                billable: false,
                notes: "Diagnosed controller fault, staged replacement",
              },
            });
          }
        }
      }
      console.log(`  service tickets: ${ticketSpecs.length}`);
    }

    // ── Shelf life ─────────────────────────────────────────────
    // Give a couple of parts a shelf life, then lay down lots that are
    // expired / expiring / fine so the report has all three states.
    const parts = await db.part.findMany({
      orderBy: { partNumber: "asc" },
      take: 2,
      select: { id: true, partNumber: true },
    });

    if (parts.length === 0) {
      console.log("  (no parts — skipping lots)");
    } else {
      for (const p of parts) {
        await db.part.update({
          where: { id: p.id },
          data: { shelfLifeDays: 180 },
        });
      }
      const lotSpecs = [
        { lotNumber: "LOT-DEMO-EXPIRED", partId: parts[0].id, quantity: 12, expiresAt: days(-8) },
        { lotNumber: "LOT-DEMO-SOON", partId: parts[0].id, quantity: 40, expiresAt: days(11) },
        {
          lotNumber: "LOT-DEMO-OK",
          partId: parts[Math.min(1, parts.length - 1)].id,
          quantity: 96,
          expiresAt: days(140),
        },
      ];
      for (const spec of lotSpecs) {
        await db.lot.upsert({
          where: { lotNumber: spec.lotNumber },
          create: { ...spec, receivedAt: days(-40), status: "AVAILABLE" },
          update: { ...spec, status: "AVAILABLE" },
        });
      }
      console.log(
        `  lots: ${lotSpecs.length} (shelf life set on ${parts.map((p) => p.partNumber).join(", ")})`
      );
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
