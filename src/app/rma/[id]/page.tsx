import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { actionTransitionRma } from "@/app/actions";
import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

const NEXT_STEPS: Record<
  string,
  { to: string; label: string; variant?: "default" | "outline" }[]
> = {
  REQUESTED: [
    { to: "AUTHORIZED", label: "Authorize return" },
    { to: "REJECTED", label: "Reject", variant: "outline" },
  ],
  AUTHORIZED: [
    { to: "RECEIVED", label: "Receive material" },
    { to: "REJECTED", label: "Reject", variant: "outline" },
  ],
  RECEIVED: [
    { to: "IN_EVALUATION", label: "Start evaluation" },
    { to: "DISPOSITIONED", label: "Disposition now", variant: "outline" },
  ],
  IN_EVALUATION: [{ to: "DISPOSITIONED", label: "Record disposition" }],
  DISPOSITIONED: [{ to: "CLOSED", label: "Close RMA" }],
};

const DISPOSITIONS = ["REPAIR", "REPLACE", "CREDIT", "RETURN_TO_STOCK", "SCRAP"];

export default async function RmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rma = await prisma.rma.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true, code: true } },
      part: { select: { partNumber: true, description: true } },
      serialNumber: { select: { id: true, serial: true, status: true } },
      salesOrder: { select: { id: true, number: true } },
    },
  });
  if (!rma) notFound();

  const audit = await prisma.auditLog.findMany({
    where: { entityType: "Rma", entityId: rma.id },
    orderBy: { createdAt: "asc" },
    take: 30,
  });
  const auditUsers = await prisma.user.findMany({
    where: { id: { in: audit.map((a) => a.userId).filter((x): x is string => !!x) } },
    select: { id: true, name: true },
  });
  const nameById = Object.fromEntries(auditUsers.map((u) => [u.id, u.name]));

  const steps = NEXT_STEPS[rma.status] || [];
  const needsDisposition = steps.some((s) => s.to === "DISPOSITIONED");
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title={rma.number}
        description={`${rma.customer.code} · ${rma.customer.name}`}
        actions={
          <Link href="/rma">
            <Button size="sm" variant="outline">
              All RMAs
            </Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={rma.status} />
        {rma.disposition && <StatusBadge status={rma.disposition} />}
        {rma.salesOrder && (
          <Link
            href={`/sales/${rma.salesOrder.id}`}
            className="text-xs text-sky-400 hover:underline"
          >
            {rma.salesOrder.number}
          </Link>
        )}
        {rma.serialNumber && (
          <Link
            href={`/serialization/${rma.serialNumber.id}`}
            className="font-mono text-xs text-sky-400 hover:underline"
          >
            {rma.serialNumber.serial} · {rma.serialNumber.status}
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Return details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-xs text-slate-500">PART </span>
              {rma.part ? (
                <>
                  <span className="font-mono text-xs text-teal-400">
                    {rma.part.partNumber}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {rma.part.description}
                  </span>
                </>
              ) : (
                "—"
              )}
            </p>
            <p>
              <span className="text-xs text-slate-500">QTY </span>
              {rma.quantity}
            </p>
            <p>
              <span className="text-xs text-slate-500">REASON </span>
              {rma.reason}
            </p>
            {rma.receivedAt && (
              <p>
                <span className="text-xs text-slate-500">RECEIVED </span>
                {formatDate(rma.receivedAt)}
              </p>
            )}
            {rma.dispositionNotes && (
              <p>
                <span className="text-xs text-slate-500">DISPOSITION NOTES </span>
                {rma.dispositionNotes}
              </p>
            )}
          </CardContent>
        </Card>

        {steps.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Next action</CardTitle>
              {rma.status === "AUTHORIZED" && (
                <p className="text-xs text-slate-500">
                  Receiving moves a serialized unit to QUARANTINE until
                  disposition.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {steps.map((s) => (
                <form
                  key={s.to}
                  action={actionTransitionRma}
                  className="space-y-2"
                >
                  <input type="hidden" name="rmaId" value={rma.id} />
                  <input type="hidden" name="to" value={s.to} />
                  {s.to === "DISPOSITIONED" && (
                    <>
                      <select
                        name="disposition"
                        required
                        className={selectClass}
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Pick disposition…
                        </option>
                        {DISPOSITIONS.map((d) => (
                          <option key={d} value={d}>
                            {d.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <Textarea
                        name="dispositionNotes"
                        rows={2}
                        placeholder="Findings / rework notes"
                      />
                    </>
                  )}
                  <Button
                    type="submit"
                    size="sm"
                    variant={s.variant || "default"}
                  >
                    {s.label}
                  </Button>
                </form>
              ))}
              {needsDisposition && rma.status === "RECEIVED" && (
                <p className="text-[10px] text-slate-600">
                  RETURN TO STOCK puts a serialized unit back to IN STOCK on
                  close; SCRAP retires the serial.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {audit.map((a) => (
            <p key={a.id} className="text-xs text-slate-400">
              <span className="text-slate-500">{formatDate(a.createdAt)}</span>
              <span className="ml-2 font-medium text-slate-300">{a.action}</span>
              {a.userId && nameById[a.userId] && (
                <span className="ml-2 text-slate-500">
                  by {nameById[a.userId]}
                </span>
              )}
            </p>
          ))}
          {audit.length === 0 && (
            <p className="text-xs text-slate-500">No history yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
