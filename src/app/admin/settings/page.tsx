import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineSetting } from "@/components/settings/inline-setting";
import {
  actionSaveCompanyProfile,
  actionSaveAccountingSettings,
} from "@/app/actions";
import { parseJsonArray } from "@/lib/utils";
import {
  Building2,
  Landmark,
  KeyRound,
  FileSpreadsheet,
  Rocket,
  Mail,
  Lock,
} from "lucide-react";

export const dynamic = "force-dynamic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function AdminSettingsPage() {
  const user = await getCurrentUser();
  const canEdit = await userHasPermission(user?.id, "admin.permissions");

  const [company, acct] = await Promise.all([
    prisma.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    prisma.accountingSettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
  ]);

  const departments = parseJsonArray<string>(company.departments);
  const deptText = departments.join("\n");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company Settings"
        description="Every company setting in one place. Each value is also editable inline on the page where it's used."
      />

      {!canEdit && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          You have read-only access. Settings can only be changed by an
          administrator.
        </div>
      )}

      {/* Company identity */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-teal-400" />
            Company identity
          </CardTitle>
          <p className="text-xs text-slate-500">
            Shown across the app — sidebar brand, reports, and login.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <InlineSetting
            label="Company name"
            name="name"
            value={company.name}
            action={actionSaveCompanyProfile}
            hiddenFields={{ tagline: company.tagline, departments: deptText }}
            canEdit={canEdit}
          />
          <InlineSetting
            label="Tagline"
            name="tagline"
            value={company.tagline}
            action={actionSaveCompanyProfile}
            hiddenFields={{ name: company.name, departments: deptText }}
            canEdit={canEdit}
          />
          <div className="sm:col-span-2">
            <InlineSetting
              label="Departments (one per line)"
              name="departments"
              type="textarea"
              value={deptText}
              display={
                departments.length ? (
                  <span className="flex flex-wrap gap-1">
                    {departments.map((d) => (
                      <span
                        key={d}
                        className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300"
                      >
                        {d}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                )
              }
              action={actionSaveCompanyProfile}
              hiddenFields={{ name: company.name, tagline: company.tagline }}
              canEdit={canEdit}
              textareaRows={6}
            />
          </div>
        </CardContent>
      </Card>

      {/* Accounting */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-teal-400" />
            Accounting
          </CardTitle>
          <p className="text-xs text-slate-500">
            Reporting basis and fiscal calendar. Month-end close is managed on
            the Accounting page.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <InlineSetting
            label="Accounting basis"
            name="basis"
            type="select"
            value={acct.basis}
            display={acct.basis === "CASH" ? "Cash" : "Accrual"}
            options={[
              { value: "ACCRUAL", label: "Accrual" },
              { value: "CASH", label: "Cash" },
            ]}
            action={actionSaveAccountingSettings}
            hiddenFields={{
              fiscalYearStartMonth: String(acct.fiscalYearStartMonth),
            }}
            canEdit={canEdit}
          />
          <InlineSetting
            label="Fiscal year starts"
            name="fiscalYearStartMonth"
            type="select"
            value={String(acct.fiscalYearStartMonth)}
            display={MONTHS[(acct.fiscalYearStartMonth || 1) - 1]}
            options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
            action={actionSaveAccountingSettings}
            hiddenFields={{ basis: acct.basis }}
            canEdit={canEdit}
          />
          <div className="sm:col-span-2 text-xs text-slate-500">
            {acct.closedThroughDate ? (
              <>Books are closed through {acct.closedThroughDate.toLocaleDateString()}.</>
            ) : (
              <>Books are open.</>
            )}{" "}
            <Link href="/accounting" className="text-teal-400 hover:underline">
              Manage month-end close →
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Other admin surfaces */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">More administration</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { href: "/admin/permissions", label: "Roles & Permissions", icon: KeyRound, note: "Access groups, invites" },
            { href: "/admin/import", label: "Data Import", icon: FileSpreadsheet, note: "CSV templates, migrate" },
            { href: "/setup", label: "Setup Wizard", icon: Rocket, note: "Onboarding, people" },
            { href: "/email", label: "Email Center", icon: Mail, note: "SMTP, inbound parse" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex items-center gap-3 rounded-xl border border-slate-800 px-3 py-3 transition-colors hover:border-slate-700 hover:bg-slate-900/40"
            >
              <l.icon className="h-5 w-5 text-slate-500" />
              <span>
                <span className="block text-sm text-slate-200">{l.label}</span>
                <span className="block text-[11px] text-slate-500">{l.note}</span>
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
