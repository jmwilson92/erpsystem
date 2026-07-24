import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChatThread,
  TicketMetaPills,
} from "@/components/support/chat-thread";
import {
  canAccessTicket,
  getSupportTicket,
} from "@/lib/services/support";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { actionPostSupportMessage } from "../actions";
import { ArrowLeft, LifeBuoy, Send } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SupportTicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isPlatformSupportEnabled())) redirect("/");

  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/support");

  const { id } = await params;
  const ticket = await getSupportTicket(id);
  if (!ticket) notFound();
  if (!canAccessTicket(ticket, user)) redirect("/support");

  const closed = ticket.status === "CLOSED";
  const isAdmin = user.role === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ticket.subject}
        description={`${ticket.number} · opened ${new Date(ticket.createdAt).toLocaleDateString()}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/support">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4" /> All tickets
              </Button>
            </Link>
            {isAdmin && (
              <Link href={`/admin/support/${ticket.id}`}>
                <Button variant="outline" size="sm">
                  <LifeBuoy className="h-4 w-4" /> Staff view
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <TicketMetaPills
        status={ticket.status}
        priority={ticket.priority}
        category={ticket.category}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conversation</CardTitle>
          {ticket.assignee && (
            <p className="text-xs text-slate-500">
              Assigned to {ticket.assignee.name}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-800/80 bg-slate-950/40 p-4">
            <ChatThread messages={ticket.messages} currentUserId={user.id} />
          </div>

          {closed ? (
            <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
              This ticket is closed.{" "}
              <Link href="/support?new=1" className="text-teal-400 hover:underline">
                Open a new chat
              </Link>{" "}
              if you still need help.
            </p>
          ) : (
            <form action={actionPostSupportMessage} className="space-y-3">
              <input type="hidden" name="ticketId" value={ticket.id} />
              <Textarea
                name="body"
                required
                rows={3}
                placeholder="Type your message…"
              />
              <Button type="submit">
                <Send className="h-4 w-4" /> Send message
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
