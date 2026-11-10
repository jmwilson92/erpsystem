import { randomUUID } from 'node:crypto';
import { prisma, currentRequestSchema } from '../db';
import type { PrismaClient } from '@prisma/client';
import { redactSecrets } from '../redact-secrets';
export function redactHelpText(text:string):string {
  return redactSecrets(text).replace(/\b(?:pin|password|passcode)\b\s*(?:is|:|=)?\s*\S+/gi,'[credential redacted]').replace(/\bxai-[A-Za-z0-9_-]+\b/g,'[key redacted]').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email redacted]').slice(0,2400);
}
/** Existing tenant AuditLog: durable across serverless workers, no schema migration.
 * PostgreSQL advisory transaction lock serializes per-user count+insert across workers.
 * SQLite uses SERIALIZABLE. Errors fail closed before model calls. */
export async function reserveHelpTurn(userId:string,demo:boolean, channel:'CarinaHelp'|'CarinaTts'='CarinaHelp'):Promise<string> {
  return reserveHelpTurnOn(prisma,userId,demo,channel,await currentRequestSchema());
}
/** Dependency injection for isolated database tests, not exposed as a server action. */
export async function reserveHelpTurnOn(client:PrismaClient,userId:string,demo:boolean,channel:'CarinaHelp'|'CarinaTts'='CarinaHelp',scope='test'):Promise<string> {
  const id=randomUUID();
  await client.$transaction(async tx=> {
    if (process.env.DATABASE_URL?.startsWith('postgres')) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${scope + ':' + channel + ':' + (demo?'demo':userId)}))::text AS locked`;
    }
    const since=new Date(Date.now()-86400000);
    const rows=await tx.auditLog.findMany({where:{entityType:channel,action:'ASK',...(demo?{}:{userId}),createdAt:{gte:since}},select:{createdAt:true},take:501});
    if(rows.length >= (channel==='CarinaTts'?(demo?50:200):(demo?20:100)) || rows.filter(r=>r.createdAt.getTime()>Date.now()-60000).length >= (channel==='CarinaTts'?(demo?8:30):(demo?4:12))) throw new Error('AI help is busy. Please wait a minute or use the Support tab. Daily fair-use limits also apply.');
    await tx.auditLog.create({data:{entityType:channel,entityId:id,action:'ASK',userId}});
  },{isolationLevel:process.env.DATABASE_URL?.startsWith('postgres')?'ReadCommitted':'Serializable'});
  return id;
}
export async function logHelpAnswer(userId:string,id:string,question:string,answer:{text:string;source?:string;citations?:unknown[]},page:string) {
  await prisma.auditLog.create({data:{entityType:'CarinaHelp',entityId:id,action:'ANSWER',userId,metadata:JSON.stringify({question:redactHelpText(question),answer:redactHelpText(answer.text),source:answer.source,citations:answer.citations,page})}});
}
