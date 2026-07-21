import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import {
  getSubscriptionState,
  PLANS,
  TRIAL_DAYS,
} from "@/lib/services/subscription";
import {
  actionActivatePlan,
  actionStartTrial,
  actionCancelSubscription,
} from "@/app/actions";
import { formatDate } from "@/lib/utils";
import { Check, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

function money(n: number) {
  return `$${n.toLocaleString()}`;
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const expired = sp.expired === "1";
  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "admin.permissions");
  const sub = await getSubscriptionState();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plan & billing"
        description="Your ForgeRP subscription for this instance."
      />

      {expired && !sub.hasAccess && (
        <Card className="border-rose-500/50 bg-rose-500/10">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
            <div>
              <p className="font-semibold text-rose-100">
                Your trial has ended
              </p>
              <p className="text-sm text-rose-200/90">
                Your data is safe. Choose a plan below to restore full access.
                {!canManage &&
                  " Ask an administrator to complete the upgrade."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Current plan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Plan
            </p>
            <p className="font-medium text-slate-100">{sub.plan}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-slate-500">
              Status
            </p>
            <StatusBadge status={sub.status} />
          </div>
          {sub.isTrialing && sub.trialEndsAt && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                Trial ends
              </p>
              <p className="font-medium text-slate-100">
                {formatDate(sub.trialEndsAt)}
                {sub.trialDaysLeft != null && (
                  <span className="ml-1 text-xs text-slate-400">
                    ({sub.trialDaysLeft}d left)
                  </span>
                )}
              </p>
            </div>
          )}
          {sub.isPaid && sub.currentPeriodEnd && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                Renews
              </p>
              <p className="font-medium text-slate-100">
                {formatDate(sub.currentPeriodEnd)}
              </p>
            </div>
          )}
          {sub.seats != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                Seats
              </p>
              <p className="font-medium text-slate-100">{sub.seats}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const current = sub.plan === plan.key && sub.isPaid;
          return (
            <Card
              key={plan.key}
              className={current ? "border-teal-500/50" : "border-slate-800"}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {plan.name}
                  {current && (
                    <span className="rounded-full bg-teal-500/15 px-2 py-0.5 text-[10px] font-medium text-teal-300">
                      Current
                    </span>
                  )}
                </CardTitle>
                <p className="text-sm text-slate-400">{plan.blurb}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-bold text-slate-100">
                  {plan.key === "ENTERPRISE" ? (
                    "Custom"
                  ) : (
                    <>
                      {money(plan.price)}
                      <span className="text-sm font-normal text-slate-500">
                        /{plan.interval}
                      </span>
                    </>
                  )}
                </p>
                <ul className="space-y-1 text-xs text-slate-400">
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-teal-400" />
                    {plan.seats ? `Up to ${plan.seats} seats` : "Unlimited seats"}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-teal-400" />
                    Full ERP suite
                  </li>
                  {plan.key !== "STARTER" && (
                    <li className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-teal-400" />
                      Custom modules
                    </li>
                  )}
                </ul>
                {canManage && !current && (
                  <form action={actionActivatePlan} className="space-y-2">
                    <input type="hidden" name="plan" value={plan.key} />
                    <Input
                      name="billingEmail"
                      type="email"
                      placeholder="Billing email"
                      defaultValue={sub.billingEmail || user?.email || ""}
                      className="h-8 text-xs"
                    />
                    <Button type="submit" size="sm" className="w-full">
                      {plan.key === "ENTERPRISE"
                        ? "Contact sales"
                        : sub.isPaid
                          ? "Switch to this plan"
                          : "Choose plan"}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {!sub.isPaid && (
            <form action={actionStartTrial}>
              <Button type="submit" size="sm" variant="outline">
                {sub.isTrialing ? "Restart 30-day trial" : `Start ${TRIAL_DAYS}-day trial`}
              </Button>
            </form>
          )}
          {sub.isPaid && (
            <form action={actionCancelSubscription}>
              <Button type="submit" size="sm" variant="outline">
                Cancel subscription
              </Button>
            </form>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-600">
        Card payment via Stripe is coming online for the public beta — during the
        beta, plans activate in-app. Billing questions? billing@forgerp.example
      </p>
    </div>
  );
}
