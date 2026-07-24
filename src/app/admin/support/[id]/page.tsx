import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, listUsers } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChatThread,
  TicketMetaPills,
} from "@/components/support/chat-thread";
import {
  getSupportTicket,
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from "@/lib/services/support";
import {
  actionAddSupportNote,
  actionPostSupportMessage,
  actionUpdateSupportTicket,
} from "@/app/support/actions";
import {
  ArrowLeft,
  StickyNote,
  Send,
  Settings2,
  NotebookPen,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminSupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  const { id } = await params;
  const [ticket, staffUsers] = await Promise.all([
    getSupportTicket(id),
    listUsers(),
  ]);
  if (!ticket) notFound();

  const admins = staffUsers.filter((u) => u.role === "ADMIN");
  const closed = ticket.status === "CLOSED";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ticket.subject}
        description={`${ticket.number} · ${ticket.requester.name} (${ticket.requester.email})`}
        actions={
          <Link href="/admin/support">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" /> Back to queue
            </Button>
          </Link>
        }
      />

      <TicketMetaPills
        status={ticket.status}
        priority={ticket.priority}
        category={ticket.category}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Chat */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Customer chat</CardTitle>
            <p className="text-xs text-slate-500">
              Visible to the requester. Replies auto-assign you if unassigned.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
              <ChatThread
                messages={ticket.messages}
                currentUserId={user?.id || ""}
              />
            </div>
            {closed ? (
              <p className="text-sm text-slate-500">
                Ticket is closed. Re-open from ticket settings if needed.
              </p>
            ) : (
              <form action={actionPostSupportMessage} className="space-y-3">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <input type="hidden" name="fromAdmin" value="1" />
                <Textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Reply to the requester…"
                />
                <Button type="submit">
                  <Send className="h-4 w-4" /> Send reply
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: settings + notes */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="h-4 w-4 text-teal-400" />
                Ticket settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionUpdateSupportTicket} className="space-y-3">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <Field label="Status">
                  <select
                    name="status"
                    defaultValue={ticket.status}
                    className={selectClass}
                  >
                    {SUPPORT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select
                    name="priority"
                    defaultValue={ticket.priority}
                    className={selectClass}
                  >
                    {SUPPORT_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Category">
                  <select
                    name="category"
                    defaultValue={ticket.category}
                    className={selectClass}
                  >
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assignee">
                  <select
                    name="assigneeId"
                    defaultValue={ticket.assigneeId || ""}
                    className={selectClass}
                  >
                    <option value="">Unassigned</option>
                    {admins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button type="submit" variant="secondary" size="sm" className="w-full">
                  Save changes
                </Button>
              </form>

              <dl className="mt-4 space-y-1.5 border-t border-slate-800 pt-4 text-xs text-slate-500">
                <div className="flex justify-between gap-2">
                  <dt>Requester role</dt>
                  <dd className="text-slate-300">{ticket.requester.role}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Opened</dt>
                  <dd className="text-slate-300">
                    {new Date(ticket.createdAt).toLocaleString()}
                  </dd>
                </div>
                {ticket.resolvedAt && (
                  <div className="flex justify-between gap-2">
                    <dt>Resolved</dt>
                    <dd className="text-slate-300">
                      {new Date(ticket.resolvedAt).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <StickyNote className="h-4 w-4 text-amber-400" />
                Internal notes
              </CardTitle>
              <p className="text-xs text-slate-500">
                Staff only — never shown to the requester.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {ticket.notes.length === 0 ? (
                <p className="text-sm text-slate-500">No notes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {ticket.notes.map((n) => (
                    <li
                      key={n.id}
                      className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="font-medium text-amber-200/90">
                          {n.author?.name || "Staff"}
                        </span>
                        <time>
                          {new Date(n.createdAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
                        {n.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <form action={actionAddSupportNote} className="space-y-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <Textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Private note for the team…"
                />
                <Button type="submit" variant="outline" size="sm">
                  <NotebookPen className="h-4 w-4" /> Add note
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

const selectClass =
  "flex h-9 w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 text-sm text-slate-100";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-400">
        {label}
      </label>
      {children}
    </div>
  );
}
