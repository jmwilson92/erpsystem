import Link from "next/link";
import {
  getDisciplineSummaries,
  listOpenScans,
  listSwimLanes,
} from "@/lib/services/engineering-work";
import { getCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionScanOut,
  actionCreateSwimLane,
  actionRemoveSwimLane,
} from "@/app/actions";
import { ArrowRight, Layers, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const LANE_ACCENT: Record<string, string> = {
  SYSTEMS: "border-l-sky-500 hover:border-sky-400/50",
  MECHANICAL: "border-l-amber-500 hover:border-amber-400/50",
  ELECTRICAL: "border-l-yellow-500 hover:border-yellow-400/50",
  NETWORK: "border-l-cyan-500 hover:border-cyan-400/50",
  CYBER: "border-l-rose-500 hover:border-rose-400/50",
  SOFTWARE: "border-l-violet-500 hover:border-violet-400/50",
  HARDWARE: "border-l-orange-500 hover:border-orange-400/50",
  RF: "border-l-pink-500 hover:border-pink-400/50",
  QUALITY: "border-l-emerald-500 hover:border-emerald-400/50",
  MFG_ENG: "border-l-orange-600 hover:border-orange-400/50",
  OTHER: "border-l-slate-500 hover:border-slate-400/50",
};

export default async function EngineeringPage() {
  const user = await getCurrentUser();
  const [summaries, openScans, allLanes] = await Promise.all([
    getDisciplineSummaries(),
    listOpenScans(user?.id),
    listSwimLanes(false),
  ]);
  const myOpen = openScans.filter((s) => s.userId === user?.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engineering"
        actions={
          <div className="flex gap-2">
            <Link href="/pmo/pi">
              <Button size="sm" variant="outline">
                PI / sprints
              </Button>
            </Link>
            <Link href="/pmo">
              <Button size="sm" variant="outline">
                PMO
              </Button>
            </Link>
          </div>
        }
      />

      {myOpen.length > 0 && (
        <Card className="border-teal-700/50 bg-teal-950/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-teal-300">
                You are scanned in
              </p>
              {myOpen.map((s) => (
                <p key={s.id} className="text-xs text-slate-400">
                  {s.engTask.number} {s.engTask.name} · since{" "}
                  {new Date(s.scannedInAt).toLocaleTimeString()}
                </p>
              ))}
            </div>
            <div className="flex gap-2">
              {myOpen.map((s) => (
                <form key={s.id} action={actionScanOut}>
                  <input type="hidden" name="scanId" value={s.id} />
                  <input type="hidden" name="returnTo" value="/engineering" />
                  <Button type="submit" size="sm">
                    Scan out
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Click a lane to open its workspace. Create or remove lanes below.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((lane) => (
          <Link
            key={lane.discipline}
            href={`/engineering/${lane.discipline.toLowerCase()}`}
          >
            <Card
              className={cn(
                "h-full border-l-4 transition-colors",
                LANE_ACCENT[lane.discipline] || LANE_ACCENT.OTHER
              )}
            >
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-slate-500" />
                    <h2 className="text-lg font-semibold text-slate-100">
                      {lane.name || lane.discipline}
                    </h2>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-600" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded bg-slate-950/50 px-2 py-1.5">
                    <p className="text-lg font-bold tabular-nums text-slate-100">
                      {lane.sagaTotal}
                    </p>
                    <p className="text-slate-500">Sagas</p>
                  </div>
                  <div className="rounded bg-slate-950/50 px-2 py-1.5">
                    <p className="text-lg font-bold tabular-nums text-slate-100">
                      {lane.taskTotal}
                    </p>
                    <p className="text-slate-500">Tasks</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                  <span className="text-sky-400/90">
                    {lane.sagaInProgress} in progress
                  </span>
                  <span className="text-emerald-400/90">
                    {lane.sagaDone} done
                  </span>
                  {lane.sagaBlocked > 0 && (
                    <span className="text-amber-400">
                      {lane.sagaBlocked} blocked
                    </span>
                  )}
                  <span>{lane.taskTodo} backlog tasks</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Manage swim lanes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={actionCreateSwimLane}
            className="flex flex-wrap items-end gap-2"
          >
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Code
              </label>
              <Input
                name="code"
                required
                placeholder="e.g. OPTICS"
                className="mt-1 w-32 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Name
              </label>
              <Input
                name="name"
                required
                placeholder="Display name"
                className="mt-1 w-48"
              />
            </div>
            <div className="min-w-[160px] flex-1">
              <label className="text-[10px] uppercase text-slate-500">
                Description
              </label>
              <Input name="description" className="mt-1" placeholder="Optional" />
            </div>
            <Button type="submit" size="sm">
              Add lane
            </Button>
          </form>

          <ul className="divide-y divide-slate-800 rounded border border-slate-800">
            {allLanes.map((lane) => (
              <li
                key={lane.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono text-teal-400">{lane.code}</span>{" "}
                  <span className="text-slate-200">{lane.name}</span>
                  {!lane.isActive && (
                    <span className="ml-2 text-[10px] text-rose-400">
                      inactive
                    </span>
                  )}
                  {lane.isSystem && (
                    <span className="ml-2 text-[10px] text-slate-600">
                      system
                    </span>
                  )}
                </div>
                {lane.isActive && (
                  <form action={actionRemoveSwimLane}>
                    <input type="hidden" name="id" value={lane.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {lane.isSystem ? "Deactivate" : "Remove"}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
