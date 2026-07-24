import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  listMySupportTickets,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/services/support";
import { actionCreateSupportTicket } from "./actions";
import { LifeBuoy, MessageSquarePlus, MessagesSquare } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/support");

  const sp = searchParams ? await searchParams : {};
  const showNew =
    (Array.isArray(sp.new) ? sp.new[0] : sp.new) === "1" ||
    (Array.isArray(sp.new) ? sp.new[0] : sp.new) === "true";

  const tickets = await listMySupportTickets(user.id);
  const isAdmin = user.role === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help & Support"
        description="Chat with staff. Every conversation opens a help ticket you can track."
        actions={
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <Link href="/admin/support">
                <Button variant="outline" size="sm">
                  <LifeBuoy className="h-4 w-4" /> Staff desk
                </Button>
              </Link>
            )}
            {!showNew && (
              <Link href="/support?new=1">
                <Button size="sm">
                  <MessageSquarePlus className="h-4 w-4" /> New chat
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {showNew && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquarePlus className="h-4 w-4 text-teal-400" />
              Start a new chat
            </CardTitle>
            <p className="text-xs text-slate-500">
              Describe the issue — a help ticket is created automatically and
              staff will reply in this thread.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionCreateSupportTicket} className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Subject
                </label>
                <Input
                  name="subject"
                  required
                  placeholder="e.g. Can't release a work order"
                  maxLength={200}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Category
                  </label>
                  <select
                    name="category"
                    defaultValue="GENERAL"
                    className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">
                    Priority
                  </label>
                  <select
                    name="priority"
                    defaultValue="MEDIUM"
                    className="flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100"
                  >
                    {SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-400">
                  Message
                </label>
                <Textarea
                  name="body"
                  required
                  rows={5}
                  placeholder="What happened? What did you expect? Include part numbers, WO numbers, or screenshots description if useful."
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Open ticket &amp; chat</Button>
                <Link href="/support">
                  <Button type="button" variant="ghost">
                    Cancel
                  </Button>
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessagesSquare className="h-4 w-4 text-teal-400" />
            Your tickets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center">
              <p className="text-sm text-slate-400">No help tickets yet.</p>
              <Link
                href="/support?new=1"
                className="mt-3 inline-flex text-sm font-medium text-teal-400 hover:underline"
              >
                Start your first chat →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/80">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/support/${t.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:bg-slate-900/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-teal-400">
                          {t.number}
                        </span>
                        <StatusBadge status={t.status} />
                        <StatusBadge status={t.priority} />
                        {!t.awaitingStaff &&
                          ["OPEN", "IN_PROGRESS", "WAITING_ON_USER"].includes(
                            t.status
                          ) && (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-sky-300">
                              Staff replied
                            </span>
                          )}
                      </div>
                      <p className="mt-1 truncate text-sm font-medium text-slate-100">
                        {t.subject}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {t._count.messages} message
                        {t._count.messages === 1 ? "" : "s"}
                        {t.assignee
                          ? ` · Assigned to ${t.assignee.name}`
                          : ""}{" "}
                        · Updated{" "}
                        {new Date(t.lastMessageAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                    <span className="text-xs text-teal-400">Open chat →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
