"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
} from "recharts";
import type { DisciplinePulse } from "@/lib/services/dashboard-pulse";

const COLORS = ["#14b8a6", "#f59e0b", "#38bdf8", "#a78bfa", "#f87171", "#34d399", "#94a3b8"];

const tooltipStyle = {
  background: "#0f172a",
  border: "1px solid #1e293b",
  borderRadius: 8,
  fontSize: 12,
} as const;

export function DisciplinePulseCharts({ pulse }: { pulse: DisciplinePulse }) {
  const { pie, bar } = pulse;
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="h-56">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          {pie.title}
        </p>
        {pie.data.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pie.data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
              >
                {pie.data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend
                wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="h-56">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          {bar.title}
        </p>
        {bar.data.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bar.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey={bar.xKey} tick={{ fill: "#64748b", fontSize: 11 }} />
              <YAxis
                domain={bar.domainMax ? [0, bar.domainMax] : undefined}
                tick={{ fill: "#64748b", fontSize: 11 }}
                allowDecimals={false}
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#1e293b40" }} />
              {bar.series.length > 1 && (
                <Legend
                  wrapperStyle={{ fontSize: 10, color: "#94a3b8" }}
                  iconSize={8}
                />
              )}
              {bar.series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.name}
                  fill={s.color}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[calc(100%-1.5rem)] items-center justify-center rounded-lg border border-dashed border-slate-800 text-xs text-slate-600">
      No data yet
    </div>
  );
}
