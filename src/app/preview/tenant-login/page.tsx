import Link from "next/link";
import { PreviewFooter } from "@/components/marketing/preview-chrome";

export default function PreviewTenantLoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-10 z-40 border-b border-slate-800/70 bg-slate-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <div className="flex items-center gap-2 font-bold">
            <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-teal-400 to-cyan-500" />
            ForgeRP
          </div>
          <div className="flex gap-2">
            <Link
              href="/preview/splash"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-white"
            >
              Marketing site
            </Link>
            <Link
              href="/preview/url-map"
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:border-teal-500/50"
            >
              How URLs work
            </Link>
          </div>
        </div>
      </header>

      <main className="grid flex-1 place-items-center px-6 py-16">
        <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs text-teal-300">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
            acme.forge-rp.live
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-400">
            <span className="font-medium text-slate-200">Acme Manufacturing</span>
            {" · "}
            your plant instance. No splash, no demo pitch — just work.
          </p>
          <div className="mt-6 space-y-3">
            <label className="block text-sm">
              <span className="text-slate-300">Work email</span>
              <input
                type="email"
                placeholder="you@acme.com"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                readOnly
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">Password</span>
              <input
                type="password"
                placeholder="••••••••"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
                readOnly
              />
            </label>
            <button
              type="button"
              className="mt-2 w-full rounded-lg bg-teal-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-teal-400"
            >
              Sign in to Acme (mock)
            </button>
          </div>
          <p className="mt-4 text-center text-xs text-slate-500">
            Need a different company?{" "}
            <Link href="/preview/splash" className="text-slate-400 underline">
              forge-rp.live
            </Link>
          </p>
        </div>
      </main>
      <PreviewFooter />
    </div>
  );
}
