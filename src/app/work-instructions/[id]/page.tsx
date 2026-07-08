import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { actionAdvanceWiStatus } from "@/app/actions";

export const dynamic = "force-dynamic";

const flow: Record<string, string> = {
  DRAFT: "ENGINEERING_REVIEW",
  ENGINEERING_REVIEW: "CM_REVIEW",
  CM_REVIEW: "RELEASED",
};

export default async function WiDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const wi = await prisma.workInstruction.findUnique({
    where: { id },
    include: {
      part: true,
      createdBy: true,
      steps: { orderBy: { stepNumber: "asc" } },
      signOffs: { take: 10, orderBy: { signedAt: "desc" }, include: { user: true } },
    },
  });
  if (!wi) notFound();

  const next = flow[wi.status];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${wi.documentNumber} Rev ${wi.revision}`}
        description={wi.title}
        actions={
          next ? (
            <form action={actionAdvanceWiStatus}>
              <input type="hidden" name="id" value={wi.id} />
              <input type="hidden" name="toStatus" value={next} />
              <Button type="submit" size="sm">
                Advance to {next.replace(/_/g, " ")}
              </Button>
            </form>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={wi.status} />
        {wi.part && <span className="text-sm text-slate-400">{wi.part.partNumber}</span>}
        {wi.bomRevision && (
          <span className="text-sm text-slate-500">BOM Rev {wi.bomRevision}</span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {["DRAFT", "ENGINEERING_REVIEW", "CM_REVIEW", "RELEASED"].map((s) => (
          <span
            key={s}
            className={`rounded-full border px-3 py-1 ${
              wi.status === s
                ? "border-teal-500 bg-teal-500/10 text-teal-400"
                : "border-slate-800 text-slate-600"
            }`}
          >
            {s.replace(/_/g, " ")}
          </span>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Steps / Routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {wi.steps.map((step) => (
            <div
              key={step.id}
              className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 font-mono text-xs text-teal-400">
                  {step.stepNumber}
                </span>
                <span className="font-medium text-slate-100">{step.title}</span>
                {step.isTestStep && <StatusBadge status="TEST" />}
                {step.workCenter && (
                  <span className="text-xs text-slate-500">{step.workCenter}</span>
                )}
                {step.estimatedMinutes && (
                  <span className="text-xs text-slate-600">{step.estimatedMinutes} min</span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-400">{step.instructions}</p>
              {step.isTestStep && (
                <p className="mt-1 text-xs text-amber-400/80">
                  Test: {step.testCriteria} · Expected: {step.expectedValue}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {wi.signOffs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Sign-offs (across WOs)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {wi.signOffs.map((s) => (
              <div key={s.id} className="flex justify-between text-slate-400">
                <span>
                  {s.user.name} · {s.result}
                </span>
                <span className="text-xs">{formatDate(s.signedAt, "MMM d HH:mm")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
