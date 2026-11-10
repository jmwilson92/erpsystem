"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { DocError, requireDocsAccess, createDocSpace, createDocPage, saveDocPage, restoreDocRevision, signDocRevision, addDocComment, resolveDocComment, linkDocRecord, unlinkDocRecord, searchDocTargets, isDocTargetType, docTargetHref } from "@/lib/services/docs";

export type DocActionState = { error?: string; ok?: boolean };
const str = (fd: FormData, name: string) => String(fd.get(name) ?? "");
function message(e: unknown) {
  if (e instanceof DocError) return e.message;
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return "That space, link or signature already exists.";
  return "The change could not be saved. Check the page and retry; no PIN is stored in this error.";
}
async function run(permission: string, fn: () => Promise<unknown>): Promise<DocActionState> {
  await requireDocsAccess(permission);
  try { await fn(); revalidatePath("/docs", "layout"); return { ok: true }; }
  catch (e) { return { error: message(e) }; }
}
export async function actionCreateDocSpace(_: DocActionState, fd: FormData): Promise<DocActionState> {
  let id = "";
  const state = await run("docs.edit", async () => { id = (await createDocSpace({ key: str(fd, "key"), name: str(fd, "name"), description: str(fd, "description") })).id; });
  if (state.ok) redirect(`/docs?space=${id}`);
  return state;
}
export async function actionCreateDocPage(_: DocActionState, fd: FormData): Promise<DocActionState> {
  let id = "";
  const template = str(fd, "template");
  const state = await run("docs.edit", async () => { id = (await createDocPage({ spaceId: str(fd, "spaceId"), parentId: str(fd, "parentId"), title: str(fd, "title"), template: template.startsWith("page:") ? "blank" : template, templatePageId: template.startsWith("page:") ? template.slice(5) : undefined, controlled: fd.get("controlled") === "on", isTemplate: fd.get("isTemplate") === "on" })).id; });
  if (state.ok) redirect(`/docs/pages/${id}/edit`);
  return state;
}
export async function actionSaveDocPage(_: DocActionState, fd: FormData): Promise<DocActionState> {
  const id = str(fd, "id");
  const state = await run("docs.edit", () => saveDocPage({ id, version: Number(str(fd, "version")), title: str(fd, "title"), content: str(fd, "content"), controlled: fd.get("controlled") === "on", isTemplate: fd.get("isTemplate") === "on", parentId: str(fd, "parentId"), summary: str(fd, "summary") }));
  if (state.ok) redirect(`/docs/pages/${id}`);
  return state;
}
export async function actionRestoreDocRevision(_: DocActionState, fd: FormData) {
  return run("docs.edit", () => restoreDocRevision(str(fd, "id"), str(fd, "revisionId"), Number(str(fd, "version"))));
}
export async function actionSignDocRevision(_: DocActionState, fd: FormData) {
  return run("docs.sign", () => signDocRevision(str(fd, "id"), Number(str(fd, "version")), str(fd, "pin")));
}
export async function actionCommentOnDoc(_: DocActionState, fd: FormData) {
  return run("docs.comment", () => addDocComment(str(fd, "id"), str(fd, "body"), Number(str(fd, "version"))));
}
export async function actionResolveDocComment(_: DocActionState, fd: FormData) {
  return run("docs.comment", () => resolveDocComment(str(fd, "commentId")));
}
export async function actionLinkDocRecord(_: DocActionState, fd: FormData) {
  const type = str(fd, "type"), targetId = str(fd, "targetId");
  const result = await run("docs.edit", () => linkDocRecord(str(fd, "pageId"), type, targetId));
  if (result.ok && isDocTargetType(type)) revalidatePath(docTargetHref(type, targetId));
  return result;
}
export async function actionUnlinkDocRecord(_: DocActionState, fd: FormData) {
  const result = await run("docs.edit", () => unlinkDocRecord(str(fd, "pageId"), str(fd, "linkId")));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
export async function actionSearchDocTargets(type: string, q: string) {
  if (!isDocTargetType(type)) return [];
  return searchDocTargets(type, q);
}
