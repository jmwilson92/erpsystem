"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { actionSaveTimecardGrid } from "@/app/actions";

type ChargeType =
  | "REGULAR"
  | "OVERHEAD"
  | "PTO"
  | "SICK"
  | "HOLIDAY";

export type GridEntry = {
  id: string;
  date: string; // ISO yyyy-mm-dd
  hours: number;
  type: string;
  workOrderId: string | null;
  projectId: string | null;
  wbsElementId: string | null;
  engTaskId: string | null;
  chargeCode: string | null;
};

export type ChargeOptions = {
  workOrders: { id: string; number: string; department: string | null }[];
  projects: { id: string; number: string; name: string }[];
  wbsElements: { id: string; code: string; name: string; projectId: string }[];
  engTasks: { id: string; number: string; name: string }[];
  /** Named overhead / indirect charge codes from the chart of accounts */
  chargeCodes: { code: string; name: string }[];
};

type Row = {
  key: string;
  type: ChargeType | string;
  workOrderId: string | null;
  projectId: string | null;
  wbsElementId: string | null;
  engTaskId: string | null;
  chargeCode: string | null;
  hours: Record<string, string>; // iso -> input value
};

const rowKey = (r: {
  type: string;
  workOrderId: string | null;
  projectId: string | null;
  wbsElementId: string | null;
  engTaskId: string | null;
  chargeCode: string | null;
}) =>
  [
    r.type,
    r.workOrderId || "",
    r.projectId || "",
    r.wbsElementId || "",
    r.engTaskId || "",
    r.chargeCode || "",
  ].join("|");

const HR_TYPES = ["PTO", "SICK", "HOLIDAY"];

export function TimecardGrid({
  sheetId,
  days,
  entries,
  options,
  editable,
  policy,
}: {
  sheetId: string;
  days: string[]; // ISO dates of the period
  entries: GridEntry[];
  options: ChargeOptions;
  editable: boolean;
  policy: {
    maxHoursPerDay: number;
    otAfterDailyHours: number;
    dtAfterDailyHours: number;
  };
}) {
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const initialRows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const e of entries) {
      const k = rowKey(e);
      const row =
        map.get(k) ||
        ({
          key: k,
          type: e.type,
          workOrderId: e.workOrderId,
          projectId: e.projectId,
          wbsElementId: e.wbsElementId,
          engTaskId: e.engTaskId,
          chargeCode: e.chargeCode,
          hours: {},
        } as Row);
      row.hours[e.date] = String(
        (Number(row.hours[e.date] || 0) + e.hours) || ""
      );
      map.set(k, row);
    }
    return [...map.values()];
  }, [entries]);

  const [rows, setRows] = useState<Row[]>(initialRows);

  // Add-row picker state
  const [newKind, setNewKind] = useState("WO");
  const [newWo, setNewWo] = useState("");
  const [newProject, setNewProject] = useState("");
  const [newWbs, setNewWbs] = useState("");
  const [newTask, setNewTask] = useState("");
  const [newChargeCode, setNewChargeCode] = useState("");

  const blank = {
    workOrderId: null,
    projectId: null,
    wbsElementId: null,
    engTaskId: null,
    chargeCode: null,
  };

  const addRow = () => {
    let row: Row | null = null;
    if (newKind === "WO" && newWo) {
      row = { key: "", type: "REGULAR", ...blank, workOrderId: newWo, hours: {} };
    } else if (newKind === "PROJECT" && newProject) {
      row = {
        key: "",
        type: "REGULAR",
        ...blank,
        projectId: newProject,
        wbsElementId: newWbs || null,
        hours: {},
      };
    } else if (newKind === "TASK" && newTask) {
      // Engineering task time when there's no work order to charge against
      row = { key: "", type: "REGULAR", ...blank, engTaskId: newTask, hours: {} };
    } else if (newKind === "OVERHEAD") {
      // Named overhead / indirect charge code (e.g. OH); blank = general OH
      row = {
        key: "",
        type: "OVERHEAD",
        ...blank,
        chargeCode: newChargeCode || "OH",
        hours: {},
      };
    } else if (["PTO", "SICK", "HOLIDAY"].includes(newKind)) {
      row = { key: "", type: newKind, ...blank, hours: {} };
    }
    if (!row) return;
    row.key = rowKey(row);
    if (rows.some((r) => r.key === row!.key)) return;
    setRows([...rows, row]);
    setNewWo("");
    setNewWbs("");
    setNewTask("");
    setNewChargeCode("");
  };

  const label = (r: Row) => {
    if (r.workOrderId) {
      const wo = options.workOrders.find((w) => w.id === r.workOrderId);
      return `${wo?.number || "WO"} (direct${wo?.department ? ` · ${wo.department}` : ""})`;
    }
    if (r.projectId) {
      const p = options.projects.find((p) => p.id === r.projectId);
      const w = r.wbsElementId
        ? options.wbsElements.find((w) => w.id === r.wbsElementId)
        : null;
      return `${p?.number || "Project"}${w ? ` / WBS ${w.code}` : ""}`;
    }
    if (r.engTaskId) {
      const t = options.engTasks.find((t) => t.id === r.engTaskId);
      return `${t?.number || "Task"} (task)`;
    }
    if (r.type === "OVERHEAD") {
      const cc = r.chargeCode || "OH";
      const named = options.chargeCodes.find((c) => c.code === cc);
      return `Overhead · ${cc}${named ? ` (${named.name})` : ""}`;
    }
    return r.type.replace(/_/g, " ");
  };

  const setCell = (key: string, iso: string, v: string) => {
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, hours: { ...r.hours, [iso]: v } } : r))
    );
  };

  const dayTotal = (iso: string) =>
    rows.reduce((s, r) => s + (Number(r.hours[iso]) || 0), 0);
  const rowTotal = (r: Row) =>
    days.reduce((s, d) => s + (Number(r.hours[d]) || 0), 0);
  const grand = days.reduce((s, d) => s + dayTotal(d), 0);

  const today = new Date().toISOString().slice(0, 10);

  const save = () => {
    setError(null);
    const payload = rows
      .map((r) => ({
        type: r.type,
        workOrderId: r.workOrderId,
        projectId: r.projectId,
        wbsElementId: r.wbsElementId,
        engTaskId: r.engTaskId,
        chargeCode: r.chargeCode,
        hours: Object.fromEntries(
          Object.entries(r.hours)
            .map(([k, v]) => [k, Number(v) || 0])
            .filter(([, v]) => (v as number) > 0)
        ),
      }))
      .filter((r) => Object.keys(r.hours).length > 0);
    const fd = new FormData();
    fd.set("sheetId", sheetId);
    fd.set("rows", JSON.stringify(payload));
    startSave(async () => {
      try {
        await actionSaveTimecardGrid(fd);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  };

  const fmtDay = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="px-2 py-1.5 text-left">Charge code</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`px-1 py-1.5 text-center ${d === today ? "text-teal-400" : ""}`}
                >
                  {fmtDay(d)}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-800/60">
                <td className="px-2 py-1 text-slate-300">
                  {label(r)}
                  {editable && (
                    <button
                      type="button"
                      onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                      className="ml-1.5 text-slate-600 hover:text-rose-400"
                      title="Remove row"
                    >
                      ×
                    </button>
                  )}
                </td>
                {days.map((d) => (
                  <td key={d} className="px-0.5 py-1 text-center">
                    {editable ? (
                      <input
                        type="number"
                        min={0}
                        max={24}
                        step={0.25}
                        value={r.hours[d] ?? ""}
                        onChange={(e) => setCell(r.key, d, e.target.value)}
                        disabled={d > today && !HR_TYPES.includes(r.type)}
                        title={
                          d > today && !HR_TYPES.includes(r.type)
                            ? "Work time can't be future-dated"
                            : undefined
                        }
                        className="h-8 w-14 rounded border border-slate-700 bg-slate-950 text-center text-xs text-slate-200 disabled:opacity-30"
                      />
                    ) : (
                      <span className="tabular-nums text-slate-400">
                        {r.hours[d] || ""}
                      </span>
                    )}
                  </td>
                ))}
                <td className="px-2 py-1 text-right tabular-nums text-teal-400">
                  {rowTotal(r) || ""}
                </td>
              </tr>
            ))}
            <tr className="text-xs">
              <td className="px-2 py-1.5 text-slate-500">Day totals</td>
              {days.map((d) => {
                const t = dayTotal(d);
                const tone =
                  t > policy.maxHoursPerDay
                    ? "text-rose-400 font-semibold"
                    : t > policy.dtAfterDailyHours
                      ? "text-rose-400"
                      : t > policy.otAfterDailyHours
                        ? "text-amber-400"
                        : "text-slate-400";
                return (
                  <td key={d} className={`px-1 py-1.5 text-center tabular-nums ${tone}`}>
                    {t || ""}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-right tabular-nums text-slate-200">
                {grand || ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-500">
        Amber = past {policy.otAfterDailyHours}h (overtime) · red = past{" "}
        {policy.dtAfterDailyHours}h (double time) · hard cap{" "}
        {policy.maxHoursPerDay}h/day. Future cells only open for PTO / sick /
        holiday rows.
      </p>

      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
          >
            <option value="WO">Work order (direct)</option>
            <option value="PROJECT">Project / WBS</option>
            <option value="TASK">Engineering task</option>
            <option value="OVERHEAD">Overhead / charge code</option>
            <option value="PTO">PTO</option>
            <option value="SICK">Sick</option>
            <option value="HOLIDAY">Holiday</option>
          </select>
          {newKind === "WO" && (
            <select
              value={newWo}
              onChange={(e) => setNewWo(e.target.value)}
              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            >
              <option value="">Pick work order…</option>
              {options.workOrders.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.number}
                  {w.department ? ` · ${w.department}` : ""}
                </option>
              ))}
            </select>
          )}
          {newKind === "PROJECT" && (
            <>
              <select
                value={newProject}
                onChange={(e) => {
                  setNewProject(e.target.value);
                  setNewWbs("");
                }}
                className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
              >
                <option value="">Pick project…</option>
                {options.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} {p.name}
                  </option>
                ))}
              </select>
              <select
                value={newWbs}
                onChange={(e) => setNewWbs(e.target.value)}
                disabled={!newProject}
                className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 disabled:opacity-40"
              >
                <option value="">Whole project</option>
                {options.wbsElements
                  .filter((w) => w.projectId === newProject)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} {w.name}
                    </option>
                  ))}
              </select>
            </>
          )}
          {newKind === "TASK" && (
            <select
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            >
              <option value="">Pick task…</option>
              {options.engTasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.number} · {t.name}
                </option>
              ))}
            </select>
          )}
          {newKind === "OVERHEAD" && (
            <select
              value={newChargeCode}
              onChange={(e) => setNewChargeCode(e.target.value)}
              className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200"
            >
              <option value="">OH · General overhead</option>
              {options.chargeCodes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          )}
          <Button type="button" size="sm" variant="outline" onClick={addRow}>
            Add row
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save timecard"}
          </Button>
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
