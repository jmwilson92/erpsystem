import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, ROLES } from "@/lib/auth";
import { getPayrollPolicy, parseHolidays } from "@/lib/services/timesheets";
import { getReviewPolicy, parseReviewQuestions } from "@/lib/services/review-cycles";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  actionSaveCompanyProfile,
  actionSavePayrollPolicy,
  actionSaveReviewPolicy,
  actionWizardAddPerson,
  actionCompleteSetup,
} from "@/app/actions";
import {
  Building2,
  CalendarClock,
  ClipboardCheck,
  Users2,
  Rocket,
  CheckCircle2,
  Circle,
} from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const DEFAULT_DEPARTMENTS = [
  "Production",
  "Manufacturing",
  "Engineering",
  "Quality",
  "Supply Chain",
  "Programs",
  "Finance",
  "Human Resources",
  "Operations",
];

export default async function SetupWizardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const stepRaw = Array.isArray(sp.step) ? sp.step[0] : sp.step;
  const step = Math.min(5, Math.max(1, Number(stepRaw) || 1));

  const me = await getCurrentUser();
  const [company, payroll, review, people] = await Promise.all([
    prisma.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default" },
      update: {},
    }),
    getPayrollPolicy(),
    getReviewPolicy(),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: { manager: { select: { name: true } } },
    }),
  ]);

  let departments: string[] = DEFAULT_DEPARTMENTS;
  try {
    if (company.departments) {
      const parsed = JSON.parse(company.departments);
      if (Array.isArray(parsed) && parsed.length) departments = parsed;
    }
  } catch {
    // fall back to defaults
  }

  const holidayText = parseHolidays(payroll)
    .map((h) => `${h.date} ${h.name}`)
    .join("\n");
  const questionsText = parseReviewQuestions(review).join("\n");

  const steps = [
    { n: 1, label: "Company", icon: Building2 },
    { n: 2, label: "Pay & time", icon: CalendarClock },
    { n: 3, label: "Reviews", icon: ClipboardCheck },
    { n: 4, label: "Your people", icon: Users2 },
    { n: 5, label: "Launch", icon: Rocket },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={`Set up ${company.name}`}
        description="Five quick steps and your team is live — everything here can be changed later in Accounting and HR."
      />

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const done = step > s.n || (s.n === 5 && company.setupCompleted);
          const active = step === s.n;
          return (
            <Link
              key={s.n}
              href={`/setup?step=${s.n}`}
              className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
                active
                  ? "bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/40"
                  : done
                    ? "text-emerald-400 hover:bg-slate-900"
                    : "text-slate-500 hover:bg-slate-900"
              }`}
            >
              {done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <Icon className={`h-4 w-4 shrink-0 ${active ? "" : "opacity-60"}`} />
              )}
              <span className="hidden sm:inline">{s.label}</span>
              {i < steps.length - 1 && <span className="sr-only">→</span>}
            </Link>
          );
        })}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Who are you?</CardTitle>
            <p className="text-xs text-slate-500">
              Your company name appears across the app; departments drive the
              org chart and direct-charge approval routing.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionSaveCompanyProfile} className="grid gap-3">
              <label className="text-xs text-slate-500">
                Company name
                <Input
                  name="name"
                  required
                  defaultValue={company.name === "ForgeRP" ? "" : company.name}
                  placeholder="e.g. Precision Aero Manufacturing"
                  className="mt-1"
                />
              </label>
              <label className="text-xs text-slate-500">
                Tagline (shown under the logo)
                <Input
                  name="tagline"
                  defaultValue={company.tagline}
                  placeholder="Manufacturing"
                  className="mt-1"
                />
              </label>
              <label className="text-xs text-slate-500">
                Departments (one per line)
                <textarea
                  name="departments"
                  rows={6}
                  defaultValue={departments.join("\n")}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Save company
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/setup?step=2">Next: pay & time →</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              How do you pay people & track time?
            </CardTitle>
            <p className="text-xs text-slate-500">
              Drives timecard periods, overtime math, and the holiday
              calendar. Prefilled with common US defaults — tweak and save.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionSavePayrollPolicy} className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">
                  Timecard period
                  <select
                    name="timesheetFrequency"
                    className={selectClass}
                    defaultValue={payroll.timesheetFrequency}
                  >
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Biweekly</option>
                    <option value="SEMIMONTHLY">Semimonthly</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Week starts on
                  <select
                    name="weekStartsOn"
                    className={selectClass}
                    defaultValue={String(payroll.weekStartsOn)}
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="6">Saturday</option>
                  </select>
                </label>
                <label className="text-xs text-slate-500">
                  Overtime after (h/day)
                  <Input name="otAfterDailyHours" type="number" step={0.5} defaultValue={payroll.otAfterDailyHours} />
                </label>
                <label className="text-xs text-slate-500">
                  Double time after (h/day)
                  <Input name="dtAfterDailyHours" type="number" step={0.5} defaultValue={payroll.dtAfterDailyHours} />
                </label>
                <label className="text-xs text-slate-500">
                  Overtime after (h/week)
                  <Input name="otAfterWeeklyHours" type="number" step={1} defaultValue={payroll.otAfterWeeklyHours} />
                </label>
                <label className="text-xs text-slate-500">
                  Hard cap (h/day)
                  <Input name="maxHoursPerDay" type="number" step={0.5} defaultValue={payroll.maxHoursPerDay} />
                </label>
                <label className="text-xs text-slate-500">
                  OT multiplier
                  <Input name="otMultiplier" type="number" step={0.1} defaultValue={payroll.otMultiplier} />
                </label>
                <label className="text-xs text-slate-500">
                  Double-time multiplier
                  <Input name="dtMultiplier" type="number" step={0.1} defaultValue={payroll.dtMultiplier} />
                </label>
                <label className="text-xs text-slate-500">
                  PTO accrual (h/period)
                  <Input name="ptoAccrualHoursPerPeriod" type="number" step={0.5} defaultValue={payroll.ptoAccrualHoursPerPeriod} />
                </label>
                <label className="text-xs text-slate-500">
                  Sick time (h/year)
                  <Input name="sickHoursPerYear" type="number" step={1} defaultValue={payroll.sickHoursPerYear} />
                </label>
              </div>
              <label className="text-xs text-slate-500">
                Company holidays (one per line: YYYY-MM-DD Name)
                <textarea
                  name="holidays"
                  rows={6}
                  defaultValue={holidayText}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-200"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Save pay & time policy
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/setup?step=3">Next: reviews →</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              How do performance reviews work?
            </CardTitle>
            <p className="text-xs text-slate-500">
              Cycles open automatically: employees self-grade on your
              questions, managers assess, both sign. Sensible defaults are
              prefilled.
            </p>
          </CardHeader>
          <CardContent>
            <form action={actionSaveReviewPolicy} className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">
                  Review frequency (months)
                  <Input name="frequencyMonths" type="number" min={1} defaultValue={review.frequencyMonths} />
                </label>
                <label className="text-xs text-slate-500">
                  Self-review lead time (days before due)
                  <Input name="selfReviewLeadDays" type="number" min={1} defaultValue={review.selfReviewLeadDays} />
                </label>
              </div>
              <label className="text-xs text-slate-500">
                Review questions (one per line)
                <textarea
                  name="questions"
                  rows={6}
                  defaultValue={questionsText}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  Save review policy
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/setup?step=4">Next: your people →</Link>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Add your people</CardTitle>
            <p className="text-xs text-slate-500">
              Managers drive approvals (PTO, timecards, reviews). Add leaders
              first, then their reports. Fine-grained access lives in Roles &
              Permissions.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              action={actionWizardAddPerson}
              className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2"
            >
              <Input name="name" required placeholder="Full name" />
              <Input name="email" type="email" required placeholder="Email" />
              <Input name="title" placeholder="Job title" />
              <select name="role" className={selectClass} defaultValue="OPERATOR">
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select name="department" className={selectClass} defaultValue="">
                <option value="">Department…</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <select name="managerId" className={selectClass} defaultValue="">
                <option value="">No manager (top of org)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    Reports to {p.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" className="sm:col-span-2">
                Add person
              </Button>
            </form>

            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Current team ({people.length})
              </p>
              {people.map((p) => (
                <p
                  key={p.id}
                  className="flex items-center justify-between border-b border-slate-800/60 px-1 py-1 text-sm"
                >
                  <span className="text-slate-300">
                    {p.name}{" "}
                    <span className="text-xs text-slate-500">
                      · {p.title || p.role} · {p.department || "—"}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500">
                    {p.manager ? `→ ${p.manager.name}` : "top"}
                  </span>
                </p>
              ))}
            </div>
            <Button asChild size="sm" variant="outline">
              <Link href="/setup?step=5">Next: launch →</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card className="border-teal-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Ready to launch 🚀</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-1.5 text-sm">
              {[
                [`Company: ${company.name}`, company.name !== "ForgeRP"],
                [
                  `Pay periods: ${payroll.timesheetFrequency.toLowerCase()} · OT after ${payroll.otAfterDailyHours}h/day`,
                  true,
                ],
                [
                  `Reviews: every ${review.frequencyMonths} months, self-review ${review.selfReviewLeadDays} days ahead`,
                  true,
                ],
                [`Team: ${people.length} people on the org chart`, people.length > 1],
              ].map(([label, ok], i) => (
                <li key={i} className="flex items-center gap-2 text-slate-300">
                  {ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-slate-600" />
                  )}
                  {label as string}
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              The demo dataset (orders, work orders, inventory) stays in place
              so your team can explore real flows — replace it with live data
              as you go, or reset anytime with{" "}
              <code className="rounded bg-slate-900 px-1">npm run db:reset</code>.
              Everything you configured here is editable later under
              Accounting → Payroll and HR → Reviews.
            </p>
            <form action={actionCompleteSetup}>
              <Button type="submit">
                Finish setup — take me to {company.name} →
              </Button>
            </form>
            {me && (
              <p className="text-[11px] text-slate-600">
                Signed in as {me.name}. Use the Demo Mode switcher (bottom of
                the sidebar) to experience the app as anyone on your team.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
