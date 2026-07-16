import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { actionSaveApprovalPolicy } from "@/app/actions";
import {
  ensureDefaultPrApprovalPolicy,
  listApprovalPolicies,
} from "@/lib/services/pr-approval";
import { ROLES } from "@/lib/auth";
import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";

export const dynamic = "force-dynamic";

const ROUTING_OPTIONS: { value: string; label: string }[] = [
  {
    value: "REQUEST_CONFIRM",
    label: "1 · Charge owner confirms demand",
  },
  {
    value: "BUYER_PACKAGE",
    label: "2 · Buyer package (quotes / prices / docs)",
  },
  {
    value: "PURCHASE_APPROVAL",
    label: "3 · Charge owner approves to purchase",
  },
  {
    value: "CHARGE_ESCALATION",
    label: "4+ · Threshold escalation (program / exec)",
  },
  { value: "ROLE", label: "Fixed role (e.g. Finance ≥ $)" },
  { value: "USER", label: "Specific user only" },
];

export default async function PrApprovalSettingsPage() {
  await ensureDefaultPrApprovalPolicy();
  const [policies, users] = await Promise.all([
    listApprovalPolicies(),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, title: true },
    }),
  ]);

  const defaultPolicy = policies.find((p) => p.isDefault) || policies[0];
  const selectClass =
    "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

  return (
    <div className="space-y-6">
      <PageHeader
        title="PR approval rules"
        description="Charge-code routing + $ thresholds — not a fake SO “owner” step"
        actions={
          <Link href="/purchasing?tab=prs">
            <Button size="sm" variant="outline">
              Back to PRs
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-700">
        <CardContent className="space-y-3 p-4 text-sm text-slate-400">
          <p className="font-medium text-slate-200">How routing works</p>
          <ol className="list-decimal space-y-1.5 pl-4 text-xs leading-relaxed">
            <li>
              <strong className="text-teal-400">Confirm demand</strong> — same
              charge owner (WBS/PM or SO production mgr) says the need is real.
            </li>
            <li>
              <strong className="text-teal-400">Buyer package</strong> —
              purchasing checks prices, sole-source, quotes, docs; attaches the
              package; sends back to the owner.
            </li>
            <li>
              <strong className="text-teal-400">Approve to purchase</strong> —
              <em>same</em> charge owner signs the buy (not a second random
              person).
            </li>
            <li>
              <strong className="text-teal-400">Thresholds</strong> — company min
              $ on escalation / finance steps only (e.g. program ≥ $10k, finance
              ≥ $25k). Edit amounts below.
            </li>
          </ol>
        </CardContent>
      </Card>

      {policies.map((policy) => (
        <Card key={policy.id} className="border-slate-800">
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
            <div>
              <CardTitle className="text-base">{policy.name}</CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                {policy.description || "No description"}
              </p>
            </div>
            <div className="flex gap-1">
              {policy.isDefault && <StatusBadge status="DEFAULT" />}
              <StatusBadge status={policy.isActive ? "ACTIVE" : "INACTIVE"} />
            </div>
          </CardHeader>
          <CardContent>
            <table className="mb-4 w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] uppercase text-slate-500">
                  <th className="pb-2">#</th>
                  <th className="pb-2">Step</th>
                  <th className="pb-2">Min $</th>
                  <th className="pb-2">Routing</th>
                  <th className="pb-2">Fallback role</th>
                  <th className="pb-2">User lock</th>
                </tr>
              </thead>
              <tbody>
                {policy.steps.map((s) => {
                  const user = users.find((u) => u.id === s.approverUserId);
                  return (
                    <tr key={s.id} className="border-b border-slate-800/50">
                      <td className="py-2 text-slate-500">{s.stepOrder}</td>
                      <td className="py-2 text-slate-200">{s.name}</td>
                      <td className="py-2 tabular-nums text-slate-300">
                        {formatCurrency(s.minAmount)}
                      </td>
                      <td className="py-2 font-mono text-[10px] text-sky-400">
                        {s.routingKey || "ROLE"}
                      </td>
                      <td className="py-2 font-mono text-xs text-teal-400">
                        {s.approverRole || "—"}
                      </td>
                      <td className="py-2 text-xs text-slate-400">
                        {user ? `${user.name} (${user.role})` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      <Card className="border-teal-900/40">
        <CardHeader>
          <CardTitle>
            {defaultPolicy ? "Edit default policy" : "Create approval policy"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionSaveApprovalPolicy} className="space-y-4">
            {defaultPolicy && (
              <input type="hidden" name="id" value={defaultPolicy.id} />
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Name
                </label>
                <Input
                  name="name"
                  required
                  className="mt-1"
                  defaultValue={
                    defaultPolicy?.name || "Charge-code PR approval"
                  }
                />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="isDefault"
                    defaultChecked={defaultPolicy?.isDefault ?? true}
                    className="rounded border-slate-600"
                  />
                  Default policy
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="isActive"
                    defaultChecked={defaultPolicy?.isActive ?? true}
                    className="rounded border-slate-600"
                  />
                  Active
                </label>
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Description
              </label>
              <Textarea
                name="description"
                rows={2}
                className="mt-1"
                defaultValue={
                  defaultPolicy?.description ||
                  "Charge owner, then escalation above threshold, then finance."
                }
              />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Steps — set min $ thresholds (blank name = omit)
              </p>
              {[0, 1, 2, 3, 4].map((i) => {
                const step = defaultPolicy?.steps[i];
                const defaultRouting =
                  step?.routingKey ||
                  (i === 0
                    ? "REQUEST_CONFIRM"
                    : i === 1
                      ? "BUYER_PACKAGE"
                      : i === 2
                        ? "PURCHASE_APPROVAL"
                        : i === 3
                          ? "CHARGE_ESCALATION"
                          : "ROLE");
                const defaultMin =
                  step?.minAmount ??
                  (i === 0 || i === 1 || i === 2
                    ? 0
                    : i === 3
                      ? 10000
                      : i === 4
                        ? 25000
                        : 0);
                const defaultName =
                  step?.name ||
                  (i === 0
                    ? "Confirm demand"
                    : i === 1
                      ? "Buyer package"
                      : i === 2
                        ? "Approve to purchase"
                        : i === 3
                          ? "Threshold escalation"
                          : i === 4
                            ? "Finance / controller"
                            : "");
                return (
                  <div
                    key={i}
                    className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-6"
                  >
                    <div>
                      <label className="text-[10px] uppercase text-slate-600">
                        Order
                      </label>
                      <Input
                        name={`step_order_${i}`}
                        type="number"
                        className="mt-0.5 h-9"
                        defaultValue={step?.stepOrder ?? i + 1}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-600">
                        Step name
                      </label>
                      <Input
                        name={`step_name_${i}`}
                        className="mt-0.5 h-9"
                        defaultValue={defaultName}
                        placeholder="Optional step"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-600">
                        Min $
                      </label>
                      <Input
                        name={`step_min_${i}`}
                        type="number"
                        step="0.01"
                        className="mt-0.5 h-9"
                        defaultValue={defaultMin}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-600">
                        Routing
                      </label>
                      <select
                        name={`step_routing_${i}`}
                        className={`${selectClass} mt-0.5`}
                        defaultValue={defaultRouting}
                      >
                        {ROUTING_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-600">
                        Fallback / role
                      </label>
                      <select
                        name={`step_role_${i}`}
                        className={`${selectClass} mt-0.5`}
                        defaultValue={
                          step?.approverRole ||
                          (i === 0
                            ? "PURCHASING"
                            : i === 1
                              ? "EXECUTIVE"
                              : i === 2
                                ? "ACCOUNTING"
                                : "")
                        }
                      >
                        <option value="">—</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-4">
                      <label className="text-[10px] uppercase text-slate-600">
                        Or specific user (USER routing / lock)
                      </label>
                      <select
                        name={`step_user_${i}`}
                        className={`${selectClass} mt-0.5`}
                        defaultValue={step?.approverUserId || ""}
                      >
                        <option value="">— None —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name} · {u.role}
                            {u.title ? ` · ${u.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>

            <Button type="submit">Save approval policy</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
