import { notFound } from "next/navigation";
import Link from "next/link";
import { getWbsDetail } from "@/lib/services/engineering-work";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { formatCurrency, formatDate } from "@/lib/utils";
import { actionUpdateWbs, actionCreateWbs, actionCreateCampaign } from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function dateInput(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

export default async function WbsDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wbs = await getWbsDetail(id);
  if (!wbs) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={`${wbs.code} — ${wbs.name}`}
        description={`WBS detail · ${wbs.project.number} ${wbs.project.name}`}
        actions={
          <div className="flex gap-2">
            <Link href={`/pmo/projects/${wbs.projectId}?tab=wbs`}>
              <Button size="sm" variant="outline">
                Back to WBS tree
              </Button>
            </Link>
            <Link href={`/pmo/projects/${wbs.projectId}`}>
              <Button size="sm" variant="ghost">
                Project
              </Button>
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={wbs.status} />
        <StatusBadge status={wbs.kind} />
        {wbs.parent && (
          <Link
            href={`/pmo/wbs/${wbs.parent.id}`}
            className="text-xs text-teal-400 hover:underline"
          >
            Parent: {wbs.parent.code} {wbs.parent.name}
          </Link>
        )}
        <span className="text-xs text-slate-500">
          Level {wbs.level} · {formatDate(wbs.startDate)} –{" "}
          {formatDate(wbs.endDate)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <p className="text-xl font-bold tabular-nums text-slate-100">
              {formatCurrency(wbs.budgetCost)}
            </p>
            <p className="text-xs text-slate-500">Budget</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <p className="text-xl font-bold tabular-nums text-teal-300">
              {formatCurrency(wbs.actualCost)}
            </p>
            <p className="text-xs text-slate-500">Actual</p>
          </CardContent>
        </Card>
        <Card className="border-slate-800">
          <CardContent className="p-4 text-center">
            <Progress value={wbs.percentComplete} className="mb-1 h-2" />
            <p className="text-xl font-bold tabular-nums text-slate-100">
              {wbs.percentComplete.toFixed(0)}%
            </p>
            <p className="text-xs text-slate-500">Complete</p>
          </CardContent>
        </Card>
      </div>

      {/* Full detail form — PMBOK-style WBS dictionary fields */}
      <form action={actionUpdateWbs} className="space-y-4">
        <input type="hidden" name="id" value={wbs.id} />
        <input type="hidden" name="projectId" value={wbs.projectId} />
        <Card className="border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              WBS dictionary (element definition)
            </CardTitle>
            <p className="text-xs text-slate-500">
              Full description of what this element entails — scope, deliverables,
              acceptance, resources (PMI WBS dictionary practice).
            </p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-[10px] uppercase text-slate-500">Code</label>
              <Input name="code" defaultValue={wbs.code} className="mt-1 font-mono" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Kind</label>
              <select
                name="kind"
                className={`${selectClass} mt-1`}
                defaultValue={wbs.kind}
              >
                <option value="SUMMARY">Summary</option>
                <option value="CONTROL_ACCOUNT">Control account</option>
                <option value="WORK_PACKAGE">Work package</option>
                <option value="PLANNING_PACKAGE">Planning package</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">Name</label>
              <Input name="name" defaultValue={wbs.name} className="mt-1" />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Status</label>
              <select
                name="status"
                className={`${selectClass} mt-1`}
                defaultValue={wbs.status}
              >
                <option value="NOT_STARTED">Not started</option>
                <option value="IN_PROGRESS">In progress</option>
                <option value="COMPLETE">Complete</option>
                <option value="ON_HOLD">On hold</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                % complete
              </label>
              <Input
                name="percentComplete"
                type="number"
                defaultValue={wbs.percentComplete}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Description / statement of work
              </label>
              <Textarea
                name="description"
                rows={3}
                className="mt-1"
                defaultValue={wbs.description || ""}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Deliverables
              </label>
              <Textarea
                name="deliverables"
                rows={2}
                className="mt-1"
                defaultValue={wbs.deliverables || ""}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Acceptance criteria
              </label>
              <Textarea
                name="acceptanceCriteria"
                rows={2}
                className="mt-1"
                defaultValue={wbs.acceptanceCriteria || ""}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Assumptions
              </label>
              <Textarea
                name="assumptions"
                rows={2}
                className="mt-1"
                defaultValue={wbs.assumptions || ""}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Constraints
              </label>
              <Textarea
                name="constraints"
                rows={2}
                className="mt-1"
                defaultValue={wbs.constraints || ""}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">
                Resources / skills
              </label>
              <Textarea
                name="resources"
                rows={2}
                className="mt-1"
                defaultValue={wbs.resources || ""}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Budget</label>
              <Input
                name="budgetCost"
                type="number"
                step="0.01"
                defaultValue={wbs.budgetCost}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Actual</label>
              <Input
                name="actualCost"
                type="number"
                step="0.01"
                defaultValue={wbs.actualCost}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">Start</label>
              <Input
                name="startDate"
                type="date"
                defaultValue={dateInput(wbs.startDate)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">End</label>
              <Input
                name="endDate"
                type="date"
                defaultValue={dateInput(wbs.endDate)}
                className="mt-1"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] uppercase text-slate-500">Notes</label>
              <Textarea
                name="notes"
                rows={2}
                className="mt-1"
                defaultValue={wbs.notes || ""}
              />
            </div>
          </CardContent>
        </Card>
        <Button type="submit">Save WBS element</Button>
      </form>

      {/* Children line items */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Sub-elements ({wbs.children.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {wbs.children.length === 0 && (
            <p className="text-xs text-slate-500">No children — add below.</p>
          )}
          {wbs.children.map((c) => (
            <Link
              key={c.id}
              href={`/pmo/wbs/${c.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-3 py-2 hover:bg-slate-900/50"
            >
              <div>
                <span className="font-mono text-sm text-teal-400">{c.code}</span>{" "}
                <span className="text-slate-200">{c.name}</span>
                <span className="ml-2 text-[10px] text-slate-600">
                  {c._count.children} kids · {c._count.campaigns} campaigns
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status} />
                <span className="text-xs tabular-nums text-slate-500">
                  {formatCurrency(c.budgetCost)}
                </span>
              </div>
            </Link>
          ))}
          <form
            action={actionCreateWbs}
            className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3"
          >
            <input type="hidden" name="projectId" value={wbs.projectId} />
            <input type="hidden" name="parentId" value={wbs.id} />
            <input
              type="hidden"
              name="returnTo"
              value={`/pmo/wbs/${wbs.id}`}
            />
            <Input name="code" required placeholder="Code e.g. 2.1" className="font-mono" />
            <Input name="name" required placeholder="Name" className="sm:col-span-2" />
            <select name="kind" className={selectClass} defaultValue="WORK_PACKAGE">
              <option value="SUMMARY">Summary</option>
              <option value="CONTROL_ACCOUNT">Control account</option>
              <option value="WORK_PACKAGE">Work package</option>
              <option value="PLANNING_PACKAGE">Planning package</option>
            </select>
            <Input name="budgetCost" type="number" placeholder="Budget" />
            <Button type="submit" size="sm">
              Add child
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Campaigns under this WBS */}
      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Campaigns on this WBS ({wbs.campaigns.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {wbs.campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded border border-slate-800 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-violet-300">{c.number}</span>
                <span className="text-slate-100">{c.name}</span>
                <StatusBadge status={c.status} />
              </div>
              <p className="text-[11px] text-slate-500">
                {c.sagas.length} saga(s) ·{" "}
                {c.sagas.reduce((s, x) => s + x._count.engTasks, 0)} tasks
              </p>
            </div>
          ))}
          <form
            action={actionCreateCampaign}
            className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2"
          >
            <input type="hidden" name="projectId" value={wbs.projectId} />
            <input type="hidden" name="wbsElementId" value={wbs.id} />
            <Input name="name" required placeholder="Campaign name" className="sm:col-span-2" />
            <Textarea
              name="definitionOfDone"
              rows={2}
              placeholder="Definition of Done"
              className="sm:col-span-2"
            />
            <Button type="submit" size="sm">
              Add campaign
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
