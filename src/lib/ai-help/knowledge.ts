import index from './index.json';
export type HelpEntry = { id: string; title: string; routes: string[]; sources: string[]; text: string };
export const HELP_ENTRIES: HelpEntry[] = index.entries;
export type HelpCitation = { id: string; title: string; href: string };
const stop = new Set('a an the is are do does i me my we you your can how what where to for of in on and or with it this that please protessera'.split(' '));
function tokens(s: string) { return [...new Set((s.toLowerCase().match(/[a-z0-9]+/g) || []).filter(t=>!stop.has(t)).map(t=>t.length>4?t.replace(/(?:ing|ed|s)$/,'').replace(/e$/,''):t))]; }
const documents=HELP_ENTRIES.map(e=>({e,title:new Set(tokens(e.title+' '+e.id)),body:new Set(tokens(e.text+' '+e.routes.join(' ')))}));
const frequency=new Map<string,number>();
for(const d of documents) for(const t of new Set([...d.title,...d.body])) frequency.set(t,(frequency.get(t)||0)+1);
/** Only static route patterns from the repo, never record IDs or query strings. */
export function helpPageContext(input?: string | null): string {
  if (typeof input !== 'string' || !input.startsWith('/') || input.startsWith('//')) return '/';
  const pathname = input.split(/[?#]/)[0].slice(0,200);
  return index.routes.find(route => route === pathname) || index.routes.find(route => {
    const pattern=route.split('/'), parts=pathname.split('/');
    return pattern.length===parts.length && pattern.every((s,i)=>s.startsWith('[') || s===parts[i]);
  }) || '/';
}
export function retrieveHelp(question: string, page?: string | null, limit=4): HelpEntry[] {
  const terms=tokens(question), context=helpPageContext(page);
  const scored=documents.map(({e,title,body})=> {
    let matched=0;
    let score=terms.reduce((n,t)=> {
      const inTitle=title.has(t);
      const inBody=body.has(t);
      if(inTitle || inBody) matched++;
      const freq=(frequency.get(t) || 0);
      return n+(inTitle?4:inBody?1:0)*Math.log(1+HELP_ENTRIES.length/(1+freq));
    },0);
    if(e.routes.includes(context) && context!=='/' && matched) score+=2;
    // Reviewed workflow rules outrank short navigation descriptions and older tours.
    if(!e.id.startsWith('module-') && !e.id.startsWith('tour-') && matched) score*=1.5;
    return {e,score,matched};
  }).filter(x=>x.score>2 && x.matched>=Math.min(2,terms.length)).sort((a,b)=>b.score-a.score);
  return scored.slice(0,Math.max(0,Math.min(4,limit))).map(x=>x.e);
}
export function citation(e: HelpEntry): HelpCitation { return {id:e.id,title:e.title,href:`/help/${e.id}`}; }
