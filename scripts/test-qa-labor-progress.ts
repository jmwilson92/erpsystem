/** Work-order labor % complete, overrun notify, estimate learning, and project/budget rollup. */
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });
  const pg = await PGlite.create();
  const ddl = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        CHECKPOINT_DISABLE: "1",
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
        DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused",
        DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused",
      },
    }
  );
  await pg.exec(ddl);
  const schema = "tenant_qalabor01";
  await pg.exec(
    `CREATE SCHEMA ${schema}; SET search_path TO ${schema};` +
      TENANT_TABLES_SQL +
      TENANT_FKS_SQL +
      "SET search_path TO public;"
  );
  const socket = new PGLiteSocketServer({
    db: pg,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 16,
  });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("External requests disabled in labor-progress tests");
  };

  const { createRequestStoreForAPI } = await import(
    "next/dist/server/async-storage/request-store"
  );
  const { createWorkStore } = await import(
    "next/dist/server/async-storage/work-store"
  );
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { workUnitAsyncStorage } = await import(
    "next/dist/server/app-render/work-unit-async-storage.external"
  );
  const { NextRequest } = await import(
    "next/dist/server/web/spec-extension/request"
  );
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const labor = await import("../src/lib/services/labor-progress");
  const auth = await import("../src/lib/auth-core");
  const p = controlPlaneClient();
  const tenant = clientForSchema(schema);
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");

  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(
      new NextRequest("http://127.0.0.1/labor-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/labor-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/labor-qa",
      buildId: "qa-local",
      previouslyRevalidatedTags: [],
      renderOpts: {
        supportsDynamicResponse: true,
        isPossibleServerAction: true,
        assetPrefix: "",
        incrementalCache: {} as never,
        experimental: {
          isRoutePPREnabled: false,
          cacheComponents: false,
          authInterrupts: false,
        },
        waitUntil: () => {},
        onClose: () => {},
      } as Parameters<typeof createWorkStore>[0]["renderOpts"],
    });
    const value = await workAsyncStorage.run(work, () =>
      workUnitAsyncStorage.run(store, fn)
    );
    return {
      value,
      cookies: Object.fromEntries(
        store.mutableCookies
          .getAll()
          .filter((c) => c.value)
          .map((c) => [c.name, c.value])
      ),
    };
  }

  // ── Pure helpers (no DB) ──────────────────────────────────────────
  assert.equal(labor.laborPercent(5, 10), 50);
  assert.equal(labor.laborPercent(11, 10), 110);
  assert.equal(labor.laborPercent(0, null), null);
  assert.equal(labor.isOverAllocated(10, 10), false);
  assert.equal(labor.isOverAllocated(10.1, 10), true);
  assert.equal(
    labor.laborLoadHours({ allocatedHours: 8, clockedHours: 3, status: "IN_PROGRESS" }),
    5
  );
  assert.equal(
    labor.laborLoadHours({ allocatedHours: 8, clockedHours: 3, status: "COMPLETED" }),
    0
  );
  const fromBom = labor.resolveAllocatedHours({
    quantity: 4,
    bomHoursPerUnit: 2.5,
    itemHoursPerUnit: 9,
  });
  assert.equal(fromBom.allocatedHours, 10);
  assert.equal(fromBom.source, "BOM");
  const fromItem = labor.resolveAllocatedHours({
    quantity: 2,
    itemHoursPerUnit: 3,
    itemSource: "LAST_ACTUAL",
  });
  assert.equal(fromItem.allocatedHours, 6);
  assert.equal(fromItem.source, "LAST_ACTUAL");

  try {
    await p.tenant.create({
      data: { slug: "qa-labor", schemaName: schema, status: "ACTIVE" },
    });
    for (const [scope, db] of [["public", p], [schema, tenant]] as const) {
      const roles = ["ADMIN", "PRODUCTION", "PM", "OPERATOR"];
      const pins = roles.map(() => String(randomInt(100000, 999999)));
      assert.equal(new Set(pins).size, roles.length);
      const users = await Promise.all(
        roles.map((role, i) =>
          db.user.create({
            data: {
              name: role,
              email: `${role.toLowerCase()}@example.invalid`,
              role,
              passwordHash: auth.hashPassword(password),
              pinCode: pins[i],
              isActive: true,
            },
          })
        )
      );
      const sessions = await Promise.all(
        users.map((u) =>
          request(() =>
            scope === "public" ? auth.createSession(u.id) : auth.createTenantSession(u.id, scope)
          )
        )
      );
      const run = async <T>(fn: () => Promise<T>, role = "ADMIN") =>
        (await request(fn, sessions[roles.indexOf(role)].cookies)).value;

      const admin = users[0];
      const production = users[1];
      const operator = users[3];

      const part = await db.part.create({
        data: {
          partNumber: "QA-LABOR-ITEM",
          description: "Labor fixture item",
          sourcingMethod: "BUILD",
          allocatedHoursPerUnit: 2,
          laborEstimateSource: "MANUAL",
        },
      });
      const bom = await db.bomHeader.create({
        data: {
          partId: part.id,
          revision: "A",
          status: "CERTIFIED",
          allocatedHoursPerUnit: 3,
          laborEstimateSource: "MANUAL",
        },
      });
      const project = await db.project.create({
        data: { number: "PRJ-LABOR", name: "Labor rollup project", status: "ACTIVE" },
      });
      const budget = await db.budget.create({
        data: {
          number: "BDGT-LABOR",
          name: "Labor budget",
          status: "ENACTED",
          projectId: project.id,
          laborBudget: 100,
          laborHoursBudget: 20,
        },
      });

      const wo = await db.workOrder.create({
        data: {
          number: "WO-LABOR-1",
          type: "TASK_ONLY",
          status: "PLANNED",
          partId: part.id,
          bomHeaderId: bom.id,
          quantity: 2,
          projectId: project.id,
          assigneeId: operator.id,
          createdById: admin.id,
        },
      });

      const snap = await run(() =>
        labor.snapshotWorkOrderAllocatedHours({ workOrderId: wo.id, userId: admin.id })
      );
      assert.equal(snap.allocatedHours, 6); // BOM 3h × qty 2 overrides item 2h
      assert.equal(snap.source, "BOM");

      const released = await db.workOrder.findUniqueOrThrow({ where: { id: wo.id } });
      assert.equal(released.allocatedHours, 6);
      assert.equal(released.estimatedMinutes, 360);

      await db.timeEntry.create({
        data: {
          userId: operator.id,
          workOrderId: wo.id,
          date: new Date(),
          hours: 4,
          type: "REGULAR",
          status: "DRAFT",
          laborRate: 50,
          costAmount: 200,
          budgetId: budget.id,
        },
      });
      const mid = await run(() => labor.onWorkOrderTimeChanged(wo.id));
      assert.equal(mid.progress.percentComplete, 66.7);
      assert.equal(mid.progress.overAllocated, false);
      assert.equal(mid.notified, false);

      await db.timeEntry.create({
        data: {
          userId: operator.id,
          workOrderId: wo.id,
          date: new Date(),
          hours: 3,
          type: "REGULAR",
          status: "DRAFT",
          laborRate: 50,
          costAmount: 150,
          budgetId: budget.id,
        },
      });
      const over = await run(() => labor.onWorkOrderTimeChanged(wo.id));
      assert.equal(over.progress.clockedHours, 7);
      assert.equal(over.progress.percentComplete, 116.7);
      assert.equal(over.progress.overAllocated, true);
      assert.equal(over.notified, true);

      const notes = await db.userNotification.findMany({
        where: { entityId: wo.id, type: "LABOR_OVERRUN" },
      });
      const recipientIds = new Set(notes.map((n) => n.userId));
      assert.ok(recipientIds.has(operator.id), "assignee is notified");
      assert.ok(recipientIds.has(production.id), "PRODUCTION role is notified");
      assert.ok(recipientIds.has(users[2].id), "PM role is notified");
      const firstCount = notes.length;
      assert.ok(firstCount >= 3);

      const again = await run(() => labor.onWorkOrderTimeChanged(wo.id));
      assert.equal(again.notified, false);
      const notes2 = await db.userNotification.count({
        where: { entityId: wo.id, type: "LABOR_OVERRUN" },
      });
      assert.equal(notes2, firstCount, "overrun notify is idempotent");

      await db.workOrder.update({
        where: { id: wo.id },
        data: { status: "COMPLETED", quantityCompleted: 2 },
      });
      const learned = await run(() =>
        labor.recordCompletionActuals({ workOrderId: wo.id, userId: admin.id })
      );
      assert.ok(learned);
      assert.equal(learned!.hoursPerUnit, 3.5); // 7h / 2 qty
      const bomAfter = await db.bomHeader.findUniqueOrThrow({ where: { id: bom.id } });
      assert.equal(bomAfter.lastActualHoursPerUnit, 3.5);
      assert.equal(bomAfter.allocatedHoursPerUnit, 3.5);
      assert.equal(bomAfter.laborEstimateSource, "LAST_ACTUAL");

      const againLearn = await run(() =>
        labor.recordCompletionActuals({ workOrderId: wo.id, userId: admin.id })
      );
      assert.equal(againLearn, null, "completion actuals are idempotent");

      const lockedPart = await db.part.create({
        data: {
          partNumber: "QA-LABOR-LOCK",
          description: "Locked estimate",
          sourcingMethod: "BUILD",
          allocatedHoursPerUnit: 5,
          laborEstimateLocked: true,
          laborEstimateSource: "OVERRIDE",
        },
      });
      const wo2 = await db.workOrder.create({
        data: {
          number: "WO-LABOR-2",
          type: "TASK_ONLY",
          status: "COMPLETED",
          partId: lockedPart.id,
          quantity: 1,
          allocatedHours: 5,
          laborEstimateSource: "ITEM",
        },
      });
      await db.timeEntry.create({
        data: {
          userId: operator.id,
          workOrderId: wo2.id,
          date: new Date(),
          hours: 8,
          type: "REGULAR",
          status: "DRAFT",
        },
      });
      await run(() => labor.recordCompletionActuals({ workOrderId: wo2.id }));
      const lockedAfter = await db.part.findUniqueOrThrow({ where: { id: lockedPart.id } });
      assert.equal(lockedAfter.lastActualHoursPerUnit, 8);
      assert.equal(lockedAfter.allocatedHoursPerUnit, 5, "locked estimate is not overwritten");
      assert.equal(lockedAfter.laborEstimateSource, "OVERRIDE");

      const projectRollup = await run(() => labor.getProjectLaborProgress(project.id));
      assert.ok(projectRollup.rows.some((r) => r.workOrderId === wo.id));
      assert.equal(projectRollup.overAllocatedCount, 1);
      assert.ok((projectRollup.percentComplete ?? 0) > 100);
      assert.equal(projectRollup.laborCost, 350);
      assert.equal(projectRollup.laborBudget, 100);
      assert.equal(projectRollup.laborCostVariance, 250);

      const budgetRollup = await run(() => labor.getBudgetLaborProgress(budget.id));
      assert.ok(budgetRollup.rows.some((r) => r.workOrderId === wo.id));
      assert.equal(budgetRollup.laborBudget, 100);

      const report = await run(() =>
        labor.queryLaborProgressReport({ projectId: project.id })
      );
      const csv = labor.laborProgressToCsv(report);
      assert.ok(csv.includes("WO-LABOR-1"));
      assert.ok(csv.includes("TOTALS"));
      assert.ok(csv.includes("116.7") || csv.includes("116.7"));

      const carina = await run(() =>
        labor.readLaborProgress({ workOrderNumber: "WO-LABOR-1" })
      );
      assert.equal(carina.kind, "work_order");
      if (carina.kind === "work_order") {
        assert.equal(carina.progress.overAllocated, true);
      }
      const spoken = labor.summarizeLaborProgressForCarina(carina);
      assert.match(spoken, /WO-LABOR-1/);
      assert.match(spoken, /OVER ALLOCATED/i);
    }
    console.log("test-qa-labor-progress: PASS");
  } finally {
    await socket.stop();
    await pg.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
