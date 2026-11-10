import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDocsAccess, searchDocTargets, isDocTargetType, docTargetHref } from "@/lib/services/docs";
import { userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DocContent } from "@/components/docs/content";
import { DocPageTree } from "@/components/docs/page-tree";
import { DocActionForm } from "@/components/docs/action-form";
import { DocLinkPicker } from "@/components/docs/link-picker";
import { DocBacklinks } from "@/components/docs/backlinks";
import { actionSignDocRevision, actionCommentOnDoc, actionResolveDocComment, actionUnlinkDocRecord } from "../../actions";
export const dynamic = "force-dynamic";
const date = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "short" });
export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDocsAccess();
  const { id } = await params;
  const page = await prisma.docPage.findUnique({ where: { id }, include: { space: true, comments: { orderBy: { createdAt: "asc" }, take: 200 }, links: true, revisions: { orderBy: { version: "desc" }, take: 1, include: { signatures: true } } } });
  if (!page) notFound();
  const [tree, canEdit, canComment, canSign, targets] = await Promise.all([
    prisma.docPage.findMany({ where: { spaceId: page.spaceId }, select: { id: true, parentId: true, title: true, controlled: true }, orderBy: { title: "asc" } }),
    userHasPermission(user.id, "docs.edit"), userHasPermission(user.id, "docs.comment"), userHasPermission(user.id, "docs.sign"),
    Promise.all(page.links.map(async l => ({ ...l, record: isDocTargetType(l.targetType) ? (await searchDocTargets(l.targetType, "", l.targetId))[0] : undefined }))),
  ]);
  return <div className="space-y-6"><div className="flex flex-wrap gap-2 text-sm text-slate-400"><Link href="/docs" className="text-teal-400">Docs</Link><span>/</span><Link href={`/docs?space=${page.spaceId}`} className="text-teal-400">{page.space.name}</Link><span>/</span><span>{page.title}</span></div>
    <PageHeader title={page.title} description={`${page.space.key} · v${page.version} · ${page.controlled ? `Controlled · ${page.status}` : "Knowledge page"}${page.isTemplate ? " · Template" : ""}`} actions={<div className="flex flex-wrap gap-2"><Link href={`/docs/pages/${id}/history`}><Button size="sm" variant="outline">Version history</Button></Link>{canEdit ? <><Link href={`/docs/new?space=${page.spaceId}&parent=${id}`}><Button size="sm" variant="outline">Child page</Button></Link><Link href={`/docs/pages/${id}/edit`}><Button size="sm">Edit</Button></Link></> : null}</div>} />
    <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]"><aside><DocPageTree pages={tree} currentId={id} /></aside><main className="min-w-0 space-y-6">
      <Card><CardContent className="p-6 sm:p-8"><DocContent content={page.content} /></CardContent></Card>
      {page.controlled ? <Card><CardHeader><CardTitle>Controlled-document approval</CardTitle></CardHeader><CardContent className="space-y-4">{page.revisions[0]?.signatures.map(s => <div key={s.id} className="rounded-lg border border-teal-800 p-3"><p className="text-sm text-teal-300">{s.meaning} by {s.signerName} · v{page.version} · {date(s.signedAt)}</p><p className="mt-1 break-all font-mono text-xs text-slate-500">SHA-256: {s.contentHash}</p></div>)}{page.status === "DRAFT" ? canSign ? <DocActionForm key={`sign-${page.version}`} action={actionSignDocRevision} submit={`Approve and release v${page.version}`} confirmText={`Approve and release exactly version ${page.version} as yourself? Your PIN confirms your identity.`}><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={page.version} /><p className="text-sm text-slate-400">I approve this revision. Signing binds my name, time and the content hash to this immutable version. Editing later creates a new draft.</p><label className="block text-sm">Your e-signature PIN<Input type="password" inputMode="numeric" name="pin" autoComplete="off" required maxLength={64} className="max-w-xs" /></label></DocActionForm> : <p className="text-sm text-slate-500">An individual docs.sign permission is required. A job-role switch does not grant signing rights.</p> : <p className="text-sm text-slate-500">Released. Changes must be saved and signed as a new revision.</p>}</CardContent></Card> : null}
      <Card><CardHeader><CardTitle>Linked work and references</CardTitle></CardHeader><CardContent className="space-y-4">{targets.length ? <ul className="space-y-3">{targets.map(l => <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3"><div className="text-sm">{l.record && isDocTargetType(l.targetType) ? <Link href={docTargetHref(l.targetType, l.targetId)} className="text-teal-400 hover:underline">{l.record.label}</Link> : <span className="text-slate-500">Restricted or deleted record</span>}<p className="text-xs text-slate-500">{l.targetType.replaceAll("_", " ")}</p></div>{canEdit ? <DocActionForm action={actionUnlinkDocRecord} submit="Unlink"><input type="hidden" name="pageId" value={id} /><input type="hidden" name="linkId" value={l.id} /></DocActionForm> : null}</li>)}</ul> : <p className="text-sm text-slate-500">No records linked.</p>}{canEdit ? <DocLinkPicker pageId={id} /> : null}</CardContent></Card>
      <DocBacklinks type="PAGE" targetId={id} />
      <Card><CardHeader><CardTitle>Comments</CardTitle></CardHeader><CardContent className="space-y-5">{page.comments.map(c => <article key={c.id} className={`rounded-lg border p-3 ${c.resolvedAt ? "border-slate-800 opacity-60" : "border-slate-700"}`}><p className="text-xs text-slate-400">{c.authorName} · v{c.version} · {date(c.createdAt)}{c.resolvedAt ? " · Resolved" : ""}</p><p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>{!c.resolvedAt && canComment && (canEdit || c.authorId === user.id) ? <DocActionForm action={actionResolveDocComment} submit="Resolve" className="mt-3"><input type="hidden" name="commentId" value={c.id} /></DocActionForm> : null}</article>)}{page.comments.length === 200 ? <p className="text-xs text-slate-500">Showing the first 200 comments.</p> : null}{canComment ? <DocActionForm key={`comment-${page.version}`} action={actionCommentOnDoc} submit="Add comment"><input type="hidden" name="id" value={id} /><input type="hidden" name="version" value={page.version} /><Textarea name="body" aria-label="Comment" placeholder="Add context, ask a question, or flag a revision…" maxLength={5000} required /></DocActionForm> : null}</CardContent></Card>
    </main></div>
  </div>;
}
