import { notFound } from "next/navigation";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getPayStub } from "@/lib/services/timesheets";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PrintFrame } from "@/components/print/print-frame";

export const dynamic = "force-dynamic";

export default async function PayStubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) notFound();

  const stub = await getPayStub(id);
  if (!stub) notFound();

  // Employees see their own stubs; accounting/HR see everyone's.
  const canViewAll =
    (await userHasPermission(viewer.id, "accounting.journal.post")) ||
    (await userHasPermission(viewer.id, "hr.admin"));
  if (!canViewAll && stub.sheet.user.id !== viewer.id) notFound();

  const { sheet, hours, current, ytd } = stub;
  const rows: { label: string; cur: number; ytd: number }[] = [
    { label: "Gross pay", cur: current.gross, ytd: ytd.gross },
    { label: "Federal income tax", cur: -current.fed, ytd: -ytd.fed },
    { label: "State income tax", cur: -current.state, ytd: -ytd.state },
    { label: "FICA (Social Security + Medicare)", cur: -current.fica, ytd: -ytd.fica },
  ];

  return (
    <PrintFrame>
      <div className="flex items-start justify-between border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-xl font-bold">Earnings Statement</h1>
          <p className="text-sm text-neutral-600">ForgeRP Manufacturing</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">
            Pay period {formatDate(sheet.periodStart)} –{" "}
            {formatDate(sheet.periodEnd)}
          </p>
          <p className="text-neutral-600">
            Processed {sheet.processedAt ? formatDate(sheet.processedAt) : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="font-semibold">{sheet.user.name}</p>
          <p className="text-neutral-600">{sheet.user.title || ""}</p>
          <p className="text-neutral-600">{sheet.user.department || ""}</p>
          <p className="text-neutral-600">{sheet.user.email}</p>
        </div>
        <div className="text-right text-neutral-600">
          <p>Hours this period: {hours.toFixed(1)}</p>
          <p>
            Withholding: fed{" "}
            {((sheet.user.fedWithholdingPct ?? 0.12) * 100).toFixed(1)}% · state{" "}
            {((sheet.user.stateWithholdingPct ?? 0.04) * 100).toFixed(1)}%
          </p>
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-neutral-800 text-left">
            <th className="py-1.5">Description</th>
            <th className="py-1.5 text-right">This period</th>
            <th className="py-1.5 text-right">Year to date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-neutral-200">
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {formatCurrency(r.cur)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatCurrency(r.ytd)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-neutral-800 font-bold">
            <td className="py-2">Net pay</td>
            <td className="py-2 text-right tabular-nums">
              {formatCurrency(current.net)}
            </td>
            <td className="py-2 text-right tabular-nums">
              {formatCurrency(ytd.net)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-6 text-xs text-neutral-500">
        Employer additionally contributed {formatCurrency(sheet.ficaEmployer || 0)}{" "}
        in matching FICA this period. This statement reflects the withholding
        profile in effect on the processing date.
      </p>
    </PrintFrame>
  );
}
