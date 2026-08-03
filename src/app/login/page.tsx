import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { controlPlaneClient } from "@/lib/db";
import { getSessionUser, needsBootstrap, demoModeEnabled } from "@/lib/auth-core";
import { LoginForm, BootstrapForm } from "@/components/auth/auth-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Protessera manufacturing ERP instance.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default async function LoginPage() {
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect("/");

  // Control plane, not the request-scoped client: an anonymous visitor carrying
  // a forge-demo cookie would otherwise see the demo sandbox's company name on
  // the sign-in screen for the real instance.
  const [bootstrap, company] = await Promise.all([
    needsBootstrap(),
    controlPlaneClient().companySettings.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-2xl font-bold text-white shadow-lg shadow-teal-900/40">
            {(company?.name || "F").slice(0, 1)}
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-50">
            {company?.name || "Protessera"}
          </h1>
          <p className="text-sm text-slate-500">Sign in to your team&apos;s ERP</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-black/30">
          <LoginForm />
        </div>

        {/*
          Claiming is offered ALONGSIDE signing in, never instead of it.
          Replacing the form left anyone with a real account no way in — and
          because needsBootstrap() only sees the `public` schema, that is what
          a live instance serving tenants was showing its own customers.
        */}
        {bootstrap && (
          <details className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
            <summary className="cursor-pointer text-xs text-slate-400">
              Setting this instance up for the first time?
            </summary>
            <p className="mt-2 mb-4 text-[11px] text-slate-500">
              No account on this instance has a password yet. Create the first
              administrator to claim it.
            </p>
            <BootstrapForm />
          </details>
        )}

        <p className="text-center text-[11px] text-slate-600">
          By signing in you accept the{" "}
          <Link href="/legal" className="text-teal-600 hover:underline">
            beta terms &amp; privacy note
          </Link>
          .
        </p>

        {demoModeEnabled() && (
          <p className="text-center text-xs text-slate-600">
            Demo mode is on — you can also{" "}
            <Link href="/" className="text-teal-500 hover:underline">
              explore without signing in
            </Link>
            . Unlimited seats, always — invite your whole team.
          </p>
        )}
      </div>
    </div>
  );
}
