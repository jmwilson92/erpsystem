import { NextRequest } from 'next/server';
import { helpIdentity } from '@/lib/ai-help/identity';
import { reserveHelpTurn, redactHelpText } from '@/lib/ai-help/budget';
export const runtime='nodejs';
export const dynamic='force-dynamic';

function ttsKey(): string {
  return (process.env.TTS_API_KEY || process.env.XAI_API_KEY)?.trim() || '';
}

/** Warm the TLS session to api.x.ai so the first spoken sentence is not a cold handshake. */
async function warmUpstream(key: string): Promise<void> {
  await fetch('https://api.x.ai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  }).catch(() => undefined);
}

/** Existing Carina voice, official xAI TTS shape only. No client-selected upstream. */
export async function POST(req:NextRequest) {
  const identity=await helpIdentity();
  if(!identity) return new Response('Sign in or start a demo',{status:401});
  const {user,demo}=identity;
  if(Number(req.headers.get('content-length') || 0)>12000) return new Response('Request too large',{status:413});
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch { return new Response('Invalid speech request',{status:400}); }

  const key=ttsKey();
  if(!key) return Response.json({error:'Voice is unavailable; text help still works.'},{status:503});

  if (body?.warmup === true) {
    await warmUpstream(key);
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  }

  let text:string, language:string;
  try {
    if(typeof body.text!=='string' || body.text.length>4000 || !body.text.trim()) throw Error();
    text=redactHelpText(body.text).slice(0,1800);
    const raw=typeof (body.language || body.lang)==='string'?String(body.language || body.lang):'en';
    language=raw.toLowerCase().split(/[-_]/)[0];
    if(!/^[a-z]{2,3}$/.test(language)) language='en';
  } catch { return new Response('Invalid speech request',{status:400}); }
  try { await reserveHelpTurn(user.id,demo,'CarinaTts'); }
  catch { return Response.json({error:'Voice limit reached. Please use text or try later.'},{status:429}); }
  try {
    const upstream=await fetch('https://api.x.ai/v1/tts',{
      method:'POST',signal:AbortSignal.timeout(15000),cache:'no-store',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({text,voice_id:process.env.TTS_VOICE_ID?.trim() || 'carina',language}),
    });
    if(!upstream.ok || !(upstream.headers.get('content-type') || '').startsWith('audio/')) throw Error();
    return new Response(await upstream.arrayBuffer(),{headers:{'Content-Type':upstream.headers.get('content-type') || 'audio/mpeg','Cache-Control':'no-store'}});
  } catch { return Response.json({error:'Voice is unavailable. Please use text help.'},{status:502}); }
}
