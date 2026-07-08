"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export function QualityCharts({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} name="NCRs" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
