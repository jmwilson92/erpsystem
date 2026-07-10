"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  actionAddEcrAttachments,
  actionAddEcrComment,
  actionSetEcrPrimaryAttachment,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText,
  MessageSquare,
  Paperclip,
  Star,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatDate, formatRelative } from "@/lib/utils";

export type EcrAttachmentView = {
  id: string;
  url: string;
  fileName: string;
  caption?: string | null;
  uploadedAt: string;
  isPrimary?: boolean;
};

export type EcrCommentView = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string | Date;
};

export function EcrCollabPanel({
  changeRequestId,
  attachments,
  comments,
  canEditFiles,
  layout = "compact",
  returnTo,
}: {
  changeRequestId: string;
  attachments: EcrAttachmentView[];
  comments: EcrCommentView[];
  /** False after release/close */
  canEditFiles: boolean;
  /** full = always open, larger thread (detail page) */
  layout?: "compact" | "full";
  /** Where server actions redirect after post/upload */
  returnTo?: string;
}) {
  const router = useRouter();
  const isFull = layout === "full";
  const [open, setOpen] = useState(isFull);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<
    { url: string; fileName: string; caption: string }[]
  >([]);
  const [commentBody, setCommentBody] = useState("");
  const [setAsPrimary, setSetAsPrimary] = useState(true);

  const redirectPath = returnTo || `/cm/ecr/${changeRequestId}`;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; fileName: string; caption: string }[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 8 * 1024 * 1024) {
        setError(`${file.name} is over 8MB — use a smaller file or a link`);
        continue;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      next.push({
        url,
        fileName: file.name,
        caption: file.name.replace(/\.[^.]+$/, ""),
      });
    }
    setPendingFiles((p) => [...p, ...next].slice(0, 12));
  }

  function uploadFiles(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingFiles.length) return;
    setError(null);
    const fd = new FormData();
    fd.set("changeRequestId", changeRequestId);
    fd.set("returnTo", redirectPath);
    if (setAsPrimary) fd.set("setAsPrimary", "true");
    pendingFiles.forEach((d, i) => {
      fd.set(`att_${i}`, d.url);
      fd.set(`att_name_${i}`, d.fileName);
      if (d.caption) fd.set(`att_caption_${i}`, d.caption);
    });
    startTransition(async () => {
      try {
        await actionAddEcrAttachments(fd);
        setPendingFiles([]);
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Upload failed");
      }
    });
  }

  function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setError(null);
    const fd = new FormData();
    fd.set("changeRequestId", changeRequestId);
    fd.set("body", commentBody.trim());
    fd.set("returnTo", redirectPath);
    startTransition(async () => {
      try {
        await actionAddEcrComment(fd);
        setCommentBody("");
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Comment failed");
      }
    });
  }

  function markPrimary(attachmentId: string) {
    setError(null);
    const fd = new FormData();
    fd.set("changeRequestId", changeRequestId);
    fd.set("attachmentId", attachmentId);
    fd.set("returnTo", redirectPath);
    startTransition(async () => {
      try {
        await actionSetEcrPrimaryAttachment(fd);
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Update failed");
      }
    });
  }

  const attCount = attachments.length;
  const commentCount = comments.length;

  return (
    <div
      className={
        isFull
          ? "space-y-4"
          : "border-t border-slate-800 pt-2"
      }
    >
      {!isFull && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 hover:text-slate-200"
        >
          <span className="flex items-center gap-2">
            <Paperclip className="h-3 w-3" />
            Files {attCount > 0 ? `(${attCount})` : ""}
            <MessageSquare className="ml-1 h-3 w-3" />
            Discussion {commentCount > 0 ? `(${commentCount})` : ""}
          </span>
          {open ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      )}

      {(open || isFull) && (
        <div className={isFull ? "grid gap-6 lg:grid-cols-5" : "mt-2 space-y-3"}>
          {/* Attachments */}
          <div className={isFull ? "space-y-3 lg:col-span-2" : "space-y-1.5"}>
            {isFull && (
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <Paperclip className="h-4 w-4 text-sky-400" />
                Drawing &amp; attachments
                {attCount > 0 && (
                  <span className="font-mono text-xs font-normal text-slate-500">
                    ({attCount})
                  </span>
                )}
              </h3>
            )}
            {!isFull && (
              <p className="text-[10px] uppercase text-slate-600">
                Drawing &amp; attachments
              </p>
            )}
            {attachments.length === 0 && (
              <p
                className={
                  isFull ? "text-sm text-slate-500" : "text-[10px] text-slate-600"
                }
              >
                No files yet — attach the drawing PDF (or supporting docs).
              </p>
            )}
            {attachments.map((a) => (
              <div
                key={a.id}
                className={
                  isFull
                    ? "flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2.5"
                    : "flex items-start justify-between gap-1 rounded border border-slate-800 bg-slate-950/60 px-2 py-1.5"
                }
              >
                <div className="min-w-0">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className={
                      isFull
                        ? "flex items-center gap-2 truncate text-sm text-sky-400 hover:underline"
                        : "flex items-center gap-1 truncate text-[11px] text-sky-400 hover:underline"
                    }
                  >
                    <FileText
                      className={
                        isFull ? "h-4 w-4 shrink-0" : "h-3 w-3 shrink-0"
                      }
                    />
                    <span className="truncate">{a.fileName}</span>
                  </a>
                  {a.caption && (
                    <p
                      className={
                        isFull
                          ? "mt-0.5 truncate text-xs text-slate-500"
                          : "truncate text-[10px] text-slate-500"
                      }
                    >
                      {a.caption}
                    </p>
                  )}
                  {a.isPrimary && (
                    <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-medium uppercase text-amber-400">
                      <Star className="h-2.5 w-2.5" /> Primary (releases to
                      library)
                    </span>
                  )}
                </div>
                {canEditFiles && !a.isPrimary && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className={
                      isFull
                        ? "h-8 shrink-0 px-2 text-xs"
                        : "h-6 shrink-0 px-1.5 text-[9px]"
                    }
                    disabled={pending}
                    onClick={() => markPrimary(a.id)}
                  >
                    Set primary
                  </Button>
                )}
              </div>
            ))}

            {canEditFiles && (
              <form onSubmit={uploadFiles} className="space-y-1.5">
                <label
                  className={
                    isFull
                      ? "inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:border-sky-500/40 hover:text-sky-300"
                      : "inline-flex cursor-pointer items-center gap-1.5 rounded border border-dashed border-slate-700 px-2 py-1.5 text-[10px] text-slate-300 hover:border-sky-500/40 hover:text-sky-300"
                  }
                >
                  <Paperclip className={isFull ? "h-4 w-4" : "h-3 w-3"} />
                  Attach drawing / file
                  <input
                    type="file"
                    multiple
                    accept="image/*,.pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                    className="hidden"
                    onChange={(e) => onFiles(e.target.files)}
                  />
                </label>
                {pendingFiles.length > 0 && (
                  <p className="text-xs text-emerald-400">
                    {pendingFiles.length} file(s) ready:{" "}
                    {pendingFiles.map((f) => f.fileName).join(", ")}
                  </p>
                )}
                <label className="flex items-center gap-1.5 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={setAsPrimary}
                    onChange={(e) => setSetAsPrimary(e.target.checked)}
                    className="rounded border-slate-600"
                  />
                  First new file is primary drawing for release
                </label>
                {pendingFiles.length > 0 && (
                  <Button
                    type="submit"
                    size="sm"
                    className={isFull ? "w-full" : "h-7 w-full text-[10px]"}
                    disabled={pending}
                  >
                    {pending ? "Uploading…" : "Upload to ECR"}
                  </Button>
                )}
              </form>
            )}
          </div>

          {/* Discussion */}
          <div className={isFull ? "flex flex-col space-y-3 lg:col-span-3" : "space-y-1.5"}>
            {isFull && (
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                <MessageSquare className="h-4 w-4 text-teal-400" />
                Discussion
                {commentCount > 0 && (
                  <span className="font-mono text-xs font-normal text-slate-500">
                    ({commentCount})
                  </span>
                )}
              </h3>
            )}
            {!isFull && (
              <p className="text-[10px] uppercase text-slate-600">Discussion</p>
            )}
            <div
              className={
                isFull
                  ? "max-h-[min(28rem,50vh)] flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                  : "max-h-40 space-y-1.5 overflow-y-auto"
              }
            >
              {comments.length === 0 && (
                <p
                  className={
                    isFull
                      ? "py-8 text-center text-sm text-slate-500"
                      : "text-[10px] text-slate-600"
                  }
                >
                  No notes yet — leave review feedback here.
                </p>
              )}
              {comments.map((c) => (
                <div
                  key={c.id}
                  className={
                    isFull
                      ? "rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5"
                      : "rounded border border-slate-800 bg-slate-950/50 px-2 py-1.5"
                  }
                >
                  <div
                    className={
                      isFull
                        ? "flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"
                        : "flex items-center justify-between gap-1 text-[9px] text-slate-500"
                    }
                  >
                    <span className="font-medium text-slate-300">
                      {c.authorName || "User"}
                    </span>
                    <span title={formatDate(c.createdAt, "MMM d, yyyy h:mm a")}>
                      {isFull
                        ? formatRelative(c.createdAt)
                        : formatDate(c.createdAt)}
                    </span>
                  </div>
                  <p
                    className={
                      isFull
                        ? "mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-100"
                        : "mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-slate-200"
                    }
                  >
                    {c.body}
                  </p>
                </div>
              ))}
            </div>
            <form onSubmit={postComment} className="space-y-2">
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={isFull ? 4 : 2}
                className={isFull ? "min-h-[6rem] text-sm" : "text-xs"}
                placeholder="Add a note for approvers / CM…"
              />
              <Button
                type="submit"
                size="sm"
                variant={isFull ? "default" : "outline"}
                className={isFull ? "w-full sm:w-auto" : "h-7 w-full text-[10px]"}
                disabled={pending || !commentBody.trim()}
              >
                {pending ? "Posting…" : "Post comment"}
              </Button>
            </form>
          </div>

          {error && (
            <p
              className={
                isFull
                  ? "text-sm text-rose-400 lg:col-span-5"
                  : "text-[10px] text-rose-400"
              }
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
