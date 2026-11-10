/** Offline PostgreSQL integration test. No Supabase/project credentials are read.
 * A WASM Postgres instance listens ONLY on loopback for the real Prisma pg adapter.
 * npm run test:docs             run and close the fixture
 * npm run test:docs -- --serve  keep the local fixture for manual/browser review
 */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL, DOCS_HARDENING_SQL } from "../src/lib/tenant-template";
import { parseDocContent, docText, safeDocHref, templateContent, diffDocLines } from "../src/lib/docs/content";

async function main() {
  const db = await PGlite.create();
  await db.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
  await db.exec(DOCS_HARDENING_SQL);
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 8 });
  await server.start();
  process.env.DATABASE_URL = `postgresql://postgres@${server.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "1";
  process.env.DEMO_USER_ROLE = "ADMIN";
  const { prisma, clientForSchema } = await import("../src/lib/db");
  const docs = await import("../src/lib/services/docs");
  const { verifySignaturePin } = await import("../src/lib/services/signature-pin");
  const pin = String(randomInt(100000, 999999));
  const operatorPin = String(((Number(pin) - 100000 + 1) % 900000) + 100000);
  let success = false;
  try {
    const admin = await prisma.user.create({ data: { name: "Docs Test Admin", email: "docs-admin@example.invalid", role: "ADMIN", pinCode: pin } });
    const operator = await prisma.user.create({ data: { name: "Docs Test Operator", email: "docs-operator@example.invalid", role: "OPERATOR", pinCode: operatorPin } });
    const engineer = await prisma.user.create({ data: { name: "Docs Test Engineer", email: "docs-engineer@example.invalid", role: "ENGINEERING" } });
    const company = await prisma.companySettings.create({ data: { id: "default", name: "Docs Local Fixture", setupCompleted: true, plan: "ENTERPRISE", subscriptionStatus: "ACTIVE" } });
    console.log("✓ Local-only Postgres fixture, authenticated identity and tenant template");

    assert.equal(safeDocHref("javascript:alert(1)"), undefined);
    assert.equal(safeDocHref("//evil.invalid"), undefined);
    assert.equal(safeDocHref("/\\evil.invalid"), undefined);
    assert.equal(safeDocHref("/docs/pages/test"), "/docs/pages/test");
    assert.equal(safeDocHref("https://example.invalid/docs"), "https://example.invalid/docs");
    assert.throws(() => parseDocContent(JSON.stringify({ type: "script", content: [] })));
    assert.throws(() => parseDocContent("x".repeat(250001)));
    const hostile = parseDocContent(JSON.stringify({ type: "doc", content: [{ type: "paragraph", attrs: { onclick: "alert(1)" }, content: [{ type: "text", text: "<script>not HTML</script>", marks: [{ type: "link", attrs: { href: "javascript:alert(1)", onclick: "bad" } }] }] }] }));
    assert.ok(!JSON.stringify(hostile).includes("javascript:"));
    assert.ok(!JSON.stringify(hostile).includes("onclick"));
    assert.ok(docText(hostile).includes("<script>not HTML</script>"));
    assert.ok(diffDocLines("old", "new").some(l => l.kind === "removed"));
    for (const t of ["blank", "sop", "decision", "meeting", "runbook"]) parseDocContent(JSON.stringify(templateContent(t)));
    console.log("✓ Content validation, safe links, templates and readable diffs");

    const space = await docs.createDocSpace({ key: "ENG", name: "Engineering", description: "Local test knowledge space" });
    const otherSpace = await docs.createDocSpace({ key: "QA", name: "Quality" });
    const page = await docs.createDocPage({ spaceId: space.id, title: "Traveler release procedure", template: "sop", controlled: true, isTemplate: true });
    const child = await docs.createDocPage({ spaceId: space.id, parentId: page.id, title: "Inspection checklist", templatePageId: page.id });
    assert.ok(child.plainText.includes("Purpose"));
    await assert.rejects(docs.createDocPage({ spaceId: otherSpace.id, parentId: page.id, title: "Wrong parent" }), /Parent page/);
    await assert.rejects(docs.saveDocPage({ id: page.id, version: 1, title: page.title, content: page.content, controlled: true, isTemplate: true, parentId: child.id }), /descendants/);
    const content = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Inspect the traveler before release. UniqueSearchToken" }] }] });
    const revised = await docs.saveDocPage({ id: page.id, version: 1, title: page.title, content, controlled: true, isTemplate: true, summary: "Add traveler inspection" });
    assert.equal(revised.version, 2);
    await assert.rejects(docs.saveDocPage({ id: page.id, version: 1, title: page.title, content, controlled: true, isTemplate: true }), /changed while/);
    assert.equal(await prisma.docRevision.count({ where: { pageId: page.id } }), 2);
    assert.equal((await prisma.docPage.findMany({ where: { plainText: { contains: "uniquesearchtoken", mode: "insensitive" } } })).length, 1);
    const promoted = await docs.saveDocPage({ id: child.id, version: 1, title: child.title, content: child.content, controlled: true, isTemplate: false, parentId: page.id });
    const uncontrolledRevision = await prisma.docRevision.findUniqueOrThrow({ where: { pageId_version: { pageId: child.id, version: 1 } } });
    const restoredControlled = await docs.restoreDocRevision(child.id, uncontrolledRevision.id, promoted.version);
    assert.equal(restoredControlled.controlled, true);
    console.log("✓ Spaces, tree, saved templates, revisions, cycle/cross-space protection, stale-save conflict and content search");

    const comment = await docs.addDocComment(page.id, "Confirm the inspection criteria", 2);
    await docs.resolveDocComment(comment.id);
    assert.ok((await prisma.docComment.findUniqueOrThrow({ where: { id: comment.id } })).resolvedAt);
    await assert.rejects(docs.addDocComment(page.id, "Stale comment", 1), /changed while/);
    await assert.rejects(docs.signDocRevision(page.id, 2, "incorrect"), /PIN/);
    const signature = await docs.signDocRevision(page.id, 2, pin);
    assert.equal(signature.userId, admin.id);
    assert.equal(signature.contentHash, docs.revisionHash(revised.title, revised.content, true));
    assert.equal((await prisma.docPage.findUniqueOrThrow({ where: { id: page.id } })).status, "RELEASED");
    const v2 = await prisma.docRevision.findUniqueOrThrow({ where: { pageId_version: { pageId: page.id, version: 2 } } });
    await assert.rejects(docs.signDocRevision(page.id, 2, pin));
    await assert.rejects(prisma.docRevision.update({ where: { id: v2.id }, data: { title: "Tampered" } }));
    await assert.rejects(prisma.docSignature.delete({ where: { id: signature.id } }));
    const restored = await docs.restoreDocRevision(page.id, v2.id, 2);
    assert.equal(restored.version, 3);
    assert.equal(restored.status, "DRAFT");
    assert.equal(await prisma.docSignature.count(), 1);
    assert.equal(await prisma.docRevision.count({ where: { pageId: page.id } }), 3);
    await assert.rejects(docs.signDocRevision(page.id, 2, pin), /changed while/);
    await assert.rejects(docs.saveDocPage({ id: page.id, version: 3, title: page.title, content, controlled: false, isTemplate: true }), /downgraded/);
    await verifySignaturePin(admin.id, pin);
    await assert.rejects(verifySignaturePin(operator.id, pin));
    await assert.rejects(verifySignaturePin(engineer.id, pin));
    const audits = await prisma.auditLog.findMany({ where: { entityId: page.id } });
    assert.ok(audits.some(a => a.action === "PIN_SIGNED"));
    assert.ok(!JSON.stringify(audits).includes(pin));
    console.log("✓ Comments, own-PIN approval, immutable hash-bound evidence, restore-as-draft and secret-free audit trail");

    const task = await prisma.engTask.create({ data: { number: "ENG-LOCAL-1", name: "Verify release workflow" } });
    const ticket = await prisma.engineeringTicket.create({ data: { number: "TKT-LOCAL-1", title: "Legacy ticket" } });
    const work = await prisma.workOrder.create({ data: { number: "WO-LOCAL-1" } });
    const part = await prisma.part.create({ data: { partNumber: "PART-LOCAL-1", description: "Fixture part" } });
    const ncr = await prisma.nonConformance.create({ data: { number: "NCR-LOCAL-1", title: "Fixture NCR", description: "Verify linked inspection", source: "IN_PROCESS" } });
    const program = await prisma.program.create({ data: { code: "PGM-LOCAL-1", name: "Fixture program" } });
    for (const [type, targetId] of [["TASK", task.id], ["TICKET", ticket.id], ["WORK_ORDER", work.id], ["PART", part.id], ["NCR", ncr.id], ["PROGRAM", program.id], ["PAGE", child.id]] as const) {
      assert.ok((await docs.searchDocTargets(type, "", targetId)).length);
      await docs.linkDocRecord(page.id, type, targetId);
      await docs.linkDocRecord(page.id, type, targetId); // idempotent
      const links = await prisma.docLink.findMany({ where: { targetType: type, targetId }, include: { page: true } });
      assert.equal(links.length, 1); assert.equal(links[0].page.id, page.id);
    }
    await assert.rejects(docs.linkDocRecord(page.id, "PART", "another-tenant-item"), /not found/);
    await assert.rejects(docs.linkDocRecord(page.id, "PAGE", page.id), /itself/);
    const partLink = await prisma.docLink.findFirstOrThrow({ where: { targetType: "PART" } });
    await docs.unlinkDocRecord(page.id, partLink.id);
    assert.equal(await prisma.docLink.count({ where: { targetType: "PART" } }), 0);
    console.log("✓ Both tracker models, WO, item, NCR, PMO and page links; backlinks; idempotence; unlink; cross-tenant ID rejection");

    process.env.DEMO_USER_ROLE = "OPERATOR";
    await assert.rejects(docs.createDocSpace({ key: "BAD", name: "Denied" }), /docs.edit/);
    await assert.rejects(docs.signDocRevision(page.id, 3, pin), /docs.sign/);
    assert.equal((await docs.searchDocTargets("PROGRAM", "")).length, 0);
    // Even engineering role has no automatic controlled-document signing grant.
    process.env.DEMO_USER_ROLE = "ENGINEERING";
    await assert.rejects(docs.signDocRevision(page.id, 3, pin), /docs.sign/);
    const signingPermission = await prisma.permission.create({ data: { code: "docs.sign", name: "Approve controlled Docs", module: "docs" } });
    const grant = await prisma.userPermission.create({ data: { userId: operator.id, permissionId: signingPermission.id, allowed: true } });
    process.env.DEMO_USER_ROLE = "OPERATOR";
    await assert.rejects(docs.signDocRevision(page.id, 3, pin), /PIN/);
    const individualSignature = await docs.signDocRevision(page.id, 3, operatorPin);
    assert.equal(individualSignature.userId, operator.id);
    assert.equal(individualSignature.signerName, operator.name);
    await prisma.userPermission.update({ where: { id: grant.id }, data: { allowed: false } });
    await assert.rejects(docs.signDocRevision(page.id, 3, operatorPin), /docs.sign/);
    process.env.DEMO_USER_ROLE = "ADMIN";
    await prisma.companySettings.update({ where: { id: company.id }, data: { disabledModules: '["docs"]' } });
    await assert.rejects(docs.createDocSpace({ key: "OFF", name: "Disabled" }), /disabled/);
    await prisma.companySettings.update({ where: { id: company.id }, data: { disabledModules: "[]" } });
    console.log("✓ Permission denies, role switches do not grant signing, record-view filtering and disabled-module guard");

    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    await db.exec(DOCS_HARDENING_SQL);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role};`);
      for (const table of ["DocSpace", "DocPage", "DocRevision", "DocSignature", "DocComment", "DocLink"]) {
        for (const sql of [`SELECT * FROM "${table}"`, `INSERT INTO "${table}" DEFAULT VALUES`, `UPDATE "${table}" SET id=id`, `DELETE FROM "${table}"`, `TRUNCATE "${table}"`]) {
          await assert.rejects(db.query(sql), /permission denied/);
        }
      }
      await db.exec("RESET ROLE;");
    }
    // A separate tenant schema has no access to the public fixture's IDs.
    await db.exec('CREATE SCHEMA tenant_docstest; SET search_path TO tenant_docstest;');
    await db.exec(TENANT_TABLES_SQL + "\n" + TENANT_FKS_SQL);
    await db.exec(DOCS_HARDENING_SQL);
    await db.exec('SET search_path TO public;');
    const tenant = clientForSchema("tenant_docstest");
    assert.equal(await tenant.docPage.count(), 0);
    assert.equal(await tenant.docPage.findUnique({ where: { id: page.id } }), null);
    await tenant.$disconnect();
    console.log("✓ RLS/client-role denial, fresh tenant DDL and actual schema-isolated reads");

    // Test the actual operator script on an old tenant + public schema, then rerun.
    await db.exec('CREATE SCHEMA tenant_docsold; CREATE TABLE tenant_docsold."LegacyFixture" (id text);');
    const runBackfill = () => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/backfill-tenant-schemas.ts", "--docs-only", "--include-public", "--include-demos", "--apply", "--allow-stale"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", d => { output += d; }); child.stderr.on("data", d => { output += d; });
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Local backfill test failed: ${output}`)));
    });
    await runBackfill(); await runBackfill();
    const tables = await db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='tenant_docsold' AND tablename LIKE 'Doc%'");
    assert.equal(tables.rows.length, 6);
    const hard = await db.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tenant_docsold' AND relname='DocPage'");
    assert.equal(hard.rows[0].relrowsecurity, true);
    console.log("✓ Actual additive backfill on an existing tenant + public, hardening and repeat-run idempotence");
    const [, , joinedPages] = await Promise.all([
      prisma.docSpace.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { pages: true } } } }),
      prisma.docPage.findMany({ orderBy: { title: "asc" }, select: { id: true, spaceId: true, parentId: true, title: true, controlled: true } }),
      prisma.docPage.findMany({ orderBy: { updatedAt: "desc" }, take: 60, include: { space: { select: { name: true, key: true } } } }),
    ]);
    assert.ok(joinedPages.every(p => p.space && p.space.key === space.key), "Page-space joins must resolve in the fixture");
    await new Promise<void>((resolve, reject) => {
      const check = spawn(process.execPath, ["--import", "tsx", "-e", `
        const {PrismaClient}=require('@prisma/client'); const {PrismaPg}=require('@prisma/adapter-pg');
        const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
        p.docPage.findMany({include:{space:{select:{key:true,name:true}}}}).then(rows=>{
          if(rows.some(r=>!r.space)) throw new Error('Cross-process page-space join failed');
          console.log('Cross-process page-space join passed');
        }).then(()=>p.$disconnect()).catch(e=>{console.error(e);process.exit(1)});
      `], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; check.stdout.on("data", d => output += d); check.stderr.on("data", d => output += d);
      check.on("error", reject); check.on("exit", code => code === 0 ? resolve() : reject(new Error(output)));
    });
    success = true;
    console.log(`Docs integration tests passed. Fixture page: /docs/pages/${page.id}`);
  } finally {
    if (!process.argv.includes("--serve") || !success) {
      await prisma.$disconnect(); await server.stop(); await db.close();
    } else {
      // Local development only: no production database credentials are used.
      const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3085"], { env: { ...process.env, ALLOW_DEMO_IN_PRODUCTION: "1", SEED_ON_FIRST_BOOT: "0" }, stdio: "inherit" });
      const stop = async () => { app.kill(); await prisma.$disconnect(); await server.stop(); await db.close(); };
      process.once("SIGTERM", () => void stop()); process.once("SIGINT", () => void stop());
      console.log("Local Docs review fixture: http://localhost:3085/docs");
    }
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
