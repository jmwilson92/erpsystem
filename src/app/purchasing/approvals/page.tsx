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
        description="Configure threshold-based multi-step approval for purchase requests"
        actions={
          <Link href="/purchasing?tab=prs">
            <Button size="sm" variant="outline">
              Back to PRs
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-700">
        <CardContent className="space-y-2 p-4 text-sm text-slate-400">
          <p>
            Each step applies when the PR estimated total is{" "}
            <strong className="text-slate-200">≥ min amount</strong>. Steps run in order.
            Only the current step can be approved (by the configured role or user).
            ADMIN can always approve any step.
          </p>
          <p className="text-xs text-slate-600">
            Demo tip: set <code className="text-teal-500">DEMO_USER_ROLE</code> in{" "}
            <code className="text-teal-500">.env</code> to PURCHASING, ACCOUNTING, or ADMIN
            to walk multi-step approvals as different people.
          </p>
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
                  <th className="pb-2">Min amount</th>
                  <th className="pb-2">Approver role</th>
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
                <label className="text-[10px] uppercase text-slate-500">Name</label>
                <Input
                  name="name"
                  required
                  className="mt-1"
                  defaultValue={defaultPolicy?.name || "Standard PR approval"}
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
              <label className="text-[10px] uppercase text-slate-500">Description</label>
              <Textarea
                name="description"
                rows={2}
                className="mt-1"
                defaultValue={
                  defaultPolicy?.description ||
                  "Buyer reviews all PRs; controller above $5k; ops admin above $25k."
                }
              />
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Steps (leave name blank to omit)
              </p>
              {[0, 1, 2, 3, 4].map((i) => {
                const step = defaultPolicy?.steps[i];
                return (
                  <div
                    key={i}
                    className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-5"
                  >
                    <div>
                      <label className="text-[10px] uppercase text-slate-600">Order</label>
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
                        defaultValue={step?.name || ""}
                        placeholder={i === 0 ? "Buyer review" : "Optional step"}
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
                        defaultValue={step?.minAmount ?? (i === 0 ? 0 : i === 1 ? 5000 : i === 2 ? 25000 : 0)}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-600">Role</label>
                      <select
                        name={`step_role_${i}`}
                        className={`${selectClass} mt-0.5`}
                        defaultValue={step?.approverRole || ""}
                      >
                        <option value="">Any (purchasing/admin)</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label className="text-[10px] uppercase text-slate-600">
                        Or specific user (optional)
                      </label>
                      <select
                        name={`step_user_${i}`}
                        className={`${selectClass} mt-0.5`}
                        defaultValue={step?.approverUserId || ""}
                      >
                        <option value="">— Role only —</option>
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
