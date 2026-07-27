import Link from "next/link";
import { ForgeMark } from "./logo";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * Slim bar for the live demo plant — keeps legal/pricing links without eating
 * the ERP viewport. Full SiteFooter stays on marketing pages.
 */
export function CompactSiteFooter() {
  return (
    <footer className="shrink-0 border-t border-slate-800/70 bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs text-slate-400">
        <p className="text-slate-400">
          © {new Date().getFullYear()} {SITE_NAME}
        </p>
        <nav
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-teal-300/90"
          aria-label="Marketing and legal"
        >
          <a href="/welcome#pricing" className="hover:text-teal-200">
            Pricing
          </a>
          <a href="/welcome#faq" className="hover:text-teal-200">
            FAQ
          </a>
          <a href="/welcome#features" className="hover:text-teal-200">
            Features
          </a>
          <Link href="/signup" className="hover:text-teal-200">
            Start free
          </Link>
          <Link href="/legal/terms-of-service" className="hover:text-cyan-300">
            Terms
          </Link>
          <Link href="/legal/privacy-policy" className="hover:text-cyan-300">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}

/** Constant marketing footer shown on every public page. */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-800/70 bg-slate-950">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <ForgeMark className="h-6 w-6" />
              <span className="font-semibold tracking-tight text-slate-100">
                {SITE_NAME}
              </span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              {SITE_DESCRIPTION}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Product
            </p>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-slate-500" aria-label="Product">
              <a href="/welcome#features" className="hover:text-slate-300">
                Features
              </a>
              <a href="/welcome#pricing" className="hover:text-slate-300">
                Pricing
              </a>
              <a href="/welcome#faq" className="hover:text-slate-300">
                FAQ
              </a>
              <Link href="/" className="hover:text-slate-300">
                Live demo
              </Link>
              <Link href="/signup" className="hover:text-slate-300">
                Start free trial
              </Link>
            </nav>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Account
            </p>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-slate-500" aria-label="Account">
              <Link href="/login" className="hover:text-slate-300">
                Sign in
              </Link>
              <Link href="/signup" className="hover:text-slate-300">
                Sign up
              </Link>
            </nav>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Legal
            </p>
            <nav className="mt-3 flex flex-col gap-2 text-sm text-slate-500" aria-label="Legal">
              <Link href="/legal/terms-of-service" className="hover:text-slate-300">
                Terms
              </Link>
              <Link href="/legal/privacy-policy" className="hover:text-slate-300">
                Privacy
              </Link>
              <Link href="/legal/cookie-policy" className="hover:text-slate-300">
                Cookies
              </Link>
              <Link href="/legal/refund-policy" className="hover:text-slate-300">
                Refunds
              </Link>
              <Link href="/legal" className="hover:text-slate-300">
                All legal
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-800/70 pt-6 text-sm text-slate-500 sm:flex-row">
          <p>
            © {new Date().getFullYear()} {SITE_NAME}, LLC. All rights reserved.
          </p>
          <p className="text-xs text-slate-600">
            Manufacturing ERP software · California, United States
          </p>
        </div>
      </div>
    </footer>
  );
}
