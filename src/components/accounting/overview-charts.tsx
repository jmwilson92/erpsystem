"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

/** Track the app's light/dark class on <html> so chart colors follow it. */
function useThemeMode(): "light" | "dark" {
  const [mode, setMode] = useState<"light" | "dark">("dark");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setMode(el.classList.contains("light") ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

// Validated categorical palette (order: teal, amber, violet, rose, sky,
// green, + slate for "Other"). Per-mode steps — both modes pass all six
// dataviz checks against the app's card surfaces. Do not reorder: the
// sequence is the colorblind-safety mechanism.
const CAT = {
  light: ["#14b8a6", "#f59e0b", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16", "#64748b"],
  dark: ["#0d9488", "#d97706", "#8b5cf6", "#f43f5e", "#0284c7", "#65a30d", "#64748b"],
};
// Semantic income/expense — conventional accounting green/red.
const INCOME = { light: "#059669", dark: "#10b981" };
const EXPENSE = { light: "#e11d48", dark: "#f43f5e" };

const short = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-medium text-slate-200">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-300">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          {p.name}
          <span className="ml-auto font-mono tabular-nums text-slate-100">
            {formatCurrency(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function IncomeExpenseTrendChart({
  data,
}: {
  data: { label: string; income: number; expense: number; net: number }[];
}) {
  const mode = useThemeMode();
  const income = INCOME[mode];
  const expense = EXPENSE[mode];
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={income} stopOpacity={0.25} />
              <stop offset="100%" stopColor={income} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            tickFormatter={short}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={44}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Area
            type="monotone"
            dataKey="income"
            name="Income"
            stroke={income}
            strokeWidth={2}
            fill="url(#incFill)"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="expense"
            name="Expenses"
            stroke={expense}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SpendDonut({
  data,
}: {
  data: { name: string; code: string; amount: number }[];
}) {
  const mode = useThemeMode();
  const palette = CAT[mode];
  const total = data.reduce((s, d) => s + d.amount, 0);
  if (total <= 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-500">
        No spending recorded yet.
      </div>
    );
  }
  const colorOf = (i: number) =>
    data[i]?.name === "Other" ? palette[6] : palette[i % 6];

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row">
      <div className="relative h-56 w-56 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="amount"
              nameKey="name"
              innerRadius={62}
              outerRadius={90}
              paddingAngle={2}
              stroke="var(--card)"
              strokeWidth={2}
            >
              {data.map((d, i) => (
                <Cell key={d.name} fill={colorOf(i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Total
          </span>
          <span className="text-lg font-bold tabular-nums text-slate-100">
            {short(total)}
          </span>
        </div>
      </div>
      {/* Legend doubles as the table view (relief for light-mode contrast). */}
      <div className="w-full space-y-1">
        {data.map((d, i) => {
          const pct = Math.round((d.amount / total) * 100);
          return (
            <div key={d.name} className="flex items-center gap-2 text-xs">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: colorOf(i) }}
              />
              <span className="truncate text-slate-300">
                {d.code ? <span className="font-mono text-slate-500">{d.code} </span> : null}
                {d.name}
              </span>
              <span className="ml-auto font-mono tabular-nums text-slate-400">
                {formatCurrency(d.amount)}
              </span>
              <span className="w-8 text-right tabular-nums text-slate-500">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
