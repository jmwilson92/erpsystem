import { notFound } from 'next/navigation';
import Link from 'next/link';
import { HELP_ENTRIES } from '@/lib/ai-help/knowledge';
export default async function HelpArticle({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const entry=HELP_ENTRIES.find(e=>e.id===slug);
  if(!entry) notFound();
  return <article className="mx-auto max-w-3xl space-y-5 p-6">
    <Link href="/guides" className="underline">Guides</Link>
    <h1 className="text-2xl font-semibold">{entry.title}</h1>
    <p className="whitespace-pre-wrap leading-relaxed">{entry.text}</p>
    <nav className="flex flex-wrap gap-3">{entry.routes.filter(r=>!r.includes('[')).map(r=><Link className="underline" key={r} href={r}>{r}</Link>)}</nav>
    <p className="text-xs text-muted-foreground">Reviewed product guidance derived from: {entry.sources.join(', ')}. Your permissions, configuration and the current screen still apply.</p>
    <Link href="/support" className="underline">Get human support</Link>
  </article>;
}
