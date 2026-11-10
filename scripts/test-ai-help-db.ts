/** Actual isolated Postgres-compatible DB, no real project data/credentials. */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { TENANT_TABLES_SQL,TENANT_FKS_SQL } from '../src/lib/tenant-template';
async function main() {
  const db=await PGlite.create();
  await db.exec(TENANT_TABLES_SQL+'\n'+TENANT_FKS_SQL);
  const server=new PGLiteSocketServer({db,host:'127.0.0.1',port:0,maxConnections:8});await server.start();
  process.env.DATABASE_URL=`postgresql://postgres@${server.getServerConn()}/postgres`;
  process.env.DATABASE_POOL_MAX='1';
  const {prisma,clientForSchema}=await import('../src/lib/db');
  const {reserveHelpTurnOn,logHelpAnswer,redactHelpText}=await import('../src/lib/ai-help/budget');
  const {cachedHelp}=await import('../src/lib/ai-help/cache');
  try {
    const a=await prisma.user.create({data:{id:'fixture-user',email:'fixture@example.invalid',name:'Fixture',role:'OPERATOR'}});
    const id=await reserveHelpTurnOn(prisma,a.id,true);
    await logHelpAnswer(a.id,id,'My PIN is 123456; email is a@example.invalid; api_key=secret',{text:'Product guide answer',source:'local'},'/bom');
    const row=await prisma.auditLog.findFirstOrThrow({where:{entityId:id,action:'ANSWER'}});
    assert.ok(!row.metadata?.includes('123456'));assert.ok(!row.metadata?.includes('a@example.invalid'));assert.ok(!row.metadata?.includes('=secret'));
    for(let i=0;i<3;i++) await reserveHelpTurnOn(prisma,a.id,true);
    await assert.rejects(reserveHelpTurnOn(prisma,a.id,true),/busy/);
    assert.equal(await prisma.workOrder.count(),0);
    assert.equal(await prisma.purchaseRequest.count(),0);
    await db.exec('CREATE SCHEMA tenant_ai_fixture; SET search_path TO tenant_ai_fixture;');
    await db.exec(TENANT_TABLES_SQL+'\n'+TENANT_FKS_SQL);
    const tenant=clientForSchema('tenant_ai_fixture');
    await tenant.user.create({data:{id:a.id,email:'other@example.invalid',name:'Other tenant',role:'OPERATOR'}});
    await reserveHelpTurnOn(tenant,a.id,true);
    assert.equal(await tenant.auditLog.count(),1,'Different tenant has independent budget and cannot see answers');
    assert.equal(await tenant.auditLog.count({where:{action:'ANSWER'}}),0);
    await tenant.$disconnect();
    let calls=0;const run=async()=>{calls++;return {text:'answer',source:'grok' as const}};
    await cachedHelp('tenant-A:user-A',{q:'same'},run);await cachedHelp('tenant-A:user-A',{q:'same'},run);assert.equal(calls,1);
    await cachedHelp('tenant-B:user-A',{q:'same'},run);await cachedHelp('tenant-A:user-B',{q:'same'},run);assert.equal(calls,3,'Memo is isolated by both tenant and principal');
    assert.equal(redactHelpText('Bearer token-value api_key=private').includes('private'),false);
    console.log('Database budget, redacted audit, tenant isolation, read-only and cache tests passed.');
  } finally {await prisma.$disconnect();await server.stop();await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
