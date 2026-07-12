"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

/** Tiny area chart for stat-card trends. */
export function Sparkline({
  data,
  color = "#14b8a6",
  prefix = "",
}: {
  data: { label: string; value: number }[];
  color?: string;
  prefix?: string;
}) {
  const id = `spark-${color.replace("#", "")}`;
  return (
    <div className="h-12 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{ stroke: "#334155", strokeDasharray: "2 2" }}
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 8,
              fontSize: 11,
              padding: "4px 8px",
            }}
            labelStyle={{ color: "#94a3b8" }}
            formatter={(value) => [
              `${prefix}${Number(value).toLocaleString()}`,
              "",
            ]}
            separator=""
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            dot={false}
            activeDot={{ r: 3, fill: color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
