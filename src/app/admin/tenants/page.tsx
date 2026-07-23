import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { controlPlaneClient } from "@/lib/db";
import { TenantOnboardLink } from "@/components/admin/tenant-onboard-link";

export const dynamic = "force-dynamic";

/**
 * Platform tenants registry — dogfood/owner only. The /admin layout already
 * requires ADMIN, but a *customer's* admin is also ADMIN inside their own
 * schema, so we additionally refuse any request routed to a tenant (a
 * forge-tenant cookie present) — only the public/dogfood instance sees this.
 */
export default async function TenantsAdminPage() {
  const jar = await cookies();
  if (jar.get("forge-tenant")?.value) redirect("/");

  const tenants = await controlPlaneClient().tenant.findMany({
    where: { isDemo: false },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const fmt = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

  const statusColor: Record<string, string> = {
    ACTIVE: "text-emerald-300",
    PROVISIONING: "text-amber-300",
    SUSPENDED: "text-orange-300",
    DESTROYED: "text-slate-500",
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-50">Customer tenants</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every provisioned customer workspace. Use “Onboarding link” to hand a
          customer a fresh claim link (valid 14 days) while trial emails are off.
        </p>
      </div>

      {tenants.length === 0 ? (
        <p className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-8 text-center text-sm text-slate-500">
          No customer tenants yet. They appear here after a completed Stripe signup.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Billing email</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Trial ends</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Onboarding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {tenants.map((t) => (
                <tr key={t.id} className="text-slate-300">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-100">{t.name || "—"}</div>
                    <div className="font-mono text-[11px] text-slate-500">{t.schemaName}</div>
                  </td>
                  <td className="px-4 py-3">{t.billingEmail || "—"}</td>
                  <td className="px-4 py-3">{t.plan || "—"}</td>
                  <td className={`px-4 py-3 font-medium ${statusColor[t.status] || "text-slate-300"}`}>
                    {t.status}
                  </td>
                  <td className="px-4 py-3">{fmt(t.trialEndsAt)}</td>
                  <td className="px-4 py-3">{fmt(t.createdAt)}</td>
                  <td className="px-4 py-3">
                    {t.status === "DESTROYED" ? (
                      <span className="text-xs text-slate-600">—</span>
                    ) : (
                      <TenantOnboardLink tenantId={t.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
