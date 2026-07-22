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
  actionMoveCandidateStage,
  actionRecordBackgroundCheck,
} from "@/app/actions";
import { CANDIDATE_STAGES } from "@/lib/services/recruiting";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function CandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const canRecruit = await userHasPermission(user?.id, "hr.recruiting.manage");
  const canBackground = await userHasPermission(user?.id, "hr.background.manage");

  const candidate = await prisma.candidate.findUnique({
    where: { id },
    include: {
      requisition: { select: { id: true, number: true, title: true } },
      recruiter: { select: { name: true } },
      onboarding: { select: { id: true, number: true, status: true } },
      backgroundChecks: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!candidate) notFound();

  const backHref = `/recruiting/candidates/${candidate.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={candidate.name}
        description={[
          candidate.email,
          candidate.phone,
          candidate.source ? `via ${candidate.source}` : null,
        ].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={candidate.stage} />
            {candidate.requisition && (
              <Link href={`/recruiting/${candidate.requisition.id}`}>
                <Button size="sm" variant="outline">← {candidate.requisition.number}</Button>
              </Link>
            )}
          </div>
        }
      />

      {candidate.onboarding && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="flex items-center justify-between p-4">
            <p className="text-sm text-emerald-200">
              Hired — onboarding {candidate.onboarding.number} ({candidate.onboarding.status})
            </p>
            <Link href={`/hr/onboarding/${candidate.onboarding.id}`}>
              <Button size="sm" variant="secondary">Open onboarding →</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {canRecruit && candidate.stage !== "HIRED" && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Move in pipeline</CardTitle></CardHeader>
              <CardContent>
                <form action={actionMoveCandidateStage} className="flex flex-wrap items-end gap-1.5">
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <input type="hidden" name="returnTo" value={backHref} />
                  <label className="text-[10px] uppercase text-slate-500">
                    Stage
                    <select name="stage" defaultValue={candidate.stage} className={`${selectClass} mt-0.5`}>
                      {CANDIDATE_STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <Input name="rejectedReason" placeholder="Reason (if rejecting)" className="h-9 w-56" />
                  <Button type="submit" size="sm" className="h-9">Update stage</Button>
                </form>
                <p className="mt-2 text-[11px] text-slate-500">
                  Moving to <strong>HIRED</strong> automatically starts an onboarding record.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Background checks */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Background checks
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {candidate.backgroundChecks.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {candidate.backgroundChecks.map((bc) => (
                <div key={bc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2">
                  <div>
                    <span className="text-sm text-slate-200">{bc.checkType.replace(/_/g, " ")}</span>
                    <span className="ml-2"><StatusBadge status={bc.status} /></span>
                    {bc.provider && <span className="ml-2 text-xs text-slate-500">{bc.provider}</span>}
                    {bc.result && <p className="text-[11px] text-slate-500">{bc.result}</p>}
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    {bc.requestedAt ? `req ${formatDate(bc.requestedAt)}` : ""}
                    {bc.completedAt ? ` · done ${formatDate(bc.completedAt)}` : ""}
                    {bc.documentUrl && (
                      <a href={bc.documentUrl} target="_blank" rel="noreferrer" className="ml-2 text-sky-400 hover:underline">
                        {bc.documentName || "doc"}
                      </a>
                    )}
                  </div>
                </div>
              ))}
              {candidate.backgroundChecks.length === 0 && (
                <p className="text-sm text-slate-500">No checks yet.</p>
              )}

              {canBackground && (
                <form action={actionRecordBackgroundCheck} className="mt-2 grid gap-1.5 rounded-lg border border-slate-800 bg-slate-950/50 p-2 sm:grid-cols-3">
                  <input type="hidden" name="candidateId" value={candidate.id} />
                  <select name="checkType" className={selectClass} defaultValue="STANDARD">
                    {["STANDARD", "CRIMINAL", "EMPLOYMENT", "EDUCATION", "DRUG", "MVR", "CREDIT", "IDENTITY"].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <Input name="provider" placeholder="Provider (Checkr…)" className="h-9" />
                  <select name="status" className={selectClass} defaultValue="INITIATED">
                    {["NOT_STARTED", "INITIATED", "IN_PROGRESS", "CLEAR", "FLAGGED", "CANCELLED"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <Input name="documentUrl" placeholder="Report URL" className="h-9 sm:col-span-2" />
                  <Button type="submit" size="sm" className="h-9">Record check</Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Candidate</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-slate-400">Recruiter: <span className="text-slate-200">{candidate.recruiter?.name || "—"}</span></p>
              <p className="text-slate-400">Applied: <span className="text-slate-200">{formatDate(candidate.appliedAt)}</span></p>
              {candidate.resumeUrl && (
                <a href={candidate.resumeUrl} target="_blank" rel="noreferrer" className="inline-block text-sm text-sky-400 hover:underline">
                  {candidate.resumeName || "View resume"} ↗
                </a>
              )}
              {candidate.notes && (
                <p className="whitespace-pre-wrap text-xs text-slate-400">{candidate.notes}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
