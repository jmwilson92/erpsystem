import Link from "next/link";
import { ForgeMark } from "./logo";

/** Constant marketing footer shown on every public page. */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800/70">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 sm:flex-row">
        <div className="flex items-center gap-2">
          <ForgeMark className="h-5 w-5" />
          <span>© {new Date().getFullYear()} ForgeRP</span>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <Link href="/" className="hover:text-slate-300">Home</Link>
          <Link href="/demo" className="hover:text-slate-300">Demo</Link>
          <Link href="/#pricing" className="hover:text-slate-300">Pricing</Link>
          <Link href="/legal/terms-of-service" className="hover:text-slate-300">Terms</Link>
          <Link href="/legal/privacy-policy" className="hover:text-slate-300">Privacy</Link>
          <Link href="/legal/cookie-policy" className="hover:text-slate-300">Cookies</Link>
          <Link href="/legal/refund-policy" className="hover:text-slate-300">Refunds</Link>
          <Link href="/legal" className="hover:text-slate-300">All legal</Link>
          <Link href="/login" className="hover:text-slate-300">Sign in</Link>
        </nav>
      </div>
    </footer>
  );
}
