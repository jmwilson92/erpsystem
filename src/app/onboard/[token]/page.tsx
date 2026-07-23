import Link from "next/link";
import { tenantBySetupToken } from "@/lib/services/tenancy";
import { ClaimTenantForm } from "@/components/auth/auth-forms";

export const dynamic = "force-dynamic";

/**
 * Customer onboarding: a provisioned tenant claims their workspace by setting
 * the first admin password. The token resolves to the tenant in the control
 * plane; the password is set inside that tenant's own schema and they're logged
 * straight in (see claimTenant / createTenantSession).
 */
export default async function OnboardPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tenant = await tenantBySetupToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-2xl shadow-lg shadow-teal-900/40">
            🔥
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-50">
            {tenant?.name || "Welcome to ForgeRP"}
          </h1>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-black/30">
          {tenant ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                Set a password for{" "}
                <span className="text-slate-200">{tenant.billingEmail}</span> to
                activate your workspace and jump in. Your 45-day trial is already
                running.
              </p>
              <ClaimTenantForm token={token} />
            </>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-rose-300">
                This setup link is invalid or has expired.
              </p>
              <p className="text-xs text-slate-500">
                Ask us for a fresh link, or{" "}
                <Link href="/login" className="text-teal-400 hover:underline">
                  sign in
                </Link>{" "}
                if you&apos;ve already set your password.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
