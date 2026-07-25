import Link from "next/link";
import { ForgeMark } from "@/components/marketing/logo";
import { LifeBuoy } from "lucide-react";

/**
 * Standalone Support Staff portal (/admin/support).
 * Separate from ERP company admins — no ERP sidebar or modules.
 * Staff type the URL; it is not listed in the ERP nav.
 */
export function StaffDeskShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName?: string | null;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3">
            <ForgeMark className="h-8 w-8" />
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-50">
                <LifeBuoy className="h-3.5 w-3.5 text-teal-400" aria-hidden />
                Support Staff Portal
              </p>
              <p className="text-[11px] text-slate-500">
                ForgeRP support team only · not the customer ERP
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {userName && (
              <span className="hidden text-slate-400 sm:inline">
                {userName} · Support staff
              </span>
            )}
            <Link
              href="/admin/support"
              className="text-slate-400 hover:text-slate-200"
            >
              Queue
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-300 hover:border-slate-500"
            >
              Exit portal
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <footer className="border-t border-slate-800/80 py-4 text-center text-xs text-slate-600">
        Unlisted support portal · ERP company admins and customers cannot access
        this URL
      </footer>
    </div>
  );
}
