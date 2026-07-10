import Link from "next/link";
import { listPmAlerts } from "@/lib/services/engineering-work";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionMarkEngAlertRead } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function PmAlertsPage() {
  const [unread, all] = await Promise.all([
    listPmAlerts({ unreadOnly: true }),
    listPmAlerts({ unreadOnly: false }),
  ]);
  const read = all.filter((a) => a.isRead).slice(0, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Alerts"
        description="Dependency and coordination alerts for project managers"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/pmo">
              <Button size="sm" variant="outline">
                PMO home
              </Button>
            </Link>
            <Link href="/pmo/pi">
              <Button size="sm" variant="ghost">
                PI planning
              </Button>
            </Link>
          </div>
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Unread ({unread.length})
        </h2>
        {unread.length === 0 && (
          <p className="text-sm text-slate-500">No unread alerts.</p>
        )}
        {unread.map((a) => (
          <Card key={a.id} className="border-amber-900/40">
            <CardContent className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div>
                <p className="text-sm font-medium text-amber-200">{a.title}</p>
                {a.body && (
                  <p className="mt-0.5 text-xs text-slate-400">{a.body}</p>
                )}
                <p className="mt-1 text-[10px] text-slate-600">
                  {formatDate(a.createdAt)} · {a.type}
                  {a.projectId ? ` · project ${a.projectId.slice(0, 8)}` : ""}
                </p>
                {a.engTaskId && (
                  <Link
                    href={`/engineering/tasks/${a.engTaskId}`}
                    className="mt-1 inline-block text-xs text-teal-400 hover:underline"
                  >
                    Open task
                  </Link>
                )}
              </div>
              <form action={actionMarkEngAlertRead}>
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="returnTo" value="/pmo/alerts" />
                <Button type="submit" size="sm" variant="outline">
                  Mark read
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </section>

      {read.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Recently read
          </h2>
          {read.map((a) => (
            <Card key={a.id} className="border-slate-800 opacity-70">
              <CardContent className="p-3 text-xs text-slate-400">
                <span className="text-slate-300">{a.title}</span>
                <span className="ml-2 text-slate-600">
                  {formatDate(a.createdAt)}
                </span>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </div>
  );
}
