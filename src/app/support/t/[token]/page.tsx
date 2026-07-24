import Link from "next/link";
import { notFound } from "next/navigation";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ChatThread,
  TicketMetaPills,
} from "@/components/support/chat-thread";
import { getSupportTicketByGuestToken } from "@/lib/services/support";
import { isPlatformSupportEnabled } from "@/lib/platform";
import { actionPostSupportMessage } from "../../actions";
import { Send } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Guest ticket thread — public link from landing-page chat.
 * Platform only (no customer/demo). Secret token is the access control.
 */
export default async function GuestSupportTicketPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!(await isPlatformSupportEnabled())) notFound();

  const { token } = await params;
  const ticket = await getSupportTicketByGuestToken(token);
  if (!ticket) notFound();

  const closed = ticket.status === "CLOSED";

  return (
    <MarketingShell>
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-12">
        <div>
          <p className="font-mono text-xs text-teal-400">{ticket.number}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-50">
            {ticket.subject}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Bookmark this page to check replies. Only people with this link can
            see the chat.
          </p>
        </div>

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
              <ChatThread
                messages={ticket.messages.map((m) => ({
                  ...m,
                  author: m.author || {
                    id: "guest",
                    name: ticket.guestName || "You",
                  },
                }))}
                currentUserId="guest"
              />
            </div>

            {closed ? (
              <p className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-400">
                This ticket is closed.{" "}
                <Link href="/" className="text-teal-400 hover:underline">
                  Back to home
                </Link>{" "}
                and open a new chat if you still need help.
              </p>
            ) : (
              <form action={actionPostSupportMessage} className="space-y-3">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <input type="hidden" name="guestToken" value={token} />
                <Textarea
                  name="body"
                  required
                  rows={3}
                  placeholder="Type your reply…"
                />
                <Button type="submit">
                  <Send className="h-4 w-4" /> Send message
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </MarketingShell>
  );
}
