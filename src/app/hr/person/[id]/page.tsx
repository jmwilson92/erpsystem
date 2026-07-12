import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  canViewPerson,
  getPersonPage,
  parseReviewQuestions,
  parseSelfRatings,
} from "@/lib/services/review-cycles";
import { getHrPersona, canDecideFor } from "@/lib/services/hr";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { formatDate, parseJsonArray } from "@/lib/utils";
import {
  actionAddEmployeeDocument,
  actionCreateEmployeeGoal,
  actionSavePerformanceReview,
  actionSignOffReview,
  actionSubmitSelfReview,
  actionUpdateGoalProgress,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return null;
  if (!(await canViewPerson({ id: me.id, role: me.role }, id))) {
    notFound();
  }

  const person = await getPersonPage(id);
  const persona = await getHrPersona(me);
  const isSelf = me.id === id;
  const canManage = await canDecideFor(
    { id: me.id, role: me.role },
    id,
    "hr.review.manage"
  );
  const canDocs =
    isSelf ||
    persona.isHrAdmin ||
    (await canDecideFor({ id: me.id, role: me.role }, id, "hr.docs.manage"));

  const { user, reviews, goals, documents, timesheets, openReviews } = person;
  const skills = parseJsonArray(user.skills);
  const certs = parseJsonArray<{ name: string; expires: string }>(
    user.certifications
  );
  const completed = reviews.filter((r) => r.status === "COMPLETED");
  const activeGoals = goals.filter((g) => g.status === "ACTIVE");

  return (
    <div className="space-y-6">
      <PageHeader
        title={user.name}
        description={`${user.title || "—"} · ${user.department || "—"}`}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href={isSelf ? "/hr?tab=profile" : "/hr?tab=team"}>
              ← Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold text-slate-100">{user.name}</p>
                <p className="text-sm text-slate-500">
                  {user.title} · {user.department}
                </p>
                {user.manager && (
                  <p className="mt-1 text-xs text-slate-500">
                    Reports to{" "}
                    <Link
                      href={`/hr/person/${user.manager.id}`}
                      className="text-sky-400 hover:underline"
                    >
                      {user.manager.name}
                    </Link>
                  </p>
                )}
              </div>
              <StatusBadge status={user.role} />
            </div>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1">
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
              <div className="space-y-0.5 border-t border-slate-800 pt-2">
                {certs.map((c) => (
                  <p key={c.name} className="text-xs text-slate-400">
                    {c.name} · exp {c.expires}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Open review cycles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {openReviews.length === 0 && (
              <p className="text-sm text-slate-500">
                No open review cycle. HR policy auto-opens one ~30 days before
                due.
              </p>
            )}
            {openReviews.map((r) => {
              const questions =
                parseReviewQuestions({ questions: r.questions }) || [];
              const self = parseSelfRatings(r.selfRatings);
              return (
                <div
                  key={r.id}
                  className="rounded-lg border border-slate-800 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium text-slate-200">
                        {r.period}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        with {r.reviewer.name}
                        {r.dueDate ? ` · due ${formatDate(r.dueDate)}` : ""}
                      </span>
                    </div>
                    <StatusBadge status={r.status} />
                  </div>

                  {/* Employee self-assessment */}
                  {isSelf &&
                    ["SELF_REVIEW", "DRAFT"].includes(r.status) &&
                    questions.length > 0 && (
                      <form
                        action={actionSubmitSelfReview}
                        className="space-y-3 rounded border border-sky-500/20 bg-sky-500/5 p-3"
                      >
                        <input type="hidden" name="reviewId" value={r.id} />
                        <p className="text-xs font-semibold uppercase tracking-wide text-sky-400">
                          Your self-assessment
                        </p>
                        {questions.map((q, i) => (
                          <div key={i} className="space-y-1">
                            <input type="hidden" name="question" value={q} />
                            <p className="text-sm text-slate-300">{q}</p>
                            <div className="flex gap-2">
                              <select
                                name="rating"
                                className={selectClass}
                                defaultValue="3"
                              >
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <option key={n} value={n}>
                                    {n} / 5
                                  </option>
                                ))}
                              </select>
                              <Input
                                name="comment"
                                placeholder="Comment (optional)"
                                className="flex-1"
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
                    <div className="space-y-1 text-xs">
                      <p className="font-semibold uppercase tracking-wide text-slate-500">
                        Self-assessment
                        {r.selfSubmittedAt
                          ? ` · ${formatDate(r.selfSubmittedAt)}`
                          : ""}
                      </p>
                      {self.map((s, i) => (
                        <div
                          key={i}
                          className="flex justify-between gap-2 border-b border-slate-900 py-1"
                        >
                          <span className="text-slate-400">
                            {s.question}
                            {s.comment ? (
                              <span className="text-slate-600">
                                {" "}
                                — {s.comment}
                              </span>
                            ) : null}
                          </span>
                          <span className="tabular-nums text-teal-400">
                            {s.rating}/5
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Manager discussion notes */}
                  {canManage && r.status !== "COMPLETED" && (
                    <form
                      action={actionSavePerformanceReview}
                      className="grid gap-2 rounded border border-slate-800 p-3"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="period" value={r.period} />
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Manager notes (discussion)
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          name="overallRating"
                          type="number"
                          min={1}
                          max={5}
                          step={0.1}
                          defaultValue={r.overallRating ?? ""}
                          placeholder="Overall rating 1–5"
                        />
                        <label className="flex items-center gap-2 text-xs text-slate-400">
                          <input
                            type="checkbox"
                            name="readyForSignoff"
                            value="true"
                            defaultChecked={r.status === "AWAITING_SIGNOFF"}
                          />
                          Ready for dual sign-off
                        </label>
                      </div>
                      <Textarea
                        name="strengths"
                        rows={2}
                        defaultValue={r.strengths || ""}
                        placeholder="Strengths"
                      />
                      <Textarea
                        name="improvements"
                        rows={2}
                        defaultValue={r.improvements || ""}
                        placeholder="Growth areas"
                      />
                      <Textarea
                        name="careerNotes"
                        rows={2}
                        defaultValue={r.careerNotes || ""}
                        placeholder="Career notes"
                      />
                      <Button type="submit" size="sm">
                        Save manager notes
                      </Button>
                    </form>
                  )}

                  {(r.strengths || r.improvements) && (
                    <div className="text-xs text-slate-400 space-y-1">
                      {r.overallRating != null && (
                        <p>
                          Manager rating:{" "}
                          <span className="text-teal-400">
                            {r.overallRating}/5
                          </span>
                        </p>
                      )}
                      {r.strengths && <p>Strengths: {r.strengths}</p>}
                      {r.improvements && <p>Growth: {r.improvements}</p>}
                    </div>
                  )}

                  {/* Dual sign-off */}
                  {["IN_PROGRESS", "AWAITING_SIGNOFF"].includes(r.status) && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                      <span className="text-xs text-slate-500">
                        Sign-off: employee{" "}
                        {r.employeeSignedAt
                          ? `✓ ${formatDate(r.employeeSignedAt)}`
                          : "—"}{" "}
                        · manager{" "}
                        {r.managerSignedAt
                          ? `✓ ${formatDate(r.managerSignedAt)}`
                          : "—"}
                      </span>
                      {isSelf && !r.employeeSignedAt && (
                        <form action={actionSignOffReview}>
                          <input type="hidden" name="reviewId" value={r.id} />
                          <input type="hidden" name="role" value="EMPLOYEE" />
                          <Button type="submit" size="sm">
                            Employee sign-off
                          </Button>
                        </form>
                      )}
                      {canManage && !r.managerSignedAt && (
                        <form action={actionSignOffReview}>
                          <input type="hidden" name="reviewId" value={r.id} />
                          <input type="hidden" name="role" value="MANAGER" />
                          <Button type="submit" size="sm">
                            Manager sign-off
                          </Button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Completed reviews</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {completed.length === 0 && (
              <p className="text-sm text-slate-500">None on file.</p>
            )}
            {completed.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b border-slate-900 py-1.5 text-sm"
              >
                <span className="text-slate-300">
                  {r.period}
                  {r.completedAt ? ` · ${formatDate(r.completedAt)}` : ""}
                </span>
                <span className="tabular-nums text-teal-400">
                  {r.overallRating != null ? `${r.overallRating}/5` : "—"}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Goals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeGoals.map((g) => (
              <div key={g.id}>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-200">{g.title}</span>
                  <span className="text-xs text-slate-500">{g.progress}%</span>
                </div>
                <Progress value={g.progress} className="mt-0.5 h-1" />
                {(isSelf || canManage) && (
                  <form
                    action={actionUpdateGoalProgress}
                    className="mt-1 flex gap-1"
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
                )}
              </div>
            ))}
            {canManage && (
              <form action={actionCreateEmployeeGoal} className="flex gap-1.5">
                <input type="hidden" name="userId" value={id} />
                <Input name="title" required placeholder="New goal…" className="h-8" />
                <input type="hidden" name="category" value="PERFORMANCE" />
                <Button type="submit" size="sm" variant="outline" className="h-8">
                  Add
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {documents.length === 0 && (
              <p className="text-sm text-slate-500">No documents.</p>
            )}
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between border-b border-slate-900 py-1.5 text-sm"
              >
                <span>
                  <span className="text-slate-200">{d.title}</span>
                  <span className="ml-2 text-[11px] text-slate-500">
                    {d.kind.replace(/_/g, " ")}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                </span>
                <span className="text-[11px] text-slate-600">
                  {formatDate(d.uploadedAt)}
                </span>
              </div>
            ))}
            {canDocs && (
              <form
                action={actionAddEmployeeDocument}
                className="mt-2 grid gap-2 sm:grid-cols-4"
              >
                <input type="hidden" name="userId" value={id} />
                <Input name="title" required placeholder="Title" />
                <select name="kind" className={selectClass} defaultValue="GENERAL">
                  <option value="GENERAL">General</option>
                  <option value="CERTIFICATION">Certification</option>
                  <option value="POLICY_ACK">Policy ack</option>
                  <option value="TRAINING">Training</option>
                  <option value="OFFER_LETTER">Offer letter</option>
                </select>
                <Input name="url" placeholder="URL (optional)" />
                <Button type="submit" size="sm">
                  Attach
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Timesheets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {timesheets.length === 0 && (
              <p className="text-sm text-slate-500">No timesheets yet.</p>
            )}
            {timesheets.map((t) => {
              const hours = t.entries.reduce((s, e) => s + e.hours, 0);
              return (
                <Link
                  key={t.id}
                  href={`/hr/timesheet/${t.id}`}
                  className="flex items-center justify-between border-b border-slate-900 py-1.5 text-sm hover:bg-slate-900/40"
                >
                  <span className="font-mono text-xs text-slate-400">
                    {formatDate(t.periodStart)} → {formatDate(t.periodEnd)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-400">{hours}h</span>
                    <StatusBadge status={t.status} />
                  </span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
