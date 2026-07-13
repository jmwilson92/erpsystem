"use client";

import { useMemo, useState } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  FEDERAL_HOLIDAYS,
  DEFAULT_OBSERVED,
  computeObservedHolidays,
} from "@/lib/federal-holidays";

/**
 * Company-holiday picker: toggle which federal holidays are observed
 * (pre-populated), plus free-form custom holidays. Emits the combined
 * list into the form's `holidays` field (YYYY-MM-DD Name per line).
 */
export function HolidayPicker({ initialText }: { initialText: string }) {
  const federalNames = new Set(FEDERAL_HOLIDAYS.map((h) => h.name.toLowerCase()));

  // Split incoming lines into recognized-federal (→ toggle on) vs custom.
  const initialLines = initialText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const initialCustom = initialLines
    .filter((l) => {
      const name = l.replace(/^\d{4}-\d{2}-\d{2}\s*/, "").toLowerCase();
      return !federalNames.has(name);
    })
    .join("\n");

  // If the policy already had holidays, respect which federal ones were on;
  // otherwise default to the common observed set.
  const hadContent = initialLines.length > 0;
  const initiallyOn = new Set<string>(
    hadContent
      ? FEDERAL_HOLIDAYS.filter((h) =>
          initialLines.some((l) =>
            l.toLowerCase().includes(h.name.toLowerCase())
          )
        ).map((h) => h.key)
      : DEFAULT_OBSERVED
  );

  const [enabled, setEnabled] = useState<Set<string>>(initiallyOn);
  const [custom, setCustom] = useState(initialCustom);

  const thisYear = new Date().getFullYear();
  const computed = useMemo(() => {
    const fed = computeObservedHolidays([...enabled], [thisYear, thisYear + 1]);
    const fedLines = fed.map((h) => `${h.date} ${h.name}`);
    const customLines = custom
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return [...fedLines, ...customLines].join("\n");
  }, [enabled, custom, thisYear]);

  function toggle(key: string, on: boolean) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1.5 text-xs text-slate-500">
          Federal holidays observed (pre-filled for {thisYear} &amp;{" "}
          {thisYear + 1})
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {FEDERAL_HOLIDAYS.map((h) => (
            <ToggleSwitch
              key={h.key}
              checked={enabled.has(h.key)}
              onChange={(v) => toggle(h.key, v)}
              label={h.name}
            />
          ))}
        </div>
      </div>
      <label className="block text-xs text-slate-500">
        Custom company holidays (one per line: YYYY-MM-DD Name)
        <textarea
          rows={3}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="2026-12-24 Christmas Eve (company)"
          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
      </label>
      {/* Real submitted field */}
      <input type="hidden" name="holidays" value={computed} />
    </div>
  );
}
