import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocActionForm } from "./action-form";
import { actionLinkDocRecord } from "@/app/docs/actions";
import { DocError, isDocsSchemaMissing, requireDocsAccess, type DocTargetType } from "@/lib/services/docs";

/** Soft landing during additive rollout: missing Doc tables never break another module. */
export async function DocBacklinks({ type, targetId }: { type: DocTargetType; targetId: string }) {
  const user = await getCurrentUser();
  if (!user || !(await userHasPermission(user.id, "docs.view"))) return null;
  try {
    await requireDocsAccess();
    const canEdit = await userHasPermission(user.id, "docs.edit");
    const [links, pages] = await Promise.all([
      prisma.docLink.findMany({ where: { targetType: type, targetId }, include: { page: { select: { id: true, title: true, version: true, controlled: true, status: true, space: { select: { key: true } } } } }, orderBy: { createdAt: "desc" } }),
      canEdit ? prisma.docPage.findMany({ where: type === "PAGE" ? { id: { not: targetId } } : {}, select: { id: true, title: true, space: { select: { key: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }) : [],
    ]);
    return <Card><CardHeader><CardTitle>Linked Docs / backlinks</CardTitle></CardHeader><CardContent className="space-y-4">{links.length ? <ul className="space-y-2">{links.map(l => <li key={l.id}><Link href={`/docs/pages/${l.page.id}`} className="text-sm text-teal-400 hover:underline">{l.page.space.key} · {l.page.title}</Link><span className="ml-2 text-xs text-slate-500">v{l.page.version}{l.page.controlled ? ` · ${l.page.status}` : ""}</span></li>)}</ul> : <p className="text-sm text-slate-500">No knowledge pages linked yet.</p>}
      {canEdit && pages.length ? <DocActionForm action={actionLinkDocRecord} submit="Link a Docs page"><input type="hidden" name="type" value={type} /><input type="hidden" name="targetId" value={targetId} /><select aria-label="Docs page to link" name="pageId" required className="h-10 w-full rounded border border-slate-700 bg-slate-950 px-2 text-sm">{pages.map(p => <option key={p.id} value={p.id}>{p.space.key} — {p.title}</option>)}</select><p className="text-xs text-slate-500">Recent 100 pages. For older pages, open Docs and link from there.</p></DocActionForm> : null}
    </CardContent></Card>;
  } catch (e) {
    if (isDocsSchemaMissing(e)) return <p className="text-xs text-slate-500">Linked Docs will appear after the Docs schema backfill.</p>;
    if (e instanceof DocError) return null;
    throw e;
  }
}
