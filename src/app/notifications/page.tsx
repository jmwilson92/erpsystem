import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import {
  actionMarkAllNotificationsRead,
  actionMarkNotificationRead,
} from "@/app/actions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const items = await prisma.userNotification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="In-app alerts, including work orders that have gone over allocated labor hours."
        actions={
          items.some((i) => !i.isRead) ? (
            <form action={actionMarkAllNotificationsRead}>
              <Button type="submit" size="sm" variant="outline">
                Mark all read
              </Button>
            </form>
          ) : undefined
        }
      />
      <Card>
        <CardContent className="divide-y divide-slate-800 p-0">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No notifications yet.</p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${
                  n.isRead ? "opacity-70" : "bg-slate-900/40"
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-slate-100">{n.title}</p>
                  <p className="text-xs text-slate-400">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-600">{formatDate(n.createdAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {n.href && (
                    <Link href={n.href} className="text-xs text-sky-400 hover:underline">
                      Open
                    </Link>
                  )}
                  {!n.isRead && (
                    <form action={actionMarkNotificationRead}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button type="submit" size="sm" variant="ghost">
                        Mark read
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
