import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { classificationLabel, listRecentErrors } from "@/lib/services/carina-errors";

export const dynamic = "force-dynamic";

function fmt(d?: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
}

function resolutionLabel(row: { resolution?: string | null; bugStatus?: string | null }) {
  if (row.resolution === "FIXED") return "Resolved by Carina";
  if (row.resolution === "REPORTED" || row.bugStatus === "OPEN") return "Bug reported";
  if (row.resolution === "DIAGNOSED") return "Diagnosed";
  if (row.resolution === "UNABLE") return "Unable to fix";
  return "Open";
}

export default async function AdminErrorLogPage() {
  const rows = await listRecentErrors(100);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Error log"
        description="Recent errors Carina captured in this workspace, with her classification and whether she resolved them."
      />
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">When (PT)</th>
                <th className="px-4 py-3 font-medium">Ref</th>
                <th className="px-4 py-3 font-medium">Class</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Route</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No errors captured yet.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id || row.correlationId} className="border-b border-slate-800/80 text-slate-200">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-400">{fmt(row.createdAt)}</td>
                  <td className="px-4 py-3 font-mono text-xs text-teal-300">{row.correlationId}</td>
                  <td className="px-4 py-3 text-xs">
                    <div>{classificationLabel(row.classification)}</div>
                    <div className="font-mono text-[10px] text-slate-500">{row.errorCode}</div>
                  </td>
                  <td className="max-w-sm px-4 py-3 text-xs">
                    <div className="line-clamp-3">{row.message}</div>
                    {row.actionAttempted && (
                      <div className="mt-1 text-[10px] text-slate-500">Action: {row.actionAttempted}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {row.route ? (
                      <Link href={row.route} className="text-teal-300 hover:underline">
                        {row.route}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{resolutionLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
