"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

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

// Semantic + validated categorical hues, per-mode.
const C = {
  teal: { light: "#14b8a6", dark: "#0d9488" },
  amber: { light: "#f59e0b", dark: "#d97706" },
  violet: { light: "#8b5cf6", dark: "#8b5cf6" },
  rose: { light: "#e11d48", dark: "#f43f5e" },
  sky: { light: "#0ea5e9", dark: "#0284c7" },
  green: { light: "#059669", dark: "#10b981" },
  slate: { light: "#64748b", dark: "#64748b" },
};
const short = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
};

function Tip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; payload?: { fill?: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-0.5 font-medium text-slate-200">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-slate-300">
          {p.name}
          <span className="ml-auto font-mono tabular-nums text-slate-100">
            {formatCurrency(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

/** Income statement as a component bar chart, revenue → net income. */
export function IncomeStatementChart({
  revenue,
  cogs,
  grossProfit,
  operatingExpenses,
  netIncome,
}: {
  revenue: number;
  cogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netIncome: number;
}) {
  const m = useThemeMode();
  const data = [
    { name: "Revenue", value: revenue, fill: C.teal[m] },
    { name: "COGS", value: cogs, fill: C.amber[m] },
    { name: "Gross profit", value: grossProfit, fill: C.sky[m] },
    { name: "Operating exp.", value: operatingExpenses, fill: C.rose[m] },
    { name: "Net income", value: netIncome, fill: netIncome >= 0 ? C.green[m] : C.rose[m] },
  ];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v) => short(Number(v) || 0)}
              style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Balance sheet as the accounting equation: Assets vs Liabilities+Equity. */
export function BalanceSheetChart({
  assets,
  liabilities,
  equity,
  currentEarnings,
}: {
  assets: number;
  liabilities: number;
  equity: number;
  currentEarnings: number;
}) {
  const m = useThemeMode();
  const data = [
    {
      name: "Assets",
      Assets: assets,
      Liabilities: 0,
      Equity: 0,
      Earnings: 0,
    },
    {
      name: "Liabilities + Equity",
      Assets: 0,
      Liabilities: liabilities,
      Equity: equity,
      Earnings: currentEarnings,
    },
  ];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
          <Bar dataKey="Assets" stackId="a" fill={C.teal[m]} radius={[4, 4, 0, 0]} maxBarSize={96} />
          <Bar dataKey="Liabilities" stackId="a" fill={C.amber[m]} maxBarSize={96} />
          <Bar dataKey="Equity" stackId="a" fill={C.violet[m]} maxBarSize={96} />
          <Bar dataKey="Earnings" stackId="a" fill={C.green[m]} radius={[4, 4, 0, 0]} maxBarSize={96} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Cash flow: the three activity totals plus the net change. */
export function CashFlowChart({
  operating,
  investing,
  financing,
  netChange,
}: {
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
}) {
  const m = useThemeMode();
  const data = [
    { name: "Operating", value: operating, fill: C.teal[m] },
    { name: "Investing", value: investing, fill: C.sky[m] },
    { name: "Financing", value: financing, fill: C.violet[m] },
    { name: "Net change", value: netChange, fill: netChange >= 0 ? C.green[m] : C.rose[m] },
  ];
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tickFormatter={short} tick={axisTick} tickLine={false} axisLine={false} width={48} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.3 }} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v) => short(Number(v) || 0)}
              style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
