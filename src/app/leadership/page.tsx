import Link from "next/link";
import {
  listBusinessPriorities,
} from "@/lib/services/leadership";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import {
  actionUpsertBusinessPriority,
  actionSetPriorityStatus,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function LeadershipPage() {
  const user = await getCurrentUser();
  const canManage = await userHasPermission(
    user?.id,
    "leadership.priority.manage"
  );
  const isAdmin = user?.role === "ADMIN" || user?.role === "EXECUTIVE";
  const showManage = canManage || isAdmin;

  const priorities = showManage
    ? await listBusinessPriorities()
    : await listBusinessPriorities({ publishedOnly: true });

  const published = priorities.filter((p) => p.status === "PUBLISHED");
  const drafts = priorities.filter((p) => p.status === "DRAFT");
  const archived = priorities.filter((p) => p.status === "ARCHIVED");

  return (
    <div className="space-y-6">
      <PageHeader title="Senior Leadership" />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-400/90">
          Published priorities
        </h2>
        {published.length === 0 && (
          <p className="text-sm text-slate-500">No published priorities yet.</p>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {published.map((p) => (
            <Card key={p.id} className="border-l-4 border-l-emerald-500">
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-lg font-bold tabular-nums text-emerald-300 ring-1 ring-emerald-500/40"
                    title={`Business priority rank ${p.priority} of 10`}
                  >
                    {p.priority}
                  </span>
                  <span className="font-mono text-xs text-emerald-400">
                    {p.number}
                  </span>
                  <StatusBadge status={p.category} />
                  <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                    Rank {p.priority} / 10
                  </span>
                  {p.ownerRole && (
                    <span className="text-[10px] uppercase text-violet-400">
                      {p.ownerRole}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-slate-100">
                  {p.title}
                </h3>
                {p.description && (
                  <p className="mt-1 text-sm text-slate-400 whitespace-pre-wrap">
                    {p.description}
                  </p>
                )}
                <p className="mt-2 text-[10px] text-slate-600">
                  Published {formatDate(p.publishedAt)}
                  {p.effectiveFrom
                    ? ` · Effective ${formatDate(p.effectiveFrom)}`
                    : ""}
                </p>
                {showManage && (
                  <form action={actionSetPriorityStatus} className="mt-2 flex gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <Button type="submit" size="sm" variant="outline">
                      Archive
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {showManage && (
        <>
          {drafts.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                Drafts
              </h2>
              {drafts.map((p) => (
                <Card key={p.id} className="border-slate-800">
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <span className="font-mono text-xs text-slate-500">
                        {p.number}
                      </span>{" "}
                      <span className="text-sm text-slate-200">{p.title}</span>
                    </div>
                    <form action={actionSetPriorityStatus}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="status" value="PUBLISHED" />
                      <Button type="submit" size="sm">
                        Publish
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              ))}
            </section>
          )}

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Create / update business priority
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionUpsertBusinessPriority}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Input
                  name="title"
                  required
                  placeholder="Priority title"
                  className="sm:col-span-2"
                />
                <Textarea
                  name="description"
                  rows={3}
                  placeholder="Description / intent"
                  className="sm:col-span-2"
                />
                <select name="category" className={selectClass} defaultValue="STRATEGIC">
                  <option value="STRATEGIC">Strategic</option>
                  <option value="FINANCIAL">Financial</option>
                  <option value="OPERATIONAL">Operational</option>
                  <option value="COMPLIANCE">Compliance</option>
                  <option value="CUSTOMER">Customer</option>
                  <option value="PEOPLE">People</option>
                </select>
                <select name="ownerRole" className={selectClass} defaultValue="CEO">
                  <option value="CEO">CEO</option>
                  <option value="CFO">CFO</option>
                  <option value="COO">COO</option>
                  <option value="VP_ENG">VP Engineering</option>
                  <option value="VP_OPS">VP Operations</option>
                  <option value="VP_SALES">VP Sales</option>
                </select>
                <Input
                  name="priority"
                  type="number"
                  min={1}
                  defaultValue={1}
                  placeholder="Rank (1 = highest)"
                />
                <select name="status" className={selectClass} defaultValue="DRAFT">
                  <option value="DRAFT">Draft</option>
                  <option value="PUBLISHED">Publish now</option>
                </select>
                <Input name="effectiveFrom" type="date" />
                <Input name="effectiveTo" type="date" />
                <Button type="submit" size="sm" className="sm:col-span-2">
                  Save priority
                </Button>
              </form>
            </CardContent>
          </Card>

          {archived.length > 0 && (
            <p className="text-xs text-slate-600">
              {archived.length} archived priorit{archived.length === 1 ? "y" : "ies"}
            </p>
          )}
        </>
      )}

      {!showManage && (
        <p className="text-xs text-slate-600">
          Leadership (CEO / CFO / VPs / COO) can create and publish priorities.
          <Link href="/admin/permissions" className="ml-1 text-teal-500 hover:underline">
            Permissions
          </Link>
        </p>
      )}
    </div>
  );
}
