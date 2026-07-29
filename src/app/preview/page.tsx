import Link from "next/link";

const CARDS = [
  {
    href: "/preview/splash",
    badge: "1 · Apex landing",
    title: "protessera.com splash",
    body: "Rotating ring + “Starting your ERP experience”. Header/footer stay. Auto-continues into the demo hub (or Skip).",
  },
  {
    href: "/preview/demo-hub",
    badge: "2 · After start",
    title: "Demo experience hub",
    body: "Post-splash: test drive CTA, features, pricing, FAQ — marketing chrome so visitors can navigate away anytime.",
  },
  {
    href: "/preview/tenant-login",
    badge: "3 · Customer URL",
    title: "acme.protessera.com",
    body: "Purchased company instance login. No splash, no wait — straight to their plant.",
  },
  {
    href: "/preview/url-map",
    badge: "4 · Routing map",
    title: "URL architecture",
    body: "How apex vs *.protessera.com vs demo vs signup should split so customers never sit through marketing every login.",
  },
] as const;

export default function PreviewHubPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wider text-teal-400">
        Local / staging review only
      </p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">
        Protessera experience mocks
      </h1>
      <p className="mt-3 max-w-xl text-slate-400">
        You&apos;re signed into the ERP, so <code className="text-teal-300">/</code>{" "}
        shows your dashboard — that&apos;s expected. These routes always show the
        marketing concepts without logging out.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition-colors hover:border-teal-500/50"
          >
            <span className="w-fit rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-300">
              {c.badge}
            </span>
            <h2 className="mt-3 text-lg font-semibold">{c.title}</h2>
            <p className="mt-1.5 flex-1 text-sm text-slate-400">{c.body}</p>
            <span className="mt-4 text-sm font-semibold text-teal-400">
              Open mock →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
