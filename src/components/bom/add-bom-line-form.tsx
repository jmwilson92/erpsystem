"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { actionAddBomLine, actionQuickCreatePart } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

type PartOpt = {
  id: string;
  partNumber: string;
  description: string;
  uom?: string | null;
};

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

/**
 * Add BOM line without full-page navigation. Optional inline part create.
 */
export function AddBomLineForm({
  partId,
  bomHeaderId,
  componentParts,
  uomCodes = ["EA", "LB", "FT", "IN", "GAL", "L", "KG", "M", "SET"],
}: {
  partId: string;
  bomHeaderId: string;
  componentParts: PartOpt[];
  uomCodes?: string[];
}) {
  const router = useRouter();
  const [parts, setParts] = useState(componentParts);
  const [componentPartId, setComponentPartId] = useState("");
  const [uom, setUom] = useState("EA");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [showCreate, setShowCreate] = useState(false);

  const selected = useMemo(
    () => parts.find((p) => p.id === componentPartId),
    [parts, componentPartId]
  );

  function onSelectPart(id: string) {
    setComponentPartId(id);
    const p = parts.find((x) => x.id === id);
    if (p?.uom) setUom(p.uom);
  }

  function addLine() {
    setError(null);
    if (!componentPartId) {
      setError("Select a component");
      return;
    }
    const fd = new FormData();
    fd.set("partId", partId);
    fd.set("bomHeaderId", bomHeaderId);
    fd.set("componentPartId", componentPartId);
    const qtyInput = document.getElementById(
      "bom-add-qty"
    ) as HTMLInputElement | null;
    const findInput = document.getElementById(
      "bom-add-find"
    ) as HTMLInputElement | null;
    fd.set("quantity", qtyInput?.value || "1");
    fd.set("uom", uom);
    if (findInput?.value) fd.set("findNumber", findInput.value);
    startTransition(async () => {
      try {
        await actionAddBomLine(fd);
        setComponentPartId("");
        if (qtyInput) qtyInput.value = "1";
        if (findInput) findInput.value = "";
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add line");
      }
    });
  }

  function createPart() {
    setError(null);
    const pn = (
      document.getElementById("quick-pn") as HTMLInputElement | null
    )?.value;
    const desc = (
      document.getElementById("quick-desc") as HTMLInputElement | null
    )?.value;
    const qu = (
      document.getElementById("quick-uom") as HTMLSelectElement | null
    )?.value;
    if (!pn?.trim() || !desc?.trim()) {
      setError("Part number and description required");
      return;
    }
    const fd = new FormData();
    fd.set("partNumber", pn.trim());
    fd.set("description", desc.trim());
    fd.set("uom", qu || "EA");
    fd.set("sourcingMethod", "PURCHASE");
    startTransition(async () => {
      try {
        const created = await actionQuickCreatePart(fd);
        setParts((p) => [
          {
            id: created.id,
            partNumber: created.partNumber,
            description: created.description,
            uom: created.uom,
          },
          ...p,
        ]);
        setComponentPartId(created.id);
        setUom(created.uom || "EA");
        setShowCreate(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create part");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-500">
            Component item *
          </label>
          <div className="mt-1 flex gap-2">
            <select
              value={componentPartId}
              onChange={(e) => onSelectPart(e.target.value)}
              className={`${selectClass} min-w-0 flex-1`}
            >
              <option value="">— Select part —</option>
              {parts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.partNumber} — {c.description}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0"
              title="Create new part"
              onClick={() => setShowCreate((v) => !v)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {selected && (
            <p className="mt-1 text-[10px] text-slate-500">
              Default UOM {selected.uom || "EA"}
            </p>
          )}
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500">
            Quantity *
          </label>
          <Input
            id="bom-add-qty"
            name="quantity"
            type="number"
            step="any"
            defaultValue={1}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-slate-500">UOM</label>
          <select
            value={uom}
            onChange={(e) => setUom(e.target.value)}
            className={`${selectClass} mt-1`}
          >
            {uomCodes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[10px] uppercase text-slate-500">Find #</label>
          <Input id="bom-add-find" name="findNumber" className="mt-1 font-mono" />
        </div>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-sky-300">
              Quick-create part
            </p>
            <button
              type="button"
              className="text-slate-500 hover:text-slate-300"
              onClick={() => setShowCreate(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Part number *
              </label>
              <Input id="quick-pn" className="mt-1 font-mono" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Description *
              </label>
              <Input id="quick-desc" className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">UOM</label>
              <select id="quick-uom" className={`${selectClass} mt-1`} defaultValue="EA">
                {uomCodes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end sm:col-span-2">
              <Button
                type="button"
                size="sm"
                disabled={pending}
                onClick={createPart}
              >
                Create &amp; select
              </Button>
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}
      <Button type="button" size="sm" disabled={pending} onClick={addLine}>
        {pending ? "Adding…" : "Add to BOM"}
      </Button>
    </div>
  );
}
