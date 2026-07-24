import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { listAllSupportTickets } from "@/lib/services/support";
import { Inbox, MessagesSquare } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSupportQueuePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const filterRaw = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const filter = filterRaw || "needs_reply";

  const tickets = await listAllSupportTickets(
    filter === "needs_reply"
      ? { awaitingStaff: true }
      : filter === "all"
        ? {}
        : filter === "open"
          ? { status: "OPEN_QUEUE" }
          : { status: filter.toUpperCase() }
  );

  const filters = [
    { key: "needs_reply", label: "Needs reply" },
    { key: "open", label: "Open queue" },
    { key: "all", label: "All" },
    { key: "resolved", label: "Resolved" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support desk"
        description="Staff-only helpdesk. Answer chats, leave internal notes, and close tickets."
        actions={
          <Link
            href="/support"
            className="text-sm text-teal-400 hover:underline"
          >
            User help view →
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={`/admin/support?filter=${f.key}`}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.key
                ? "border-teal-500/50 bg-teal-500/15 text-teal-300"
                : "border-slate-800 text-slate-400 hover:border-slate-700"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-4 w-4 text-teal-400" />
            Queue
            <span className="text-xs font-normal text-slate-500">
              ({tickets.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 py-12 text-center text-sm text-slate-500">
              Nothing in this queue. Nice work.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                    <th className="pb-2 pr-3 font-medium">Ticket</th>
                    <th className="pb-2 pr-3 font-medium">Requester</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 pr-3 font-medium">Priority</th>
                    <th className="pb-2 pr-3 font-medium">Assignee</th>
                    <th className="pb-2 pr-3 font-medium">Activity</th>
                    <th className="pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {tickets.map((t) => (
                    <tr key={t.id} className="align-top hover:bg-slate-900/40">
                      <td className="py-3 pr-3">
                        <div className="font-mono text-xs text-teal-400">
                          {t.number}
                        </div>
                        <div className="mt-0.5 max-w-xs font-medium text-slate-100">
                          {t.subject}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {t.category.replace(/_/g, " ")} ·{" "}
                          {t._count.messages} msgs
                          {t._count.notes > 0
                            ? ` · ${t._count.notes} notes`
                            : ""}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="text-slate-200">{t.requester.name}</div>
                        <div className="text-xs text-slate-500">
                          {t.requester.email}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={t.status} />
                          {t.awaitingStaff && (
                            <span className="text-[10px] font-semibold uppercase text-amber-400">
                              Awaiting staff
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-3">
                        <StatusBadge status={t.priority} />
                      </td>
                      <td className="py-3 pr-3 text-slate-400">
                        {t.assignee?.name || "—"}
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-500">
                        {new Date(t.lastMessageAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/admin/support/${t.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-teal-400 hover:underline"
                        >
                          <MessagesSquare className="h-3.5 w-3.5" />
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
