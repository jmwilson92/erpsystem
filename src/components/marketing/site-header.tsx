import Link from "next/link";
import { BrandLogo } from "./logo";

/**
 * Marketing header. Product story links always go to /welcome (full marketing
 * page with cinematic backgrounds) — never into the ERP shell. "Live demo"
 * returns to the sandbox / Spinning up the Shop flow on /.
 *
 * Using plain <a> for story links so demo→marketing is a full navigation and
 * never paints pricing/FAQ inside the app chrome.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/welcome" aria-label="Protessera home">
          <BrandLogo className="text-white" />
        </Link>
        <nav
          className="hidden items-center gap-6 text-sm text-teal-200/90 sm:flex"
          aria-label="Primary"
        >
          <a href="/welcome#features" className="hover:text-teal-300">
            Features
          </a>
          <a href="/welcome#pricing" className="hover:text-teal-300">
            Pricing
          </a>
          <a href="/welcome#faq" className="hover:text-teal-300">
            FAQ
          </a>
          <Link href="/" className="hover:text-teal-300">
            Live demo
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-cyan-300 hover:text-cyan-200"
          >
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
