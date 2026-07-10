import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  actionVoteCm,
  actionAssignEcrApprovers,
  actionReleaseDocumentEcr,
  actionMoveCmSubmission,
} from "@/app/actions";
import {
  parseEcrAttachments,
  mapCrToColumn,
  ensureAdminFolder,
} from "@/lib/services/cm-library";
import { EcrCollabPanel } from "@/components/cm/ecr-collab-panel";
import {
  ArrowLeft,
  FileText,
  Package,
  Shield,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function EcrDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await ensureAdminFolder();

  const cr = await prisma.changeRequest.findUnique({
    where: { id },
    include: {
      boardMembers: true,
      bomHeader: { include: { part: true } },
      workInstruction: true,
      productFolder: true,
      sourceDocument: true,
      releasedDocument: true,
      releaseFolder: true,
      comments: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!cr) notFound();

  const [cmUsers, folders, users] = await Promise.all([
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
    prisma.cmFolder.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: {
        id: {
          in: [
            ...cr.boardMembers.map((m) => m.userId),
            cr.requestedById,
            cr.releasedById,
          ].filter(Boolean) as string[],
        },
      },
    }),
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const column = mapCrToColumn(cr.status);
  const isDocumentEcr = Boolean(cr.documentNumber);
  const canEditFiles =
    isDocumentEcr &&
    cr.status !== "IMPLEMENTED" &&
    cr.status !== "CLOSED";

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

  const adminRoot = folders.find(
    (f) => f.kind === "ADMIN" && !f.parentId
  );
  const releaseFolders = folders.filter(
    (f) => f.kind !== "ARCHIVE" && !f.name.toLowerCase().includes("archive")
  );

  const returnTo = `/cm/ecr/${cr.id}`;
  const needsApprovers =
    isDocumentEcr &&
    (column === "SUBMITTED" ||
      (column === "IN_REVIEW" && cr.boardMembers.length < 2));
  const showVotes =
    cr.boardMembers.length > 0 && column === "IN_REVIEW";
  const showRelease =
    isDocumentEcr && column === "APPROVED";

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/cm?tab=submissions"
          className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-sky-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to board
        </Link>
      </div>

      <PageHeader
        title={cr.number}
        description={cr.title}
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={cr.status} />
        <StatusBadge status={cr.type} />
        {cr.priority !== "NORMAL" && <StatusBadge status={cr.priority} />}
        {isDocumentEcr && cr.documentDocType && (
          <StatusBadge status={cr.documentDocType} />
        )}
        {cr.isCompanyInternal && <StatusBadge status="ADMIN" />}
        {cr.isDocumentUpdate && (
          <span className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] uppercase text-sky-400">
            Revision update
          </span>
        )}
        <span className="text-xs text-slate-500">
          Column: {column.replace(/_/g, " ")} · Created{" "}
          {formatDate(cr.createdAt, "MMM d, yyyy h:mm a")}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main details */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">ECR details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {cr.description && (
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Description
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                  {cr.description}
                </p>
              </div>
            )}

            {isDocumentEcr && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-[10px] uppercase text-slate-500">
                    Document
                  </p>
                  <p className="mt-1 font-mono text-lg text-teal-400">
                    {cr.documentNumber}{" "}
                    <span className="text-sm text-slate-400">
                      Rev {cr.documentRevision}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-200">
                    {cr.documentTitle}
                  </p>
                  {cr.documentDocType && (
                    <div className="mt-2">
                      <StatusBadge status={cr.documentDocType} />
                    </div>
                  )}
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
                  <p className="text-[10px] uppercase text-slate-500">
                    Destination
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-slate-200">
                    {cr.isCompanyInternal ? (
                      <Shield className="h-4 w-4 text-violet-400" />
                    ) : (
                      <Package className="h-4 w-4 text-amber-400" />
                    )}
                    {cr.productName || "—"}
                  </p>
                  {cr.releaseFolder && (
                    <p className="mt-1 text-xs text-slate-500">
                      Released to: {cr.releaseFolder.name}
                    </p>
                  )}
                  {cr.releasedDocumentId && (
                    <Link
                      href={`/cm?tab=library&folder=${cr.releaseFolderId || ""}`}
                      className="mt-2 inline-block text-xs text-sky-400 hover:underline"
                    >
                      Open in CM library →
                    </Link>
                  )}
                </div>
              </div>
            )}

            {cr.documentDescription && (
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Document notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">
                  {cr.documentDescription}
                </p>
              </div>
            )}

            {cr.decisionNotes && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <p className="text-[10px] uppercase text-slate-500">
                  Decision notes
                </p>
                <p className="mt-1 text-sm text-slate-300">{cr.decisionNotes}</p>
              </div>
            )}

            {cr.sourceDocument && (
              <p className="text-xs text-slate-500">
                Supersedes library doc{" "}
                <span className="font-mono text-slate-400">
                  {cr.sourceDocument.number} Rev {cr.sourceDocument.revision}
                </span>
              </p>
            )}

            {cr.workInstruction && (
              <p className="text-sm">
                <Link
                  href={`/work-instructions/${cr.workInstruction.id}`}
                  className="text-sky-400 hover:underline"
                >
                  WI {cr.workInstruction.documentNumber}
                </Link>
              </p>
            )}
            {cr.bomHeader && (
              <p className="text-sm">
                <Link
                  href={`/bom/${cr.bomHeader.id}`}
                  className="text-sky-400 hover:underline"
                >
                  BOM {cr.bomHeader.part.partNumber} Rev{" "}
                  {cr.bomHeader.revision}
                </Link>
              </p>
            )}

            <dl className="grid gap-2 border-t border-slate-800 pt-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Requested by</dt>
                <dd className="text-slate-300">
                  {cr.requestedById
                    ? userMap[cr.requestedById]?.name || cr.requestedById
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Updated</dt>
                <dd className="text-slate-300">
                  {formatDate(cr.updatedAt, "MMM d, yyyy h:mm a")}
                </dd>
              </div>
              {cr.decidedAt && (
                <div>
                  <dt className="text-slate-500">Decided</dt>
                  <dd className="text-slate-300">
                    {formatDate(cr.decidedAt, "MMM d, yyyy h:mm a")}
                  </dd>
                </div>
              )}
              {cr.releasedAt && (
                <div>
                  <dt className="text-slate-500">Released</dt>
                  <dd className="text-slate-300">
                    {formatDate(cr.releasedAt, "MMM d, yyyy h:mm a")}
                    {cr.releasedById &&
                      userMap[cr.releasedById] &&
                      ` · ${userMap[cr.releasedById].name}`}
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Workflow actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 text-amber-400" />
                Workflow
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {needsApprovers && (
                <form
                  action={actionAssignEcrApprovers}
                  className="space-y-2"
                >
                  <input type="hidden" name="changeRequestId" value={cr.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <p className="text-xs font-medium uppercase text-amber-500/90">
                    CM: assign 2 approvers
                  </p>
                  <select
                    name="approverUserId1"
                    required
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Approver 1…
                    </option>
                    {cmUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <select
                    name="approverUserId2"
                    required
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Approver 2…
                    </option>
                    {cmUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" className="w-full">
                    Assign &amp; open review
                  </Button>
                </form>
              )}

              {cr.boardMembers.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase text-slate-500">
                    Approvers
                  </p>
                  {cr.boardMembers.map((m) => (
                    <div
                      key={m.id}
                      className="rounded-lg border border-slate-800 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm text-slate-200">
                            {userMap[m.userId]?.name || m.role}
                          </p>
                          <p className="text-[11px] text-slate-500">{m.role}</p>
                        </div>
                        {m.vote ? (
                          <StatusBadge status={m.vote} />
                        ) : showVotes ? (
                          <div className="flex gap-1">
                            <form action={actionVoteCm}>
                              <input
                                type="hidden"
                                name="memberId"
                                value={m.id}
                              />
                              <input
                                type="hidden"
                                name="vote"
                                value="APPROVE"
                              />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={returnTo}
                              />
                              <Button type="submit" size="sm">
                                Approve
                              </Button>
                            </form>
                            <form action={actionVoteCm}>
                              <input
                                type="hidden"
                                name="memberId"
                                value={m.id}
                              />
                              <input
                                type="hidden"
                                name="vote"
                                value="REJECT"
                              />
                              <input
                                type="hidden"
                                name="returnTo"
                                value={returnTo}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant="destructive"
                              >
                                Reject
                              </Button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-600">
                            Pending
                          </span>
                        )}
                      </div>
                      {m.comments && (
                        <p className="mt-1 text-xs text-slate-400">
                          {m.comments}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {showRelease && (
                <form
                  action={actionReleaseDocumentEcr}
                  className="space-y-2 border-t border-emerald-900/40 pt-3"
                >
                  <input type="hidden" name="changeRequestId" value={cr.id} />
                  <p className="text-xs font-medium uppercase text-emerald-400/90">
                    CM release → library folder
                  </p>
                  <select
                    name="releaseFolderId"
                    required
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                    defaultValue={
                      cr.productFolderId ||
                      (cr.isCompanyInternal ? adminRoot?.id || "" : "") ||
                      ""
                    }
                  >
                    <option value="" disabled>
                      Assign folder…
                    </option>
                    {releaseFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.kind === "ADMIN" && !f.parentId
                          ? "Admin (company)"
                          : f.productName || f.name}
                        {f.parentId ? ` / ${f.name}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" className="w-full">
                    Release to CM library
                  </Button>
                  <p className="text-[11px] text-slate-600">
                    Primary file becomes the library document; prior rev locked
                    → Archive
                  </p>
                </form>
              )}

              {!isDocumentEcr && column !== "RELEASED" && (
                <form
                  action={actionMoveCmSubmission}
                  className="space-y-2 border-t border-slate-800 pt-3"
                >
                  <input type="hidden" name="changeRequestId" value={cr.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <p className="text-[10px] uppercase text-slate-500">
                    Move column
                  </p>
                  <select
                    name="column"
                    className="h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                    defaultValue={column}
                  >
                    {(
                      [
                        "IN_WORK",
                        "SUBMITTED",
                        "IN_REVIEW",
                        "APPROVED",
                        "RELEASED",
                      ] as const
                    ).map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline" className="w-full">
                    Move
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {attachments[0] && (
            <Card className="border-sky-900/40">
              <CardContent className="p-4">
                <p className="text-[10px] uppercase text-slate-500">
                  Primary drawing
                </p>
                <a
                  href={attachments.find((a) => a.isPrimary)?.url || attachments[0].url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex items-center gap-2 text-sm text-sky-400 hover:underline"
                >
                  <FileText className="h-5 w-5 shrink-0" />
                  <span className="truncate">
                    {attachments.find((a) => a.isPrimary)?.fileName ||
                      attachments[0].fileName}
                  </span>
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Full discussion + files */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Files &amp; discussion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EcrCollabPanel
            changeRequestId={cr.id}
            attachments={attachments}
            comments={cr.comments.map((c) => ({
              id: c.id,
              body: c.body,
              authorName: c.authorName,
              createdAt: c.createdAt,
            }))}
            canEditFiles={canEditFiles}
            layout="full"
            returnTo={returnTo}
          />
        </CardContent>
      </Card>
    </div>
  );
}
