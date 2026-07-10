"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkHit = {
  id: string;
  kind: "TASK" | "SAGA" | "CAMPAIGN";
  number: string;
  name: string;
  discipline?: string | null;
  label?: string;
};

/**
 * Type-to-search multi-select for dependencies (tasks / sagas / campaigns).
 * Renders hidden inputs for FormData: dependsOnTaskIds / dependsOnSagaIds / dependsOnCampaignIds
 */
export function WorkDependencyTypeahead({
  items,
  nameTask = "dependsOnTaskIds",
  nameSaga = "dependsOnSagaIds",
  nameCampaign = "dependsOnCampaignIds",
  placeholder = "Type task, saga, or campaign name…",
}: {
  items: WorkHit[];
  nameTask?: string;
  nameSaga?: string;
  nameCampaign?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<WorkHit[]>([]);

  const matches = useMemo(() => {
    const query = q.trim().toUpperCase();
    if (query.length < 1) return [];
    const picked = new Set(selected.map((s) => `${s.kind}:${s.id}`));
    return items
      .filter((i) => {
        if (picked.has(`${i.kind}:${i.id}`)) return false;
        const hay = `${i.number} ${i.name} ${i.discipline || ""} ${i.label || ""}`.toUpperCase();
        return hay.includes(query);
      })
      .slice(0, 10);
  }, [q, items, selected]);

  function add(hit: WorkHit) {
    setSelected((p) => [...p, hit]);
    setQ("");
  }

  function remove(hit: WorkHit) {
    setSelected((p) =>
      p.filter((x) => !(x.kind === hit.kind && x.id === hit.id))
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
          autoComplete="off"
        />
        {matches.length > 0 && (
          <div className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-950 shadow-lg">
            {matches.map((m) => (
              <button
                key={`${m.kind}-${m.id}`}
                type="button"
                className="flex w-full flex-col items-start border-b border-slate-800 px-3 py-2 text-left text-xs hover:bg-slate-900"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(m)}
              >
                <span className="font-mono text-teal-400">
                  {m.number}{" "}
                  <span className="text-[10px] text-slate-500">{m.kind}</span>
                  {m.discipline && (
                    <span className="text-[10px] text-violet-400">
                      {" "}
                      · {m.discipline}
                    </span>
                  )}
                </span>
                <span className="text-slate-300">{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <li
              key={`${s.kind}-${s.id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-200"
              )}
            >
              <span className="font-mono text-teal-400">{s.number}</span>
              <span className="max-w-[120px] truncate">{s.name}</span>
              <button
                type="button"
                onClick={() => remove(s)}
                className="text-slate-500 hover:text-rose-400"
                aria-label="Remove"
              >
                <X className="h-3 w-3" />
              </button>
              {s.kind === "TASK" && (
                <input type="hidden" name={nameTask} value={s.id} />
              )}
              {s.kind === "SAGA" && (
                <input type="hidden" name={nameSaga} value={s.id} />
              )}
              {s.kind === "CAMPAIGN" && (
                <input type="hidden" name={nameCampaign} value={s.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
