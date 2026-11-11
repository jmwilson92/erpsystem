/** Platform-only link issuance and atomic customer onboarding including MFA, URI redaction and array parsing. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
async function main() {
  Object.assign(globalThis, { AsyncLocalStorage });
  const pg = await PGlite.create();
  const ddl = execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-empty", "--to-schema", "prisma/schema.prisma", "--script"], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { PATH: process.env.PATH, CHECKPOINT_DISABLE: "1", PRISMA_HIDE_UPDATE_MESSAGE: "1", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused", DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused" },
  });
  await pg.exec(ddl);
  const schema = "tenant_qaclaims01";
  await pg.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};` + TENANT_TABLES_SQL + TENANT_FKS_SQL + "SET search_path TO public;");
  const socket = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0, maxConnections: 16 });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1"; process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  globalThis.fetch = async () => { throw new Error("External requests disabled in recovery tests"); };
  const { createRequestStoreForAPI } = await import("next/dist/server/async-storage/request-store");
  const { createWorkStore } = await import("next/dist/server/async-storage/work-store");
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external");
  const { NextRequest } = await import("next/dist/server/web/spec-extension/request");
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const p = controlPlaneClient(), tenant = clientForSchema(schema);
  const tenancy = await import("../src/lib/services/tenancy"), mfa = await import("../src/lib/services/mfa"), totp = await import("../src/lib/services/totp");
  const auth = await import("../src/lib/auth-core"), a = await import("../src/app/actions");
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");
  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(new NextRequest("http://127.0.0.1/invite/qa", { headers: { cookie: Object.entries(cookies).map(([k,v]) => `${k}=${v}`).join("; ") } }), { pathname: "/invite/qa", search: "" }, { tags: [], expirationsByCacheKind: new Map() }, undefined, undefined);
    const work = createWorkStore({ page: "/invite/[token]/page", buildId: "qa-local", previouslyRevalidatedTags: [], renderOpts: {
      supportsDynamicResponse: true, isPossibleServerAction: true, assetPrefix: "", incrementalCache: {} as never,
      experimental: { isRoutePPREnabled: false, cacheComponents: false, authInterrupts: false },
      waitUntil: () => {}, onClose: () => {},
    } as Parameters<typeof createWorkStore>[0]["renderOpts"] });
    const value = await workAsyncStorage.run(work, () => workUnitAsyncStorage.run(store, fn));
    return { value, cookies: Object.fromEntries(store.mutableCookies.getAll().filter(c => c.value).map(c => [c.name, c.value])) };
  }
  const form = (data: Record<string,string>) => { const fd = new FormData(); for (const [k,v] of Object.entries(data)) fd.set(k,v); return fd; };

  const demoSchema="demo_qaclaims01";await pg.exec(`CREATE SCHEMA ${demoSchema}; SET search_path TO ${demoSchema};`+TENANT_TABLES_SQL+TENANT_FKS_SQL+"SET search_path TO public;");const demo=clientForSchema(demoSchema);
  try{
    const owner=await tenant.user.create({data:{email:"customer@example.invalid",name:"Customer Owner",role:"ADMIN",passwordHash:auth.hashPassword(password)}}),platform=await p.user.create({data:{email:"platform@example.invalid",name:"Platform Owner",role:"ADMIN",passwordHash:auth.hashPassword(password)}}),operator=await p.user.create({data:{email:"operator@example.invalid",name:"Operator",role:"OPERATOR"}});
    await demo.user.create({data:{email:"demo@example.invalid",name:"Demo Administrator",role:"ADMIN"}});
    const workspace=await p.tenant.create({data:{slug:"claim-customer",schemaName:schema,status:"ACTIVE",billingEmail:owner.email}}),demoWorkspace=await p.tenant.create({data:{slug:"claim-demo",schemaName:demoSchema,status:"ACTIVE",isDemo:true}});
    const platformCookies=(await request(()=>auth.createSession(platform.id))).cookies,operatorCookies=(await request(()=>auth.createSession(operator.id))).cookies,oldCookies=(await request(()=>auth.createTenantSession(owner.id,schema))).cookies;
    const snapshot=async()=>JSON.stringify({tenants:await p.tenant.findMany({orderBy:{id:"asc"}}),publicUsers:await p.user.findMany({orderBy:{id:"asc"}}),owner:await tenant.user.findUnique({where:{id:owner.id}}),sessions:await tenant.authSession.findMany({orderBy:{id:"asc"}}),challenge:await p.mfaChallenge.findMany({orderBy:{id:"asc"}}),tenantLog:await tenant.auditLog.count(),publicLog:await p.auditLog.count()});
    const issue=async(cookies:Record<string,string>)=>(await request(()=>a.actionReissueOnboarding(null,form({tenantId:workspace.id})),cookies)).value;
    const claim=async(token:string,secret:string,cookies:Record<string,string>={})=>request(async()=>{try{return await a.actionClaimTenant({ok:false,message:""},form({token,password:secret,name:"Unexpected Recovery Rename"}))}catch(e){if(String((e as {digest?:string}).digest).startsWith("NEXT_REDIRECT"))return {ok:true,redirect:(e as {digest:string}).digest};throw e}},cookies);
    process.env.DEMO_MODE="1";
    for(const cookies of [{},{"forge-demo":demoSchema},{"forge-demo-user":platform.id},{"forge-session":"invalid-session"},operatorCookies,oldCookies,{...platformCookies,"forge-demo":demoSchema}]){
      const before=await snapshot(),result=await issue(cookies);assert(!result.ok&&!result.url);assert((await snapshot())===before,"Unauthorized link request changed customer state");
    }
    process.env.DEMO_MODE="0";
    const issued=await issue(platformCookies);assert(issued.ok&&issued.url);const token=issued.url!.split("/").at(-1)!;assert(/^[a-f0-9]{48}$/.test(token));
    const beforeClearFailure=await snapshot();
    await pg.exec(`CREATE FUNCTION public.qa_fail_claim_clear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."setupTokenHash" IS NULL AND OLD."setupTokenHash" IS NOT NULL THEN RAISE EXCEPTION 'injected claim consumption failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_claim_clear BEFORE UPDATE ON public."Tenant" FOR EACH ROW EXECUTE FUNCTION public.qa_fail_claim_clear();`);
    try{const failed=await claim(token,"New-Password-1-"+randomBytes(15).toString("hex"));assert(!failed.value.ok);assert(!failed.cookies[auth.SESSION_COOKIE]&&!failed.cookies[auth.MFA_COOKIE]);assert((await snapshot())===beforeClearFailure,"Token consumption failure changed password/session/audit")}finally{await pg.exec('DROP TRIGGER qa_fail_claim_clear ON public."Tenant";DROP FUNCTION public.qa_fail_claim_clear();')}
    const beforeSessionFailure=await snapshot();
    await pg.exec(`CREATE FUNCTION ${schema}.qa_fail_claim_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected claim session failure'; END $$; CREATE TRIGGER qa_fail_claim_session BEFORE INSERT ON ${schema}."AuthSession" FOR EACH ROW EXECUTE FUNCTION ${schema}.qa_fail_claim_session();`);
    try{const failed=await claim(token,"New-Password-2-"+randomBytes(15).toString("hex"));assert(!failed.value.ok);assert(!failed.cookies[auth.SESSION_COOKIE]);assert((await snapshot())===beforeSessionFailure,"Session creation failure consumed token or changed password")}finally{await pg.exec(`DROP TRIGGER qa_fail_claim_session ON ${schema}."AuthSession";DROP FUNCTION ${schema}.qa_fail_claim_session();`)}
    const beforeAuditFailure=await snapshot();
    await pg.exec(`CREATE FUNCTION ${schema}.qa_fail_claim_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='INSTANCE_CLAIMED' THEN RAISE EXCEPTION 'injected claim audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER qa_fail_claim_audit BEFORE INSERT ON ${schema}."AuditLog" FOR EACH ROW EXECUTE FUNCTION ${schema}.qa_fail_claim_audit();`);
    try{const failed=await claim(token,"New-Password-3-"+randomBytes(15).toString("hex"));assert(!failed.value.ok);assert(!failed.cookies[auth.SESSION_COOKIE]);assert((await snapshot())===beforeAuditFailure,"Audit failure changed claim state")}finally{await pg.exec(`DROP TRIGGER qa_fail_claim_audit ON ${schema}."AuditLog";DROP FUNCTION ${schema}.qa_fail_claim_audit();`)}
    const nextPassword="Customer-Password-4-"+randomBytes(15).toString("hex"),success=await claim(token,nextPassword,{"forge-demo":demoSchema});assert(success.value.ok);assert(success.cookies["forge-tenant"]===schema);assert(success.cookies[auth.SESSION_COOKIE]);assert(!success.cookies["forge-demo"]);
    assert((await p.tenant.findUniqueOrThrow({where:{id:workspace.id}})).setupTokenHash===null);assert(auth.verifyPassword(nextPassword,(await tenant.user.findUniqueOrThrow({where:{id:owner.id}})).passwordHash!));assert((await tenant.user.findUniqueOrThrow({where:{id:owner.id}})).name==="Customer Owner");assert(await tenant.authSession.count()===1);assert(await p.auditLog.count()===0);assert(await tenant.auditLog.count()===1);
    const replayBefore=await snapshot(),replay=await claim(token,"Replay-Password-5-"+randomBytes(15).toString("hex"));assert(!replay.value.ok);assert((await snapshot())===replayBefore,"Replayed claim changed customer state");
    console.log("PASS AUTH-024/025 genuine platform session required; demo/anonymous/tenant/operator denied unchanged; native customer claim isolates tenant, preserves authority/profile, consumes once and revokes old sessions; token/session/audit faults roll back password and cookies");
    const racing=await tenancy.issueOnboardingLink(workspace.id),secrets=["Race-Password-6-"+randomBytes(15).toString("hex"),"Race-Password-7-"+randomBytes(15).toString("hex")];
    const races=await Promise.all(secrets.map(secret=>claim(racing.token,secret)));assert(races.filter(r=>r.value.ok).length===1);assert(races.filter(r=>r.cookies[auth.SESSION_COOKIE]).length===1);assert(await tenant.authSession.count()===1);
    for(const data of [{role:"OPERATOR",isActive:true},{role:"ADMIN",isActive:false}]){await tenant.user.update({where:{id:owner.id},data});const link=await tenancy.issueOnboardingLink(workspace.id),before=await snapshot();const failed=await claim(link.token,"Role-Password-8-"+randomBytes(15).toString("hex"));assert(!failed.value.ok);assert((await snapshot())===before,"Claim resurrected disabled/demoted administrator")}
    await tenant.user.update({where:{id:owner.id},data:{role:"ADMIN",isActive:true}});const rotated=await tenancy.issueOnboardingLink(workspace.id);await tenancy.issueOnboardingLink(workspace.id);assert(!(await claim(rotated.token,nextPassword)).value.ok);
    await p.tenant.update({where:{id:workspace.id},data:{status:"SUSPENDED"}});const suspendedBefore=await snapshot();assert(!(await issue(platformCookies)).ok);assert((await snapshot())===suspendedBefore);await p.tenant.update({where:{id:workspace.id},data:{status:"ACTIVE"}});await assert.rejects(tenancy.issueOnboardingLink(demoWorkspace.id),/active customer/);
    const liveCookies=(await request(()=>auth.createTenantSession(owner.id,schema))).cookies;
    const enrollment=(await request(()=>mfa.startEnrolment({userId:owner.id,account:owner.email,issuer:"Synthetic QA"}),liveCookies)).value;
    const confirmation=(await request(()=>mfa.confirmEnrolment({userId:owner.id,code:totp.codeForStep(enrollment.secret,totp.currentStep())}),liveCookies)).value;assert(confirmation.ok&&confirmation.recoveryCodes?.length);
    const mfaLink=await tenancy.issueOnboardingLink(workspace.id),beforeMfaFailure=await snapshot();
    await pg.exec(`CREATE FUNCTION public.qa_fail_claim_challenge() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected claim challenge failure'; END $$; CREATE TRIGGER qa_fail_claim_challenge BEFORE INSERT ON public."MfaChallenge" FOR EACH ROW EXECUTE FUNCTION public.qa_fail_claim_challenge();`);
    try{const failed=await claim(mfaLink.token,nextPassword);assert(!failed.value.ok);assert(!failed.cookies[auth.MFA_COOKIE]&&!failed.cookies[auth.SESSION_COOKIE]);assert((await snapshot())===beforeMfaFailure,"MFA challenge failure changed onboarding state")}finally{await pg.exec('DROP TRIGGER qa_fail_claim_challenge ON public."MfaChallenge";DROP FUNCTION public.qa_fail_claim_challenge();')}
    const challenged=await claim(mfaLink.token,nextPassword);assert(challenged.value.ok);assert("redirect"in challenged.value&&challenged.value.redirect.includes("/login/mfa"));assert(challenged.cookies[auth.MFA_COOKIE]&&!challenged.cookies[auth.SESSION_COOKIE]&&!challenged.cookies["forge-tenant"]);assert(await tenant.authSession.count()===0);
    const completed=await request(()=>auth.completeMfaLogin({code:confirmation.recoveryCodes![0]}),challenged.cookies);assert(completed.value.ok);assert(completed.cookies["forge-tenant"]===schema&&completed.cookies[auth.SESSION_COOKIE]);
    console.log("PASS AUTH-025 claim races win once; inactive/demoted/suspended/rotated links denied; enrolled MFA remains required, challenge failure rolls back every DB write, native MFA redirect and real recovery proof complete login");
    const {redactError,redactSecrets}=await import("../src/lib/redact-secrets"),{parseJsonArray}=await import("../src/lib/utils");
    for(const scheme of ["postgresql","postgres","mysql","mongodb+srv","rediss","https"]){const synthetic="synthetic-"+randomBytes(12).toString("hex"),message=`Connection failed: ${scheme}://qa_user:${synthetic}@db.example.invalid/path`;assert(!redactError(new Error(message)).includes(synthetic));assert(!redactSecrets(message).includes("qa_user"))}
    const encoded="synthetic%40url%3Apassword";assert(!redactSecrets(`postgresql://qa:${encoded}@db.example.invalid/db`).includes(encoded));assert(redactSecrets("https://example.invalid/public/path")==="https://example.invalid/public/path");
    for(const value of ["{}","null","42",'"value"',"true","invalid",undefined,null])assert(Array.isArray(parseJsonArray(value))&&parseJsonArray(value).length===0);
    assert.deepEqual(parseJsonArray('["ok",2]'),["ok",2]);console.log("PASS SEC-001/UTIL-001 URI userinfo is stripped across connection schemes without exposing samples; valid non-array JSON always returns an empty array; legitimate URLs and arrays preserved");
  }finally{await p.$disconnect();await tenant.$disconnect();await demo.$disconnect();await socket.stop();await pg.close()}
}
main().catch(e=>{console.error(e instanceof Error?e.name+": onboarding regression failed":"onboarding regression failed");process.exitCode=1});
