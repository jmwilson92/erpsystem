import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser, hasPendingMfa } from "@/lib/auth-core";
import { MfaVerifyForm } from "@/components/auth/auth-forms";
import { ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Two-factor verification",
  robots: { index: false, follow: false },
};

export default async function VerifyMfaPage() {
  // Already signed in, or nothing parked — nothing to verify either way.
  if (await getSessionUser()) redirect("/");
  if (!(await hasPendingMfa())) redirect("/login");

  const company = await prisma.companySettings
    .findUnique({ where: { id: "default" } })
    .catch(() => null);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-900/40">
            <ShieldCheck className="h-7 w-7 text-white" />
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-50">
            {company?.name || "Protessera"}
          </h1>
          <p className="text-sm text-slate-500">Two-factor verification</p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-xl shadow-black/30">
          <MfaVerifyForm />
        </div>
      </div>
    </div>
  );
}
