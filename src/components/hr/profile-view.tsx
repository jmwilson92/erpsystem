import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatDate, parseJsonArray } from "@/lib/utils";
import { certExpiryTone, type getEmployeeProfile } from "@/lib/services/hr";
import {
  parseReviewQuestions,
  parseSelfRatings,
} from "@/lib/services/review-cycles";
import {
  actionRequestPto,
  actionUpdateGoalProgress,
  actionCreateEmployeeGoal,
  actionAdvanceExpense,
  actionAddEmployeeDocument,
  actionSubmitSelfReview,
  actionSignOffReview,
} from "@/app/actions";
import { FileText, Award, ShieldCheck, GraduationCap, File } from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const DOC_ICONS: Record<string, typeof File> = {
  OFFER_LETTER: FileText,
  CERTIFICATION: Award,
  POLICY_ACK: ShieldCheck,
  TRAINING: GraduationCap,
  GENERAL: File,
};

export function ProfileView({
  profile,
}: {
  profile: Awaited<ReturnType<typeof getEmployeeProfile>>;
}) {
  const { user, ptoRequests, timeEntries, expenses, reviews, goals, documents } =
    profile;
  const skills = parseJsonArray(user.skills);
  const certs = parseJsonArray<{ name: string; expires: string }>(
    user.certifications
  );
  const upcoming = reviews.filter((r) => r.status !== "COMPLETED");
  const completed = reviews.filter((r) => r.status === "COMPLETED");
  const activeGoals = goals.filter((g) => g.status === "ACTIVE");
  const ptoApprovedHours = ptoRequests
    .filter((p) => p.status === "APPROVED")
    .reduce((s, p) => s + p.hours, 0);

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div>
            <p className="text-lg font-semibold text-slate-100">{user.name}</p>
            <p className="text-sm text-slate-500">
              {user.title} · {user.department}
            </p>
            {user.manager && (
              <p className="mt-1 text-xs text-slate-500">
                Reports to{" "}
                <span className="text-slate-300">{user.manager.name}</span>
                {user.manager.title ? ` (${user.manager.title})` : ""}
              </p>
            )}
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
          </div>
          <div className="text-right">
            <StatusBadge status={user.role} />
            <p className="mt-2 text-xs text-slate-500">
              PTO used (approved):{" "}
              <span className="tabular-nums text-slate-300">
                {ptoApprovedHours}h
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {upcoming.length > 0 && (
        <Card className="border-sky-500/30">
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">
                Open reviews
              </p>
              <Link
                href={`/hr/person/${user.id}`}
                className="text-xs text-sky-400 hover:underline"
              >
                Full person page →
              </Link>
            </div>
            {upcoming.map((r) => {
              const questions = parseReviewQuestions({ questions: r.questions });
              const self = parseSelfRatings(r.selfRatings);
              return (
                <div
                  key={r.id}
                  className="space-y-2 rounded-lg border border-slate-800 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-300">
                      {r.period} · with {r.reviewer.name}
                      {r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ""}
                    </p>
                    <StatusBadge status={r.status} />
                  </div>

                  {["SELF_REVIEW", "DRAFT"].includes(r.status) &&
                    questions.length > 0 && (
                      <form
                        action={actionSubmitSelfReview}
                        className="space-y-2 rounded border border-sky-500/20 bg-sky-500/5 p-3"
                      >
                        <input type="hidden" name="reviewId" value={r.id} />
                        <p className="text-xs font-medium text-sky-400">
                          Complete your self-assessment
                        </p>
                        {questions.map((q, i) => (
                          <div key={i} className="space-y-1">
                            <input type="hidden" name="question" value={q} />
                            <p className="text-xs text-slate-300">{q}</p>
                            <div className="flex gap-2">
                              <select
                                name="rating"
                                className={selectClass}
                                defaultValue="3"
                              >
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>
                                    {n}/5
                                  </option>
                                ))}
                              </select>
                              <Input
                                name="comment"
                                placeholder="Comment"
                                className="h-9 flex-1 text-xs"
                              />
                            </div>
                          </div>
                        ))}
                        <Button type="submit" size="sm">
                          Submit self-review
                        </Button>
                      </form>
                    )}

                  {self.length > 0 && (
                    <div className="space-y-0.5 text-xs text-slate-500">
                      {self.map((s, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{s.question}</span>
                          <span className="text-teal-400">{s.rating}/5</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {["IN_PROGRESS", "AWAITING_SIGNOFF"].includes(r.status) &&
                    !r.employeeSignedAt && (
                      <form action={actionSignOffReview}>
                        <input type="hidden" name="reviewId" value={r.id} />
                        <input type="hidden" name="role" value="EMPLOYEE" />
                        <Button type="submit" size="sm" variant="outline">
                          Sign off on review
                        </Button>
                      </form>
                    )}
                  {r.employeeSignedAt && (
                    <p className="text-[11px] text-emerald-400">
                      You signed off {formatDate(r.employeeSignedAt)}
                      {r.managerSignedAt
                        ? ` · manager signed ${formatDate(r.managerSignedAt)}`
                        : " · waiting on manager"}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Goals */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeGoals.length === 0 && (
              <p className="text-sm text-slate-500">No active goals.</p>
            )}
            {activeGoals.map((g) => (
              <div key={g.id}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-200">{g.title}</span>
                  <span className="text-xs text-slate-500">{g.category}</span>
                </div>
                <Progress value={g.progress} className="mt-1 h-1.5" />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    {g.progress}%{g.targetDate ? ` · due ${formatDate(g.targetDate)}` : ""}
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
            <form
              action={actionCreateEmployeeGoal}
              className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-4"
            >
              <input type="hidden" name="userId" value={user.id} />
              <Input
                name="title"
                required
                placeholder="New goal…"
                className="sm:col-span-2"
              />
              <select name="category" className={selectClass} defaultValue="SKILL">
                <option value="SKILL">Skill</option>
                <option value="CAREER">Career</option>
                <option value="PERFORMANCE">Performance</option>
                <option value="CERTIFICATION">Certification</option>
              </select>
              <Button type="submit" size="sm">
                Add goal
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Reviews */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {completed.length === 0 && (
              <p className="text-sm text-slate-500">No completed reviews yet.</p>
            )}
            {completed.map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-800 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{r.period}</span>
                  <span className="text-teal-400">{r.overallRating}/5</span>
                </div>
                <p className="text-xs text-slate-500">by {r.reviewer.name}</p>
                {r.strengths && (
                  <p className="mt-1 text-xs text-slate-400">{r.strengths}</p>
                )}
                {r.improvements && (
                  <p className="mt-1 text-xs text-amber-400/90">
                    Growth: {r.improvements}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* PTO */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My time off</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={actionRequestPto} className="grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="userId" value={user.id} />
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
                Request
              </Button>
            </form>
            {ptoRequests.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="text-xs text-slate-400">
                  {p.type} · {formatDate(p.startDate)} → {formatDate(p.endDate)} · {p.hours}h
                </span>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {documents.length === 0 && (
              <p className="text-sm text-slate-500">No documents on file.</p>
            )}
            {documents.map((d) => {
              const Icon = DOC_ICONS[d.kind] || File;
              return (
                <div
                  key={d.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-800 px-3 py-2"
                >
                  <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{d.title}</p>
                    <p className="text-[11px] text-slate-500">
                      {d.kind.replace(/_/g, " ")} · {formatDate(d.uploadedAt)}
                      {d.note ? ` · ${d.note}` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
            <form
              action={actionAddEmployeeDocument}
              className="grid gap-2 border-t border-slate-800 pt-2 sm:grid-cols-3"
            >
              <input type="hidden" name="userId" value={user.id} />
              <Input name="title" required placeholder="Document title" className="text-xs" />
              <select name="kind" className={selectClass} defaultValue="GENERAL">
                <option value="GENERAL">General</option>
                <option value="CERTIFICATION">Certification</option>
                <option value="POLICY_ACK">Policy ack</option>
                <option value="TRAINING">Training</option>
              </select>
              <Button type="submit" size="sm">
                Attach document
              </Button>
              <Input
                name="url"
                placeholder="URL (optional)"
                className="text-xs sm:col-span-2"
              />
              <Input name="note" placeholder="Note" className="text-xs" />
            </form>
            {certs.length > 0 && (
              <div className="border-t border-slate-800 pt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Certifications
                </p>
                {certs.map((c) => {
                  const tone = certExpiryTone(c.expires);
                  return (
                    <p
                      key={c.name}
                      className={`text-xs ${
                        tone === "expired"
                          ? "text-red-400"
                          : tone === "soon"
                            ? "text-amber-400"
                            : "text-slate-400"
                      }`}
                    >
                      {c.name} · {tone === "expired" ? "EXPIRED" : "exp"} {c.expires}
                    </p>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent time entries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {timeEntries.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5 text-xs"
              >
                <span className="text-slate-400">
                  {formatDate(t.date)} ·{" "}
                  {t.workOrder?.number || t.project?.number || t.description || t.type}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-teal-400">{t.hours}h</span>
                  <StatusBadge status={t.status} />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">My expenses</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {expenses.length === 0 && (
              <p className="text-sm text-slate-500">No expense reports.</p>
            )}
            {expenses.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between rounded border border-slate-800 px-3 py-1.5 text-xs"
              >
                <span className="text-slate-400">
                  <span className="font-mono text-sky-400">{e.number}</span> {e.title}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCurrency(e.totalAmount)}</span>
                  <StatusBadge status={e.status} />
                  {e.status === "DRAFT" && (
                    <form action={actionAdvanceExpense}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value="SUBMITTED" />
                      <Button type="submit" size="sm" variant="outline" className="h-6 text-[11px]">
                        Submit
                      </Button>
                    </form>
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
