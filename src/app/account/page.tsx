import { getCurrentUser } from "@/lib/auth";
import { getSessionUser, demoModeEnabled } from "@/lib/auth-core";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChangePasswordForm } from "@/components/auth/auth-forms";
import { actionLogout, actionSetMyPin } from "@/app/actions";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const sessionUser = await getSessionUser();
  const isLoggedIn = Boolean(sessionUser);

  const sessions = isLoggedIn
    ? await prisma.authSession.findMany({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        orderBy: { lastSeenAt: "desc" },
        take: 10,
      })
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My account"
        description={`${user.name} · ${user.email} · ${user.role}`}
        actions={
          isLoggedIn ? (
            <form action={actionLogout}>
              <Button type="submit" size="sm" variant="outline">
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </Button>
            </form>
          ) : undefined
        }
      />

      {!isLoggedIn && (
        <Card className="border-amber-900/50 bg-amber-500/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-amber-200">
              You&apos;re browsing via{" "}
              {demoModeEnabled() ? "demo mode" : "an unauthenticated session"} —
              set a password below, then sign in for a real login session.
            </p>
            <Link href="/login">
              <Button size="sm">Go to sign in</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-teal-400" />
            Sign-off PIN
          </CardTitle>
          <p className="text-xs text-slate-500">
            Your personal 4–6 digit PIN confirms shop-floor sign-offs (work
            instruction steps, test procedures, GFP approvals).{" "}
            {user.pinCode
              ? "A PIN is set — enter a new one to change it."
              : "No PIN set yet."}{" "}
            Forgot it? An admin can reset it under Roles &amp; Permissions.
          </p>
        </CardHeader>
        <CardContent>
          <form action={actionSetMyPin} className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              New PIN (4–6 digits)
              <input
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                minLength={4}
                maxLength={6}
                required
                className="mt-1 block h-9 w-36 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
              />
            </label>
            <label className="text-xs text-slate-500">
              Confirm PIN
              <input
                name="pinConfirm"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                minLength={4}
                maxLength={6}
                required
                className="mt-1 block h-9 w-36 rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
              />
            </label>
            <Button type="submit" size="sm" className="h-9">
              {user.pinCode ? "Change PIN" : "Set PIN"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="h-4 w-4 text-teal-400" />
              Password
            </CardTitle>
            <p className="text-xs text-slate-500">
              {user.passwordHash
                ? "Changing your password signs out every other session."
                : "No password set yet — set one to enable real login."}
            </p>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Active sessions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {sessions.length === 0 && (
              <p className="text-sm text-slate-500">
                {isLoggedIn ? "No other sessions." : "Sign in to see sessions."}
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="truncate text-xs text-slate-400">
                  {s.userAgent || "Unknown device"}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-slate-500">
                  Last seen {formatDate(s.lastSeenAt, "MMM d, HH:mm")}
                  <StatusBadge status="ACTIVE" />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
