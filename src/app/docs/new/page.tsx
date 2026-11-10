import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDocsAccess } from "@/lib/services/docs";
import { DOC_TEMPLATES } from "@/lib/docs/content";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DocActionForm } from "@/components/docs/action-form";
import { actionCreateDocPage } from "../actions";
export const dynamic = "force-dynamic";
const select = "h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm";
export default async function NewDocPage({ searchParams }: { searchParams: Promise<{ space?: string; parent?: string }> }) {
  await requireDocsAccess("docs.edit");
  const { space, parent } = await searchParams;
  const [spaces, pages, templates] = await Promise.all([prisma.docSpace.findMany({ orderBy: { name: "asc" } }), prisma.docPage.findMany({ where: space ? { spaceId: space } : {}, orderBy: { title: "asc" }, select: { id: true, title: true, space: { select: { key: true } } } }), prisma.docPage.findMany({ where: { isTemplate: true }, select: { id: true, title: true }, take: 100, orderBy: { title: "asc" } })]);
  if (!spaces.length) return <p>Create a <Link className="text-teal-400 underline" href="/docs">space</Link> first.</p>;
  return <div className="mx-auto max-w-3xl space-y-6"><PageHeader title="New Docs page" /><Card><CardContent className="p-6"><DocActionForm action={actionCreateDocPage} submit="Create and edit">
    <label className="block text-sm">Title<Input name="title" required maxLength={180} autoFocus /></label>
    <label className="block text-sm">Space<select name="spaceId" className={select} defaultValue={space}>{spaces.map(s => <option key={s.id} value={s.id}>{s.key} — {s.name}</option>)}</select></label>
    <label className="block text-sm">Parent page (must be in the selected space)<select name="parentId" className={select} defaultValue={parent ?? ""}><option value="">Top level</option>{pages.map(p => <option key={p.id} value={p.id}>{p.space.key} — {p.title}</option>)}</select></label>
    <label className="block text-sm">Template<select name="template" className={select}>{DOC_TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}{templates.map(t => <option key={t.id} value={`page:${t.id}`}>Saved template — {t.title}</option>)}</select></label>
    <label className="flex items-center gap-2 text-sm"><input name="controlled" type="checkbox" />Controlled document (requires PIN approval to release)</label>
    <label className="flex items-center gap-2 text-sm"><input name="isTemplate" type="checkbox" />Make this page reusable as a template</label>
  </DocActionForm></CardContent></Card></div>;
}
