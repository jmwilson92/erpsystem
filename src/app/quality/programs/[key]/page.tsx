import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  actionCreateQualityItem,
  actionRecordQualityEvent,
  actionSetQualityItemStatus,
} from "@/app/actions";
import {
  getProgramByKey,
  refreshProgramStatuses,
  statusFor,
} from "@/lib/services/quality-programs";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function QualityProgramPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const program = await getProgramByKey(key);
  if (!program) notFound();
  await refreshProgramStatuses(program.id);

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "quality.programs.manage");

  const [items, events, people] = await Promise.all([
    prisma.qualityItem.findMany({
      where: { programId: program.id },
      include: { owner: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { nextDueAt: "asc" }],
    }),
    prisma.qualityEvent.findMany({
      where: { programId: program.id },
      orderBy: { performedAt: "desc" },
      take: 25,
      include: {
        performedBy: { select: { name: true } },
        item: { select: { name: true, identifier: true } },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const overdue = items.filter((i) => statusFor(i.nextDueAt, i.status) === "OVERDUE").length;
  const dueSoon = items.filter((i) => statusFor(i.nextDueAt, i.status) === "DUE_SOON").length;
  const recurring = program.defaultIntervalDays > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={program.name}
        description={program.description || undefined}
        actions={
          <Link href="/quality/programs">
            <Button size="sm" variant="outline">← All programs</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-slate-400">
        <span>{items.length} {program.itemNoun.toLowerCase()}(s)</span>
        {overdue > 0 && <span className="text-rose-300">{overdue} overdue</span>}
        {dueSoon > 0 && <span className="text-amber-300">{dueSoon} due soon</span>}
        {recurring && <span>Default interval: {program.defaultIntervalDays} days</span>}
      </div>

      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add {program.itemNoun.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionCreateQualityItem} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="programKey" value={program.key} />
              <Input name="identifier" placeholder="ID / tag *" className="h-9" />
              <Input name="name" placeholder="Name / description" className="h-9" />
              <Input name="location" placeholder="Location" className="h-9" />
              <select name="ownerId" className={selectClass} defaultValue="">
                <option value="">Owner…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Input
                name="intervalDays"
                type="number"
                placeholder={recurring ? `Interval days (default ${program.defaultIntervalDays})` : "Interval days"}
                className="h-9"
              />
              <label className="text-[10px] uppercase text-slate-500">
                {recurring ? "Next due" : "Due date (optional)"}
                <Input name="nextDueAt" type="date" className="mt-0.5 h-9" />
              </label>
              <Button type="submit" size="sm" className="h-9 self-end lg:col-span-2">Add</Button>
            </form>
            {recurring && (
              <p className="mt-1 text-[11px] text-slate-500">
                Leave next-due blank to auto-set {program.defaultIntervalDays} days out. A passing {program.eventNoun.toLowerCase()} rolls the due date forward automatically.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Register */}
      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">{program.itemNoun}</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Next due</th>
              <th className="px-3 py-2 text-left">Last {program.eventNoun.toLowerCase()}</th>
              {canManage && <th className="px-3 py-2 text-right">Log {program.eventNoun.toLowerCase()}</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const st = statusFor(it.nextDueAt, it.status);
              return (
                <tr
                  key={it.id}
                  className={`border-t border-slate-800/60 ${
                    st === "OVERDUE" ? "bg-rose-500/5" : st === "DUE_SOON" ? "bg-amber-500/5" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-teal-400">{it.identifier}</td>
                  <td className="px-3 py-2">
                    {it.name}
                    {it.notes && <p className="text-[11px] text-slate-500">{it.notes}</p>}
                  </td>
                  <td className="px-3 py-2 text-slate-400">{it.location || "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{it.owner?.name || "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={st} /></td>
                  <td className={`px-3 py-2 ${st === "OVERDUE" ? "text-rose-300" : st === "DUE_SOON" ? "text-amber-300" : "text-slate-400"}`}>
                    {it.nextDueAt ? formatDate(it.nextDueAt) : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {it.lastActionAt ? formatDate(it.lastActionAt) : "—"}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <form action={actionRecordQualityEvent} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="programId" value={program.id} />
                        <input type="hidden" name="programKey" value={program.key} />
                        <input type="hidden" name="itemId" value={it.id} />
                        <input type="hidden" name="type" value="CHECK" />
                        <select name="result" className="h-8 rounded-md border border-slate-700 bg-slate-950 px-1.5 text-xs text-slate-200" defaultValue="PASS">
                          <option value="PASS">Pass</option>
                          <option value="FAIL">Fail</option>
                          <option value="NA">N/A</option>
                        </select>
                        <Input name="documentUrl" placeholder="cert/doc URL" className="h-8 w-28 text-xs" />
                        <Button type="submit" size="sm" variant="outline" className="h-8">Log</Button>
                      </form>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {items.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">
            No {program.itemNoun.toLowerCase()}s yet.
          </div>
        )}
      </div>

      {/* Log an incident / audit / general event (not tied to one item) */}
      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Log an event / incident</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionRecordQualityEvent} className="grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="programId" value={program.id} />
              <input type="hidden" name="programKey" value={program.key} />
              <select name="type" className={selectClass} defaultValue="CHECK">
                <option value="CHECK">{program.eventNoun}</option>
                <option value="INCIDENT">Incident</option>
                <option value="AUDIT">Audit</option>
                <option value="REVIEW">Review</option>
                <option value="DISPOSITION">Disposition</option>
              </select>
              <select name="result" className={selectClass} defaultValue="CLOSED">
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
                <option value="OPEN">Open</option>
                <option value="CLOSED">Closed</option>
                <option value="NA">N/A</option>
              </select>
              <Input name="documentUrl" placeholder="Document URL" className="h-9" />
              <Textarea name="notes" placeholder="What happened / findings" className="sm:col-span-3" rows={2} />
              <Button type="submit" size="sm" className="h-9 self-end">Log event</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Recent log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {events.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-sm">
              <div>
                <StatusBadge status={e.type} className="text-[9px]" />
                {e.result && <span className="ml-1"><StatusBadge status={e.result} className="text-[9px]" /></span>}
                <span className="ml-2 text-slate-300">
                  {e.item ? `${e.item.identifier} — ${e.item.name}` : program.name}
                </span>
                {e.notes && <span className="ml-2 text-xs text-slate-500">{e.notes}</span>}
              </div>
              <div className="text-[11px] text-slate-500">
                {e.performedBy?.name || "—"} · {formatDate(e.performedAt)}
                {e.documentUrl && (
                  <a href={e.documentUrl} target="_blank" rel="noreferrer" className="ml-2 text-sky-400 hover:underline">doc</a>
                )}
              </div>
            </div>
          ))}
          {events.length === 0 && <p className="text-sm text-slate-500">No activity yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
