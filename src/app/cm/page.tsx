import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, cn } from "@/lib/utils";
import {
  actionCreateCmFolder,
  actionDeleteCmFolder,
  actionMoveCmDocument,
  actionDeleteCmDocument,
} from "@/app/actions";
import {
  mapCrToColumn,
  mapDocumentEcrToColumn,
  mapWiToColumn,
  mapBomToColumn,
  ensureAdminFolder,
  type CmBoardColumn,
} from "@/lib/services/cm-library";
import {
  listNumberSchemes,
  listNumberRequests,
  listNumberRegistry,
  listAvailableNumbersForEcr,
  ensureDefaultNumberSchemes,
} from "@/lib/services/cm-numbers";
import { DocumentEcrForm } from "@/components/cm/document-ecr-form";
import { CmSubmissionsBoard } from "@/components/cm/cm-board";
import { CmNumbersPanel } from "@/components/cm/cm-numbers-panel";
import { parseEcrAttachments } from "@/lib/services/cm-library";
import Link from "next/link";
import {
  Folder,
  FolderPlus,
  FileText,
  ChevronRight,
  LayoutGrid,
  Library,
  Trash2,
  Shield,
  Package,
  Hash,
} from "lucide-react";

export const dynamic = "force-dynamic";

function pick(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v || "";
}

const BOARD_COLUMNS: {
  id: CmBoardColumn;
  label: string;
  accent: string;
}[] = [
  {
    id: "IN_WORK",
    label: "In work",
    accent: "border-slate-600 bg-slate-900/40",
  },
  {
    id: "SUBMITTED",
    label: "Submitted",
    accent: "border-sky-500/40 bg-sky-500/5",
  },
  {
    id: "IN_REVIEW",
    label: "In review",
    accent: "border-amber-500/40 bg-amber-500/5",
  },
  {
    id: "APPROVED",
    label: "Approved",
    accent: "border-teal-500/40 bg-teal-500/5",
  },
  {
    id: "RELEASED",
    label: "Released",
    accent: "border-emerald-500/40 bg-emerald-500/5",
  },
];

type BoardCard = {
  id: string;
  kind: "CR" | "WI" | "BOM";
  number: string;
  title: string;
  type: string;
  status: string;
  priority?: string;
  href?: string;
  meta?: string;
  column: CmBoardColumn;
  changeRequestId?: string;
  boardMembers?: {
    id: string;
    userId: string;
    role: string;
    vote: string | null;
  }[];
  // Document ECR extras
  isDocumentEcr?: boolean;
  documentNumber?: string | null;
  documentRevision?: string | null;
  productName?: string | null;
  productFolderId?: string | null;
  isCompanyInternal?: boolean;
  isDocumentUpdate?: boolean;
  releaseFolderId?: string | null;
  releasedDocumentId?: string | null;
  documentFileUrl?: string | null;
  documentFileName?: string | null;
  attachments?: {
    id: string;
    url: string;
    fileName: string;
    caption?: string | null;
    uploadedAt: string;
    isPrimary?: boolean;
  }[];
  comments?: {
    id: string;
    body: string;
    authorName: string | null;
    createdAt: string | Date;
  }[];
};

export default async function CmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const tab = pick(sp, "tab") || "submissions";
  const folderId = pick(sp, "folder") || null;
  const numbersPanel = (pick(sp, "panel") || "request") as
    | "request"
    | "requests"
    | "master"
    | "schemes";
  const registrySearch = pick(sp, "q") || "";

  // Admin folder always available for both library + document ECR
  await ensureAdminFolder();
  await ensureDefaultNumberSchemes();

  const [crs, wis, boms, folders, currentFolder, documents, cmUsers, libraryDocs, numberSchemes, numberRequests, numberRegistry, assignedNumbers] =
    await Promise.all([
      prisma.changeRequest.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          boardMembers: true,
          bomHeader: { include: { part: true } },
          workInstruction: true,
          productFolder: true,
          sourceDocument: true,
          releasedDocument: true,
          comments: { orderBy: { createdAt: "asc" } },
        },
      }),
      prisma.workInstruction.findMany({
        where: { status: { not: "OBSOLETE" } },
        orderBy: { updatedAt: "desc" },
        take: 80,
        include: { part: true },
      }),
      prisma.bomHeader.findMany({
        where: { status: { not: "OBSOLETE" } },
        orderBy: { updatedAt: "desc" },
        take: 80,
        include: { part: true },
      }),
      prisma.cmFolder.findMany({
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          _count: { select: { children: true, documents: true } },
        },
      }),
      folderId
        ? prisma.cmFolder.findUnique({
            where: { id: folderId },
            include: {
              parent: true,
              children: {
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                include: {
                  _count: { select: { documents: true, children: true } },
                },
              },
            },
          })
        : Promise.resolve(null),
      prisma.cmDocument.findMany({
        where: folderId ? { folderId } : { folderId: null },
        orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
        include: {
          part: { select: { partNumber: true } },
          workInstruction: {
            select: { id: true, documentNumber: true, revision: true },
          },
          bomHeader: {
            select: {
              id: true,
              revision: true,
              part: { select: { partNumber: true } },
            },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          isActive: true,
          role: {
            in: [
              "CM",
              "ENGINEERING",
              "QUALITY",
              "ADMIN",
              "PRODUCTION",
              "PURCHASING",
            ],
          },
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true, role: true },
      }),
      prisma.cmDocument.findMany({
        where: { isArchived: false, status: { in: ["RELEASED", "IN_WORK"] } },
        orderBy: [{ number: "asc" }, { revision: "desc" }],
        take: 300,
        select: {
          id: true,
          number: true,
          title: true,
          revision: true,
          docType: true,
          fileUrl: true,
          fileName: true,
          description: true,
          folder: {
            select: {
              id: true,
              name: true,
              productName: true,
              kind: true,
            },
          },
        },
      }),
      listNumberSchemes(false),
      listNumberRequests({ limit: 100 }),
      listNumberRegistry({
        search: registrySearch || undefined,
        limit: 500,
      }),
      listAvailableNumbersForEcr(),
    ]);

  const userIds = [
    ...new Set([
      ...crs.flatMap((c) => c.boardMembers.map((m) => m.userId)),
      ...cmUsers.map((u) => u.id),
    ]),
  ];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  // Build board cards — CRs primary; WIs/BOMs without CR appear as in-work/pipeline
  const wiIdsWithCr = new Set(
    crs.map((c) => c.workInstructionId).filter(Boolean) as string[]
  );
  const bomIdsWithCr = new Set(
    crs.map((c) => c.bomHeaderId).filter(Boolean) as string[]
  );

  const cards: BoardCard[] = [];

  for (const cr of crs) {
    // Released document ECRs live in library — hide from board once implemented
    if (cr.documentNumber && cr.status === "IMPLEMENTED") continue;

    let attachments = parseEcrAttachments(cr.documentAttachments);
    if (
      attachments.length === 0 &&
      cr.documentFileUrl &&
      cr.documentFileName
    ) {
      attachments = [
        {
          id: "legacy-primary",
          url: cr.documentFileUrl,
          fileName: cr.documentFileName,
          caption: null,
          uploadedAt: cr.createdAt.toISOString(),
          uploadedById: cr.requestedById,
          isPrimary: true,
        },
      ];
    }

    const isDocumentEcr = Boolean(cr.documentNumber);
    cards.push({
      id: `cr-${cr.id}`,
      kind: "CR",
      number: cr.number,
      title: cr.title,
      type: cr.type,
      status: cr.status,
      priority: cr.priority,
      // Document ECRs start (and stay out of) Submitted — not In work
      column: isDocumentEcr
        ? mapDocumentEcrToColumn(cr.status)
        : mapCrToColumn(cr.status),
      changeRequestId: cr.id,
      isDocumentEcr,
      documentNumber: cr.documentNumber,
      documentRevision: cr.documentRevision,
      productName: cr.productName,
      productFolderId: cr.productFolderId,
      isCompanyInternal: cr.isCompanyInternal,
      isDocumentUpdate: cr.isDocumentUpdate,
      releaseFolderId: cr.releaseFolderId,
      releasedDocumentId: cr.releasedDocumentId,
      documentFileUrl: cr.documentFileUrl,
      documentFileName: cr.documentFileName,
      attachments,
      comments: cr.comments.map((c) => ({
        id: c.id,
        body: c.body,
        authorName: c.authorName,
        createdAt: c.createdAt,
      })),
      meta: [
        cr.documentNumber
          ? `${cr.documentNumber} Rev ${cr.documentRevision || "?"}`
          : null,
        cr.documentDocType || null,
        cr.productName
          ? cr.isCompanyInternal
            ? "Admin / internal"
            : `Product: ${cr.productName}`
          : null,
        cr.isDocumentUpdate ? "Update" : cr.documentNumber ? "New" : null,
        attachments.length
          ? `${attachments.length} file${attachments.length === 1 ? "" : "s"}`
          : null,
        cr.comments.length
          ? `${cr.comments.length} note${cr.comments.length === 1 ? "" : "s"}`
          : null,
        cr.workInstruction
          ? `WI ${cr.workInstruction.documentNumber}`
          : null,
        cr.bomHeader
          ? `BOM ${cr.bomHeader.part.partNumber} Rev ${cr.bomHeader.revision}`
          : null,
        formatDate(cr.createdAt),
      ]
        .filter(Boolean)
        .join(" · "),
      href: cr.workInstructionId
        ? `/work-instructions/${cr.workInstructionId}`
        : cr.bomHeaderId
          ? `/bom/${cr.bomHeaderId}`
          : cr.releasedDocumentId
            ? `/cm?tab=library&folder=${cr.releaseFolderId || ""}`
            : undefined,
      boardMembers: cr.boardMembers.map((m) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        vote: m.vote,
      })),
    });
  }

  for (const wi of wis) {
    if (wiIdsWithCr.has(wi.id)) continue;
    // Only show open pipeline WIs not already on a CR
    if (wi.status === "RELEASED") continue;
    cards.push({
      id: `wi-${wi.id}`,
      kind: "WI",
      number: `${wi.documentNumber} Rev ${wi.revision}`,
      title: wi.title,
      type: "WORK_INSTRUCTION",
      status: wi.status,
      column: mapWiToColumn(wi.status),
      href: `/work-instructions/${wi.id}`,
      meta: [
        wi.part?.partNumber,
        formatDate(wi.updatedAt),
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const bom of boms) {
    if (bomIdsWithCr.has(bom.id)) continue;
    if (bom.status === "CERTIFIED") continue;
    cards.push({
      id: `bom-${bom.id}`,
      kind: "BOM",
      number: `${bom.part.partNumber} Rev ${bom.revision}`,
      title: bom.description || bom.part.description,
      type: "BOM",
      status: bom.status,
      column: mapBomToColumn(bom.status),
      href: `/bom/${bom.id}`,
      meta: formatDate(bom.updatedAt),
    });
  }

  // Product roots vs Admin
  const adminRoot = folders.find(
    (f) => f.kind === "ADMIN" && !f.parentId
  );
  const productRoots = folders.filter(
    (f) => !f.parentId && f.kind === "PRODUCT"
  );
  // Folders valid for release destination (product roots, admin, their subfolders)
  const releaseFolders = folders.filter((f) => f.kind !== "ARCHIVE");
  const childFolders = currentFolder ? currentFolder.children : [];

  // Breadcrumb path for library
  const breadcrumb: { id: string | null; name: string }[] = [
    { id: null, name: "All products" },
  ];
  if (currentFolder) {
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    const chain: { id: string; name: string }[] = [];
    let cur: (typeof folders)[0] | undefined = folders.find(
      (f) => f.id === currentFolder.id
    );
    while (cur) {
      chain.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? byId[cur.parentId] : undefined;
    }
    breadcrumb.push(...chain);
  }

  const inAdmin =
    currentFolder?.kind === "ADMIN" ||
    (!!currentFolder?.parentId &&
      folders.find((f) => f.id === currentFolder.parentId)?.kind === "ADMIN");
  const isProductRoot =
    !!currentFolder && !currentFolder.parentId && currentFolder.kind === "PRODUCT";

  return (
    <div className="space-y-6">
      <PageHeader title="Configuration Management" />

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        <Link
          href="/cm?tab=submissions"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
            tab !== "library" && tab !== "numbers"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          CM submissions
        </Link>
        <Link
          href="/cm?tab=library"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
            tab === "library"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          <Library className="h-3.5 w-3.5" />
          CM library
        </Link>
        <Link
          href="/cm?tab=numbers"
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
            tab === "numbers"
              ? "bg-slate-800 text-slate-50"
              : "text-slate-400 hover:text-slate-200"
          )}
        >
          <Hash className="h-3.5 w-3.5" />
          Numbers
          {numberRequests.filter((r) => r.status === "PENDING").length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-300">
              {numberRequests.filter((r) => r.status === "PENDING").length}
            </span>
          )}
        </Link>
      </div>

      {/* ═══════════════ NUMBER CONTROL ═══════════════ */}
      {tab === "numbers" && (
        <CmNumbersPanel
          initialPanel={numbersPanel}
          searchQuery={registrySearch}
          schemes={numberSchemes.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            description: s.description,
            appliesTo: s.appliesTo,
            prefix: s.prefix,
            separator: s.separator,
            padLength: s.padLength,
            suffix: s.suffix,
            nextSequence: s.nextSequence,
            example: s.example,
            isActive: s.isActive,
            sortOrder: s.sortOrder,
          }))}
          requests={numberRequests.map((r) => ({
            id: r.id,
            requestNumber: r.requestNumber,
            status: r.status,
            category: r.category,
            title: r.title,
            description: r.description,
            preferredNumber: r.preferredNumber,
            productName: r.productName,
            assignedNumber: r.assignedNumber,
            assignedAt: r.assignedAt ? r.assignedAt.toISOString() : null,
            cmNotes: r.cmNotes,
            rejectedReason: r.rejectedReason,
            requestedByName: r.requestedByName,
            createdAt: r.createdAt.toISOString(),
            scheme: r.scheme
              ? {
                  id: r.scheme.id,
                  code: r.scheme.code,
                  name: r.scheme.name,
                  example: r.scheme.example,
                }
              : null,
          }))}
          registry={numberRegistry.map((row) => ({
            id: row.id,
            number: row.number,
            category: row.category,
            title: row.title,
            description: row.description,
            status: row.status,
            productName: row.productName,
            assignedAt: row.assignedAt.toISOString(),
            notes: row.notes,
            scheme: row.scheme,
            request: row.request,
          }))}
          productFolders={productRoots.map((f) => ({
            id: f.id,
            name: f.name,
            productName: f.productName,
          }))}
        />
      )}

      {/* ═══════════════ SUBMISSIONS BOARD ═══════════════ */}
      {tab !== "library" && tab !== "numbers" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Drag tiles by the grip handle between columns. Click a card body for
            full details (drawing, discussion, approvers). Document ECRs: CM
            assigns two approvers, then release from Approved with a library
            folder pick.
          </p>

          <DocumentEcrForm
            productFolders={productRoots.map((f) => ({
              id: f.id,
              name: f.name,
              productName: f.productName,
              kind: f.kind,
            }))}
            adminFolderId={adminRoot?.id || null}
            libraryDocs={libraryDocs}
            assignedNumbers={assignedNumbers.map((n) => ({
              id: n.id,
              number: n.number,
              title: n.title,
              category: n.category,
              status: n.status,
              productName: n.productName,
            }))}
          />

          <CmSubmissionsBoard
            columns={BOARD_COLUMNS}
            initialCards={cards.map((c) => ({
              id: c.id,
              kind: c.kind,
              number: c.number,
              title: c.title,
              type: c.type,
              status: c.status,
              priority: c.priority,
              href: c.href,
              meta: c.meta,
              column: c.column,
              changeRequestId: c.changeRequestId,
              boardMembers: c.boardMembers,
              isDocumentEcr: c.isDocumentEcr,
              documentNumber: c.documentNumber,
              documentRevision: c.documentRevision,
              productName: c.productName,
              productFolderId: c.productFolderId,
              isCompanyInternal: c.isCompanyInternal,
              isDocumentUpdate: c.isDocumentUpdate,
              releaseFolderId: c.releaseFolderId,
              releasedDocumentId: c.releasedDocumentId,
              attachments: (c.attachments || []).map((a) => ({ id: a.id })),
              comments: (c.comments || []).map((cm) => ({ id: cm.id })),
            }))}
            userMap={Object.fromEntries(
              Object.entries(userMap).map(([id, u]) => [id, { name: u.name }])
            )}
            cmUsers={cmUsers}
            releaseFolders={releaseFolders.map((f) => ({
              id: f.id,
              name: f.name,
              kind: f.kind,
              productName: f.productName,
              parentId: f.parentId,
            }))}
            adminRootId={adminRoot?.id || null}
          />

        </div>
      )}

      {/* ═══════════════ CM LIBRARY (by product + Admin) ═══════════════ */}
      {tab === "library" && (
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Product / Admin tree */}
          <Card className="lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Organize by product</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link
                href="/cm?tab=library"
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                  !folderId
                    ? "bg-slate-800 text-teal-400"
                    : "text-slate-400 hover:bg-slate-900"
                )}
              >
                <Package className="h-3.5 w-3.5" />
                All products
              </Link>

              {/* Company Admin */}
              <div>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Company
                </p>
                {adminRoot ? (
                  <Link
                    href={`/cm?tab=library&folder=${adminRoot.id}`}
                    className={cn(
                      "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm",
                      folderId === adminRoot.id
                        ? "bg-violet-500/15 text-violet-300"
                        : "text-slate-400 hover:bg-slate-900"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Shield className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                      <span className="truncate">Admin</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      {adminRoot._count.documents}
                    </span>
                  </Link>
                ) : (
                  <p className="px-2 text-[11px] text-slate-600">Loading…</p>
                )}
                <p className="mt-0.5 px-2 text-[10px] text-slate-600">
                  Policies via CM submissions only
                </p>
              </div>

              {/* Products */}
              <div>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                  Products
                </p>
                {productRoots.length === 0 && (
                  <p className="px-2 text-[11px] text-slate-600">
                    No product folders yet
                  </p>
                )}
                {productRoots.map((f) => (
                  <Link
                    key={f.id}
                    href={`/cm?tab=library&folder=${f.id}`}
                    className={cn(
                      "flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm",
                      folderId === f.id
                        ? "bg-slate-800 text-teal-400"
                        : "text-slate-400 hover:bg-slate-900"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Package className="h-3.5 w-3.5 shrink-0 text-amber-400/90" />
                      <span className="truncate">
                        {f.productName || f.name}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-600">
                      {f._count.documents}
                    </span>
                  </Link>
                ))}
              </div>

              {/* Create product (only at library root context) */}
              {!folderId && (
                <form
                  action={actionCreateCmFolder}
                  className="space-y-2 border-t border-slate-800 pt-3"
                >
                  <input type="hidden" name="kind" value="PRODUCT" />
                  <p className="text-[10px] uppercase text-slate-500">
                    New product
                  </p>
                  <Input
                    name="name"
                    required
                    placeholder="Product name e.g. Radiator Gen3"
                    className="h-8 text-sm"
                  />
                  <Input
                    name="productTag"
                    placeholder="SKU / family code (optional)"
                    className="h-8 text-sm"
                  />
                  <Textarea
                    name="description"
                    rows={2}
                    placeholder="What this product folder holds…"
                    className="text-sm"
                  />
                  <Button type="submit" size="sm" className="w-full">
                    <FolderPlus className="mr-1 h-3.5 w-3.5" />
                    Create product folder
                  </Button>
                </form>
              )}

              {/* Subfolder under current product / admin */}
              {folderId && (
                <form
                  action={actionCreateCmFolder}
                  className="space-y-2 border-t border-slate-800 pt-3"
                >
                  <input type="hidden" name="parentId" value={folderId} />
                  <p className="text-[10px] uppercase text-slate-500">
                    New subfolder
                    {inAdmin
                      ? " (under Admin)"
                      : isProductRoot
                        ? " (under product)"
                        : ""}
                  </p>
                  <Input
                    name="name"
                    required
                    placeholder={
                      inAdmin
                        ? "e.g. Quality policies"
                        : "e.g. Assembly drawings"
                    }
                    className="h-8 text-sm"
                  />
                  <Button type="submit" size="sm" className="w-full" variant="outline">
                    <FolderPlus className="mr-1 h-3.5 w-3.5" />
                    Add subfolder
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Content */}
          <div className="space-y-4 lg:col-span-9">
            <div className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
              {breadcrumb.map((b, i) => (
                <span key={b.id || "root"} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3 w-3" />}
                  <Link
                    href={
                      b.id
                        ? `/cm?tab=library&folder=${b.id}`
                        : "/cm?tab=library"
                    }
                    className={
                      i === breadcrumb.length - 1
                        ? "font-medium text-slate-200"
                        : "hover:text-sky-400"
                    }
                  >
                    {b.name}
                  </Link>
                </span>
              ))}
            </div>

            {!folderId && (
              <Card className="border-slate-800 bg-slate-950/40">
                <CardContent className="space-y-2 p-4 text-sm text-slate-400">
                  <p className="font-medium text-slate-200">
                    Library is organized by product
                  </p>
                  <p className="text-xs">
                    CM manager creates <strong className="text-slate-300">product</strong>{" "}
                    and <strong className="text-violet-300">Admin</strong> folders.
                    Drawings and policies only enter the library after an ECR is
                    approved and released on{" "}
                    <Link
                      href="/cm?tab=submissions"
                      className="text-sky-400 hover:underline"
                    >
                      CM submissions
                    </Link>
                    — nothing is filed manually here.
                  </p>
                  {productRoots.length === 0 && (
                    <p className="text-xs text-amber-400/90">
                      No products yet — add one on the left.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Product grid on root */}
            {!folderId && productRoots.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {productRoots.map((f) => (
                  <Link
                    key={f.id}
                    href={`/cm?tab=library&folder=${f.id}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-4 hover:border-teal-500/30"
                  >
                    <Package className="h-9 w-9 text-amber-400/90" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-100">
                        {f.productName || f.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {f._count.documents} doc(s)
                        {f._count.children
                          ? ` · ${f._count.children} folder(s)`
                          : ""}
                        {f.productTag ? ` · ${f.productTag}` : ""}
                      </p>
                    </div>
                  </Link>
                ))}
                {adminRoot && (
                  <Link
                    href={`/cm?tab=library&folder=${adminRoot.id}`}
                    className="flex items-center gap-3 rounded-lg border border-violet-900/40 bg-violet-500/5 p-4 hover:border-violet-500/40"
                  >
                    <Shield className="h-9 w-9 text-violet-400" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-violet-100">
                        Admin
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {adminRoot._count.documents} company doc(s) · policies
                      </p>
                    </div>
                  </Link>
                )}
              </div>
            )}

            {currentFolder && (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {currentFolder.kind === "ADMIN" || inAdmin ? (
                      <Shield className="h-5 w-5 text-violet-400" />
                    ) : (
                      <Package className="h-5 w-5 text-amber-400" />
                    )}
                    <h2 className="text-lg font-semibold text-slate-100">
                      {currentFolder.productName || currentFolder.name}
                    </h2>
                    {currentFolder.kind === "ADMIN" && !currentFolder.parentId && (
                      <StatusBadge status="ADMIN" />
                    )}
                    {isProductRoot && <StatusBadge status="PRODUCT" />}
                  </div>
                  {currentFolder.description && (
                    <p className="mt-1 text-xs text-slate-500">
                      {currentFolder.description}
                    </p>
                  )}
                  {currentFolder.productTag && (
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      Tag: {currentFolder.productTag}
                    </p>
                  )}
                </div>
                {!currentFolder.isSystem && (
                  <form action={actionDeleteCmFolder}>
                    <input type="hidden" name="id" value={currentFolder.id} />
                    <Button type="submit" size="sm" variant="outline">
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </form>
                )}
              </div>
            )}

            {childFolders.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {childFolders.map((f) => (
                  <Link
                    key={f.id}
                    href={`/cm?tab=library&folder=${f.id}`}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/50 p-3 hover:border-teal-500/30"
                  >
                    <Folder className="h-8 w-8 text-amber-400/80" />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-200">
                        {f.name}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {f._count.documents} doc(s)
                        {f._count.children
                          ? ` · ${f._count.children} subfolder(s)`
                          : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Documents — only when inside a folder */}
            {folderId && (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {inAdmin ? "Policies & internal docs" : "Drawings & documents"}
                      <span className="ml-2 font-normal text-xs text-slate-500">
                        ({documents.length})
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {documents.length === 0 && (
                      <p className="py-6 text-center text-sm text-slate-500">
                        {inAdmin
                          ? "No company policies yet. You cannot file them here — start a company-internal document ECR on CM submissions; after two approvers and CM release, it lands in Admin."
                          : "No drawings here yet. You cannot add them in the library — create a document ECR on CM submissions with this product; CM releases into this folder after approval."}
                      </p>
                    )}
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <FileText className="h-3.5 w-3.5 text-sky-400" />
                            <span className="font-mono text-sm text-teal-400">
                              {doc.number}
                            </span>
                            <span className="text-xs text-slate-500">
                              Rev {doc.revision}
                            </span>
                            <StatusBadge status={doc.docType} />
                            <StatusBadge status={doc.status} />
                          </div>
                          <p className="mt-0.5 text-sm text-slate-200">
                            {doc.title}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {[
                              doc.productTag,
                              doc.part?.partNumber,
                              doc.workInstruction
                                ? `WI ${doc.workInstruction.documentNumber}`
                                : null,
                              doc.bomHeader
                                ? `BOM ${doc.bomHeader.part.partNumber} Rev ${doc.bomHeader.revision}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || formatDate(doc.createdAt)}
                          </p>
                          {doc.fileUrl && (
                            <a
                              href={doc.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-0.5 inline-block text-xs text-sky-400 hover:underline"
                            >
                              {doc.fileName || "Open file / link"}
                            </a>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <form
                            action={actionMoveCmDocument}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="id" value={doc.id} />
                            <select
                              name="folderId"
                              className="h-7 max-w-[160px] rounded border border-slate-700 bg-slate-950 px-1 text-[10px]"
                              defaultValue={doc.folderId || ""}
                            >
                              <option value="">— Unfiled —</option>
                              {folders.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.kind === "ADMIN" && !f.parentId
                                    ? "Admin"
                                    : f.productName || f.name}
                                  {f.parentId ? ` / ${f.name}` : ""}
                                </option>
                              ))}
                            </select>
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[10px]"
                            >
                              Move
                            </Button>
                          </form>
                          <form action={actionDeleteCmDocument}>
                            <input type="hidden" name="id" value={doc.id} />
                            {folderId && (
                              <input
                                type="hidden"
                                name="folderId"
                                value={folderId}
                              />
                            )}
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-slate-800 bg-slate-950/40">
                  <CardContent className="p-3 text-xs text-slate-500">
                    Documents (including Admin policies) are only added by{" "}
                    <strong className="text-slate-400">CM release</strong> after
                    an ECR is approved on{" "}
                    <Link
                      href="/cm?tab=submissions"
                      className="text-sky-400 hover:underline"
                    >
                      CM submissions
                    </Link>
                    . CM manager creates folders and assigns the release folder.
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
