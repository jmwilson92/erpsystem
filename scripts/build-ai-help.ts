/** Reviewed guidance + current navigation/tours -> reproducible, tenant-free index. */
import fs from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS } from '../src/lib/navigation';
import { TOURS } from '../src/lib/guides';
import { FOUNDING_OFFER_LABEL } from '../src/lib/services/founding-membership';
import { PLANS, TRIAL_DAYS, SHOP_FREE_SEATS } from '../src/lib/services/subscription-plans';
type Entry = { id: string; title: string; routes: string[]; sources: string[]; text: string };
const entries: Entry[] = JSON.parse(fs.readFileSync('docs/ai-help/workflows.json', 'utf8'));
for (const group of NAV_GROUPS) for (const item of group.items) {
  const route = item.href.split('?')[0];
  entries.push({ id: `module-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'dashboard'}`, title: `${group.label}: ${item.label}`, routes: [route], sources: ['src/lib/navigation.ts'], text: `${item.label} is under ${group.label}, at ${item.href}. Navigation keywords: ${(item.keywords || []).join(', ')}. This is navigation guidance, not a promise that any action or integration is enabled for your account.` });
}
for (const tour of TOURS) entries.push({ id: `tour-${tour.id}`, title: tour.title, routes: [...new Set(tour.steps.map(s=>s.route).filter((s): s is string=>!!s))], sources: ['src/lib/guides.ts'], text: `${tour.description}\n${tour.steps.map(s=>`${s.title}: ${s.body}${s.why ? ` ${s.why}` : ''}`).join('\n')}` });
entries.push({ id:'pricing', title:'Plans, free Shop, trial and founding member pricing', routes:['/pricing','/billing'], sources:['src/lib/services/subscription-plans.ts','src/lib/services/founding-membership.ts','docs/FOUNDING-MEMBER-BILLING.md'], text: `Shop is free for up to ${SHOP_FREE_SEATS} users, with no card and no expiry. Paid Shop is for 6–10 users. Paid plans have a ${TRIAL_DAYS}-day trial. ${PLANS.map(p=>p.pricing==='custom' ? `${p.name}: custom quote, 251+ users.` : `${p.name}: ${p.seats} users maximum; first year ${p.key==='SHOP'?'$10/month first user plus $2/month each additional user':`$${p.firstYearPrice}/year`}; standard after year one ${p.key==='SHOP'?'$30/user/month':`$${p.price}/year`}.`).join(' ')} A real paid subscription or trial started through ${FOUNDING_OFFER_LABEL} qualifies for the founding-member lifetime introductory rate. Free Shop and demos alone do not qualify. The grant is sticky across renewal and cancellation for the same workspace; it is not transferable by email. It locks the recurring rate, not seat quantity, tax or add-ons. Do not promise the lock to every signup or quote an account's actual renewal without checking Billing. Checkout/Stripe and plan eligibility remain the source of truth.` });
const ids = new Set<string>();
for (const e of entries) {
  if (ids.has(e.id)) { e.id += '-view'; }
  if (ids.has(e.id)) throw new Error(`duplicate ${e.id}`); ids.add(e.id);
  for (const file of e.sources) if (!fs.existsSync(file)) throw new Error(`Missing source ${file}`);
  for (const route of e.routes) if (!route.startsWith('/') || route.startsWith('//')) throw new Error(`Unsafe route ${route}`);
}
const routeFiles: string[] = [];
function walk(dir:string) { for(const f of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,f.name); if(f.isDirectory()) walk(p); else if(f.name==='page.tsx') routeFiles.push('/'+path.relative('src/app',path.dirname(p)).split(path.sep).filter(s=>!s.startsWith('(')).join('/')); } }
walk('src/app');
fs.writeFileSync('src/lib/ai-help/index.json', JSON.stringify({ version:1, entries, routes:routeFiles.sort() },null,2)+'\n');
console.log(`Built ${entries.length} reviewed/navigation/tour entries and ${routeFiles.length} route inventory entries`);
