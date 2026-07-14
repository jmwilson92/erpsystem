import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser, needsBootstrap, demoModeEnabled } from "@/lib/auth-core";
import { LoginForm, BootstrapForm } from "@/components/auth/auth-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const sessionUser = await getSessionUser();
  if (sessionUser) redirect("/");

  const [bootstrap, company] = await Promise.all([
    needsBootstrap(),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-2xl font-bold text-white shadow-lg shadow-teal-900/40">
            {(company?.name || "F").slice(0, 1)}
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-50">
            {company?.name || "ForgeRP"}
          </h1>
          <p className="text-sm text-slate-500">
            {bootstrap
              ? "First boot — claim this instance by creating the admin account."
              : "Sign in to your team's ERP"}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-black/30">
          {bootstrap ? <BootstrapForm /> : <LoginForm />}
        </div>

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
