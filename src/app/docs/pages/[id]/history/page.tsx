import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDocsAccess } from "@/lib/services/docs";
import { userHasPermission } from "@/lib/auth";
import { diffDocLines } from "@/lib/docs/content";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocContent } from "@/components/docs/content";
import { DocActionForm } from "@/components/docs/action-form";
import { actionRestoreDocRevision } from "../../../actions";
export const dynamic = "force-dynamic";
export default async function DocHistory({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ version?: string; compare?: string }> }) {
  const user = await requireDocsAccess();
  const { id } = await params, sp = await searchParams;
  const page = await prisma.docPage.findUnique({ where: { id }, select: { title: true, version: true } });
  if (!page) notFound();
  const revisions = await prisma.docRevision.findMany({ where: { pageId: id }, orderBy: { version: "desc" }, take: 200, include: { signatures: true } });
  const selected = revisions.find(r => r.version === Number(sp.version)) ?? revisions[0];
  const previous = revisions.find(r => r.version === Number(sp.compare)) ?? revisions.find(r => r.version === selected?.version - 1);
  const canEdit = await userHasPermission(user.id, "docs.edit");
  const diff = selected ? diffDocLines(previous ? `${previous.title}\n${previous.plainText}` : "", `${selected.title}\n${selected.plainText}`) : [];
  return <div className="mx-auto max-w-6xl space-y-6"><PageHeader title={`History — ${page.title}`} actions={<Link href={`/docs/pages/${id}`} className="text-sm text-teal-400">Back to current page</Link>} />
    <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]"><nav aria-label="Version history" className="space-y-2">{revisions.map(r => <Link key={r.id} href={`?version=${r.version}`} aria-current={r.id === selected?.id ? "page" : undefined} className="block rounded-lg border border-slate-800 p-3 text-sm hover:border-teal-700"><p className="font-medium">v{r.version} {r.signatures.length ? "· Signed" : ""}</p><p className="text-xs text-slate-400">{r.authorName} · {r.createdAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}</p><p className="mt-1 text-xs text-slate-500">{r.summary}</p></Link>)}{revisions.length === 200 ? <p className="text-xs text-slate-500">Latest 200 revisions shown.</p> : null}</nav>
      {selected ? <section className="min-w-0 space-y-5"><Card><CardHeader><CardTitle>Version {selected.version} — {selected.title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm">{selected.controlled ? "Controlled document" : "Knowledge page"}</p><p className="break-all font-mono text-xs text-slate-500">SHA-256: {selected.contentHash}</p>{selected.signatures.map(s => <p key={s.id} className="text-sm text-teal-400">{s.meaning} · {s.signerName} · {s.signedAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" })}</p>)}{canEdit && selected.version !== page.version ? <DocActionForm action={actionRestoreDocRevision} submit="Restore as new draft" confirmText="Restore this content as a NEW draft? Existing revisions and signatures will be kept."><input type="hidden" name="id" value={id} /><input type="hidden" name="revisionId" value={selected.id} /><input type="hidden" name="version" value={page.version} /></DocActionForm> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Text diff: {previous ? `v${previous.version}` : "empty"} → v{selected.version}</CardTitle></CardHeader><CardContent><form className="mb-4 flex flex-wrap items-center gap-3"><input type="hidden" name="version" value={selected.version} /><label className="text-sm">Compare with <select name="compare" defaultValue={previous?.version} className="rounded border border-slate-700 bg-slate-950 px-2 py-1">{revisions.filter(r => r.id !== selected.id).map(r => <option key={r.id} value={r.version}>v{r.version}</option>)}</select></label><button className="text-sm text-teal-400 underline">Compare</button></form><p className="mb-3 text-xs text-slate-500">+ added, − removed. First 500 text lines; formatting-only changes are visible in the rendered revision below.</p><div className="overflow-x-auto rounded border border-slate-800 font-mono text-xs">{diff.map((l, i) => <p key={i} className={`whitespace-pre-wrap px-3 py-1 ${l.kind === "added" ? "bg-emerald-950/50 text-emerald-300" : l.kind === "removed" ? "bg-rose-950/50 text-rose-300" : "text-slate-500"}`}>{l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}{l.text || " "}</p>)}</div></CardContent></Card>
        <Card><CardHeader><CardTitle>Rendered revision</CardTitle></CardHeader><CardContent><DocContent content={selected.content} /></CardContent></Card>
      </section> : null}
    </div>
  </div>;
}
