"use client";

import { useState } from "react";
import { Camera } from "lucide-react";

/** Hidden photo_* fields for server actionAddWiStep + thumbnail preview */
export function StepPhotoFields({ max = 6 }: { max?: number }) {
  const [photos, setPhotos] = useState<{ url: string; name: string }[]>([]);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const next: { url: string; name: string }[] = [];
    for (const file of Array.from(files).slice(0, max)) {
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      next.push({ url, name: file.name });
    }
    setPhotos((p) => [...p, ...next].slice(0, max));
  }

  return (
    <div className="sm:col-span-2 rounded border border-slate-800 p-2">
      <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
        <Camera className="h-3.5 w-3.5" />
        Add photo / picture
        <input
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>
      {photos.map((ph, i) => (
        <input key={i} type="hidden" name={`photo_${i}`} value={ph.url} />
      ))}
      {photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {photos.map((ph, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ph.url}
                alt={ph.name}
                className="h-16 w-16 rounded border border-slate-700 object-cover"
              />
              <button
                type="button"
                className="absolute -right-1 -top-1 rounded bg-rose-600 px-1 text-[10px] text-white"
                onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
