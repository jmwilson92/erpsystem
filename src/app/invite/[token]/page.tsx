import { prisma } from "@/lib/db";
import { getInviteByToken } from "@/lib/auth-core";
import { AcceptInviteForm } from "@/components/auth/auth-forms";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invite, company] = await Promise.all([
    getInviteByToken(token),
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
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-black/30">
          {invite ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                {invite.kind === "RESET"
                  ? `Reset the password for ${invite.email}.`
                  : `You're joining as ${invite.email} (${invite.role}). Set a password to activate your account.`}
              </p>
              <AcceptInviteForm token={token} />
            </>
          ) : (
            <div className="space-y-3 text-center">
              <p className="text-sm text-rose-300">
                This invite link is invalid or has expired.
              </p>
              <p className="text-xs text-slate-500">
                Ask your admin for a fresh invite, or{" "}
                <Link href="/login" className="text-teal-400 hover:underline">
                  sign in
                </Link>
                .
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
