"use client";

import { useMemo, useState, useTransition } from "react";
import { actionReceivePo } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera,
  PackageOpen,
  AlertTriangle,
  FileText,
  FlaskConical,
  Ruler,
} from "lucide-react";

type Line = {
  id: string;
  lineNumber: number;
  description: string;
  quantity: number;
  quantityReceived: number;
  partNumber?: string | null;
  partId?: string | null;
  uom?: string | null;
  requiresGdtInspection?: boolean;
  requiresFunctionalTest?: boolean;
  /** When true, line id is a traveler line (non-PO GFP traveler) */
  isTravelerLine?: boolean;
};

type LocationOption = {
  code: string;
  name: string | null;
  type: string;
};

type FileDoc = { url: string; fileName: string; caption: string };

export function ReceiveForm({
  purchaseOrderId,
  travelerId,
  lines,
  locations,
  isGfpTraveler = false,
  defaultContractNumber = "",
}: {
  purchaseOrderId?: string;
  travelerId: string;
  lines: Line[];
  locations: LocationOption[];
  isGfpTraveler?: boolean;
  defaultContractNumber?: string;
}) {
  const openLines = useMemo(
    () =>
      lines
        .map((l) => ({
          ...l,
          open: Math.max(0, l.quantity - l.quantityReceived),
        }))
        .filter((l) => l.open > 0),
    [lines]
  );

  const stockLocations = locations.filter((l) =>
    ["STORAGE", "WIP", "SHIPPING", "GFP"].includes(l.type)
  );
  const gfpLocations = stockLocations.filter(
    (l) => l.type === "GFP" || l.code.toUpperCase().startsWith("GFP")
  );

  const needsQa = openLines.some((l) => l.requiresGdtInspection);
  const needsTest = openLines.some((l) => l.requiresFunctionalTest);
  const anyBypassLine = openLines.some(
    (l) => !l.requiresGdtInspection && !l.requiresFunctionalTest
  );
  const anyRouteInspect = needsQa || needsTest;
  const allRouteInspect =
    openLines.length > 0 &&
    openLines.every(
      (l) => l.requiresGdtInspection || l.requiresFunctionalTest
    );
  const mixedModes = anyBypassLine && anyRouteInspect;
  // Gov prop only on GFP receiving travelers (not PO dock)
  const gfpContext = isGfpTraveler;

  const [qtys, setQtys] = useState<Record<string, string>>(() =>
    Object.fromEntries(openLines.map((l) => [l.id, String(l.open)]))
  );
  const [lots, setLots] = useState<Record<string, string>>({});
  const [putaway, setPutaway] = useState(() => {
    if (gfpContext && gfpLocations[0]) return gfpLocations[0].code;
    return stockLocations[0]?.code || "";
  });
  const [failInspection, setFailInspection] = useState(false);
  const [receivingAck, setReceivingAck] = useState(false);
  const [notes, setNotes] = useState("");
  const [packingSlip, setPackingSlip] = useState("");
  const [photos, setPhotos] = useState<FileDoc[]>([]);
  const [packingDocs, setPackingDocs] = useState<FileDoc[]>([]);
  const [cocDocs, setCocDocs] = useState<FileDoc[]>([]);
  const [certDocs, setCertDocs] = useState<FileDoc[]>([]);
  const [dd1149Docs, setDd1149Docs] = useState<FileDoc[]>([]);
  const [contractNumber, setContractNumber] = useState(defaultContractNumber);
  const [govPropNumbers, setGovPropNumbers] = useState<Record<string, string>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const partialPreview = openLines.some((l) => {
    const q = Number(qtys[l.id] || 0);
    return q > 0 && q < l.open;
  });
  const anyQty = openLines.some((l) => Number(qtys[l.id] || 0) > 0);
  const needsDd1149 = gfpContext; // DD1149 only on GFP receiving travelers

  const routeLabel = needsQa
    ? "Route to QA"
    : needsTest
      ? "Route to TEST"
      : null;

  async function filesToDocs(files: FileList | null): Promise<FileDoc[]> {
    if (!files?.length) return [];
    const next: FileDoc[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
      const url = await readAsDataUrl(file);
      next.push({
        url,
        fileName: file.name,
        caption: file.name.replace(/\.[^.]+$/, ""),
      });
    }
    return next;
  }

  function appendDocs(
    setter: React.Dispatch<React.SetStateAction<FileDoc[]>>,
    files: FileList | null
  ) {
    void filesToDocs(files).then((docs) =>
      setter((prev) => [...prev, ...docs].slice(0, 12))
    );
  }

  function pushDocs(
    fd: FormData,
    prefix: string,
    docs: FileDoc[]
  ) {
    docs.forEach((d, i) => {
      fd.set(`${prefix}_${i}`, d.url);
      fd.set(`${prefix}_name_${i}`, d.fileName);
      if (d.caption) fd.set(`${prefix}_caption_${i}`, d.caption);
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!anyQty) {
      setError("Enter a quantity greater than 0 for at least one line.");
      return;
    }
    // Putaway required for any standard (bypass) lines — not when every line routes to QA/Test
    if (!failInspection && !allRouteInspect && !putaway) {
      setError("Select where this material will be stocked (putaway location).");
      return;
    }
    // Standard (test-bypass) receipts require the receiver to actually
    // attest the dock inspection — no auto sign-off.
    if (!failInspection && anyBypassLine && !receivingAck) {
      setError(
        "Confirm the dock inspection (count, condition, correct part) before receiving standard material."
      );
      return;
    }
    if (needsDd1149 && !failInspection && dd1149Docs.length === 0) {
      setError("DD Form 1149 is required on GFP receiving travelers.");
      return;
    }
    if (needsDd1149 && !failInspection && !contractNumber.trim()) {
      setError("Contract number is required for government property.");
      return;
    }

    const fd = new FormData();
    if (purchaseOrderId) fd.set("purchaseOrderId", purchaseOrderId);
    fd.set("travelerId", travelerId);
    if (isGfpTraveler) fd.set("isGfpTraveler", "true");
    fd.set("failInspection", failInspection ? "true" : "false");
    fd.set("receivingAck", receivingAck ? "true" : "false");
    if (putaway) fd.set("putawayLocationCode", putaway);
    if (packingSlip) fd.set("packingSlip", packingSlip);
    if (notes) fd.set("notes", notes);
    if (contractNumber.trim()) fd.set("contractNumber", contractNumber.trim());

    for (const line of openLines) {
      if (isGfpTraveler || line.isTravelerLine) {
        fd.set(`qty_tline_${line.id}`, qtys[line.id] ?? "0");
        if (lots[line.id]) fd.set(`lot_tline_${line.id}`, lots[line.id]);
      } else {
        fd.set(`qty_${line.id}`, qtys[line.id] ?? "0");
        if (lots[line.id]) fd.set(`lot_${line.id}`, lots[line.id]);
      }
      if (needsDd1149 && govPropNumbers[line.id]?.trim()) {
        fd.set(`govProp_${line.id}`, govPropNumbers[line.id].trim());
      }
      // Inspection results are completed only in QA / Test Center (always PENDING at dock)
    }

    photos.forEach((p, i) => {
      fd.set(`photo_shared_${i}`, p.url);
      if (p.caption) fd.set(`caption_shared_${i}`, p.caption);
    });
    pushDocs(fd, "packing_doc", packingDocs);
    pushDocs(fd, "coc_doc", cocDocs);
    pushDocs(fd, "cert_doc", certDocs);
    pushDocs(fd, "dd1149_doc", dd1149Docs);

    startTransition(async () => {
      try {
        await actionReceivePo(fd);
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Receive failed");
      }
    });
  }

  if (openLines.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nothing left to receive on this traveler.
      </p>
    );
  }

  return (
    <form id="receive-form" onSubmit={submit} className="space-y-5">
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200/90">
        <strong className="font-medium">Partial receives are fine.</strong> Enter only
        the qty that arrived. Open qty becomes a child traveler like{" "}
        <span className="font-mono">RCV-T-00005-02</span>.
      </div>

      {anyBypassLine && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-200/90">
          <strong className="font-medium">Dock putaway:</strong> lines with no
          QA / functional test go straight into stock when you sign off and pick
          a putaway location. No child traveler needed for those.
        </div>
      )}

      {anyRouteInspect && (
        <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Lines that need further checks each get the next child traveler{" "}
            <span className="font-mono">RCV-T-xxxxx-01</span>,{" "}
            <span className="font-mono">-02</span>, … —{" "}
            <strong>not siloed by QA vs Test</strong>. Each child is just that
            line of material; do whatever inspections it shows (visual, GD&amp;T,
            functional), then put away on that same card. No work orders.
          </span>
        </div>
      )}

      {mixedModes && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          One submit: standard lines → put away at dock now; lines needing checks
          → sequential child travelers (-01, -02…) for you to finish and stock.
        </div>
      )}

      {/* Receipt paperwork */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-3">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          <FileText className="h-3.5 w-3.5" />
          Paperwork (packing list · CoC · material certs
          {needsDd1149 ? " · DD1149" : ""})
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DocUpload
            label="Packing list"
            docs={packingDocs}
            onFiles={(f) => appendDocs(setPackingDocs, f)}
            onClear={() => setPackingDocs([])}
          />
          <DocUpload
            label="Certificate of conformance"
            docs={cocDocs}
            onFiles={(f) => appendDocs(setCocDocs, f)}
            onClear={() => setCocDocs([])}
          />
          <DocUpload
            label="Material certifications"
            docs={certDocs}
            onFiles={(f) => appendDocs(setCertDocs, f)}
            onClear={() => setCertDocs([])}
          />
          {needsDd1149 && (
            <DocUpload
              label="DD Form 1149 *"
              docs={dd1149Docs}
              onFiles={(f) => appendDocs(setDd1149Docs, f)}
              onClear={() => setDd1149Docs([])}
            />
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Line / tests</th>
              <th className="px-3 py-2 text-right">Ordered</th>
              <th className="px-3 py-2 text-right">Rcvd</th>
              <th className="px-3 py-2 text-right">Open</th>
              <th className="px-3 py-2 text-right">Receive now</th>
              <th className="px-3 py-2 text-left">Lot</th>
              {needsDd1149 && (
                <th className="px-3 py-2 text-left">Gov prop #</th>
              )}
            </tr>
          </thead>
          <tbody>
            {openLines.map((l) => (
              <tr key={l.id} className="border-t border-slate-800/70 align-top">
                <td className="px-3 py-2">
                  <span className="font-mono text-teal-400">
                    {l.partNumber || `#${l.lineNumber}`}
                  </span>
                  <p className="text-xs text-slate-500">{l.description}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {l.requiresGdtInspection && (
                      <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                        GD&amp;T + visual
                      </span>
                    )}
                    {l.requiresFunctionalTest && (
                      <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                        Functional test
                      </span>
                    )}
                    {!l.requiresGdtInspection && !l.requiresFunctionalTest && (
                      <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
                        Test bypass
                      </span>
                    )}
                  </div>

                  {(l.requiresGdtInspection || l.requiresFunctionalTest) && (
                    <div className="mt-2 space-y-1.5 rounded border border-slate-800 bg-slate-900/40 p-2 text-[11px] text-slate-400">
                      <p className="font-medium uppercase tracking-wide text-slate-500">
                        Pending tests (complete in station — not editable here)
                      </p>
                      {l.requiresGdtInspection && (
                        <div className="flex items-center gap-2 text-sky-300">
                          <Ruler className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Visual + GD&amp;T → <strong>QA</strong>
                            {l.requiresFunctionalTest ? " (first)" : ""} · Pending
                          </span>
                        </div>
                      )}
                      {l.requiresFunctionalTest && (
                        <div className="flex items-center gap-2 text-violet-300">
                          <FlaskConical className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Functional / power → <strong>Test Center</strong>
                            {l.requiresGdtInspection
                              ? " (after QA passes)"
                              : ""}{" "}
                            · Pending
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-400">
                  {l.quantityReceived}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-amber-400">
                  {l.open}
                </td>
                <td className="px-3 py-2 text-right">
                  <Input
                    type="number"
                    min={0}
                    max={l.open}
                    step="any"
                    className="ml-auto h-8 w-24 text-right"
                    value={qtys[l.id] ?? ""}
                    onChange={(e) =>
                      setQtys((prev) => ({ ...prev, [l.id]: e.target.value }))
                    }
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    className="h-8 w-36 font-mono text-xs"
                    placeholder="LOT-…"
                    value={lots[l.id] ?? ""}
                    onChange={(e) =>
                      setLots((prev) => ({ ...prev, [l.id]: e.target.value }))
                    }
                  />
                </td>
                {needsDd1149 && (
                  <td className="px-3 py-2">
                    <Input
                      className="h-8 w-36 font-mono text-xs"
                      placeholder="Auto if blank"
                      value={govPropNumbers[l.id] ?? ""}
                      onChange={(e) =>
                        setGovPropNumbers((prev) => ({
                          ...prev,
                          [l.id]: e.target.value,
                        }))
                      }
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {needsDd1149 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Owning contract # <span className="text-amber-400">*</span>
            </label>
            <Input
              className="mt-1 h-9 font-mono"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="Government contract that owns this property"
              required
            />
          </div>
        </div>
      )}

      {partialPreview && (
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
          <PackageOpen className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Partial receive — a <strong>child traveler</strong> will track remaining open
            quantity.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Stock / putaway location{" "}
            {!allRouteInspect && !failInspection && (
              <span className="text-amber-400">*</span>
            )}
            {allRouteInspect && (
              <span className="normal-case text-slate-600"> (optional home bin)</span>
            )}
          </label>
          <select
            className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
            value={putaway}
            onChange={(e) => setPutaway(e.target.value)}
            disabled={failInspection}
            required={!failInspection && !allRouteInspect}
          >
            <option value="">
              {allRouteInspect ? "Optional — after tests…" : "Select stocking area…"}
            </option>
            {(gfpContext ? gfpLocations.length ? gfpLocations : stockLocations : stockLocations).map(
              (loc) => (
                <option key={loc.code} value={loc.code}>
                  {loc.code}
                  {loc.name ? ` — ${loc.name}` : ""} ({loc.type})
                </option>
              )
            )}
          </select>
          <p className="mt-1 text-[11px] text-slate-600">
            {allRouteInspect
              ? "Not required now — you put away on the child traveler after QA/Test pass."
              : anyRouteInspect
                ? "Required for standard lines; also used as planned bin after tests."
                : gfpContext
                  ? "GFP traveler — putaway to a GFP area."
                  : "Required — where stock goes after dock acceptance."}
          </p>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Packing slip #
          </label>
          <Input
            className="mt-1 h-9"
            value={packingSlip}
            onChange={(e) => setPackingSlip(e.target.value)}
            placeholder="Optional vendor slip #"
          />
        </div>
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Dock photos
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-300 hover:border-teal-600/50 hover:text-teal-300">
            <Camera className="h-4 w-4" />
            Add photos
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => appendDocs(setPhotos, e.target.files)}
            />
          </label>
          <span className="text-xs text-slate-600">
            {photos.length} photo{photos.length === 1 ? "" : "s"}
          </span>
        </div>
        {photos.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div
                key={i}
                className="relative h-16 w-16 overflow-hidden rounded border border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption} className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-0 top-0 bg-black/70 px-1 text-[10px] text-white"
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Notes
        </label>
        <Textarea
          className="mt-1"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Dock notes, damage, carrier, etc."
        />
      </div>

      {anyBypassLine && !failInspection && (
        <label className="flex items-start gap-2 rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={receivingAck}
            onChange={(e) => setReceivingAck(e.target.checked)}
            className="mt-0.5 rounded border-slate-600"
          />
          <span>
            I have inspected the received material — quantity matches, correct
            part number, no visible damage — and I am signing off the dock
            acceptance.
            <span className="mt-0.5 block text-[11px] text-slate-500">
              Required for standard (no GD&amp;T / functional) material.
              Nothing is auto-signed on your behalf.
            </span>
          </span>
        </label>
      )}

      <div className="rounded-lg border border-rose-900/50 bg-rose-500/5 p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-rose-400/90">
          Damage / reject entire receipt
        </p>
        <label className="flex items-start gap-2 text-sm text-rose-200/90">
          <input
            type="checkbox"
            checked={failInspection}
            onChange={(e) => setFailInspection(e.target.checked)}
            className="mt-0.5 rounded border-slate-600"
          />
          <span>
            Force fail → open NCR / MRB (skip putaway and test queue). Use only when
            the whole delivery is bad.
          </span>
        </label>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !anyQty}>
          {pending
            ? "Working…"
            : failInspection
              ? "Fail receipt → MRB"
              : routeLabel && allRouteInspect
                ? routeLabel
                : routeLabel && mixedModes
                  ? "Receive (split stock + QA/Test)"
                  : partialPreview
                    ? "Receive partial"
                    : "Receive & put away"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setQtys(Object.fromEntries(openLines.map((l) => [l.id, String(l.open)])));
          }}
        >
          Fill remaining qty
        </Button>
      </div>
    </form>
  );
}

function DocUpload({
  label,
  docs,
  onFiles,
  onClear,
  compact,
}: {
  label: string;
  docs: FileDoc[];
  onFiles: (f: FileList | null) => void;
  onClear: () => void;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : ""}>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      <label
        className={`mt-0.5 inline-flex cursor-pointer items-center gap-1.5 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:border-teal-700 ${
          compact ? "" : "w-full justify-center"
        }`}
      >
        <FileText className="h-3 w-3" />
        Attach
        <input
          type="file"
          accept="image/*,.pdf,.doc,.docx,.png,.jpg,.jpeg"
          multiple
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>
      {docs.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-teal-500/90">
            {docs.length} file{docs.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="text-[10px] text-slate-500 underline"
            onClick={onClear}
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
