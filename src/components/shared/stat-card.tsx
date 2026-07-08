import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  accent = "teal",
  className,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive?: boolean };
  accent?: "teal" | "amber" | "emerald" | "red" | "sky" | "violet";
  className?: string;
}) {
  const accents = {
    teal: "from-teal-500/10 to-transparent text-teal-400",
    amber: "from-amber-500/10 to-transparent text-amber-400",
    emerald: "from-emerald-500/10 to-transparent text-emerald-400",
    red: "from-red-500/10 to-transparent text-red-400",
    sky: "from-sky-500/10 to-transparent text-sky-400",
    violet: "from-violet-500/10 to-transparent text-violet-400",
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className={cn("relative p-5 bg-gradient-to-br", accents[accent])}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
            <p className="mt-2 text-2xl font-bold text-slate-50 tabular-nums">{value}</p>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
            {trend && (
              <p
                className={cn(
                  "mt-1 text-xs font-medium",
                  trend.positive ? "text-emerald-400" : "text-red-400"
                )}
              >
                {trend.value}
              </p>
            )}
          </div>
          {Icon && (
            <div className="rounded-lg bg-slate-950/40 p-2.5">
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
