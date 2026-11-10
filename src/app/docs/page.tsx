import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDocsAccess, isDocsSchemaMissing } from "@/lib/services/docs";
import { userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocActionForm } from "@/components/docs/action-form";
import { DocPageTree } from "@/components/docs/page-tree";
import { actionCreateDocSpace } from "./actions";

export const dynamic = "force-dynamic";
export default async function DocsPage({ searchParams }: { searchParams: Promise<{ space?: string; q?: string }> }) {
  const user = await requireDocsAccess();
  const { space, q: rawQ } = await searchParams;
  const q = (rawQ ?? "").trim().slice(0, 100);
  const canEdit = await userHasPermission(user.id, "docs.edit");
  try {
    const [spaces, pages, results] = await Promise.all([
      prisma.docSpace.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { pages: true } } } }),
      prisma.docPage.findMany({ where: space ? { spaceId: space } : {}, orderBy: { title: "asc" }, select: { id: true, spaceId: true, parentId: true, title: true, controlled: true } }),
      prisma.docPage.findMany({ where: { ...(space ? { spaceId: space } : {}), ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { plainText: { contains: q, mode: "insensitive" } }] } : {}) }, orderBy: { updatedAt: "desc" }, take: 60, include: { space: { select: { name: true, key: true } } } }),
    ]);
    const current = spaces.find(s => s.id === space);
    return <div className="space-y-6">
      <PageHeader title="Docs" description="Your team's knowledge, connected to the work." actions={canEdit && spaces.length ? <Link href={`/docs/new${space ? `?space=${encodeURIComponent(space)}` : ""}`}><Button>New page</Button></Link> : undefined} />
      <form className="flex gap-2" role="search"><Input name="q" defaultValue={q} placeholder="Search page titles and content…" aria-label="Search Docs" maxLength={100} />{space ? <input type="hidden" name="space" value={space} /> : null}<Button variant="outline">Search</Button></form>
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-5">
          <Card><CardHeader><CardTitle>Spaces</CardTitle></CardHeader><CardContent className="space-y-2"><Link href="/docs" className="block text-sm text-teal-400">All spaces</Link>{spaces.map(s => <Link key={s.id} href={`/docs?space=${s.id}`} aria-current={space === s.id ? "page" : undefined} className="block rounded-lg border border-slate-800 p-3 hover:border-teal-700"><span className="text-xs text-teal-400">{s.key}</span><p className="font-medium">{s.name}</p><span className="text-xs text-slate-500">{s._count.pages} pages</span></Link>)}</CardContent></Card>
          {current ? <Card><CardHeader><CardTitle>Page tree</CardTitle></CardHeader><CardContent><DocPageTree pages={pages} /></CardContent></Card> : null}
          {canEdit ? <Card><CardHeader><CardTitle>Create a space</CardTitle></CardHeader><CardContent><DocActionForm action={actionCreateDocSpace} submit="Create space"><Input name="name" placeholder="Space name" aria-label="Space name" required maxLength={180} /><Input name="key" placeholder="Key, e.g. ENG" aria-label="Space key" required pattern="[A-Za-z][A-Za-z0-9-]{1,23}" /><Input name="description" placeholder="Description" aria-label="Space description" maxLength={1000} /></DocActionForm></CardContent></Card> : null}
        </aside>
        <section className="space-y-3"><h2 className="text-lg font-semibold">{q ? `Search results for “${q}”` : current?.name ?? "Recently updated"}</h2>{current?.description ? <p className="text-sm text-slate-400">{current.description}</p> : null}
          {!results.length ? <Card><CardContent className="p-8 text-center"><p className="text-slate-400">{q ? "No matching pages." : "No pages yet. Create a space, then start from a template."}</p></CardContent></Card> : results.map(page => <Link key={page.id} href={`/docs/pages/${page.id}`} className="block rounded-xl border border-slate-800 bg-slate-900/40 p-5 hover:border-teal-700"><p className="text-xs text-teal-400">{page.space.key} · v{page.version} · {page.controlled ? page.status : "Knowledge page"}{page.isTemplate ? " · Template" : ""}</p><h3 className="mt-1 font-semibold">{page.title}</h3><p className="mt-2 line-clamp-2 text-sm text-slate-400">{page.plainText.slice(0, 280)}</p></Link>)}
          {results.length === 60 ? <p className="text-xs text-slate-500">Showing the first 60 matches. Narrow your search or select a space.</p> : null}
        </section>
      </div>
    </div>;
  } catch (e) {
    if (!isDocsSchemaMissing(e)) throw e;
    return <Card><CardHeader><CardTitle>Docs is waiting for its schema update</CardTitle></CardHeader><CardContent>Ask an administrator to run the additive Docs tenant backfill. Other modules remain available.</CardContent></Card>;
  }
}
