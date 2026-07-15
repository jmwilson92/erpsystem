import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import {
  getHrPersona,
  getEmployeeProfile,
  getTeamOverview,
  getComplianceItems,
  getTrainingMatrix,
  certExpiryTone,
} from "@/lib/services/hr";
import {
  getReviewPolicy,
  openDueReviewCycles,
  parseReviewQuestions,
} from "@/lib/services/review-cycles";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProfileView } from "@/components/hr/profile-view";
import { TeamView } from "@/components/hr/team-view";
import { formatCurrency, formatDate, parseJsonArray } from "@/lib/utils";
import {
  actionDecidePto,
  actionRequestPto,
  actionDecideTimeEntry,
  actionAdvanceExpense,
  actionUpdateGoalProgress,
  actionSaveReviewPolicy,
  actionOpenDueReviewCycles,
  actionCreateTrainingRequirement,
  actionToggleTrainingRequirement,
} from "@/app/actions";
import { Users2, Clock, Calendar, Target } from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const certToneClass: Record<ReturnType<typeof certExpiryTone>, string> = {
  expired: "bg-red-500/15 text-red-400 ring-1 ring-red-500/30",
  soon: "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30",
  ok: "text-slate-500",
};

export default async function HrPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const tabParam = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || "";
  const me = await getCurrentUser();
  if (!me) return null;

  const persona = await getHrPersona(me);

  // Auto-open self-review forms that fall inside the lead window.
  if (persona.isHrAdmin || persona.isManager) {
    await openDueReviewCycles({ actorId: me.id });
  }

  const [profile, team, complianceItems, trainingGaps, trainingReqs] =
    await Promise.all([
      getEmployeeProfile(me.id),
      persona.isManager ? getTeamOverview(me.id) : Promise.resolve([]),
      persona.isManager || persona.isHrAdmin
        ? getComplianceItems(me)
        : Promise.resolve([]),
      persona.isManager || persona.isHrAdmin
        ? getTrainingMatrix(persona.isHrAdmin ? undefined : persona.reportIds)
        : Promise.resolve([]),
      persona.isHrAdmin
        ? prisma.trainingRequirement.findMany({ orderBy: { name: "asc" } })
        : Promise.resolve([]),
    ]);
  const overdueCount = complianceItems.filter((c) => c.daysOut < 0).length;

  // Company-wide data only loads for HR administration.
  const [users, timeEntries, pto, expenses, reviews, goals, reviewPolicy] =
    persona.isHrAdmin
      ? await Promise.all([
          prisma.user.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            include: { manager: { select: { id: true, name: true } } },
          }),
          prisma.timeEntry.findMany({
            orderBy: { date: "desc" },
            include: { user: true, workOrder: true, project: true },
            take: 20,
          }),
          prisma.ptoRequest.findMany({
            orderBy: { createdAt: "desc" },
            include: { user: true },
          }),
          prisma.expenseReport.findMany({
            orderBy: { createdAt: "desc" },
            include: { user: true, lines: true },
          }),
          prisma.performanceReview.findMany({
            include: { employee: true, reviewer: true },
            orderBy: { createdAt: "desc" },
          }),
          prisma.employeeGoal.findMany({
            where: { status: "ACTIVE" },
            include: { user: true },
          }),
          getReviewPolicy(),
        ])
      : [[], [], [], [], [], [], null];

  const pendingTime = timeEntries.filter((t) => t.status === "SUBMITTED");
  const pendingPto = pto.filter((p) => p.status === "PENDING");
  const departments = [...new Set(users.map((u) => u.department))].sort();
  const expiringCerts = users.flatMap((u) =>
    parseJsonArray<{ name: string; expires: string }>(u.certifications)
      .filter((c) => certExpiryTone(c.expires) !== "ok")
      .map((c) => ({ user: u.name, ...c }))
  );

  // Everyone gets the same top-level tabs (their own data); manager/HR-admin
  // sections appear as extra cards within the relevant tab, permission-gated.
  const allowedTabs = new Set([
    "reviews",
    "goals",
    "training",
    "timeoff",
    "documents",
    "feedback",
    "more",
  ]);
  const defaultTab = allowedTabs.has(tabParam) ? tabParam : "reviews";

  const description = persona.isHrAdmin
    ? "HR administration & your workspace — reviews, goals, training, time off, documents, feedback"
    : persona.isManager
      ? "Your workspace and your team"
      : "Your workspace — reviews, goals, training, time off, documents, feedback";

  return (
    <div className="space-y-6">
      <PageHeader title="HR & Workforce" description={description} />

      {persona.isHrAdmin && (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard title="Active Employees" value={users.length} icon={Users2} accent="teal" />
          <StatCard
            title="Hours (recent)"
            value={timeEntries.reduce((s, t) => s + t.hours, 0)}
            icon={Clock}
            accent="sky"
          />
          <StatCard title="Open PTO" value={pendingPto.length} icon={Calendar} accent="amber" />
          <StatCard title="Active Goals" value={goals.length} icon={Target} accent="violet" />
        </div>
      )}

      {persona.isHrAdmin && expiringCerts.length > 0 && (
        <Card className="border-amber-500/30">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-400">
              Certification attention needed
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {expiringCerts.map((c) => {
                const tone = certExpiryTone(c.expires);
                return (
                  <span
                    key={`${c.user}-${c.name}`}
                    className={`rounded px-2 py-0.5 text-xs ${certToneClass[tone]}`}
                  >
                    {c.user}: {c.name} ·{" "}
                    {tone === "expired" ? "expired" : "expires"} {c.expires}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue={defaultTab}>
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="training">
            Training
            {(persona.isManager || persona.isHrAdmin) && overdueCount > 0
              ? ` (${overdueCount})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="timeoff">
            Time off
            {persona.isHrAdmin && pendingPto.length > 0
              ? ` (${pendingPto.length})`
              : ""}
          </TabsTrigger>
          <TabsTrigger value="documents">My documents</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="more">
            More
            {persona.isHrAdmin && pendingTime.length > 0
              ? ` (${pendingTime.length})`
              : ""}
          </TabsTrigger>
        </TabsList>

        {/* Employee-own panels (always available; admin cards stack below) */}
        <TabsContent value="reviews">
          <ProfileView profile={profile} only={["reviews"]} />
        </TabsContent>
        <TabsContent value="goals">
          <ProfileView profile={profile} only={["goals"]} />
        </TabsContent>
        <TabsContent value="training">
          <ProfileView profile={profile} only={["training"]} />
        </TabsContent>
        <TabsContent value="timeoff">
          <ProfileView profile={profile} only={["timeoff"]} />
        </TabsContent>
        <TabsContent value="documents">
          <ProfileView profile={profile} only={["documents"]} />
        </TabsContent>
        <TabsContent value="feedback">
          <ProfileView profile={profile} only={["feedback"]} />
        </TabsContent>
        <TabsContent value="more" className="space-y-4">
          <ProfileView profile={profile} only={["identity", "activity"]} />
          {persona.isManager && <TeamView team={team} />}
        </TabsContent>

        {(persona.isManager || persona.isHrAdmin) && (
          <TabsContent value="training" className="space-y-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Training & review compliance
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Overdue and soon-due performance reviews and expiring
                  certifications for {persona.isHrAdmin ? "the company" : "your team"}.
                  Overdue items also alert on the bell.
                </p>
              </CardHeader>
              <CardContent className="space-y-1">
                {complianceItems.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-500">
                    Everything current. 🎉
                  </p>
                )}
                {complianceItems.map((c, i) => {
                  const overdue = c.daysOut < 0;
                  return (
                    <Link
                      key={i}
                      href={c.href}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-slate-700"
                    >
                      <span className="min-w-0">
                        <span className="text-slate-200">{c.employeeName}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {c.label}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          overdue
                            ? "bg-rose-500/15 text-rose-300"
                            : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {c.kind === "TRAINING_MISSING"
                          ? "MISSING"
                          : c.kind === "TRAINING_OVERDUE"
                            ? `${Math.abs(c.daysOut)}d overdue`
                            : c.kind.startsWith("TRAINING")
                              ? overdue
                                ? "EXPIRED"
                                : `expires ${Math.abs(c.daysOut)}d`
                              : overdue
                                ? `${Math.abs(c.daysOut)}d overdue`
                                : `due ${c.daysOut}d`}
                      </span>
                    </Link>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Recurring training matrix
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Every required training cycle × every applicable employee.{" "}
                  {trainingGaps.filter((g) => g.status === "CURRENT").length}{" "}
                  current ·{" "}
                  {trainingGaps.filter((g) => g.status === "DUE_SOON").length}{" "}
                  due soon ·{" "}
                  {trainingGaps.filter((g) => g.status === "OVERDUE").length}{" "}
                  overdue ·{" "}
                  {trainingGaps.filter((g) => g.status === "MISSING").length}{" "}
                  missing.
                </p>
              </CardHeader>
              <CardContent className="space-y-1">
                {trainingGaps.length === 0 && (
                  <p className="py-4 text-center text-sm text-slate-500">
                    No active training cycles defined
                    {persona.isHrAdmin ? " — add one below." : "."}
                  </p>
                )}
                {trainingGaps
                  .filter((g) => g.status !== "CURRENT")
                  .slice(0, 40)
                  .map((g) => (
                    <Link
                      key={`${g.requirementId}:${g.userId}`}
                      href={`/hr/person/${g.userId}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm hover:border-slate-700"
                    >
                      <span className="min-w-0">
                        <span className="text-slate-200">{g.employeeName}</span>
                        <span className="ml-2 text-xs text-slate-500">
                          {g.requirementName}
                          {g.frequencyMonths > 0
                            ? ` · every ${g.frequencyMonths} mo`
                            : " · one-time"}
                          {g.department ? ` · ${g.department}` : ""}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          g.status === "MISSING"
                            ? "bg-rose-500/15 text-rose-300"
                            : g.status === "OVERDUE"
                              ? "bg-rose-500/15 text-rose-300"
                              : "bg-amber-500/15 text-amber-300"
                        }`}
                      >
                        {g.status === "DUE_SOON" && g.daysOut !== null
                          ? `due ${g.daysOut}d`
                          : g.status === "OVERDUE" && g.daysOut !== null
                            ? `${Math.abs(g.daysOut)}d overdue`
                            : g.status.replace(/_/g, " ")}
                      </span>
                    </Link>
                  ))}
                {trainingGaps.length > 0 &&
                  trainingGaps.every((g) => g.status === "CURRENT") && (
                    <p className="py-4 text-center text-sm text-slate-500">
                      Every required training is current. 🎉
                    </p>
                  )}
              </CardContent>
            </Card>

            {persona.isHrAdmin && (
              <Card className="border-teal-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Training cycles (HR)
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    Define what training recurs and how often. New completions
                    logged on a person&apos;s page auto-set the next expiry
                    from the cycle; gaps alert here and on the bell.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    {trainingReqs.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0">
                          <span
                            className={
                              r.isActive ? "text-slate-200" : "text-slate-500 line-through"
                            }
                          >
                            {r.name}
                          </span>
                          <span className="ml-2 text-xs text-slate-500">
                            {r.type.replace(/_/g, " ").toLowerCase()}
                            {r.frequencyMonths > 0
                              ? ` · every ${r.frequencyMonths} mo`
                              : " · one-time"}
                            {r.department ? ` · ${r.department}` : " · company-wide"}
                          </span>
                        </span>
                        <form action={actionToggleTrainingRequirement}>
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="sm" variant="outline">
                            {r.isActive ? "Deactivate" : "Reactivate"}
                          </Button>
                        </form>
                      </div>
                    ))}
                    {trainingReqs.length === 0 && (
                      <p className="text-sm text-slate-500">
                        No cycles defined yet.
                      </p>
                    )}
                  </div>
                  <form
                    action={actionCreateTrainingRequirement}
                    className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-2 lg:grid-cols-4"
                  >
                    <Input
                      name="name"
                      required
                      placeholder="Training name (matches records)"
                      className="h-9 lg:col-span-2"
                    />
                    <select name="type" className={selectClass} defaultValue="COMPLIANCE">
                      <option value="COMPLIANCE">Compliance</option>
                      <option value="SAFETY">Safety</option>
                      <option value="CERTIFICATION">Certification</option>
                      <option value="COURSE">Course</option>
                      <option value="ON_THE_JOB">On the job</option>
                    </select>
                    <Input
                      name="frequencyMonths"
                      type="number"
                      min={0}
                      defaultValue={12}
                      title="Months between completions (0 = one-time)"
                      className="h-9"
                    />
                    <select
                      name="department"
                      className={`${selectClass} lg:col-span-2`}
                      defaultValue=""
                    >
                      <option value="">Company-wide</option>
                      {departments.filter(Boolean).map((d) => (
                        <option key={d} value={d!}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <Input
                      name="description"
                      placeholder="Description (optional)"
                      className="h-9"
                    />
                    <Button type="submit" size="sm">
                      Add training cycle
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {persona.isHrAdmin && (
          <>
            <TabsContent value="more" className="space-y-4">
              <p className="text-xs text-slate-500">
                {departments
                  .map(
                    (d) => `${d}: ${users.filter((u) => u.department === d).length}`
                  )
                  .join(" · ")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {users.map((u) => {
                  const skills = parseJsonArray(u.skills);
                  const certs = parseJsonArray<{ name: string; expires: string }>(
                    u.certifications
                  );
                  return (
                    <Card key={u.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div>
                            <Link
                              href={`/hr/person/${u.id}`}
                              className="font-semibold text-slate-100 hover:text-teal-400 hover:underline"
                            >
                              {u.name}
                            </Link>
                            <p className="text-xs text-slate-500">
                              {u.title} · {u.department}
                            </p>
                            {u.manager && (
                              <p className="text-[11px] text-slate-600">
                                Mgr: {u.manager.name}
                              </p>
                            )}
                            <Link
                              href={`/hr/person/${u.id}`}
                              className="mt-1 inline-block text-[11px] text-sky-400 hover:underline"
                            >
                              Profile →
                            </Link>
                          </div>
                          <StatusBadge status={u.role} />
                        </div>
                        {skills.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {skills.map((s) => (
                              <span
                                key={s}
                                className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-teal-400"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                        {certs.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {certs.map((c) => {
                              const tone = certExpiryTone(c.expires);
                              return (
                                <p
                                  key={c.name}
                                  className={`w-fit rounded px-1 text-[11px] ${certToneClass[tone]}`}
                                >
                                  {c.name} ·{" "}
                                  {tone === "expired" ? "EXPIRED" : "exp"} {c.expires}
                                </p>
                              );
                            })}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <p className="text-xs text-slate-500">
                Documents are added from each person&apos;s own page — open a
                team member above to attach offer letters, certifications, or
                training records.
              </p>
            </TabsContent>

            <TabsContent value="more" className="space-y-2">
              {pendingTime.length > 0 && (
                <p className="text-xs text-slate-500">
                  {pendingTime.length} submitted entr
                  {pendingTime.length === 1 ? "y" : "ies"} awaiting approval ·{" "}
                  {pendingTime.reduce((s, t) => s + t.hours, 0)}h
                </p>
              )}
              {timeEntries.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 px-4 py-2 text-sm"
                >
                  <div>
                    <span className="text-slate-200">{t.user.name}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {t.workOrder?.number || t.project?.number || t.description || t.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-teal-400">{t.hours}h</span>
                    {t.costAmount > 0 && (
                      <span className="text-xs tabular-nums text-slate-500">
                        {formatCurrency(t.costAmount)}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{formatDate(t.date)}</span>
                    <StatusBadge status={t.status} />
                    {t.status === "SUBMITTED" && (
                      <div className="flex gap-1">
                        <form action={actionDecideTimeEntry}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="decision" value="APPROVED" />
                          <Button type="submit" size="sm">
                            Approve
                          </Button>
                        </form>
                        <form action={actionDecideTimeEntry} className="flex gap-1">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="decision" value="REJECTED" />
                          <Input
                            name="decisionNotes"
                            required
                            placeholder="Reason (required)"
                            className="h-8 w-36 text-xs"
                          />
                          <Button type="submit" size="sm" variant="outline">
                            Reject
                          </Button>
                        </form>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="timeoff" className="space-y-3">
              <Card className="border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Request time off (on behalf)</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action={actionRequestPto}
                    className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6"
                  >
                    <select name="userId" required className={selectClass}>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <select name="type" className={selectClass} defaultValue="PTO">
                      <option value="PTO">PTO</option>
                      <option value="SICK">Sick</option>
                      <option value="HOLIDAY">Holiday</option>
                      <option value="UNPAID">Unpaid</option>
                    </select>
                    <Input name="startDate" type="date" required />
                    <Input name="endDate" type="date" required />
                    <Input name="hours" type="number" min={1} step={0.5} required placeholder="Hours" />
                    <Button type="submit" size="sm">
                      Submit request
                    </Button>
                    <Input
                      name="reason"
                      placeholder="Reason (optional)"
                      className="sm:col-span-3 lg:col-span-6"
                    />
                  </form>
                </CardContent>
              </Card>

              {pto.map((p) => (
                <Card key={p.id}>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div>
                      <p className="text-sm text-slate-200">{p.user.name}</p>
                      <p className="text-xs text-slate-500">
                        {p.type} · {formatDate(p.startDate)} → {formatDate(p.endDate)} ·{" "}
                        {p.hours}h{p.reason ? ` · ${p.reason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={p.status} />
                      {p.status === "PENDING" && (
                        <>
                          <form action={actionDecidePto}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="decision" value="APPROVED" />
                            <Button type="submit" size="sm">
                              Approve
                            </Button>
                          </form>
                          <form action={actionDecidePto} className="flex gap-1">
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="decision" value="REJECTED" />
                            <Input
                              name="decisionNotes"
                              required
                              placeholder="Reason (required)"
                              className="h-8 w-36 text-xs"
                            />
                            <Button type="submit" size="sm" variant="outline">
                              Reject
                            </Button>
                          </form>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="more" className="space-y-2">
              {expenses.map((e) => (
                <Card key={e.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-sm text-sky-400">{e.number}</span>
                        <span className="ml-2 text-sm text-slate-300">{e.title}</span>
                        <p className="text-xs text-slate-500">
                          {e.user.name} · {e.lines.length} line
                          {e.lines.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{formatCurrency(e.totalAmount)}</p>
                        <StatusBadge status={e.status} />
                        {e.status === "DRAFT" && (
                          <form action={actionAdvanceExpense}>
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="status" value="SUBMITTED" />
                            <Button type="submit" size="sm" variant="outline">
                              Submit
                            </Button>
                          </form>
                        )}
                        {e.status === "SUBMITTED" && (
                          <>
                            <form action={actionAdvanceExpense}>
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="status" value="APPROVED" />
                              <Button type="submit" size="sm">
                                Approve
                              </Button>
                            </form>
                            <form action={actionAdvanceExpense} className="flex gap-1">
                              <input type="hidden" name="id" value={e.id} />
                              <input type="hidden" name="status" value="REJECTED" />
                              <Input
                                name="decisionNotes"
                                required
                                placeholder="Reason (required)"
                                className="h-8 w-36 text-xs"
                              />
                              <Button type="submit" size="sm" variant="outline">
                                Reject
                              </Button>
                            </form>
                          </>
                        )}
                        {e.status === "APPROVED" && (
                          <span className="text-[11px] text-slate-500">
                            Approved — accounting records payment
                          </span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="reviews" className="space-y-4">
              {reviewPolicy && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Review cycle policy
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      Frequency, lead time for self-assessment, and company
                      questions pushed to employees.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <form
                      action={actionSaveReviewPolicy}
                      className="grid gap-2 lg:grid-cols-2"
                    >
                      <label className="text-xs text-slate-500">
                        Frequency (months)
                        <Input
                          name="frequencyMonths"
                          type="number"
                          min={1}
                          max={36}
                          defaultValue={reviewPolicy.frequencyMonths}
                        />
                      </label>
                      <label className="text-xs text-slate-500">
                        Self-review lead days
                        <Input
                          name="selfReviewLeadDays"
                          type="number"
                          min={1}
                          max={90}
                          defaultValue={reviewPolicy.selfReviewLeadDays}
                        />
                      </label>
                      <label className="text-xs text-slate-500 lg:col-span-2">
                        Review questions (one per line)
                        <textarea
                          name="questions"
                          rows={6}
                          defaultValue={parseReviewQuestions(
                            reviewPolicy
                          ).join("\n")}
                          className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
                        />
                      </label>
                      <div className="lg:col-span-2">
                        <Button type="submit" size="sm">
                          Save policy
                        </Button>
                      </div>
                    </form>
                    <form action={actionOpenDueReviewCycles} className="mt-2">
                      <Button type="submit" size="sm" variant="outline">
                        Open due cycles now
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Performance Reviews</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    {reviews.map((r) => {
                      const suggestions = parseJsonArray(r.aiSuggestions);
                      return (
                        <div
                          key={r.id}
                          className="border-b border-slate-900 py-1.5 text-sm"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={`/hr/person/${r.employeeId}`}
                              className="font-medium text-slate-200 hover:text-teal-400 hover:underline"
                            >
                              {r.employee.name}
                            </Link>
                            <span className="flex items-center gap-2">
                              {r.overallRating ? (
                                <span className="tabular-nums text-teal-400">
                                  {r.overallRating}/5
                                </span>
                              ) : (
                                <StatusBadge status={r.status} />
                              )}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            {r.period} · by {r.reviewer.name}
                            {r.employeeSignedAt && r.managerSignedAt
                              ? " · dual signed"
                              : ""}
                          </p>
                          {r.strengths && (
                            <p className="mt-0.5 text-xs text-slate-400">
                              {r.strengths}
                            </p>
                          )}
                          {suggestions.length > 0 && (
                            <div className="mt-1 rounded bg-violet-500/10 p-1.5">
                              <p className="text-[10px] font-medium uppercase text-violet-400">
                                AI suggestions
                              </p>
                              <ul className="text-xs text-violet-200/80">
                                {suggestions.map((s) => (
                                  <li key={s}>• {s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Active Goals</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {goals.map((g) => (
                      <div key={g.id}>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-200">{g.title}</span>
                          <Link
                            href={`/hr/person/${g.userId}`}
                            className="text-xs text-sky-400 hover:underline"
                          >
                            {g.user.name}
                          </Link>
                        </div>
                        <Progress value={g.progress} className="mt-1 h-1.5" />
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-[11px] text-slate-500">
                            {g.category} · {g.progress}%
                            {g.targetDate
                              ? ` · due ${formatDate(g.targetDate)}`
                              : ""}
                          </p>
                          <form
                            action={actionUpdateGoalProgress}
                            className="flex items-center gap-1"
                          >
                            <input type="hidden" name="id" value={g.id} />
                            <Input
                              name="progress"
                              type="number"
                              min={0}
                              max={100}
                              defaultValue={g.progress}
                              className="h-7 w-16 text-xs"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              className="h-7"
                            >
                              Update
                            </Button>
                          </form>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
