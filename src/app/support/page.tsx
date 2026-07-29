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
  listSupportTicketsByGuestEmail,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
} from "@/lib/services/support";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { actionCreateSupportTicket } from "./actions";
import { MessageSquarePlus, MessagesSquare } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * In-app Help & Support for anyone signed into the ERP (customers, demos,
 * dogfood). Opens tickets on the platform staff desk. Does NOT expose the
 * staff queue — that lives only at unlisted /admin/support.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/support");

  const platform = await isPlatformSupportEnabled();
  const sp = searchParams ? await searchParams : {};
  const showNew =
    (Array.isArray(sp.new) ? sp.new[0] : sp.new) === "1" ||
    (Array.isArray(sp.new) ? sp.new[0] : sp.new) === "true";

  // Platform dogfood users: tickets linked to their user id.
  // Customer/demo users: tickets matched by guest email (public control plane).
  const tickets = platform
    ? await listMySupportTickets(user.id)
    : await listSupportTicketsByGuestEmail(user.email);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help & Support"
        description="Message the Protessera support desk. We'll answer as soon as we can."
        actions={
          !showNew ? (
            <Link href="/support?new=1">
              <Button size="sm">
                <MessageSquarePlus className="h-4 w-4" /> New request
              </Button>
            </Link>
          ) : undefined
        }
      />

      {showNew && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquarePlus className="h-4 w-4 text-teal-400" />
              Contact support
            </CardTitle>
            <p className="text-xs text-slate-500">
              Your message goes to the Protessera team. Use the chat bubble anytime
              too — same desk.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionCreateSupportTicket} className="space-y-4">
              <input
                type="hidden"
                name="source"
                value={platform ? "APP" : "TENANT"}
              />
              {!platform && (
                <>
                  <input type="hidden" name="name" value={user.name} />
                  <input type="hidden" name="email" value={user.email} />
                </>
              )}
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
                  placeholder="What happened? What did you expect?"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Send to support</Button>
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
            Your requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center">
              <p className="text-sm text-slate-400">No support requests yet.</p>
              <Link
                href="/support?new=1"
                className="mt-3 inline-flex text-sm font-medium text-teal-400 hover:underline"
              >
                Contact support →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-slate-800/80">
              {tickets.map((t) => {
                const href =
                  platform && t.requesterId === user.id
                    ? `/support/${t.id}`
                    : t.guestToken
                      ? `/support/t/${t.guestToken}`
                      : `/support?new=1`;
                return (
                  <li key={t.id}>
                    <Link
                      href={href}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 transition-colors hover:bg-slate-900/40"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-teal-400">
                            {t.number}
                          </span>
                          <StatusBadge status={t.status} />
                          <StatusBadge status={t.priority} />
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
                      <span className="text-xs text-teal-400">Open →</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
