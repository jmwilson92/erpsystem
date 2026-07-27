import Link from "next/link";

/** Mini marketing header for preview mocks (not the real SiteHeader). */
export function PreviewHeader({
  showMarketingNav = true,
}: {
  showMarketingNav?: boolean;
}) {
  return (
    <header className="sticky top-10 z-40 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
        <Link href="/preview" className="flex items-center gap-2 font-bold">
          <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500 shadow-lg shadow-teal-500/30" />
          ForgeRP
        </Link>
        {showMarketingNav && (
          <nav
            className="hidden items-center gap-6 text-sm text-slate-300 sm:flex"
            aria-label="Primary"
          >
            <Link href="/preview/demo-hub#features" className="hover:text-white">
              Features
            </Link>
            <Link href="/preview/demo-hub#pricing" className="hover:text-white">
              Pricing
            </Link>
            <Link href="/preview/demo-hub#faq" className="hover:text-white">
              FAQ
            </Link>
            <Link href="/preview/demo-hub" className="hover:text-white">
              Live demo
            </Link>
          </nav>
        )}
        <div className="flex items-center gap-2">
          <Link
            href="/preview/tenant-login"
            className="rounded-lg px-3 py-1.5 text-sm text-slate-300 hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/preview/demo-hub"
            className="rounded-lg bg-teal-500 px-3.5 py-1.5 text-sm font-medium text-slate-950 hover:bg-teal-400"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

export function PreviewFooter() {
  return (
    <footer className="mt-auto border-t border-slate-800 text-sm text-slate-500">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
        <span>© ForgeRP, LLC · mock only</span>
        <div className="flex flex-wrap gap-4">
          <Link href="/preview/demo-hub#pricing" className="hover:text-slate-300">
            Pricing
          </Link>
          <Link href="/preview/demo-hub#faq" className="hover:text-slate-300">
            FAQ
          </Link>
          <Link href="/preview/tenant-login" className="hover:text-slate-300">
            Customer login
          </Link>
          <Link href="/preview" className="hover:text-slate-300">
            All mocks
          </Link>
        </div>
      </div>
    </footer>
  );
}
