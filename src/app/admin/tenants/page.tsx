import Link from "next/link";
import { controlPlaneClient } from "@/lib/db";
import { loadTenantActivities } from "@/lib/services/tenant-activity";
import { TenantOnboardLink } from "@/components/admin/tenant-onboard-link";
import {
  claimPresentation,
  lastAuditLabel,
  lastLoginLabel,
  recordsLabel,
} from "@/components/admin/tenant-activity-summary";
import { requireTenantRegistryAccess } from "./access";

export const dynamic = "force-dynamic";

/**
 * Platform tenants registry — dogfood/owner only. See requireTenantRegistryAccess.
 * Demo sandboxes are omitted; open a row for the per-tenant activity detail.
 */
export default async function TenantsAdminPage() {
  await requireTenantRegistryAccess();

  const tenants = await controlPlaneClient().tenant.findMany({
    where: { isDemo: false },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const activity = await loadTenantActivities(tenants);

  const fmt = (d: Date | null) =>
    d
      ? new Date(d).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";

  const statusColor: Record<string, string> = {
    ACTIVE: "text-emerald-300",
    PROVISIONING: "text-amber-300",
    SUSPENDED: "text-orange-300",
    DESTROYED: "text-slate-500",
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-50">Customer tenants</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every provisioned customer workspace, with a read-only adoption
          snapshot: whether the onboarding link was claimed, last login, and
          whether they have started entering parts, BOMs, work orders, or
          nonconformances. Demo sandboxes are omitted. Use “Onboarding link” to
          hand a customer a fresh claim link (valid 14 days).
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
                <th className="px-4 py-3 font-medium">Onboarding</th>
                <th className="px-4 py-3 font-medium">Last login</th>
                <th className="px-4 py-3 font-medium">Records</th>
                <th className="px-4 py-3 font-medium">Last audit</th>
                <th className="px-4 py-3 font-medium">Trial ends</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {tenants.map((t) => {
                const row = activity.get(t.id);
                const claim = row ? claimPresentation(row) : null;
                return (
                  <tr key={t.id} className="text-slate-300">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/tenants/${t.id}`}
                        className="font-medium text-slate-100 hover:text-teal-300"
                      >
                        {t.name || "—"}
                      </Link>
                      <div className="font-mono text-[11px] text-slate-500">
                        {t.schemaName}
                      </div>
                    </td>
                    <td className="px-4 py-3">{t.billingEmail || "—"}</td>
                    <td className="px-4 py-3">{t.plan || "—"}</td>
                    <td
                      className={`px-4 py-3 font-medium ${statusColor[t.status] || "text-slate-300"}`}
                    >
                      {t.status}
                    </td>
                    <td className="px-4 py-3">
                      {claim ? (
                        <>
                          <div className={`font-medium ${claim.tone}`}>{claim.text}</div>
                          <div className="text-[11px] text-slate-500">{claim.detail}</div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row ? lastLoginLabel(row) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">
                      {row ? recordsLabel(row) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row ? lastAuditLabel(row) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(t.trialEndsAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{fmt(t.createdAt)}</td>
                    <td className="px-4 py-3">
                      {t.status === "DESTROYED" ? (
                        <span className="text-xs text-slate-600">—</span>
                      ) : (
                        <TenantOnboardLink tenantId={t.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
