import Link from "next/link";
import { ForgeLogo } from "./logo";

/**
 * Constant marketing header shown on every public page (landing, demo, signup,
 * legal). The logo always returns to the landing page, so visitors are never
 * stranded. Section links point at the landing anchors so they work from any
 * page.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/70 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/" aria-label="ForgeRP home">
          <ForgeLogo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-slate-300 sm:flex">
          <Link href="/#features" className="hover:text-white">Features</Link>
          <Link href="/#pricing" className="hover:text-white">Pricing</Link>
          <Link href="/demo" className="hover:text-white">Live demo</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:text-white">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-teal-500 px-3.5 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}
