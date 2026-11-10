import assert from "node:assert/strict";
import crypto from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanPriceBlock } from "../src/components/marketing/plan-price";
import { execFileSync, spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { Pool } from "pg";
import { TENANT_TEMPLATE_SQL, FOUNDING_BILLING_COLUMNS, FOUNDING_BILLING_HARDENING } from "../src/lib/tenant-template";
import { backfillFoundingMembers } from "./lib/founding-backfill.mjs";
import { FOUNDING_CUTOFF_EXCLUSIVE, qualifiesForFounding, foundingMembership, foundingGrant, subscriptionFoundingMembership } from "../src/lib/services/founding-membership";
import { reviewFounderStripeState } from "../src/lib/services/founding-stripe-review";

async function main() {
  const cutoff = Date.parse(FOUNDING_CUTOFF_EXCLUSIVE);
  assert.match(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "medium" }).format(cutoff - 1), /3\/9\/27, 11:59:59 PM/);
  const founderHtml = renderToStaticMarkup(React.createElement(PlanPriceBlock, { planKey: "STARTER", foundingMember: true }));
  assert.match(founderHtml, /locked for life/); assert.doesNotMatch(founderHtml, /3,600/);
  const regularHtml = renderToStaticMarkup(React.createElement(PlanPriceBlock, { planKey: "STARTER" }));
  assert.match(regularHtml, /3,600/);
  assert.equal(qualifiesForFounding(new Date("2027-03-09T23:59:59.999-08:00")), true);
  assert.equal(qualifiesForFounding(new Date("2027-03-10T00:00:00-08:00")), false);
  assert.equal(qualifiesForFounding(new Date(NaN)), false);
  assert.equal(qualifiesForFounding(new Date(0)), false);
  assert.deepEqual(foundingGrant({ foundingMember: false }), {});
  assert.equal(subscriptionFoundingMembership({ created: cutoff / 1000 + 1, metadata: { foundingMember: "1" } }).foundingMember, true);
  assert.equal(subscriptionFoundingMembership({ created: cutoff / 1000 + 1 }).foundingMember, false);
  assert.equal(subscriptionFoundingMembership({ created: cutoff / 1000 + 1 }, foundingMembership(new Date(cutoff - 1))).foundingMember, true);
  console.log("✓ Pacific deadline, full final minute, invalid dates, sticky grants and trial conversion");

  const db = new PGlite();
  await db.waitReady;
  const socket = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 16 });
  await socket.start();
  const connectionString = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DATABASE_URL = connectionString;
  process.env.DIRECT_URL = connectionString;
  process.env.CI = "1";
  process.env.DEMO_MODE = "0";
  process.env.STRIPE_SECRET_KEY = "fake-key-for-intercepted-tests-only";
  process.env.STRIPE_PRICE_STARTER = "price_standard";
  process.env.STRIPE_PRICE_STARTER_FIRST_YEAR = "price_intro";
  process.env.STRIPE_PRICE_SHOP = "price_shopstandard";
  process.env.STRIPE_PRICE_SHOP_FIRST_YEAR = "price_shopintro";
  const pool = new Pool({ connectionString, max: 1 });
  const old = (sql: string) => sql.replace(/^    "foundingMember".*\n/gm, "").replace(/^    "foundingQualifiedAt".*\n/gm, "");
  const calls: { method: string; path: string; body: URLSearchParams }[] = [];
  const objects = new Map<string, unknown>();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.stripe.com", "Unexpected external network access");
    const method = options?.method ?? "GET";
    const path = url.pathname.replace(/^\/v1/, "");
    const body = new URLSearchParams(String(options?.body ?? ""));
    calls.push({ method, path, body });
    let result: unknown;
    if (method === "POST" && path === "/checkout/sessions") result = { url: "https://checkout.stripe.com/test-local-only" };
    else if (method === "POST" && path === "/subscription_schedules") result = { id: "sub_sched_local" };
    else if (method === "POST" && path === "/subscription_schedules/sub_sched_local") result = { id: "sub_sched_local" };
    else { assert.equal(method, "GET", "Unexpected Stripe mutation"); result = objects.get(path); assert.ok(result, `Missing mock ${path}`); }
    return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
  };
  const clients: { $disconnect(): Promise<void> }[] = [];
  try {
    await db.exec(old(TENANT_TEMPLATE_SQL));
    const raw = execFileSync("node", ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    const tenantDdl = raw.match(/CREATE TABLE "Tenant" \([\s\S]*?\n\);/)?.[0];
    assert.ok(tenantDdl);
    await db.exec(old(tenantDdl));
    for (const schema of ["tenant_oldtrial", "tenant_free", "demo_old"]) {
      await db.exec(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; ${old(TENANT_TEMPLATE_SQL)}; SET search_path TO public;`);
    }
    await pool.query(`INSERT INTO "Tenant" ("id","slug","schemaName","isDemo","status","plan","createdAt","updatedAt") VALUES ('oldtrial','oldtrial','tenant_oldtrial',false,'ACTIVE','STARTER','2026-10-01',now()), ('free','free','tenant_free',false,'ACTIVE','SHOP','2026-10-01',now())`);
    await pool.query(`INSERT INTO "public"."CompanySettings" ("id","plan","subscriptionStatus","updatedAt") VALUES ('default','STARTER','ACTIVE',now())`);
    await pool.query(`INSERT INTO "tenant_oldtrial"."CompanySettings" ("id","plan","subscriptionStatus","trialEndsAt","updatedAt") VALUES ('default','STARTER','TRIALING','2026-12-01',now())`);
    await pool.query(`INSERT INTO "tenant_free"."CompanySettings" ("id","plan","seats","subscriptionStatus","updatedAt") VALUES ('default','SHOP',5,'ACTIVE',now())`);
    await pool.query(`INSERT INTO "demo_old"."CompanySettings" ("id","plan","subscriptionStatus","updatedAt") VALUES ('default','STARTER','ACTIVE',now())`);
    const options = { columns: FOUNDING_BILLING_COLUMNS, hardening: FOUNDING_BILLING_HARDENING, cutoffExclusive: FOUNDING_CUTOFF_EXCLUSIVE, includeDemos: true, now: new Date("2026-11-09T20:35:00-08:00"), log: () => {} };
    const report = await backfillFoundingMembers(pool, options);
    assert.equal(report.pendingGrants, 2); assert.equal(report.missingColumns, 10);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE column_name='foundingMember'`)).rows[0].n, 0, "Dry-run must not alter schemas");
    const applied = await backfillFoundingMembers(pool, { ...options, apply: true });
    assert.equal(applied.granted, 2);
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "tenant_oldtrial"."CompanySettings"`)).rows[0].foundingMember, true);
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "Tenant" WHERE "id"='oldtrial'`)).rows[0].foundingMember, true);
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "tenant_free"."CompanySettings"`)).rows[0].foundingMember, false);
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "demo_old"."CompanySettings"`)).rows[0].foundingMember, false);
    for (const role of ["anon", "authenticated"]) {
      await pool.query(`CREATE ROLE "${role}"; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."CompanySettings", "public"."Tenant" TO "${role}"; SET ROLE "${role}"`);
      await assert.rejects(pool.query(`UPDATE "public"."CompanySettings" SET "foundingMember"=false WHERE "id"='default'`), /server-controlled/);
      await assert.rejects(pool.query(`UPDATE "public"."Tenant" SET "foundingQualifiedAt"=now() WHERE "id"='oldtrial'`), /server-controlled/);
      await assert.rejects(pool.query(`INSERT INTO "public"."CompanySettings" ("id","foundingMember","updatedAt") VALUES ('forged',true,now())`), /server-controlled/);
      await assert.rejects(pool.query(`DELETE FROM "public"."CompanySettings" WHERE "id"='default'`), /server-controlled/);
      await pool.query(`UPDATE "public"."CompanySettings" SET "tagline"='unchanged profile permissions' WHERE "id"='default'`);
      await pool.query("RESET ROLE");
    }
    const repeated = await backfillFoundingMembers(pool, { ...options, apply: true });
    assert.equal(repeated.missingGuards, 0); assert.equal(repeated.missingColumns, 0); assert.equal(repeated.pendingGrants, 0);
    await db.exec(`CREATE SCHEMA tenant_ambiguous; SET search_path TO tenant_ambiguous; ${old(TENANT_TEMPLATE_SQL)}; SET search_path TO public;`);
    await pool.query(`INSERT INTO "tenant_ambiguous"."CompanySettings" ("id","plan","subscriptionStatus","updatedAt") VALUES ('default','STARTER','ACTIVE',now())`);
    await pool.query(`UPDATE "public"."CompanySettings" SET "foundingMember"=false, "foundingQualifiedAt"=$1 WHERE "id"='default'`, [new Date(cutoff - 1).toISOString()]);
    const later = await backfillFoundingMembers(pool, { ...options, apply: true, now: new Date(cutoff + 1000) });
    assert.equal(later.manualReview, 1);
    assert.equal((await pool.query(`SELECT "foundingMember", "foundingQualifiedAt" AT TIME ZONE 'UTC' AS date FROM "public"."CompanySettings"`)).rows[0].date.getTime(), cutoff - 1);
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "public"."CompanySettings"`)).rows[0].foundingMember, true, "Exact UTC eligibility evidence must work after cutoff in any process timezone");
    assert.equal((await pool.query(`SELECT "foundingMember" FROM "tenant_ambiguous"."CompanySettings"`)).rows[0].foundingMember, false);
    console.log("✓ Actual legacy tenant/public registry DDL, existing paid/trial grants, free/demo exclusion, report-only mode, repeat safety and late ambiguous-account review");

    // Exercise the real CLI, not only its helper. It must be idempotent too.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/backfill-tenant-schemas.ts", "--founding-only", "--include-public", "--include-demos", "--apply"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; child.stdout.on("data", d => output += d); child.stderr.on("data", d => output += d);
      child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error(output)));
    });
    const { clientForSchema, controlPlaneClient } = await import("../src/lib/db");
    const { activatePlan, startTrial, cancelSubscription, getSubscriptionState } = await import("../src/lib/services/subscription");
    const { createCheckoutSession, retrieveCheckoutSession, ensureIntroRenewalSchedule, handleWebhookEvent, subscriptionIdForEvent, verifyWebhook } = await import("../src/lib/services/stripe");
    const cp = controlPlaneClient(), tenant = clientForSchema("tenant_oldtrial"), other = clientForSchema("tenant_free");
    clients.push(cp, tenant, other);
    assert.equal((await tenant.companySettings.findUniqueOrThrow({ where: { id: "default" } })).foundingQualifiedAt?.getTime(), options.now.getTime(), "Raw DDL backfill and Prisma must agree on the UTC eligibility instant");
    await startTrial(undefined, other);
    assert.equal((await getSubscriptionState(other)).foundingMember, true);
    await activatePlan({ plan: "STARTER", provider: "stripe", foundingMembership: { foundingMember: false } }, tenant);
    await cancelSubscription(undefined, tenant);
    assert.equal((await getSubscriptionState(tenant)).foundingMember, true, "Renewals and cancellation must not revoke a founder");
    const savedStandard = process.env.STRIPE_PRICE_STARTER; delete process.env.STRIPE_PRICE_STARTER;
    await createCheckoutSession({ plan: "STARTER", firstYear: false, appUrl: "https://example.invalid", foundingMembership: { foundingMember: true }, workspaceSchema: "tenant_oldtrial" });
    process.env.STRIPE_PRICE_STARTER = savedStandard;
    const checkout = calls.at(-1)!;
    objects.set("/subscriptions/sub_active", { id: "sub_active", status: "active" });
    const priorPosts = calls.filter(c => c.method === "POST").length;
    await assert.rejects(createCheckoutSession({ plan: "STARTER", appUrl: "https://example.invalid", existingSubscriptionId: "sub_active" }), /duplicate subscription/);
    assert.equal(calls.filter(c => c.method === "POST").length, priorPosts);

    assert.equal(checkout.body.get("line_items[0][price]"), "price_intro");
    assert.equal(checkout.body.get("subscription_data[metadata][foundingMember]"), "1");
    assert.equal(checkout.body.get("metadata[workspaceSchema]"), "tenant_oldtrial");
    assert.equal(checkout.body.has("payment_method_types"), false);
    calls.length = 0;
    objects.set("/subscriptions/sub_before", { id: "sub_before", created: cutoff / 1000 - 1, schedule: "sub_sched_existing", items: { data: [{ price: "price_intro", quantity: 1 }] } });
    const standard = process.env.STRIPE_PRICE_STARTER; delete process.env.STRIPE_PRICE_STARTER;
    await ensureIntroRenewalSchedule("sub_before", "STARTER");
    process.env.STRIPE_PRICE_STARTER = standard;
    assert.ok(calls.every(c => c.method === "GET"), "Founders must never create/update/release a schedule, including existing ones");
    objects.set("/subscriptions/sub_after", { id: "sub_after", created: cutoff / 1000, items: { data: [{ price: "price_intro", quantity: 1 }] } });
    objects.set("/subscription_schedules/sub_sched_local", { phases: [{ start_date: cutoff / 1000, items: [{ price: "price_intro", quantity: 1 }] }] });
    calls.length = 0;
    await ensureIntroRenewalSchedule("sub_after", "STARTER");
    assert.equal(calls.at(-1)?.body.get("phases[1][items][0][price]"), "price_standard");
    calls.length = 0;
    await ensureIntroRenewalSchedule("sub_after", "STARTER", { foundingMember: true });
    assert.ok(calls.every(c => c.method === "GET"));
    assert.equal(subscriptionIdForEvent("invoice.payment_succeeded", { id: "in_wrong" }), null);
    assert.equal(subscriptionIdForEvent("invoice.paid", { id: "in_wrong", parent: { subscription_details: { subscription: "sub_after" } } }), "sub_after");
    console.log("✓ Founder Checkout price/metadata, no founder schedule writes, exact cutoff, and unchanged non-founder standard-price renewal phases");

    // Simulate a trial converting after the cutoff through a signed server-owned
    // Checkout. DB entitlement, not the clock or email, owns this conversion.
    objects.set("/subscriptions/sub_converted", { id: "sub_converted", created: cutoff / 1000 + 86400, customer: "cus_converted", status: "active", metadata: { plan: "STARTER", workspaceSchema: "tenant_oldtrial" }, items: { data: [{ price: "price_intro", quantity: 1 }] } });
    calls.length = 0;
    await handleWebhookEvent({ type: "checkout.session.completed", data: { object: { id: "cs_converted", customer: "cus_converted", subscription: "sub_converted", payment_status: "paid", metadata: { plan: "STARTER", firstYear: "1", workspaceSchema: "tenant_oldtrial" } } } });
    assert.equal((await tenant.companySettings.findUniqueOrThrow({ where: { id: "default" } })).stripeSubscriptionId, "sub_converted");
    assert.equal((await cp.tenant.findUniqueOrThrow({ where: { id: "oldtrial" } })).foundingMember, true);
    assert.equal((await other.companySettings.findUniqueOrThrow({ where: { id: "default" } })).stripeSubscriptionId, null);
    assert.ok(calls.every(c => c.method === "GET"));
    await handleWebhookEvent({ type: "invoice.payment_succeeded", data: { object: { id: "in_neverpersist", customer: "cus_converted", subscription: "sub_converted", lines: { data: [{ period: { end: cutoff / 1000 + 86400 * 365 } }] } } } });
    assert.equal((await tenant.companySettings.findUniqueOrThrow({ where: { id: "default" } })).stripeSubscriptionId, "sub_converted");
    await handleWebhookEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_converted", customer: "cus_converted", created: cutoff / 1000 + 86400, metadata: {} } } });
    assert.equal((await getSubscriptionState(tenant)).foundingMember, true);
    assert.equal((await getSubscriptionState(tenant)).status, "CANCELLED");
    process.env.STRIPE_WEBHOOK_SECRET = "local-fixture-webhook-only";
    const signedPayload = JSON.stringify({ type: "customer.subscription.updated", data: { object: { id: "sub_converted" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${signedPayload}`).digest("hex");
    assert.ok(verifyWebhook(signedPayload, `t=${timestamp},v1=${digest}`));
    assert.throws(() => verifyWebhook(signedPayload, `t=${timestamp},v1=invalid`));
    const publicBefore = (await getSubscriptionState(cp)).plan;
    objects.set("/subscriptions/sub_unknown", { id: "sub_unknown", created: cutoff / 1000 + 1, status: "active", metadata: { plan: "GROWTH" } });
    await handleWebhookEvent({ type: "invoice.payment_succeeded", data: { object: { id: "in_unknown", customer: "cus_unknown", subscription: "sub_unknown" } } });
    assert.equal((await getSubscriptionState(cp)).plan, publicBefore, "Unowned checkout must never write public");
    objects.set("/checkout/sessions/cs_crossesdeadline", { status: "complete", payment_status: "unpaid", created: cutoff / 1000 - 100, metadata: { plan: "STARTER", provision: "tenant", payNow: "1" }, subscription: { id: "sub_late", created: cutoff / 1000 + 1, status: "incomplete" } });
    const late = await retrieveCheckoutSession("cs_crossesdeadline");
    assert.equal(late?.foundingMember, false, "Checkout session creation before cutoff is not a subscription start");
    assert.equal(late?.paymentReceived, false);
    console.log("✓ Tenant-isolated webhook conversion, invoice ID correctness, sticky cancellation, unknown-owner guard, late completion and unpaid Checkout facts");

    objects.set("/subscriptions/sub_newfounder", { id: "sub_newfounder", created: cutoff / 1000 - 1, status: "trialing", metadata: { plan: "STARTER", firstYear: "1" }, items: { data: [{ price: "price_intro", quantity: 1 }] } });
    calls.length = 0;
    await handleWebhookEvent({ type: "checkout.session.completed", data: { object: { id: "cs_newfounder", customer: "cus_newfounder", customer_email: "fixture@example.invalid", subscription: "sub_newfounder", payment_status: "unpaid", metadata: { plan: "STARTER", firstYear: "1", provision: "tenant" } } } });
    const fresh = await cp.tenant.findFirstOrThrow({ where: { stripeSubscriptionId: "sub_newfounder" } });
    assert.equal(fresh.foundingMember, true);
    const freshDb = clientForSchema(fresh.schemaName); clients.push(freshDb);
    const freshState = await getSubscriptionState(freshDb);
    assert.equal(freshState.foundingMember, true);
    assert.equal(freshState.status, "TRIALING", "Unpaid trial must not be activated as paid");
    assert.ok(calls.every(c => c.method === "GET"));
    await handleWebhookEvent({ type: "checkout.session.completed", data: { object: { id: "cs_newfounder", customer: "cus_newfounder", customer_email: "fixture@example.invalid", subscription: "sub_newfounder", payment_status: "unpaid", metadata: { plan: "STARTER", firstYear: "1", provision: "tenant" } } } });
    assert.equal(await cp.tenant.count({ where: { stripeSubscriptionId: "sub_newfounder" } }), 1);
    console.log("✓ Real fresh schema provisioning and replay: new founders persist in both tenant/registry; unpaid trials stay trials");

    const review = reviewFounderStripeState({ introPrice: "price_intro", standardPrice: "price_standard", subscription: { items: { data: [{ price: "price_intro" }] }, schedule: "sub_sched_review" }, schedule: { status: "active", phases: [{ items: [{ price: "price_intro" }] }, { items: [{ price: "price_standard" }] }] } });
    assert.ok(review.actions.includes("REVIEW_RELEASE_INTRO_SCHEDULE"));
    const standardReview = reviewFounderStripeState({ introPrice: "price_intro", standardPrice: "price_standard", subscription: { items: { data: [{ price: "price_standard" }] } } });
    assert.ok(standardReview.actions.includes("REVIEW_MOVE_STANDARD_TO_FIRST_YEAR_PRICE"));
    console.log("✓ Read-only legacy Stripe review identifies existing price switches; no live Stripe calls or mutations performed");
  } finally {
    globalThis.fetch = realFetch;
    for (const client of clients) await client.$disconnect();
    await pool.end(); await socket.stop(); await db.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
