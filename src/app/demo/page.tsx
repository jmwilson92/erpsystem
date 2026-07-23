import { cookies } from "next/headers";
import Link from "next/link";
import {
  actionStartTestDrive,
  actionEndTestDrive,
} from "@/app/actions";
import { DEMO_COOKIE } from "@/lib/db";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import {
  Factory,
  FlaskConical,
  Clock,
  Users2,
  Shield,
  FileBarChart,
  Rocket,
  Sparkles,
  RefreshCcw,
} from "lucide-react";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    icon: Factory,
    title: "Shop floor to cash",
    body: "Quote → sales order → work order → ship. Shipping auto-raises the AR invoice and posts revenue + COGS. Receiving auto-vouchers AP with a 3-way match.",
  },
  {
    icon: FlaskConical,
    title: "Quality that closes the loop",
    body: "NCRs, MRB dispositions that actually do things — return shipments, replacement PRs, rework orders — plus supplier scorecards and CAPA.",
  },
  {
    icon: Clock,
    title: "Timecards your people will fill out",
    body: "Auto-created per pay period, grid entry by charge code, OT rules, PTO auto-fill, routed approvals (PM / department / HR), straight into payroll.",
  },
  {
    icon: Users2,
    title: "People development built in",
    body: "Review cycles with dual sign-off, goal check-ins, continuous feedback, training records with attached certificates, PTO balances that gate requests.",
  },
  {
    icon: Shield,
    title: "Gov property & compliance",
    body: "GFP/CAP tracking, DD1149 gates at receiving, UID, configuration management with certified BOM enforcement.",
  },
  {
    icon: FileBarChart,
    title: "Reports for everything",
    body: "P&L, balance sheet, agings, WIP, inventory valuation, OTD, NCR log, timecards — on screen or CSV, zero setup.",
  },
];

export default async function DemoLandingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const ended = sp.ended === "1";
  const warming = sp.error === "warming";
  const jar = await cookies();
  const inSandbox = Boolean(jar.get(DEMO_COOKIE)?.value);

  return (
    <MarketingShell>
      <div className="relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, rgba(20,184,166,0.18) 0%, rgba(2,6,23,0) 70%)",
          }}
        />
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-20 text-center">
          <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 to-cyan-500 text-2xl shadow-lg shadow-teal-500/30">
            🔥
          </div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-400">
            ForgeRP
          </p>
          <h1 className="mx-auto mt-3 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            The manufacturing ERP that&apos;s{" "}
            <span className="bg-gradient-to-r from-teal-300 to-cyan-400 bg-clip-text text-transparent">
              plug and play
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-400">
            Set up like a Starlink, not like an ERP project. A 3-minute wizard,
            live demo data, and every module already talking to each other —
            floor, quality, supply chain, HR, and GAAP accounting.
          </p>

          {ended && !inSandbox && (
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-200">
              Thanks for taking the test drive! Your sandbox is gone — start a
              fresh one anytime.
            </div>
          )}
          {warming && (
            <div className="mx-auto mt-6 max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              The demo is warming up and isn&apos;t quite ready yet. Please try
              again in a few minutes.
            </div>
          )}

          <div className="mt-8 flex flex-col items-center gap-3">
            {inSandbox ? (
              <>
                <Link
                  href="/"
                  className="rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-500/25 transition-transform hover:scale-[1.02]"
                >
                  Continue your test drive →
                </Link>
                <form action={actionEndTestDrive}>
                  <button
                    type="submit"
                    className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
                  >
                    End test drive and delete my sandbox
                  </button>
                </form>
              </>
            ) : (
              <form action={actionStartTestDrive}>
                <button
                  type="submit"
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-teal-500/25 transition-transform hover:scale-[1.02]"
                >
                  <Rocket className="h-5 w-5" />
                  Start your free test drive
                </button>
              </form>
            )}
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <Sparkles className="h-3.5 w-3.5 text-teal-500" />
              Your own private sandbox with a full demo factory. Ship orders,
              run payroll, break things — it vanishes when you leave.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition-colors hover:border-teal-500/30"
            >
              <f.icon className="h-5 w-5 text-teal-400" />
              <p className="mt-3 text-sm font-semibold text-slate-100">
                {f.title}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-900/40 p-8 text-center">
          <RefreshCcw className="mx-auto h-6 w-6 text-teal-400" />
          <h2 className="mt-3 text-xl font-bold">How the test drive works</h2>
          <div className="mx-auto mt-4 grid max-w-3xl gap-4 text-left text-sm text-slate-400 sm:grid-cols-3">
            <div>
              <p className="font-semibold text-slate-200">1. Jump in</p>
              <p className="mt-1">
                One click spins up a private copy of a running factory —
                orders in flight, timesheets pending, invoices open.
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-200">2. Actually use it</p>
              <p className="mt-1">
                Approve timesheets, disposition MRB cases, ship an order and
                watch the journals post. Switch personas to see every role.
              </p>
            </div>
            <div>
              <p className="font-semibold text-slate-200">3. Walk away clean</p>
              <p className="mt-1">
                End the drive (or just leave) and your sandbox is destroyed.
                Nothing you do touches anyone else&apos;s data.
              </p>
            </div>
          </div>
          <p className="mt-6 text-sm text-slate-400">
            Like what you see?{" "}
            <Link
              href="/signup"
              className="font-semibold text-teal-400 hover:underline"
            >
              Start your free trial →
            </Link>
          </p>
        </div>
      </div>
    </MarketingShell>
  );
}
