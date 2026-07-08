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
  CartesianGrid,
} from "recharts";

const COLORS = ["#14b8a6", "#f59e0b", "#38bdf8", "#a78bfa", "#f87171", "#34d399", "#94a3b8"];

export function DashboardCharts({
  data,
}: {
  data: {
    woByStatus: { name: string; value: number }[];
    suppliers: { name: string; score: number; otd: number }[];
  };
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="h-56">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Work Orders by Status
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.woByStatus}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
            >
              {data.woByStatus.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="h-56">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
          Supplier Scores
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.suppliers}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Bar dataKey="score" fill="#14b8a6" radius={[4, 4, 0, 0]} name="Score" />
            <Bar dataKey="otd" fill="#38bdf8" radius={[4, 4, 0, 0]} name="OTD %" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
