import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { actionRequestPermission } from "@/app/actions";
import Link from "next/link";
import { ShieldOff, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const raw = sp.code;
  const code = (Array.isArray(raw) ? raw[0] : raw) || "";
  const user = await getCurrentUser();

  const pending = user
    ? await prisma.permissionRequest.findFirst({
        where: { userId: user.id, permissionCode: code, status: "PENDING" },
      })
    : null;

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
          <ShieldOff className="h-6 w-6 text-rose-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-100">
            You don&apos;t have permission for this action
          </h1>
          {code && (
            <p className="mt-1 font-mono text-xs text-slate-500">{code}</p>
          )}
        </div>

        {pending ? (
          <p className="flex items-center justify-center gap-2 rounded-lg border border-amber-900/50 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            <Clock className="h-4 w-4" />
            Request sent — waiting on an admin decision.
          </p>
        ) : code && user ? (
          <form action={actionRequestPermission} className="space-y-2">
            <input type="hidden" name="code" value={code} />
            <input
              name="note"
              placeholder="Why do you need this? (optional)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
            <Button type="submit" size="sm" className="w-full">
              Request permission
            </Button>
            <p className="text-[11px] text-slate-500">
              Sends the request to your admins — they can grant it once (24h)
              or permanently.
            </p>
          </form>
        ) : null}

        <Link
          href="/dashboard"
          className="block text-sm text-teal-400 hover:underline"
        >
          ← Back to dashboard
        </Link>
      </div>
    </div>
  );
}
