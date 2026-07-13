import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { DocHeader, SignatureRow } from "@/components/print/doc-parts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function PrintTimesheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [sheet, company] = await Promise.all([
    prisma.timesheet.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, department: true, title: true } },
        entries: {
          include: {
            workOrder: { select: { number: true } },
            project: { select: { number: true } },
            wbsElement: { select: { code: true } },
          },
        },
        approvals: true,
      },
    }),
    prisma.companySettings.findUnique({ where: { id: "default" } }),
  ]);
  if (!sheet) notFound();

  // Columns: one per day of the period
  const days: Date[] = [];
  for (
    let d = new Date(sheet.periodStart);
    d <= sheet.periodEnd;
    d = new Date(d.getTime() + 86_400_000)
  ) {
    days.push(new Date(d));
  }

  // Rows: one per charge line (type + WO/project/WBS)
  type Row = { label: string; byDay: Record<string, number>; total: number };
  const rows = new Map<string, Row>();
  for (const e of sheet.entries) {
    const charge = e.workOrder
      ? `${e.workOrder.number} (direct)`
      : e.project
        ? `${e.project.number}${e.wbsElement ? ` / ${e.wbsElement.code}` : ""}`
        : e.type;
    const key = `${e.type}|${charge}`;
    const row = rows.get(key) || { label: charge, byDay: {}, total: 0 };
    const dk = day(e.date);
    row.byDay[dk] = (row.byDay[dk] || 0) + e.hours;
    row.total += e.hours;
    rows.set(key, row);
  }
  const rowList = [...rows.values()];
  const grandTotal = rowList.reduce((s, r) => s + r.total, 0);
  const dayTotals = days.map((d) =>
    rowList.reduce((s, r) => s + (r.byDay[day(d)] || 0), 0)
  );

  return (
    <PrintFrame>
      <DocHeader
        company={company?.name || "ForgeRP"}
        tagline={company?.tagline}
        title="Timesheet"
        number={`${day(sheet.periodStart)} → ${day(sheet.periodEnd)}`}
        meta={[
          { label: "Employee", value: sheet.user.name },
          ...(sheet.user.department
            ? [{ label: "Department", value: sheet.user.department }]
            : []),
          { label: "Status", value: sheet.status.replace(/_/g, " ") },
          ...(sheet.submittedAt
            ? [{ label: "Submitted", value: formatDate(sheet.submittedAt) }]
            : []),
        ]}
      />

      <table className="mt-6 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-neutral-900 text-left uppercase tracking-wide">
            <th className="px-1.5 py-1.5">Charge line</th>
            {days.map((d) => (
              <th key={day(d)} className="px-1.5 py-1.5 text-right">
                {d.toLocaleDateString("en-US", { weekday: "short" })}
                <br />
                {d.getMonth() + 1}/{d.getDate()}
              </th>
            ))}
            <th className="px-1.5 py-1.5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {rowList.map((r, i) => (
            <tr key={i} className="border-b border-neutral-300">
              <td className="px-1.5 py-1.5">{r.label}</td>
              {days.map((d) => (
                <td key={day(d)} className="px-1.5 py-1.5 text-right tabular-nums">
                  {r.byDay[day(d)] ? r.byDay[day(d)] : ""}
                </td>
              ))}
              <td className="px-1.5 py-1.5 text-right font-semibold tabular-nums">
                {r.total}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-900 font-bold">
            <td className="px-1.5 py-1.5">Daily total</td>
            {dayTotals.map((t, i) => (
              <td key={i} className="px-1.5 py-1.5 text-right tabular-nums">
                {t || ""}
              </td>
            ))}
            <td className="px-1.5 py-1.5 text-right tabular-nums">{grandTotal}</td>
          </tr>
        </tbody>
      </table>

      {sheet.approvals.length > 0 ? (
        <div className="mt-6 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            Approvals
          </p>
          <ul className="mt-1 space-y-0.5">
            {sheet.approvals.map((a) => (
              <li key={a.id} className="text-neutral-700">
                {a.label} — {a.hours}h · {a.status}
                {a.decidedAt ? ` on ${formatDate(a.decidedAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SignatureRow labels={["Employee", "Supervisor", "Payroll"]} />
    </PrintFrame>
  );
}
