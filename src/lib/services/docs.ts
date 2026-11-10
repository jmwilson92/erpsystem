import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission, userHasPermission } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { isPathEnabled } from "@/lib/modules";
import { parseDocContent, docText, templateContent } from "@/lib/docs/content";
import { verifySignaturePin } from "./signature-pin";

export class DocError extends Error {}
export const DOC_TARGETS = {
  TASK: { label: "Engineering task / ticket", module: "engineering", prefix: "/engineering/tasks/" },
  TICKET: { label: "Legacy engineering ticket", module: "engineering", prefix: "/engineering/tickets/" },
  WORK_ORDER: { label: "Work order", module: "work-orders", prefix: "/work-orders/" },
  PART: { label: "Part / item", module: "items", prefix: "/items/" },
  NCR: { label: "NCR", module: "quality", prefix: "/quality/ncr/" },
  PROGRAM: { label: "PMO program", module: "pmo", prefix: "/pmo/programs/" },
  PAGE: { label: "Docs page", module: "docs", prefix: "/docs/pages/" },
} as const;
export type DocTargetType = keyof typeof DOC_TARGETS;
export const isDocTargetType = (s: string): s is DocTargetType => Object.hasOwn(DOC_TARGETS, s);
export const docTargetHref = (type: DocTargetType, id: string) => `${DOC_TARGETS[type].prefix}${encodeURIComponent(id)}`;

export async function requireDocsAccess(permission = "docs.view") {
  const user = await requirePermission("docs.view");
  if (!user.isActive) throw new DocError("An active account is required");
  const settings = await prisma.companySettings.findFirst({ select: { disabledModules: true } });
  let disabled: string[] = [];
  try { disabled = JSON.parse(settings?.disabledModules || "[]"); } catch { /* match company settings fallback */ }
  if (!isPathEnabled("/docs", Array.isArray(disabled) ? disabled : [])) throw new DocError("Docs is disabled for this company");
  if (permission !== "docs.view" && !(await userHasPermission(user.id, permission))) throw new DocError(`Permission required: ${permission}`);
  return user;
}
function titleValue(s: string) {
  const title = s.trim();
  if (!title || title.length > 180) throw new DocError("A title of 1–180 characters is required");
  return title;
}
function normalizedContent(raw: string) {
  try { const node = parseDocContent(raw); return { content: JSON.stringify(node), plainText: docText(node) }; }
  catch { throw new DocError("Invalid editor document (maximum 250 KB)"); }
}
export function revisionHash(title: string, content: string, controlled: boolean) {
  return createHash("sha256").update(JSON.stringify({ title, content, controlled })).digest("hex");
}
const conflict = () => new DocError("This page changed while you were working. Reload before saving or signing; your unsaved draft is still in the editor.");

export async function createDocSpace(input: { key: string; name: string; description?: string }) {
  const user = await requireDocsAccess("docs.edit");
  const key = input.key.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{1,23}$/.test(key)) throw new DocError("Space key must be 2–24 letters, digits or hyphens, starting with a letter");
  const space = await prisma.docSpace.create({ data: { key, name: titleValue(input.name), description: input.description?.trim().slice(0, 1000), createdById: user.id } });
  await logAudit({ entityType: "DocSpace", entityId: space.id, action: "CREATE", userId: user.id });
  return space;
}
export async function createDocPage(input: { spaceId: string; parentId?: string; title: string; template?: string; templatePageId?: string; controlled?: boolean; isTemplate?: boolean }) {
  const user = await requireDocsAccess("docs.edit");
  await prisma.docSpace.findUniqueOrThrow({ where: { id: input.spaceId } });
  const title = titleValue(input.title);
  if (input.parentId && !(await prisma.docPage.findFirst({ where: { id: input.parentId, spaceId: input.spaceId } }))) throw new DocError("Parent page must be in this space");
  let node = templateContent(input.template ?? "blank");
  if (input.templatePageId) {
    const source = await prisma.docPage.findFirst({ where: { id: input.templatePageId, isTemplate: true } });
    if (!source) throw new DocError("Template no longer exists");
    node = parseDocContent(source.content);
  }
  const controlled = !!input.controlled, content = JSON.stringify(node), plainText = docText(node);
  const page = await prisma.docPage.create({ data: {
    spaceId: input.spaceId, parentId: input.parentId || null, title, content, plainText, controlled, isTemplate: !!input.isTemplate,
    createdById: user.id, updatedById: user.id,
    revisions: { create: { version: 1, title, content, plainText, controlled, contentHash: revisionHash(title, content, controlled), authorId: user.id, authorName: user.name, summary: "Page created" } },
  } });
  await logAudit({ entityType: "DocPage", entityId: page.id, action: "CREATE", userId: user.id });
  return page;
}

export async function saveDocPage(input: { id: string; version: number; title: string; content: string; controlled: boolean; isTemplate: boolean; parentId?: string; summary?: string }) {
  const user = await requireDocsAccess("docs.edit");
  const title = titleValue(input.title), { content, plainText } = normalizedContent(input.content);
  if (!Number.isSafeInteger(input.version) || input.version < 1) throw conflict();
  const page = await prisma.$transaction(async tx => {
    const old = await tx.docPage.findUniqueOrThrow({ where: { id: input.id } });
    if (old.controlled && !input.controlled) throw new DocError("Controlled pages cannot be downgraded; keep revision control enabled");
    // Serialize tree moves within a space: two concurrent moves must not form a cycle.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${old.spaceId}))`;
    let parentId = input.parentId || null;
    const visited = new Set([input.id]);
    while (parentId) {
      if (visited.has(parentId)) throw new DocError("A page cannot be nested inside itself or its descendants");
      visited.add(parentId);
      const parent = await tx.docPage.findUnique({ where: { id: parentId }, select: { parentId: true, spaceId: true } });
      if (!parent || parent.spaceId !== old.spaceId) throw new DocError("Parent must be in this space");
      parentId = parent.parentId;
    }
    const updated = await tx.docPage.updateMany({ where: { id: input.id, version: input.version }, data: { title, content, plainText, controlled: input.controlled, isTemplate: input.isTemplate, parentId: input.parentId || null, version: { increment: 1 }, status: "DRAFT", updatedById: user.id } });
    if (updated.count !== 1) throw conflict();
    await tx.docRevision.create({ data: { pageId: input.id, version: input.version + 1, title, content, plainText, controlled: input.controlled, contentHash: revisionHash(title, content, input.controlled), summary: input.summary?.trim().slice(0, 500) || "Page updated", authorId: user.id, authorName: user.name } });
    return tx.docPage.findUniqueOrThrow({ where: { id: input.id } });
  });
  await logAudit({ entityType: "DocPage", entityId: page.id, action: "REVISE", userId: user.id, metadata: { version: page.version } });
  return page;
}
export async function restoreDocRevision(id: string, revisionId: string, version: number) {
  await requireDocsAccess("docs.edit");
  const [revision, page] = await Promise.all([
    prisma.docRevision.findFirst({ where: { id: revisionId, pageId: id } }), prisma.docPage.findUnique({ where: { id } }),
  ]);
  if (!revision || !page) throw new DocError("Revision not found");
  return saveDocPage({ id, version, title: revision.title, content: revision.content, controlled: page.controlled || revision.controlled, isTemplate: page.isTemplate, parentId: page.parentId ?? undefined, summary: `Restored version ${revision.version} as a new draft` });
}
export async function signDocRevision(id: string, version: number, pin: string) {
  const user = await requireDocsAccess("docs.sign");
  let signer;
  try { signer = await verifySignaturePin(user.id, pin); }
  catch { throw new DocError("PIN could not be verified. Use your own PIN from My Account."); }
  // Version match + row lock ensures an edit racing this signature cannot release different content.
  const signature = await prisma.$transaction(async tx => {
    const updated = await tx.docPage.updateMany({ where: { id, version, controlled: true, status: "DRAFT" }, data: { status: "RELEASED" } });
    if (updated.count !== 1) throw conflict();
    const revision = await tx.docRevision.findUniqueOrThrow({ where: { pageId_version: { pageId: id, version } } });
    if (revision.contentHash !== revisionHash(revision.title, revision.content, revision.controlled)) throw new DocError("Revision integrity check failed");
    return tx.docSignature.create({ data: { revisionId: revision.id, userId: user.id, signerName: signer.name, contentHash: revision.contentHash, pinVerified: true, meaning: "APPROVED" } });
  });
  await logAudit({ entityType: "DocPage", entityId: id, action: "PIN_SIGNED", userId: user.id, metadata: { version, signatureId: signature.id, contentHash: signature.contentHash, meaning: signature.meaning } });
  return signature;
}
export async function addDocComment(id: string, body: string, version: number) {
  const user = await requireDocsAccess("docs.comment");
  const page = await prisma.docPage.findUniqueOrThrow({ where: { id } });
  if (!body.trim() || body.length > 5000) throw new DocError("Comment must be 1–5,000 characters");
  if (page.version !== version) throw conflict();
  return prisma.docComment.create({ data: { pageId: id, version, body: body.trim(), authorId: user.id, authorName: user.name } });
}
export async function resolveDocComment(id: string) {
  const user = await requireDocsAccess("docs.comment");
  const comment = await prisma.docComment.findUniqueOrThrow({ where: { id } });
  if (comment.authorId !== user.id && !(await userHasPermission(user.id, "docs.edit"))) throw new DocError("Only the author or an editor can resolve a comment");
  return prisma.docComment.update({ where: { id }, data: { resolvedAt: new Date(), resolvedById: user.id } });
}

export async function searchDocTargets(type: DocTargetType, query: string, exactId?: string) {
  const user = await requireDocsAccess();
  if (!isDocTargetType(type)) throw new DocError("Unsupported record type");
  if (!(await userHasPermission(user.id, `${DOC_TARGETS[type].module}.view`))) return [];
  const q = query.trim().slice(0, 100), take = exactId ? 1 : 30;
  const str = (value: string) => ({ contains: value, mode: "insensitive" as const });
  // Each delegate is tenant-routed; a target ID from another tenant never resolves.
  switch (type) {
    case "TASK": return (await prisma.engTask.findMany({ where: exactId ? { id: exactId } : { OR: [{ number: str(q) }, { name: str(q) }] }, take, orderBy: { number: "asc" }, select: { id: true, number: true, name: true } })).map(r => ({ id: r.id, label: `${r.number} — ${r.name}` }));
    case "TICKET": return (await prisma.engineeringTicket.findMany({ where: exactId ? { id: exactId } : { OR: [{ number: str(q) }, { title: str(q) }] }, take, orderBy: { number: "asc" }, select: { id: true, number: true, title: true } })).map(r => ({ id: r.id, label: `${r.number} — ${r.title}` }));
    case "WORK_ORDER": return (await prisma.workOrder.findMany({ where: exactId ? { id: exactId } : { number: str(q) }, take, orderBy: { number: "asc" }, select: { id: true, number: true } })).map(r => ({ id: r.id, label: r.number }));
    case "PART": return (await prisma.part.findMany({ where: exactId ? { id: exactId } : { OR: [{ partNumber: str(q) }, { description: str(q) }] }, take, orderBy: { partNumber: "asc" }, select: { id: true, partNumber: true, description: true } })).map(r => ({ id: r.id, label: `${r.partNumber} — ${r.description}` }));
    case "NCR": return (await prisma.nonConformance.findMany({ where: exactId ? { id: exactId } : { OR: [{ number: str(q) }, { title: str(q) }] }, take, orderBy: { number: "asc" }, select: { id: true, number: true, title: true } })).map(r => ({ id: r.id, label: `${r.number} — ${r.title}` }));
    case "PROGRAM": return (await prisma.program.findMany({ where: exactId ? { id: exactId } : { OR: [{ code: str(q) }, { name: str(q) }] }, take, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } })).map(r => ({ id: r.id, label: `${r.code} — ${r.name}` }));
    case "PAGE": return (await prisma.docPage.findMany({ where: exactId ? { id: exactId } : { title: str(q) }, take, orderBy: { title: "asc" }, select: { id: true, title: true } })).map(r => ({ id: r.id, label: r.title }));
  }
}
export async function linkDocRecord(pageId: string, type: string, targetId: string) {
  const user = await requireDocsAccess("docs.edit");
  if (!isDocTargetType(type)) throw new DocError("Unsupported record type");
  if (type === "PAGE" && pageId === targetId) throw new DocError("A page cannot link to itself");
  await prisma.docPage.findUniqueOrThrow({ where: { id: pageId } });
  if (!(await searchDocTargets(type, "", targetId)).length) throw new DocError("Record not found or not accessible in this company");
  const link = await prisma.docLink.upsert({ where: { pageId_targetType_targetId: { pageId, targetType: type, targetId } }, create: { pageId, targetType: type, targetId, createdById: user.id }, update: {} });
  await logAudit({ entityType: "DocPage", entityId: pageId, action: "LINK", userId: user.id, metadata: { type, targetId } });
  return link;
}
export async function unlinkDocRecord(pageId: string, linkId: string) {
  const user = await requireDocsAccess("docs.edit");
  await prisma.docLink.deleteMany({ where: { id: linkId, pageId } });
  await logAudit({ entityType: "DocPage", entityId: pageId, action: "UNLINK", userId: user.id, metadata: { linkId } });
}
export function isDocsSchemaMissing(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code) && /Doc(Space|Page|Revision|Signature|Comment|Link)/i.test(String(error.meta?.table ?? error.meta?.column ?? error.message));
}
