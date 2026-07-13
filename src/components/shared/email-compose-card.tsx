import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionSendEmail } from "@/app/actions";
import { Mail } from "lucide-react";

/** Collapsible prefilled outbound e-mail form for a record page. */
export function EmailComposeCard({
  draft,
  returnTo,
  title = "Email this document",
}: {
  draft: {
    to: string;
    subject: string;
    body: string;
    entityType: string;
    entityId: string;
    entityLabel: string;
  };
  returnTo: string;
  title?: string;
}) {
  return (
    <Card>
      <details>
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-sky-400" />
              {title}
              <span className="text-xs font-normal text-slate-500">
                prefilled — click to expand
              </span>
            </CardTitle>
          </CardHeader>
        </summary>
        <CardContent>
          <form action={actionSendEmail} className="space-y-2">
            <input type="hidden" name="entityType" value={draft.entityType} />
            <input type="hidden" name="entityId" value={draft.entityId} />
            <input type="hidden" name="entityLabel" value={draft.entityLabel} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                name="to"
                type="email"
                required
                defaultValue={draft.to}
                placeholder="recipient@example.com"
              />
              <Input name="subject" required defaultValue={draft.subject} />
            </div>
            <Textarea
              name="body"
              required
              rows={8}
              defaultValue={draft.body}
              className="font-mono text-xs"
            />
            <Button type="submit" size="sm">
              Send e-mail
            </Button>
          </form>
        </CardContent>
      </details>
    </Card>
  );
}
