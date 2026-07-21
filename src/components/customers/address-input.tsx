"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";

/**
 * Address textarea with type-ahead. Suggestions come from the free
 * OpenStreetMap Photon geocoder as you type the street line; selecting one
 * fills a formatted address. Fails silently offline — it's still a plain
 * textarea.
 */
export function AddressInput({
  name,
  defaultValue,
  rows = 5,
  placeholder,
  className,
}: {
  name: string;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue || "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function onChange(v: string) {
    setValue(v);
    // Suggest based on the line being typed (usually the street line)
    const line = v.split("\n").pop()?.trim() || "";
    if (timer.current) clearTimeout(timer.current);
    if (line.length < 4 || !/\d|\w{4,}/.test(line)) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(line)}&limit=5&lang=en`,
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          features?: {
            properties?: {
              housenumber?: string;
              street?: string;
              name?: string;
              city?: string;
              town?: string;
              village?: string;
              state?: string;
              postcode?: string;
              country?: string;
            };
          }[];
        };
        const opts = (data.features || [])
          .map((f) => {
            const p = f.properties || {};
            const line1 = [p.housenumber, p.street || p.name]
              .filter(Boolean)
              .join(" ");
            const line2 = [p.city || p.town || p.village, p.state, p.postcode]
              .filter(Boolean)
              .join(", ");
            return [line1, line2].filter(Boolean).join("\n");
          })
          .filter((s) => s.includes("\n"));
        const unique = [...new Set(opts)];
        setSuggestions(unique);
        setOpen(unique.length > 0);
      } catch {
        // Offline / blocked — behave like a normal textarea
      }
    }, 350);
  }

  function pick(s: string) {
    // Keep any lines already typed above the street line (e.g. company name)
    const lines = value.split("\n");
    lines.pop();
    setValue([...lines, s].filter(Boolean).join("\n"));
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <Textarea
        name={name}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className="block w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-teal-500/10"
            >
              {s.replace("\n", " · ")}
            </button>
          ))}
          <p className="border-t border-slate-800 px-3 py-1 text-[9px] text-slate-600">
            Suggestions © OpenStreetMap contributors
          </p>
        </div>
      )}
    </div>
  );
}
