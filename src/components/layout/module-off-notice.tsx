import Link from "next/link";
import { PackageX } from "lucide-react";

/** Shown in place of a page whose module has been turned off. */
export function ModuleOffNotice({ moduleName }: { moduleName: string }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl border border-slate-800 bg-slate-950/60 p-8 text-center">
      <PackageX className="mx-auto h-10 w-10 text-slate-600" />
      <h2 className="mt-3 text-lg font-semibold text-slate-200">
        {moduleName} is turned off
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        This module isn&apos;t part of your current plan. An administrator can
        re-enable it in Company Settings.
      </p>
      <Link
        href="/admin/settings"
        className="mt-4 inline-block rounded-lg border border-teal-700/50 bg-teal-500/10 px-4 py-2 text-sm text-teal-300 hover:bg-teal-500/20"
      >
        Open Company Settings →
      </Link>
    </div>
  );
}
