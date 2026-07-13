import Link from "next/link";
import { listEmailMessages } from "@/lib/services/email";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { actionSendEmail } from "@/app/actions";
import { EmailIntake } from "@/components/email/email-intake";
import { formatDate } from "@/lib/utils";
import { Mail, Inbox, Send } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "h-9 rounded-lg border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const ENTITY_HREF: Record<string, (id: string) => string> = {
  PurchaseOrder: (id) => `/purchasing/po/${id}`,
  Quote: (id) => `/sales/quotes/${id}`,
};

export default async function EmailCenterPage() {
  const messages = await listEmailMessages(60);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email Center"
        description="Outbound mail composed from records (POs, quotes) and inbound mail parsed into draft records — one log for all of it"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-teal-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Inbox className="h-4 w-4 text-teal-400" />
              Inbound intake
            </CardTitle>
            <p className="text-xs text-slate-500">
              Paste a forwarded e-mail. <strong>RFQ</strong> drafts a quote
              for the matched customer with lines from part numbers found in
              the body. <strong>PO ack</strong> finds the PO-xxxxx and marks
              it acknowledged. <strong>Other</strong> just logs it.
            </p>
          </CardHeader>
          <CardContent>
            <EmailIntake />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-4 w-4 text-sky-400" />
              Quick send
            </CardTitle>
            <p className="text-xs text-slate-500">
              Ad-hoc outbound mail. POs and quotes have prefilled
              &ldquo;Email&rdquo; buttons on their own pages.
              {process.env.SMTP_URL
                ? ""
                : " No SMTP configured — messages are logged as sent (demo transport)."}
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionSendEmail} className="space-y-2">
              <Input name="to" type="email" required placeholder="to@example.com" />
              <Input name="subject" required placeholder="Subject" />
              <Textarea name="body" required rows={5} placeholder="Message…" />
              <Button type="submit" size="sm">
                Send
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-slate-500" />
            Message log ({messages.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {messages.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              Nothing yet — send a PO or parse an RFQ.
            </p>
          )}
          {messages.map((m) => (
            <details
              key={m.id}
              className="rounded-xl border border-slate-800 px-3 py-2"
            >
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <StatusBadge status={m.direction} />
                  <span className="truncate text-slate-200">{m.subject}</span>
                  {m.entityLabel &&
                    (m.entityType && ENTITY_HREF[m.entityType] && m.entityId ? (
                      <Link
                        href={ENTITY_HREF[m.entityType](m.entityId)}
                        className="font-mono text-xs text-teal-400 hover:underline"
                      >
                        {m.entityLabel}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs text-slate-500">
                        {m.entityLabel}
                      </span>
                    ))}
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  {m.direction === "OUTBOUND" ? `→ ${m.toAddr}` : `← ${m.fromAddr}`}
                  <StatusBadge status={m.status} />
                  {formatDate(m.createdAt)}
                </span>
              </summary>
              <pre className="mt-2 whitespace-pre-wrap border-t border-slate-800/60 pt-2 font-mono text-[11px] text-slate-400">
                {m.body}
              </pre>
            </details>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
