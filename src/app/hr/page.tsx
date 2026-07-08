import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatDate, parseJsonArray } from "@/lib/utils";
import { Users2, Clock, Calendar, Target } from "lucide-react";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR & Workforce"
        description="Time, PTO, expenses, reviews, goals, skills & certifications"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard title="Active Employees" value={users.length} icon={Users2} accent="teal" />
        <StatCard title="Hours (recent)" value={hoursThisWeek} icon={Clock} accent="sky" />
        <StatCard title="Open PTO" value={pto.filter((p) => p.status === "PENDING").length} icon={Calendar} accent="amber" />
        <StatCard title="Active Goals" value={goals.length} icon={Target} accent="violet" />
      </div>

      <Tabs defaultValue="people">
        <TabsList>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="time">Time</TabsTrigger>
          <TabsTrigger value="pto">PTO</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="reviews">Reviews & Goals</TabsTrigger>
        </TabsList>

        <TabsContent value="people" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {users.map((u) => {
            const skills = parseJsonArray(u.skills);
            const certs = parseJsonArray<{ name: string; expires: string }>(u.certifications);
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
                      {certs.map((c) => (
                        <p key={c.name} className="text-[11px] text-slate-500">
                          {c.name} · exp {c.expires}
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="time" className="space-y-2">
          {timeEntries.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-slate-800 px-4 py-2 text-sm"
            >
              <div>
                <span className="text-slate-200">{t.user.name}</span>
                <span className="ml-2 text-xs text-slate-500">
                  {t.workOrder?.number || t.project?.number || t.description || t.type}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-teal-400">{t.hours}h</span>
                <span className="text-xs text-slate-500">{formatDate(t.date)}</span>
                <StatusBadge status={t.status} />
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="pto" className="space-y-2">
          {pto.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="text-sm text-slate-200">{p.user.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.type} · {formatDate(p.startDate)} → {formatDate(p.endDate)} ·{" "}
                    {p.hours}h · {p.reason}
                  </p>
                </div>
                <StatusBadge status={p.status} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="expenses" className="space-y-2">
          {expenses.map((e) => (
            <Card key={e.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-mono text-sm text-sky-400">{e.number}</span>
                    <span className="ml-2 text-sm text-slate-300">{e.title}</span>
                    <p className="text-xs text-slate-500">{e.user.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(e.totalAmount)}</p>
                    <StatusBadge status={e.status} />
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
            <CardContent className="space-y-3">
              {goals.map((g) => (
                <div key={g.id}>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-200">{g.title}</span>
                    <span className="text-xs text-slate-500">{g.user.name}</span>
                  </div>
                  <Progress value={g.progress} className="mt-1 h-1.5" />
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {g.category} · {g.progress}% · due {formatDate(g.targetDate)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
