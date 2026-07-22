import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionCreateOnboarding } from "@/app/actions";
import { formatDate } from "@/lib/utils";
import type { ChecklistItem } from "@/lib/services/recruiting";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

function progress(checklist: string | null): { done: number; total: number } {
  try {
    const items = checklist ? (JSON.parse(checklist) as ChecklistItem[]) : [];
    return { done: items.filter((i) => i.done).length, total: items.length };
  } catch {
    return { done: 0, total: 0 };
  }
}

export default async function OnboardingListPage() {
  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "hr.onboarding.manage");

  const [records, managers] = await Promise.all([
    prisma.employeeOnboarding.findMany({
      orderBy: { createdAt: "desc" },
      include: { manager: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New-hire onboarding"
        description="Collect personal info, IDs and documents, run the checklist, and clear background checks before day one."
        actions={
          <Link href="/recruiting"><Button size="sm" variant="outline">← Recruiting</Button></Link>
        }
      />

      {canManage && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Start onboarding</CardTitle></CardHeader>
          <CardContent>
            <form action={actionCreateOnboarding} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input name="legalName" required placeholder="Legal name *" className="h-9 lg:col-span-2" />
              <Input name="personalEmail" type="email" placeholder="Personal email" className="h-9" />
              <Input name="phone" placeholder="Phone" className="h-9" />
              <Input name="jobTitle" placeholder="Job title" className="h-9" />
              <Input name="department" placeholder="Department" className="h-9" />
              <select name="employmentType" className={selectClass} defaultValue="FULL_TIME">
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
                <option value="TEMP">Temp</option>
                <option value="INTERN">Intern</option>
              </select>
              <select name="managerId" className={selectClass} defaultValue="">
                <option value="">Manager…</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <label className="text-[10px] uppercase text-slate-500">
                Start date
                <Input name="startDate" type="date" className="mt-0.5 h-9" />
              </label>
              <Button type="submit" size="sm" className="h-9 self-end">Start onboarding</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Record</th>
              <th className="px-3 py-2 text-left">New hire</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const p = progress(r.checklist);
              return (
                <tr key={r.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                  <td className="px-3 py-2 font-mono text-xs text-teal-400">
                    <Link href={`/hr/onboarding/${r.id}`} className="hover:underline">{r.number}</Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/hr/onboarding/${r.id}`} className="text-slate-100 hover:text-sky-400">
                      {r.preferredName || r.legalName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-400">{r.jobTitle || "—"}</td>
                  <td className="px-3 py-2 text-slate-400">{r.startDate ? formatDate(r.startDate) : "—"}</td>
                  <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-xs text-slate-400">
                    {p.total > 0 ? `${p.done}/${p.total}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {records.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">No onboarding records yet.</div>
        )}
      </div>
    </div>
  );
}
