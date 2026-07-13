"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { actionCreateDocumentEcr } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Paperclip, FileText, X, Layers } from "lucide-react";

type ProductFolder = {
  id: string;
  name: string;
  productName: string | null;
  kind: string;
};

type DocHit = {
  id: string;
  number: string;
  title: string;
  revision: string;
  docType: string;
  fileUrl: string | null;
  fileName: string | null;
  description: string | null;
  folder: {
    id: string;
    name: string;
    productName: string | null;
    kind: string;
  } | null;
};

/** Assigned numbers from CM master list (RESERVED / ACTIVE) for new ECRs */
type AssignedNumber = {
  id: string;
  number: string;
  title: string;
  category: string;
  status: string;
  productName: string | null;
};

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export function DocumentEcrForm({
  productFolders,
  adminFolderId,
  libraryDocs,
  assignedNumbers = [],
  bomParts = [],
}: {
  productFolders: ProductFolder[];
  adminFolderId: string | null;
  /** Preloaded released docs for client-side typeahead */
  libraryDocs: DocHit[];
  /** Controlled numbers from master list available for new ECRs */
  assignedNumbers?: AssignedNumber[];
  /** Buildable items selectable when the drawing includes a BOM */
  bomParts?: { id: string; partNumber: string; description: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companyInternal, setCompanyInternal] = useState(false);
  const [docNumber, setDocNumber] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [revision, setRevision] = useState("A");
  const [docType, setDocType] = useState("DRAWING");
  const [fileUrl, setFileUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [productFolderId, setProductFolderId] = useState("");
  const [includesBom, setIncludesBom] = useState(false);
  const [bomPartId, setBomPartId] = useState("");
  const [attachments, setAttachments] = useState<
    { url: string; fileName: string; caption: string }[]
  >([]);

  const matches = useMemo(() => {
    const q = docNumber.trim().toUpperCase();
    if (q.length < 1) return [];
    return libraryDocs
      .filter((d) => d.number.includes(q))
      .slice(0, 8);
  }, [docNumber, libraryDocs]);

  const reservedMatches = useMemo(() => {
    const q = docNumber.trim().toUpperCase();
    // Only suggest after the user starts typing — never pin a permanent list open
    if (q.length < 1) return [];
    return assignedNumbers
      .filter(
        (n) =>
          n.number.includes(q) || n.title.toUpperCase().includes(q)
      )
      .slice(0, 8);
  }, [docNumber, assignedNumbers]);

  function pickAssigned(n: AssignedNumber) {
    setSourceId("");
    setDocNumber(n.number);
    setTitle(n.title);
    setRevision("A");
    // Map category → document type
    const cat = n.category.toUpperCase();
    if (cat === "DRAWING") setDocType("DRAWING");
    else if (cat === "POLICY" || cat === "PROCEDURE") setDocType("PROCEDURE");
    else if (cat === "FORM") setDocType("FORM");
    else if (cat === "TEST") setDocType("TP");
    else if (cat === "SPEC") setDocType("SPEC");
    else setDocType("OTHER");
    if (n.productName?.toLowerCase().includes("admin")) {
      setCompanyInternal(true);
      if (adminFolderId) setProductFolderId(adminFolderId);
    }
  }

  function pickSource(d: DocHit) {
    setSourceId(d.id);
    setDocNumber(d.number);
    setTitle(d.title);
    setDocType(d.docType || "DRAWING");
    setFileUrl(d.fileUrl || "");
    setFileName(d.fileName || "");
    setDescription(d.description || "");
    // Next rev
    if (/^[A-Z]$/i.test(d.revision)) {
      setRevision(
        String.fromCharCode(d.revision.toUpperCase().charCodeAt(0) + 1)
      );
    } else {
      setRevision(`${d.revision}.1`);
    }
    if (d.folder?.kind === "ADMIN") {
      setCompanyInternal(true);
      setProductFolderId(adminFolderId || d.folder.id);
    } else if (d.folder) {
      setCompanyInternal(false);
      const root = productFolders.find(
        (p) =>
          p.id === d.folder?.id ||
          p.productName === d.folder?.productName ||
          p.name === d.folder?.productName
      );
      setProductFolderId(root?.id || d.folder.id);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; fileName: string; caption: string }[] = [];
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 8 * 1024 * 1024) {
        setError(`${file.name} is over 8MB — use a smaller file or paste a URL`);
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
    setAttachments((p) => {
      const merged = [...p, ...next].slice(0, 12);
      if (merged[0] && !fileName) {
        setFileName(merged[0].fileName);
      }
      return merged;
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    attachments.forEach((a, i) => {
      fd.set(`att_${i}`, a.url);
      fd.set(`att_name_${i}`, a.fileName);
      if (a.caption) fd.set(`att_caption_${i}`, a.caption);
    });
    // If only files (no URL), primary comes from first attachment
    if (!((fd.get("documentFileUrl") as string) || "").trim() && attachments[0]) {
      fd.set("documentFileUrl", attachments[0].url);
      if (!((fd.get("documentFileName") as string) || "").trim()) {
        fd.set("documentFileName", attachments[0].fileName);
      }
    }
    startTransition(async () => {
      try {
        await actionCreateDocumentEcr(fd);
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Submit failed");
      }
    });
  }

  return (
    <Card className="border-teal-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">New document ECR</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                name="isCompanyInternal"
                checked={companyInternal}
                onChange={(e) => {
                  setCompanyInternal(e.target.checked);
                  if (e.target.checked && adminFolderId) {
                    setProductFolderId(adminFolderId);
                  }
                }}
                className="rounded border-slate-600"
              />
              Company internal / policy (Admin)
            </label>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Creator must know the product destination (or Admin for policies).
            </p>
          </div>

          {!companyInternal && (
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Product *
              </label>
              <select
                name="productFolderId"
                className={`${selectClass} mt-1`}
                required={!companyInternal}
                value={productFolderId}
                onChange={(e) => setProductFolderId(e.target.value)}
              >
                <option value="">— Select product —</option>
                {productFolders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.productName || p.name}
                  </option>
                ))}
              </select>
              <input
                type="hidden"
                name="productName"
                value={
                  productFolders.find((p) => p.id === productFolderId)
                    ?.productName ||
                  productFolders.find((p) => p.id === productFolderId)?.name ||
                  ""
                }
              />
            </div>
          )}
          {companyInternal && adminFolderId && (
            <>
              <input type="hidden" name="productFolderId" value={adminFolderId} />
              <input
                type="hidden"
                name="productName"
                value="Admin / company internal"
              />
            </>
          )}

          <div className="relative z-10 sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Document number *{" "}
              <span className="normal-case text-slate-600">
                (type to find reserved / master-list or existing library numbers)
              </span>
            </label>
            <Input
              name="documentNumber"
              required
              className="mt-1 font-mono"
              value={docNumber}
              onChange={(e) => {
                setDocNumber(e.target.value.toUpperCase());
                setSourceId("");
              }}
              placeholder="Start typing e.g. DWG…"
              autoComplete="off"
            />
            {!sourceId &&
              docNumber.trim().length >= 1 &&
              (reservedMatches.length > 0 || matches.length > 0) && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-700 bg-slate-950 shadow-lg">
                  {reservedMatches.length > 0 && (
                    <>
                      <p className="border-b border-slate-800 px-3 py-1 text-[10px] uppercase text-violet-400/80">
                        Reserved / master list
                      </p>
                      {reservedMatches.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className="flex w-full flex-col items-start border-b border-slate-800 px-3 py-2 text-left text-xs hover:bg-slate-900"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickAssigned(n)}
                        >
                          <span className="font-mono text-violet-300">
                            {n.number}{" "}
                            <span className="text-[10px] text-slate-500">
                              {n.status}
                            </span>
                          </span>
                          <span className="text-slate-300">{n.title}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {matches.length > 0 && (
                    <>
                      <p className="border-b border-slate-800 px-3 py-1 text-[10px] uppercase text-teal-500/80">
                        Existing CM library (revise)
                      </p>
                      {matches.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          className="flex w-full flex-col items-start border-b border-slate-800 px-3 py-2 text-left text-xs hover:bg-slate-900"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickSource(d)}
                        >
                          <span className="font-mono text-teal-400">
                            {d.number} Rev {d.revision}
                          </span>
                          <span className="text-slate-300">{d.title}</span>
                          <span className="text-[10px] text-slate-500">
                            {d.folder?.productName ||
                              d.folder?.name ||
                              d.folder?.kind ||
                              "CM library"}
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            {sourceId && (
              <p className="mt-1 text-[11px] text-sky-400">
                Updating existing CM document — working copy loaded. New rev:{" "}
                {revision}
              </p>
            )}
            {!sourceId && (
              <p className="mt-1 text-[11px] text-slate-500">
                Need a new number?{" "}
                <a
                  href="/cm?tab=numbers&panel=request"
                  className="text-violet-400 underline hover:text-violet-300"
                >
                  Request one from CM
                </a>{" "}
                first — then type it here after assignment.
              </p>
            )}
            <input type="hidden" name="sourceDocumentId" value={sourceId} />
          </div>

          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Title *
            </label>
            <Input
              name="documentTitle"
              required
              className="mt-1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Revision *
            </label>
            <Input
              name="documentRevision"
              required
              className="mt-1 font-mono"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">Type</label>
            <select
              name="documentDocType"
              className={`${selectClass} mt-1`}
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              <option value="DRAWING">Drawing</option>
              <option value="SPEC">Spec</option>
              <option value="PROCEDURE">Policy / procedure</option>
              <option value="FORM">Form</option>
              <option value="FAT">FAT</option>
              <option value="ATP">ATP</option>
              <option value="TP">TP</option>
              <option value="TR">TR</option>
              <option value="CERT">Certificate</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          {docType === "DRAWING" && (
            <div className="sm:col-span-2 rounded-xl border border-violet-900/40 bg-violet-500/5 p-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-violet-400" />
                <ToggleSwitch
                  checked={includesBom}
                  onChange={(v) => setIncludesBom(v)}
                  label="Drawing includes a BOM"
                />
              </div>
              <input
                type="hidden"
                name="includesBom"
                value={includesBom ? "true" : ""}
              />
              {includesBom && (
                <div className="mt-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Item this BOM builds *
                  </label>
                  <select
                    name="bomPartId"
                    required
                    className={`${selectClass} mt-1`}
                    value={bomPartId}
                    onChange={(e) => setBomPartId(e.target.value)}
                  >
                    <option value="">— Select item —</option>
                    {bomParts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.partNumber} — {p.description}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-slate-500">
                    An in-work BOM is created (or linked) for this item. The
                    drawing cannot be released into the library until that BOM
                    is certified.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Attach drawing files */}
          <div className="sm:col-span-2 rounded-md border border-slate-800 bg-slate-950/40 p-3">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-200">
              <Paperclip className="h-4 w-4 text-sky-400" />
              Attach drawing / file *
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.dwg,.dxf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-500">
              First file is the primary drawing released into the CM library.
              You can add more files later on the board as the ECR moves.
            </p>
            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((a, i) => (
                  <li
                    key={`${a.fileName}-${i}`}
                    className="flex items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-slate-300">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                      <span className="truncate">{a.fileName}</span>
                      {i === 0 && (
                        <span className="shrink-0 text-[9px] uppercase text-amber-400">
                          primary
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className="text-slate-500 hover:text-rose-400"
                      onClick={() =>
                        setAttachments((p) => p.filter((_, j) => j !== i))
                      }
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase text-slate-500">
              File name{" "}
              <span className="normal-case text-slate-600">(optional override)</span>
            </label>
            <Input
              name="documentFileName"
              className="mt-1"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Filled from upload"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Or paste URL / path
            </label>
            <Input
              name="documentFileUrl"
              className="mt-1"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://… or /shared/drawings/…"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Change description
            </label>
            <Textarea
              name="description"
              rows={2}
              className="mt-1"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this create/update is needed…"
            />
          </div>
          {error && (
            <p className="sm:col-span-2 text-xs text-rose-400">{error}</p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Submitting…" : "Submit document ECR"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
