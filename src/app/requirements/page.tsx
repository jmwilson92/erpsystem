import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import {
  getRequirementsBoard,
  REQ_CATEGORIES,
  VERIFICATION_METHODS,
} from "@/lib/services/requirements";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { StatCard } from "@/components/shared/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  actionCreateRequirement,
  actionUpdateRequirementStatus,
  actionLinkRequirementWork,
  actionRemoveRequirementTrace,
} from "@/app/actions";
import Link from "next/link";
import {
  ListChecks,
  Link2,
  ShieldCheck,
  CircleAlert,
  X,
} from "lucide-react";

export const dynamic = "force-dynamic";

const selectClass =
  "h-8 rounded-lg border border-slate-700 bg-slate-950 px-1.5 text-xs text-slate-200";

function pick(
  sp: Record<string, string | string[] | undefined>,
  key: string
): string {
  const v = sp[key];
  return Array.isArray(v) ? v[0] || "" : v || "";
}

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const productFilter = pick(sp, "product");
  const statusFilter = pick(sp, "status");
  const user = await getCurrentUser();
  const canEdit =
    !!user &&
    (user.role === "ADMIN" ||
      (await userHasPermission(user.id, "engineering.task.create")));

  const [{ requirements, stats }, products, projects, engTasks, sagas, tps] =
    await Promise.all([
      getRequirementsBoard({
        productId: productFilter || undefined,
        status: statusFilter || undefined,
      }),
      prisma.product.findMany({
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.project.findMany({
        where: { status: { notIn: ["CLOSED", "CANCELLED"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true },
        take: 100,
      }),
      prisma.engTask.findMany({
        where: { status: { notIn: ["DONE", "CANCELLED"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true, discipline: true },
        take: 300,
      }),
      prisma.saga.findMany({
        where: { status: { notIn: ["DONE", "CANCELLED"] } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, name: true, discipline: true },
        take: 200,
      }),
      prisma.testProcedure.findMany({
        where: { status: { not: "OBSOLETE" } },
        orderBy: { number: "asc" },
        select: { id: true, number: true, revision: true, title: true },
        take: 200,
      }),
    ]);

  // Tree order: parents first, children indented beneath
  type Req = (typeof requirements)[number];
  const byParent = new Map<string, Req[]>();
  for (const r of requirements) {
    const key = r.parentId || "__root__";
    const list = byParent.get(key) || [];
    list.push(r);
    byParent.set(key, list);
  }
  const ordered: { req: Req; depth: number }[] = [];
  const seen = new Set<string>();
  function walk(parentKey: string, depth: number) {
    for (const r of byParent.get(parentKey) || []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      ordered.push({ req: r, depth });
      walk(r.id, depth + 1);
    }
  }
  walk("__root__", 0);
  for (const r of requirements) {
    if (!seen.has(r.id)) ordered.push({ req: r, depth: r.parentId ? 1 : 0 });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requirements"
        description="System requirements with trace links into the engineering boards and swim lanes — coverage and verification at a glance"
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          title="Active requirements"
          value={stats.total}
          icon={ListChecks}
          accent="teal"
        />
        <StatCard
          title="Traced to work"
          value={`${stats.covered}%`}
          subtitle={`${stats.coveredCount} of ${stats.total} linked`}
          icon={Link2}
          accent={stats.covered >= 80 ? "emerald" : "amber"}
        />
        <StatCard
          title="Verified"
          value={stats.verified}
          subtitle="Method recorded"
          icon={ShieldCheck}
          accent="emerald"
        />
        <StatCard
          title="Uncovered"
          value={stats.uncovered}
          subtitle="No engineering trace yet"
          icon={CircleAlert}
          accent={stats.uncovered > 0 ? "red" : "emerald"}
        />
      </div>

      <form className="flex flex-wrap items-center gap-2" action="/requirements">
        <select
          name="product"
          className={`${selectClass} h-9`}
          defaultValue={productFilter}
        >
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <select
          name="status"
          className={`${selectClass} h-9`}
          defaultValue={statusFilter}
        >
          <option value="">All statuses</option>
          {["DRAFT", "IN_REVIEW", "APPROVED", "VERIFIED", "WAIVED", "OBSOLETE"].map(
            (s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            )
          )}
        </select>
        <Button type="submit" size="sm" variant="outline">
          Filter
        </Button>
      </form>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Requirement tree ({requirements.length})
          </CardTitle>
          <p className="text-xs text-slate-500">
            Trace each requirement to the board task or swim-lane saga that
            implements it. Verification closes the loop — TEST-method
            requirements can call out a controlled test procedure.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {ordered.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              No requirements yet{canEdit ? " — add the first one below." : "."}
            </p>
          )}
          {ordered.map(({ req: r, depth }) => (
            <div
              key={r.id}
              className={`rounded-xl border p-3 ${
                r.status === "VERIFIED"
                  ? "border-emerald-900/40"
                  : r.traces.length === 0 &&
                      !["OBSOLETE", "WAIVED"].includes(r.status)
                    ? "border-rose-900/40"
                    : "border-slate-800"
              }`}
              style={{ marginLeft: `${Math.min(depth, 4) * 22}px` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    {depth > 0 && <span className="text-slate-600">└</span>}
                    <span className="font-mono text-teal-400">{r.number}</span>
                    <span className="font-medium text-slate-200">
                      {r.title}
                    </span>
                    <StatusBadge status={r.status} />
                    <StatusBadge status={r.category} />
                    {r.priority !== "NORMAL" && (
                      <StatusBadge status={r.priority} />
                    )}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">{r.statement}</p>
                  <p className="mt-1 text-[11px] text-slate-600">
                    {r.product ? `${r.product.code} · ` : ""}
                    {r.project ? `${r.project.number} · ` : ""}
                    {r.source ? `Source: ${r.source} · ` : ""}
                    {r.verificationMethod
                      ? `Verify by ${r.verificationMethod.toLowerCase()}`
                      : "No verification method"}
                    {r.testProcedure && (
                      <>
                        {" · "}
                        <Link
                          href="/test-procedures"
                          className="text-sky-400 hover:underline"
                        >
                          {r.testProcedure.number} Rev {r.testProcedure.revision}
                        </Link>
                      </>
                    )}
                    {r.rationale ? ` · Rationale: ${r.rationale}` : ""}
                  </p>
                </div>

                {canEdit && (
                  <form
                    action={actionUpdateRequirementStatus}
                    className="flex items-center gap-1.5"
                  >
                    <input type="hidden" name="requirementId" value={r.id} />
                    <select
                      name="status"
                      className={selectClass}
                      defaultValue={r.status}
                    >
                      {["DRAFT", "IN_REVIEW", "APPROVED", "VERIFIED", "WAIVED", "OBSOLETE"].map(
                        (s) => (
                          <option key={s} value={s}>
                            {s.replace(/_/g, " ")}
                          </option>
                        )
                      )}
                    </select>
                    <select
                      name="verificationMethod"
                      className={selectClass}
                      defaultValue={r.verificationMethod || ""}
                    >
                      <option value="">Verify by…</option>
                      {VERIFICATION_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                    >
                      Save
                    </Button>
                  </form>
                )}
              </div>

              {/* Trace chips */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {r.traces.map((t) => (
                  <span
                    key={t.id}
                    className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px]"
                  >
                    {t.engTask ? (
                      <Link
                        href={`/engineering/tasks/${t.engTask.id}`}
                        className="font-mono text-violet-400 hover:underline"
                      >
                        {t.engTask.number}
                      </Link>
                    ) : t.saga ? (
                      <Link
                        href="/engineering"
                        className="font-mono text-sky-400 hover:underline"
                      >
                        {t.saga.number} · {t.saga.discipline}
                      </Link>
                    ) : null}
                    <span className="text-slate-500">
                      {(t.engTask || t.saga)?.status.replace(/_/g, " ")}
                    </span>
                    {canEdit && (
                      <form action={actionRemoveRequirementTrace}>
                        <input type="hidden" name="traceId" value={t.id} />
                        <button
                          type="submit"
                          className="text-slate-600 hover:text-rose-400"
                          aria-label="Remove trace"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </form>
                    )}
                  </span>
                ))}
                {r.traces.length === 0 &&
                  !["OBSOLETE", "WAIVED"].includes(r.status) && (
                    <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                      NOT TRACED
                    </span>
                  )}
                {canEdit && (
                  <form
                    action={actionLinkRequirementWork}
                    className="flex items-center gap-1"
                  >
                    <input type="hidden" name="requirementId" value={r.id} />
                    <select
                      name="target"
                      required
                      className={selectClass}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Trace to…
                      </option>
                      <optgroup label="Swim lanes / sagas">
                        {sagas.map((s) => (
                          <option key={s.id} value={`saga:${s.id}`}>
                            {s.number} {s.name} ({s.discipline})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Board tasks">
                        {engTasks.map((t) => (
                          <option key={t.id} value={`task:${t.id}`}>
                            {t.number} {t.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      className="h-8 px-2 text-xs"
                    >
                      Link
                    </Button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {canEdit && (
        <Card className="border-teal-900/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">New requirement</CardTitle>
            <p className="text-xs text-slate-500">
              Children inherit the parent&apos;s product / program unless set
              explicitly.
            </p>
          </CardHeader>
          <CardContent>
            <form
              action={actionCreateRequirement}
              className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            >
              <Input
                name="title"
                required
                placeholder="Title *"
                className="h-9 lg:col-span-2"
              />
              <select name="category" className={`${selectClass} h-9`} defaultValue="FUNCTIONAL">
                {REQ_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select name="priority" className={`${selectClass} h-9`} defaultValue="NORMAL">
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="CRITICAL">Critical</option>
              </select>
              <Textarea
                name="statement"
                required
                rows={2}
                placeholder='Statement * — "The system shall …"'
                className="lg:col-span-4"
              />
              <Input
                name="rationale"
                placeholder="Rationale (optional)"
                className="h-9 lg:col-span-2"
              />
              <Input
                name="source"
                placeholder="Source (SOW, standard…)"
                className="h-9"
              />
              <select
                name="verificationMethod"
                className={`${selectClass} h-9`}
                defaultValue=""
              >
                <option value="">Verify by…</option>
                {VERIFICATION_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <select name="parentId" className={`${selectClass} h-9 lg:col-span-2`} defaultValue="">
                <option value="">Top-level (no parent)</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} — {r.title}
                  </option>
                ))}
              </select>
              <select name="productId" className={`${selectClass} h-9`} defaultValue="">
                <option value="">Product…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code}
                  </option>
                ))}
              </select>
              <select name="projectId" className={`${selectClass} h-9`} defaultValue="">
                <option value="">Program…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number}
                  </option>
                ))}
              </select>
              <select
                name="testProcedureId"
                className={`${selectClass} h-9 lg:col-span-3`}
                defaultValue=""
              >
                <option value="">Verifying test procedure (optional)…</option>
                {tps.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.number} Rev {tp.revision} — {tp.title}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" className="h-9">
                Add requirement
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
