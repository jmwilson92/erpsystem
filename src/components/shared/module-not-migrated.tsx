import { AlertTriangle } from "lucide-react";
import type { ModuleHealth } from "@/lib/services/module-health";

/**
 * Shown when a module's tables aren't in this database yet. Tells you the
 * one command that fixes it rather than dropping you on a route error with a
 * digest you can't do anything with.
 */
export function ModuleNotMigrated({
  module,
  health,
}: {
  module: string;
  health: Extract<ModuleHealth, { ok: false }>;
}) {
  const missing = health.reason === "missing_table";
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <div className="space-y-2">
          <p className="text-sm font-semibold text-amber-200">
            {missing
              ? `${module} isn't set up in this database yet`
              : `${module} can't reach the database`}
          </p>
          {missing ? (
            <>
              <p className="text-sm text-slate-300">
                The code is deployed but the tables haven&apos;t been created
                here. Run this once against this environment:
              </p>
              <pre className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-teal-300">
                npx prisma db push
              </pre>
              <p className="text-xs text-slate-500">
                Additive only — it creates the new tables and leaves existing
                data alone. Reload this page afterwards.
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-300">
              The database rejected the query. Check the connection settings for
              this environment and try again.
            </p>
          )}
          <p className="font-mono text-[11px] text-slate-600">{health.detail}</p>
        </div>
      </div>
    </div>
  );
}
