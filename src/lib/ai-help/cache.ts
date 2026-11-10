import { createHash } from 'node:crypto';
import type { AiConversationOutput } from '../services/ai';
const cache=new Map<string,{until:number;value:AiConversationOutput}>();
/** Short, bounded, per-tenant AND per-user memo. Never reuse one customer's answer for another. */
export async function cachedHelp(scope:string,input:unknown,run:()=>Promise<AiConversationOutput>):Promise<AiConversationOutput> {
  const key=createHash('sha256').update(scope+'\0'+JSON.stringify(input)).digest('hex');
  const now=Date.now();
  for(const [k,v] of cache) if(v.until<=now) cache.delete(k);
  const hit=cache.get(key);if(hit) return structuredClone(hit.value);
  const value=await run();
  if(value.source==='grok') {
    if(cache.size>=100) cache.delete(cache.keys().next().value!);
    cache.set(key,{until:now+120000,value:structuredClone(value)});
  }
  return value;
}
