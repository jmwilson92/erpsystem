import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, parseJsonArray } from "@/lib/utils";
import { certExpiryTone } from "@/lib/services/hr";
import {
  actionDecidePto,
  actionRequestPto,
  actionDecideTimeEntry,
  actionAdvanceExpense,
  actionUpdateGoalProgress,
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

export default async function HrPage() {
  const [users, timeEntries, pto, expenses, reviews, goals] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
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
  ]);

  const hoursThisWeek = timeEntries.reduce((s, t) => s + t.hours, 0);
  const pendingTime = timeEntries.filter((t) => t.status === "SUBMITTED");
  const pendingPto = pto.filter((p) => p.status === "PENDING");

  const departments = [...new Set(users.map((u) => u.department))].sort();
  const expiringCerts = users.flatMap((u) =>
    parseJsonArray<{ name: string; expires: string }>(u.certifications)
      .filter((c) => certExpiryTone(c.expires) !== "ok")
      .map((c) => ({ user: u.name, ...c }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR & Workforce"
        description="Time, PTO, expenses, reviews, goals, skills & certifications"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Active Employees" value={users.length} icon={Users2} accent="teal" />
        <StatCard title="Hours (recent)" value={hoursThisWeek} icon={Clock} accent="sky" />
        <StatCard title="Open PTO" value={pendingPto.length} icon={Calendar} accent="amber" />
        <StatCard title="Active Goals" value={goals.length} icon={Target} accent="violet" />
      </div>

      {expiringCerts.length > 0 && (
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
                    {c.user}: {c.name} · {tone === "expired" ? "expired" : "expires"}{" "}
                    {c.expires}
                  </span>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="time">
            Time{pendingTime.length > 0 ? ` (${pendingTime.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="pto">
            PTO{pendingPto.length > 0 ? ` (${pendingPto.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="reviews">Reviews & Goals</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="space-y-4">
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
                        <p className="font-semibold text-slate-100">{u.name}</p>
                        <p className="text-xs text-slate-500">
                          {u.title} · {u.department}
                        </p>
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
                              {c.name} · {tone === "expired" ? "EXPIRED" : "exp"}{" "}
                              {c.expires}
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
        </TabsContent>

        <TabsContent value="time" className="space-y-2">
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
                    <form action={actionDecideTimeEntry}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="decision" value="REJECTED" />
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

        <TabsContent value="pto" className="space-y-3">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Request time off</CardTitle>
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
                <Input
                  name="hours"
                  type="number"
                  min={1}
                  step={0.5}
                  required
                  placeholder="Hours"
                />
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
                      <form action={actionDecidePto}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="decision" value="REJECTED" />
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

        <TabsContent value="expenses" className="space-y-2">
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
                        <form action={actionAdvanceExpense}>
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="status" value="REJECTED" />
                          <Button type="submit" size="sm" variant="outline">
                            Reject
                          </Button>
                        </form>
                      </>
                    )}
                    {e.status === "APPROVED" && (
                      <form action={actionAdvanceExpense}>
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="status" value="PAID" />
                        <Button type="submit" size="sm" variant="amber">
                          Mark paid
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="reviews" className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Performance Reviews</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviews.map((r) => {
                const suggestions = parseJsonArray(r.aiSuggestions);
                return (
                  <div key={r.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-200">{r.employee.name}</span>
                      <span className="text-teal-400">{r.overallRating}/5</span>
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.period} · by {r.reviewer.name}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{r.strengths}</p>
                    {suggestions.length > 0 && (
                      <div className="mt-2 rounded bg-violet-500/10 p-2">
                        <p className="text-[10px] font-medium uppercase text-violet-400">
                          AI Development Suggestions
                        </p>
                        <ul className="mt-1 space-y-0.5 text-xs text-violet-200/80">
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
                    <span className="text-xs text-slate-500">{g.user.name}</span>
                  </div>
                  <Progress value={g.progress} className="mt-1 h-1.5" />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-500">
                      {g.category} · {g.progress}% · due {formatDate(g.targetDate)}
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
                      <Button type="submit" size="sm" variant="outline" className="h-7">
                        Update
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
