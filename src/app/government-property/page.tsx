import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Shield, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function GovPropertyPage() {
  const properties = await prisma.governmentProperty.findMany({
    orderBy: { assetTag: "asc" },
    include: { complianceChecks: { orderBy: { checkedAt: "desc" } } },
  });

  const gfp = properties.filter((p) => p.propertyType === "GFP").length;
  const cap = properties.filter((p) => p.propertyType === "CAP").length;
  const compliant = properties.filter((p) => p.dfarsCompliant).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Government Property"
        description="GFP / CAP tracking for DFARS, FAR, and DCMA audit readiness"
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="GFP Assets" value={gfp} icon={Shield} accent="violet" />
        <StatCard title="CAP Assets" value={cap} icon={Shield} accent="sky" />
        <StatCard
          title="DFARS Compliant"
          value={`${compliant}/${properties.length}`}
          icon={CheckCircle2}
          accent="emerald"
        />
      </div>

      <div className="grid gap-4">
        {properties.map((prop) => (
          <Card
            key={prop.id}
            className={
              prop.propertyType === "GFP"
                ? "border-violet-500/30"
                : "border-sky-500/20"
            }
          >
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="font-mono text-violet-400">{prop.assetTag}</CardTitle>
                <StatusBadge status={prop.propertyType} />
                <StatusBadge status={prop.status} />
                {prop.dfarsCompliant ? (
                  <StatusBadge status="COMPLIANT" />
                ) : (
                  <StatusBadge status="NON_COMPLIANT" />
                )}
              </div>
              <p className="text-sm text-slate-300">{prop.description}</p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <Field label="UID" value={prop.uid || "—"} mono />
                <Field label="Serial" value={prop.serialNumber || "—"} mono />
                <Field label="Contract" value={prop.contractNumber || "—"} mono />
                <Field label="Custodial / CAGE" value={prop.custodialCode || "—"} />
                <Field label="Location" value={prop.location || "—"} />
                <Field label="Condition" value={prop.condition} />
                <Field
                  label="Acquisition Cost"
                  value={formatCurrency(prop.acquisitionCost)}
                />
                <Field
                  label="Last Inventory"
                  value={formatDate(prop.lastInventoryDate)}
                />
              </div>

              {prop.complianceChecks.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium uppercase text-slate-500">
                    Compliance Checklist
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {prop.complianceChecks.map((c) => (
                      <span
                        key={c.id}
                        className={`rounded border px-2 py-1 text-xs ${
                          c.status === "PASS"
                            ? "border-emerald-500/30 text-emerald-400"
                            : "border-red-500/30 text-red-400"
                        }`}
                      >
                        {c.checkType.replace(/_/g, " ")}: {c.status}
                        {c.notes ? ` — ${c.notes}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-300">Audit-ready guidance</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            <li>UID and serial tracked at asset level for GFP/CAP</li>
            <li>Physical inventory and documentation checks recorded with date/user</li>
            <li>Inventory module marks government ownership distinctly (violet)</li>
            <li>Contract number and custodial codes required for DCMA reviews</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-600">{label}</p>
      <p className={`text-slate-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}
