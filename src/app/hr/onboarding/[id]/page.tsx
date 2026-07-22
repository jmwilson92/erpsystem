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
  actionUpdateOnboarding,
  actionSetOnboardingChecklistItem,
  actionCompleteOnboarding,
  actionRecordBackgroundCheck,
} from "@/app/actions";
import type { ChecklistItem } from "@/lib/services/recruiting";
import { formatDate } from "@/lib/utils";
import { Check, Circle } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function dateInput(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function OnboardingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "hr.onboarding.manage");
  const canBackground = await userHasPermission(user?.id, "hr.background.manage");

  const onb = await prisma.employeeOnboarding.findUnique({
    where: { id },
    include: {
      manager: { select: { name: true } },
      candidate: { select: { id: true, name: true } },
      backgroundChecks: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!onb) notFound();

  let checklist: ChecklistItem[] = [];
  try {
    checklist = onb.checklist ? (JSON.parse(onb.checklist) as ChecklistItem[]) : [];
  } catch {
    checklist = [];
  }
  const categories = [...new Set(checklist.map((i) => i.category))];
  const done = checklist.filter((i) => i.done).length;
  const allDone = checklist.length > 0 && done === checklist.length;
  const backHref = `/hr/onboarding/${onb.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${onb.number} · ${onb.preferredName || onb.legalName}`}
        description={[onb.jobTitle, onb.department, onb.employmentType.replace(/_/g, " ").toLowerCase()].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={onb.status} />
            <Link href="/hr/onboarding"><Button size="sm" variant="outline">← All</Button></Link>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
        <span>Checklist: <span className="text-slate-200">{done}/{checklist.length}</span></span>
        {onb.startDate && <span>Starts {formatDate(onb.startDate)}</span>}
        {onb.manager && <span>Manager: {onb.manager.name}</span>}
        {onb.candidate && (
          <Link href={`/recruiting/candidates/${onb.candidate.id}`} className="text-teal-400 hover:underline">
            from candidate {onb.candidate.name}
          </Link>
        )}
        {canManage && onb.status !== "COMPLETE" && (
          <form action={actionCompleteOnboarding} className="ml-auto">
            <input type="hidden" name="onboardingId" value={onb.id} />
            <Button type="submit" size="sm" disabled={!allDone} title={allDone ? "" : "Finish all checklist items first"}>
              Complete onboarding
            </Button>
          </form>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Documents & ID checklist */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Documents, IDs & tasks</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {categories.map((cat) => (
                <div key={cat}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{cat}</p>
                  <div className="space-y-1.5">
                    {checklist.filter((i) => i.category === cat).map((item) => (
                      <div key={item.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5">
                        {canManage ? (
                          <form action={actionSetOnboardingChecklistItem}>
                            <input type="hidden" name="onboardingId" value={onb.id} />
                            <input type="hidden" name="key" value={item.key} />
                            <input type="hidden" name="done" value={item.done ? "false" : "true"} />
                            <button type="submit" className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-600 text-slate-400 hover:border-teal-500" title={item.done ? "Mark not done" : "Mark done"}>
                              {item.done ? <Check className="h-3.5 w-3.5 text-teal-400" /> : <Circle className="h-2 w-2" />}
                            </button>
                          </form>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center">{item.done ? <Check className="h-3.5 w-3.5 text-teal-400" /> : <Circle className="h-2 w-2 text-slate-600" />}</span>
                        )}
                        <span className={`flex-1 text-sm ${item.done ? "text-slate-400 line-through" : "text-slate-200"}`}>{item.label}</span>
                        {item.docUrl ? (
                          <a href={item.docUrl} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:underline">{item.docName || "document"}</a>
                        ) : canManage ? (
                          <form action={actionSetOnboardingChecklistItem} className="flex items-center gap-1">
                            <input type="hidden" name="onboardingId" value={onb.id} />
                            <input type="hidden" name="key" value={item.key} />
                            <input type="hidden" name="done" value={item.done ? "true" : "false"} />
                            <Input name="docUrl" placeholder="Attach doc URL" className="h-7 w-40 text-xs" />
                            <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Attach</Button>
                          </form>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Background checks */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Background checks <span className="ml-2 text-xs font-normal text-slate-500">{onb.backgroundChecks.length}</span></CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {onb.backgroundChecks.map((bc) => (
                <div key={bc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2">
                  <div>
                    <span className="text-sm text-slate-200">{bc.checkType.replace(/_/g, " ")}</span>
                    <span className="ml-2"><StatusBadge status={bc.status} /></span>
                    {bc.provider && <span className="ml-2 text-xs text-slate-500">{bc.provider}</span>}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {bc.completedAt ? `done ${formatDate(bc.completedAt)}` : bc.requestedAt ? `req ${formatDate(bc.requestedAt)}` : ""}
                  </span>
                </div>
              ))}
              {onb.backgroundChecks.length === 0 && <p className="text-sm text-slate-500">No checks yet.</p>}
              {canBackground && (
                <form action={actionRecordBackgroundCheck} className="mt-2 grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2 sm:grid-cols-3">
                  <input type="hidden" name="onboardingId" value={onb.id} />
                  <select name="checkType" className={selectClass} defaultValue="STANDARD">
                    {["STANDARD", "CRIMINAL", "EMPLOYMENT", "EDUCATION", "DRUG", "MVR", "CREDIT", "IDENTITY"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <Input name="provider" placeholder="Provider" className="h-9" />
                  <select name="status" className={selectClass} defaultValue="INITIATED">
                    {["NOT_STARTED", "INITIATED", "IN_PROGRESS", "CLEAR", "FLAGGED", "CANCELLED"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" className="h-9 sm:col-span-3">Record check</Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Personal info */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Personal info</CardTitle></CardHeader>
            <CardContent>
              {canManage ? (
                <form action={actionUpdateOnboarding} className="space-y-2">
                  <input type="hidden" name="onboardingId" value={onb.id} />
                  <Input name="legalName" defaultValue={onb.legalName} placeholder="Legal name" className="h-9" />
                  <Input name="preferredName" defaultValue={onb.preferredName || ""} placeholder="Preferred name" className="h-9" />
                  <Input name="personalEmail" type="email" defaultValue={onb.personalEmail || ""} placeholder="Personal email" className="h-9" />
                  <Input name="phone" defaultValue={onb.phone || ""} placeholder="Phone" className="h-9" />
                  <Textarea name="address" defaultValue={onb.address || ""} placeholder="Home address" rows={2} />
                  <label className="block text-[10px] uppercase text-slate-500">Date of birth
                    <Input name="dateOfBirth" type="date" defaultValue={dateInput(onb.dateOfBirth)} className="mt-0.5 h-9" />
                  </label>
                  <Input name="emergencyContactName" defaultValue={onb.emergencyContactName || ""} placeholder="Emergency contact" className="h-9" />
                  <Input name="emergencyContactPhone" defaultValue={onb.emergencyContactPhone || ""} placeholder="Emergency phone" className="h-9" />
                  <Input name="jobTitle" defaultValue={onb.jobTitle || ""} placeholder="Job title" className="h-9" />
                  <Input name="department" defaultValue={onb.department || ""} placeholder="Department" className="h-9" />
                  <label className="block text-[10px] uppercase text-slate-500">Start date
                    <Input name="startDate" type="date" defaultValue={dateInput(onb.startDate)} className="mt-0.5 h-9" />
                  </label>
                  <Textarea name="notes" defaultValue={onb.notes || ""} placeholder="Notes" rows={2} />
                  <Button type="submit" size="sm" className="w-full">Save details</Button>
                </form>
              ) : (
                <div className="space-y-1 text-sm text-slate-300">
                  <p>{onb.legalName}</p>
                  <p className="text-slate-500">{onb.personalEmail || "—"}</p>
                  <p className="text-slate-500">{onb.phone || "—"}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
