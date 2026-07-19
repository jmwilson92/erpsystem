"use client";

import { useState, useTransition } from "react";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  actionVerifyPackingList,
  actionPackShipment,
  actionShipSalesOrder,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera } from "lucide-react";
import {
  useActionLoading,
  type ActionTheme,
} from "@/components/layout/action-loading";

export function PackShipPanel({
  shipmentId,
  salesOrderId,
  packingListVerified,
  status,
  shipToAddress,
  lineSummary,
  depositBlocked,
  depositMessage,
}: {
  shipmentId: string;
  salesOrderId: string;
  packingListVerified: boolean;
  status: string;
  shipToAddress?: string | null;
  lineSummary: string[];
  /** Hard block — deposit pending on the sales order */
  depositBlocked?: boolean;
  depositMessage?: string | null;
}) {
  const [photos, setPhotos] = useState<
    { url: string; fileName: string; caption: string }[]
  >([]);
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { start: startLoading, stop: stopLoading } = useActionLoading();
  const packed = status === "PACKED" || status === "SHIPPED";
  const shipped = status === "SHIPPED" || status === "DELIVERED";

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; fileName: string; caption: string }[] = [];
    for (const file of Array.from(files).slice(0, 8)) {
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
    setPhotos((p) => [...p, ...next].slice(0, 12));
  }

  function run(theme: ActionTheme, fn: () => Promise<void>) {
    setError(null);
    // Paint overlay before startTransition (transition setState is deferred).
    startLoading(theme);
    startTransition(async () => {
      try {
        await fn();
        window.location.reload();
      } catch (e) {
        stopLoading();
        if (isRedirectError(e)) throw e;
        setError(e instanceof Error ? e.message : "Failed");
      }
    });
  }

  return (
    <div className="mt-3 space-y-3 rounded border border-slate-800 bg-slate-950/40 p-3">
      <div>
        <p className="text-[10px] uppercase text-slate-500">Packing list</p>
        <ul className="mt-1 text-xs text-slate-400">
          {lineSummary.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        {shipToAddress && (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[11px] text-slate-500">
            Ship to: {shipToAddress}
          </pre>
        )}
      </div>

      {!packingListVerified && !shipped && (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run("packing", async () => {
              const fd = new FormData();
              fd.set("shipmentId", shipmentId);
              await actionVerifyPackingList(fd);
            })
          }
        >
          1. Verify packing list
        </Button>
      )}

      {packingListVerified && !packed && (
        <div className="space-y-2">
          <p className="text-xs text-emerald-400/90">Packing list verified</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300">
            <Camera className="h-3.5 w-3.5" />
            Pack photos *
            <input
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              className="hidden"
              onChange={(e) => onFiles(e.target.files)}
            />
          </label>
          {photos.length > 0 && (
            <p className="text-[10px] text-teal-400">
              {photos.length} photo(s) attached
            </p>
          )}
          <Button
            type="button"
            size="sm"
            disabled={pending || photos.length === 0}
            onClick={() =>
              run("packing", async () => {
                const fd = new FormData();
                fd.set("shipmentId", shipmentId);
                photos.forEach((p, i) => {
                  fd.set(`pack_photo_${i}`, p.url);
                  fd.set(`pack_photo_name_${i}`, p.fileName);
                });
                await actionPackShipment(fd);
              })
            }
          >
            2. Pack (with photos)
          </Button>
        </div>
      )}

      {packed && !shipped && (
        <div className="space-y-2">
          {depositBlocked && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
              {depositMessage ||
                "Deposit required on this sales order — shipping is blocked until deposit is received or waived."}
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Carrier
              </label>
              <Input
                className="mt-0.5 h-8 w-32"
                value={carrier}
                onChange={(e) => setCarrier(e.target.value)}
                placeholder="UPS"
                disabled={depositBlocked}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Tracking
              </label>
              <Input
                className="mt-0.5 h-8 w-40 font-mono"
                value={tracking}
                onChange={(e) => setTracking(e.target.value)}
                disabled={depositBlocked}
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={pending || !!depositBlocked}
              onClick={() =>
                run("shipping", async () => {
                  const fd = new FormData();
                  fd.set("salesOrderId", salesOrderId);
                  fd.set("shipmentId", shipmentId);
                  if (carrier) fd.set("carrier", carrier);
                  if (tracking) fd.set("trackingNumber", tracking);
                  await actionShipSalesOrder(fd);
                })
              }
            >
              3. Ship
            </Button>
          </div>
        </div>
      )}

      {shipped && (
        <p className="text-xs text-emerald-400">
          Shipped — inventory &amp; sales order updated
        </p>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
