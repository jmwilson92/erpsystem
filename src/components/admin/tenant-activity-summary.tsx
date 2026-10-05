import { formatDate, formatRelative } from "@/lib/utils";
import type { TenantActivity } from "@/lib/services/tenant-activity";

export function claimPresentation(activity: TenantActivity): {
  text: string;
  detail: string;
  tone: string;
} {
  if (activity.claimReason === "demo") {
    return {
      text: "Demo",
      detail: "Sandbox — not a customer workspace",
      tone: "text-slate-400",
    };
  }
  if (activity.claimReason === "audit") {
    return {
      text: "Claimed",
      detail: activity.claimedAt
        ? `INSTANCE_CLAIMED ${formatRelative(activity.claimedAt)}`
        : "INSTANCE_CLAIMED",
      tone: "text-emerald-300",
    };
  }
  if (activity.claimReason === "token_consumed") {
    return {
      text: "Claimed",
      detail: "Setup token consumed",
      tone: "text-emerald-300",
    };
  }
  if (activity.linkExpiresAt && activity.linkExpiresAt.getTime() < Date.now()) {
    return {
      text: "Not claimed",
      detail: `Link expired ${formatDate(activity.linkExpiresAt)}`,
      tone: "text-amber-300",
    };
  }
  return {
    text: "Not claimed",
    detail: activity.linkExpiresAt
      ? `Link outstanding until ${formatDate(activity.linkExpiresAt)}`
      : "Link outstanding",
    tone: "text-amber-300",
  };
}

export function lastLoginLabel(activity: TenantActivity): string {
  if (activity.claimReason === "demo") return "—";
  if (activity.unavailable) return "Unavailable";
  if (!activity.lastLoginAt) return "Never";
  return formatRelative(activity.lastLoginAt);
}

export function lastAuditLabel(activity: TenantActivity): string {
  if (activity.claimReason === "demo") return "—";
  if (activity.unavailable) return "Unavailable";
  if (!activity.lastAuditAt) return "None";
  return formatRelative(activity.lastAuditAt);
}

export function recordsLabel(activity: TenantActivity): string {
  if (activity.claimReason === "demo") return "Demo";
  if (activity.unavailable || !activity.counts) return "Unavailable";
  const c = activity.counts;
  return `${c.parts} parts · ${c.boms} BOMs · ${c.workOrders} WOs · ${c.nonConformances} NCRs`;
}
