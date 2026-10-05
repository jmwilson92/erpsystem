import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { controlPlaneClient } from "@/lib/db";
import { loadTenantActivity } from "@/lib/services/tenant-activity";
import { TenantOnboardLink } from "@/components/admin/tenant-onboard-link";
import {
  claimPresentation,
  lastAuditLabel,
  lastLoginLabel,
} from "@/components/admin/tenant-activity-summary";
import { formatDate } from "@/lib/utils";
import { requireTenantRegistryAccess } from "../access";

export const dynamic = "force-dynamic";

/**
 * One customer workspace. Same platform-admin gate as the registry list.
 * Looks up by id, slug, or schema name so /admin/tenants/<tenantId> resolves
 * for the identifiers shown on the list.
 */
export default async function TenantActivityPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  await requireTenantRegistryAccess();

  const { tenantId } = await params;
  const key = tenantId.trim();
  if (!key) notFound();

  const tenant = await controlPlaneClient().tenant.findFirst({
    where: { OR: [{ id: key }, { slug: key }, { schemaName: key }] },
  });
  if (!tenant) notFound();

  const activity = await loadTenantActivity(tenant);
  const claim = claimPresentation(activity);

  const statusColor: Record<string, string> = {
    ACTIVE: "text-emerald-300",
    PROVISIONING: "text-amber-300",
    SUSPENDED: "text-orange-300",
    DESTROYED: "text-slate-500",
  };

  const counts = activity.counts;
  const tiles = counts
    ? [
        { label: "Parts", value: counts.parts },
        { label: "BOMs", value: counts.boms },
        { label: "Work orders", value: counts.workOrders },
        { label: "Nonconformances", value: counts.nonConformances },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <Link
        href="/admin/tenants"
        className="text-sm text-slate-400 hover:text-slate-200"
      >
        ← Customer tenants
      </Link>

      <div className="mt-4 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-50">
            {tenant.name || "Unnamed workspace"}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{tenant.schemaName}</p>
          {tenant.isDemo && (
            <p className="mt-2 text-sm text-amber-300">
              Demo sandbox. Adoption metrics are not collected for throwaway
              workspaces.
            </p>
          )}
        </div>
        {tenant.status !== "DESTROYED" && !tenant.isDemo && (
          <TenantOnboardLink tenantId={tenant.id} />
        )}
      </div>

      {activity.unavailable && (
        <p className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This workspace could not be read. The claim signal below uses the
          control-plane setup token only; login and record counts are unknown,
          not zero.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Onboarding">
          <span className={`font-medium ${claim.tone}`}>{claim.text}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{claim.detail}</span>
        </Fact>
        <Fact label="Last login">
          <span>{lastLoginLabel(activity)}</span>
          {activity.lastLoginAt && (
            <span className="mt-0.5 block text-xs text-slate-500">
              {formatDate(activity.lastLoginAt, "MMM d, yyyy HH:mm")}
            </span>
          )}
        </Fact>
        <Fact label="Last audit">
          <span>{lastAuditLabel(activity)}</span>
          {activity.lastAuditAt && (
            <span className="mt-0.5 block text-xs text-slate-500">
              {formatDate(activity.lastAuditAt, "MMM d, yyyy HH:mm")}
            </span>
          )}
        </Fact>
        <Fact label="Status">
          <span className={statusColor[tenant.status] || "text-slate-200"}>
            {tenant.status}
          </span>
        </Fact>
        <Fact label="Plan">{tenant.plan || "—"}</Fact>
        <Fact label="Billing email">{tenant.billingEmail || "—"}</Fact>
        <Fact label="Trial ends">{formatDate(tenant.trialEndsAt)}</Fact>
        <Fact label="Created">{formatDate(tenant.createdAt)}</Fact>
        <Fact label="Stripe customer">{tenant.stripeCustomerId || "—"}</Fact>
      </div>

      {tiles.length > 0 && (
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3"
            >
              <p className="text-2xl font-bold tabular-nums text-slate-100">
                {tile.value}
              </p>
              <p className="text-xs text-slate-400">{tile.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 text-sm text-slate-200">{children}</div>
    </div>
  );
}
