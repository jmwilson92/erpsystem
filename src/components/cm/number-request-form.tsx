"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { actionRequestCmNumber } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Hash } from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

type Scheme = {
  id: string;
  code: string;
  name: string;
  prefix: string;
  separator: string;
  padLength: number;
  nextSequence: number;
  example: string | null;
  appliesTo: string;
  isActive: boolean;
};

export function NumberRequestForm({
  schemes,
  productFolders,
}: {
  schemes: Scheme[];
  productFolders: { id: string; name: string; productName: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState(
    schemes.find((s) => s.code === "DRAWING")?.code || schemes[0]?.code || "DRAWING"
  );
  const [productFolderId, setProductFolderId] = useState("");

  const activeScheme = schemes.find((s) => s.code === category && s.isActive);
  const productName =
    productFolders.find((p) => p.id === productFolderId)?.productName ||
    productFolders.find((p) => p.id === productFolderId)?.name ||
    "";
  const nextPreview =
    activeScheme?.example ||
    (activeScheme
      ? `${activeScheme.prefix}${activeScheme.separator}${String(
          activeScheme.nextSequence
        ).padStart(activeScheme.padLength, "0")}`
      : "—");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await actionRequestCmNumber(fd);
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Request failed");
      }
    });
  }

  return (
    <Card className="border-violet-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Hash className="h-4 w-4 text-violet-400" />
          Request a part / document number
        </CardTitle>
        <p className="text-xs text-slate-500">
          Fill this out before starting an ECR. CM will assign a controlled
          number from company policy; use that number when you create your ECR
          or part record.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              What do you need? *
            </label>
            <select
              name="category"
              className={`${selectClass} mt-1`}
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {schemes
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.code}>
                    {s.name} ({s.prefix}…)
                  </option>
                ))}
            </select>
            {activeScheme && (
              <input type="hidden" name="schemeId" value={activeScheme.id} />
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              Next number under current scheme:{" "}
              <span className="font-mono text-violet-300">{nextPreview}</span>
              <span className="text-slate-600"> (CM may override)</span>
            </p>
          </div>
          <div>
            <label className="text-[10px] uppercase text-slate-500">
              Product / area{" "}
              <span className="normal-case text-slate-600">(optional)</span>
            </label>
            <select
              name="productFolderId"
              className={`${selectClass} mt-1`}
              value={productFolderId}
              onChange={(e) => setProductFolderId(e.target.value)}
            >
              <option value="">— Not product-specific —</option>
              {productFolders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.productName || p.name}
                </option>
              ))}
            </select>
            <input type="hidden" name="productName" value={productName} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Title / what is this for? *
            </label>
            <Input
              name="title"
              required
              className="mt-1"
              placeholder="e.g. Housing assembly drawing, Safety policy, Incoming inspection form…"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Description
            </label>
            <Textarea
              name="description"
              rows={2}
              className="mt-1"
              placeholder="Brief description of the drawing, policy, test, form, or part…"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] uppercase text-slate-500">
              Preferred number{" "}
              <span className="normal-case text-slate-600">
                (optional — CM decides final)
              </span>
            </label>
            <Input
              name="preferredNumber"
              className="mt-1 font-mono"
              placeholder="Leave blank for auto-assign from scheme"
            />
          </div>
          {error && (
            <p className="sm:col-span-2 text-xs text-rose-400">{error}</p>
          )}
          <div className="sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Submitting…" : "Submit number request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
