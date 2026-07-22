import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionAddCandidate, actionUpdateRequisitionStatus } from "@/app/actions";
import { CANDIDATE_STAGES } from "@/lib/services/recruiting";
import { formatCurrency } from "@/lib/utils";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const STAGE_LABEL: Record<string, string> = {
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  HIRED: "Hired",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
};

export default async function RequisitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "hr.recruiting.manage");

  const req = await prisma.jobRequisition.findUnique({
    where: { id },
    include: {
      recruiter: { select: { name: true } },
      hiringManager: { select: { name: true } },
      candidates: {
        orderBy: { updatedAt: "desc" },
        include: { recruiter: { select: { name: true } } },
      },
    },
  });
  if (!req) notFound();

  const activeStages = CANDIDATE_STAGES.filter((s) => s !== "WITHDRAWN");

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${req.number} · ${req.title}`}
        description={[
          req.department,
          req.location,
          req.employmentType.replace(/_/g, " ").toLowerCase(),
          `${req.openings} opening(s)`,
        ].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={req.status} />
            <Link href="/recruiting"><Button size="sm" variant="outline">← All reqs</Button></Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-4 text-sm text-slate-400">
        {(req.payRangeMin || req.payRangeMax) && (
          <span>
            Pay: {req.payRangeMin ? formatCurrency(req.payRangeMin) : "—"} – {req.payRangeMax ? formatCurrency(req.payRangeMax) : "—"}
          </span>
        )}
        <span>Recruiter: {req.recruiter?.name || "—"}</span>
        <span>Hiring manager: {req.hiringManager?.name || "—"}</span>
      </div>
      {req.description && (
        <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-300">
          {req.description}
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap items-end gap-4">
          <form action={actionUpdateRequisitionStatus} className="flex items-end gap-1.5">
            <input type="hidden" name="requisitionId" value={req.id} />
            <label className="text-[10px] uppercase text-slate-500">
              Status
              <select name="status" defaultValue={req.status} className={`${selectClass} mt-0.5`}>
                {["DRAFT", "OPEN", "ON_HOLD", "FILLED", "CLOSED", "CANCELLED"].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <Button type="submit" size="sm" variant="secondary" className="h-9">Save</Button>
          </form>

          <form action={actionAddCandidate} className="flex flex-1 flex-wrap items-end gap-1.5">
            <input type="hidden" name="requisitionId" value={req.id} />
            <Input name="name" required placeholder="Candidate name *" className="h-9 w-44" />
            <Input name="email" type="email" placeholder="Email" className="h-9 w-44" />
            <Input name="source" placeholder="Source" className="h-9 w-32" />
            <Input name="resumeUrl" placeholder="Resume URL" className="h-9 w-40" />
            <Button type="submit" size="sm" className="h-9">Add candidate</Button>
          </form>
        </div>
      )}

      {/* Pipeline board */}
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {activeStages.map((stage) => {
          const inStage = req.candidates.filter((c) => c.stage === stage);
          return (
            <div key={stage} className="rounded-xl border border-slate-800 bg-slate-950/40">
              <div className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {STAGE_LABEL[stage]} <span className="text-slate-600">({inStage.length})</span>
              </div>
              <div className="space-y-2 p-2">
                {inStage.map((c) => (
                  <Link
                    key={c.id}
                    href={`/recruiting/candidates/${c.id}`}
                    className="block rounded-lg border border-slate-800 bg-slate-900/60 p-2 hover:border-teal-500/50"
                  >
                    <p className="text-sm text-slate-100">{c.name}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {c.email || "no email"}{c.source ? ` · ${c.source}` : ""}
                    </p>
                    {c.stage === "REJECTED" && c.rejectedReason && (
                      <p className="mt-0.5 text-[10px] text-rose-400">{c.rejectedReason}</p>
                    )}
                  </Link>
                ))}
                {inStage.length === 0 && (
                  <p className="px-1 py-2 text-[11px] text-slate-600">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
