import Link from "next/link";

export default function PreviewUrlMapPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
        Proposed routing
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Who sees what on which URL
      </h1>
      <p className="mt-3 text-slate-400">
        Customers who already bought seats should never land on the marketing
        splash. Prospects on the apex domain get the cinematic start → demo hub.
      </p>
      <Link
        href="/preview"
        className="mt-4 inline-flex rounded-lg border border-slate-700 px-3 py-1.5 text-sm hover:border-teal-500/50"
      >
        ← All mocks
      </Link>

      <div className="mt-8 space-y-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="font-mono text-sm text-teal-300">
            forge-rp.live · www.forge-rp.live
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Public marketing. Landing = rotating ring + “Starting your ERP
            experience”. After a few seconds (or Skip) → demo hub with FAQ,
            pricing, test drive.
          </p>
          <Link
            href="/preview/splash"
            className="mt-3 inline-block text-sm font-semibold text-teal-400"
          >
            Open splash mock →
          </Link>
        </div>

        <p className="text-center text-slate-600">↓</p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="font-mono text-sm text-teal-300">
            forge-rp.live/demo · demo hub
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Live test drive + sales content. Header/footer always available.
          </p>
          <Link
            href="/preview/demo-hub"
            className="mt-3 inline-block text-sm font-semibold text-teal-400"
          >
            Open demo hub mock →
          </Link>
        </div>

        <p className="text-center text-slate-600">↓ purchase</p>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="font-mono text-sm text-teal-300">
            {"{slug}"}.forge-rp.live
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Customer plant (e.g. acme.forge-rp.live). Login / app only.{" "}
            <em>Never</em> shows the splash. Seat caps apply here.
          </p>
          <Link
            href="/preview/tenant-login"
            className="mt-3 inline-block text-sm font-semibold text-teal-400"
          >
            Open tenant login mock →
          </Link>
        </div>

        <div className="rounded-xl border border-teal-500/30 bg-teal-500/[0.05] p-5">
          <h2 className="text-sm font-semibold">When you greenlight</h2>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-400">
            <li>Wildcard DNS *.forge-rp.live → same deploy</li>
            <li>Middleware: Host → tenant slug → schema</li>
            <li>Apex only: splash + marketing</li>
            <li>Provision: assign slug, email https://slug.forge-rp.live</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
