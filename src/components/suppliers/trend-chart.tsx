"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

export function SupplierTrendChart({
  data,
}: {
  data: { period: string; score: number; otd: number; ppm: number }[];
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="period" tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis tick={{ fill: "#64748b", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Legend />
          <Line type="monotone" dataKey="score" stroke="#14b8a6" strokeWidth={2} name="Score" dot={false} />
          <Line type="monotone" dataKey="otd" stroke="#38bdf8" strokeWidth={2} name="OTD %" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
