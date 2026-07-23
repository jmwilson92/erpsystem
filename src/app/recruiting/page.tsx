import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { actionCreateRequisition } from "@/app/actions";
import { Briefcase, Users, DoorOpen } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function RecruitingPage() {
  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "hr.recruiting.manage");

  const [reqs, people] = await Promise.all([
    prisma.jobRequisition.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        recruiter: { select: { name: true } },
        hiringManager: { select: { name: true } },
        _count: { select: { candidates: true } },
      },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const open = reqs.filter((r) => ["OPEN", "ON_HOLD"].includes(r.status));
  const totalCandidates = reqs.reduce((s, r) => s + r._count.candidates, 0);
  const totalOpenings = open.reduce((s, r) => s + r.openings, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruiting"
        description="Job requisitions and the candidate pipeline — the recruiter's workspace."
        actions={
          <Link href="/hr/onboarding">
            <Button size="sm" variant="outline">
              New-hire onboarding →
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Open requisitions" value={open.length} icon={Briefcase} accent="teal" />
        <StatCard title="Total openings" value={totalOpenings} icon={DoorOpen} accent="sky" />
        <StatCard title="Candidates in pipeline" value={totalCandidates} icon={Users} accent="violet" />
      </div>

      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Open a requisition</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={actionCreateRequisition} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Input name="title" required placeholder="Job title *" className="h-9 lg:col-span-2" />
              <Input name="department" placeholder="Department" className="h-9" />
              <Input name="location" placeholder="Location" className="h-9" />
              <select name="employmentType" className={selectClass} defaultValue="FULL_TIME">
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="CONTRACT">Contract</option>
                <option value="TEMP">Temp</option>
                <option value="INTERN">Intern</option>
              </select>
              <Input name="openings" type="number" min="1" defaultValue="1" placeholder="Openings" className="h-9" />
              <Input name="payRangeMin" type="number" placeholder="Pay min" className="h-9" />
              <Input name="payRangeMax" type="number" placeholder="Pay max" className="h-9" />
              <select name="recruiterId" className={selectClass} defaultValue={user?.id || ""}>
                <option value="">Recruiter…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select name="hiringManagerId" className={selectClass} defaultValue="">
                <option value="">Hiring manager…</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Textarea name="description" placeholder="Description" className="lg:col-span-3" rows={2} />
              <Button type="submit" size="sm" className="h-9 self-end">Open requisition</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-800" data-tour="recruiting-pipeline">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Req</th>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Dept</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Openings</th>
              <th className="px-3 py-2 text-right">Candidates</th>
              <th className="px-3 py-2 text-left">Recruiter</th>
            </tr>
          </thead>
          <tbody>
            {reqs.map((r) => (
              <tr key={r.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                <td className="px-3 py-2 font-mono text-xs text-teal-400">
                  <Link href={`/recruiting/${r.id}`} className="hover:underline">{r.number}</Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/recruiting/${r.id}`} className="text-slate-100 hover:text-sky-400">{r.title}</Link>
                </td>
                <td className="px-3 py-2 text-slate-400">{r.department || "—"}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right tabular-nums">{r.openings}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r._count.candidates}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{r.recruiter?.name || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {reqs.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-500">No requisitions yet.</div>
        )}
      </div>
    </div>
  );
}
