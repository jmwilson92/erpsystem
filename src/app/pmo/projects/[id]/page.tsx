import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getProjectDetail, MILESTONE_KINDS } from "@/lib/services/pmo";
import {
  getWbsTree,
  listCampaignsForProject,
} from "@/lib/services/engineering-work";
import { WbsTree } from "@/components/pmo/wbs-tree";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { computeEvm, formatCurrency, formatDate, cn } from "@/lib/utils";
import {
  actionUpdateProjectCharter,
  actionAddProjectRisk,
  actionUpdateProjectRisk,
  actionAddProjectIssue,
  actionUpdateProjectIssue,
  actionUpsertRaci,
  actionDeleteRaci,
  actionAddCommunication,
  actionDeleteCommunication,
  actionAddPmoTask,
  actionUpdatePmoTask,
  actionAddPmoMilestone,
  actionUpdatePmoMilestone,
  actionSaveWikiPage,
  actionCreatePi,
  actionAddPiFeature,
  actionAddCostEntry,
  actionAddProjectRequirement,
  actionSyncReqsToProduct,
  actionSyncMilestonesToProduct,
  actionLinkProductToProject,
  actionCreateWbs,
  actionCreateCampaign,
  actionUpdateCampaign,
  actionCreateEngTask,
  actionAlignBusinessPriority,
  actionCreateBudget,
  actionEnsureProjectWbsChargeCodes,
} from "@/app/actions";
import { ActionLoadingForm } from "@/components/layout/action-loading";
import { listBudgets } from "@/lib/services/budgets";

export const dynamic = "force-dynamic";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "charter", label: "Charter" },
  { id: "wbs", label: "WBS" },
  { id: "budgets", label: "Budgets" },
  { id: "campaigns", label: "Campaigns" },
  { id: "schedule", label: "Gates" },
  { id: "pi", label: "PI planning" },
  { id: "risks", label: "Risks" },
  { id: "issues", label: "Issues" },
  { id: "raci", label: "RACI" },
  { id: "comms", label: "Comms" },
  { id: "requirements", label: "Requirements" },
  { id: "cost", label: "Dev cost" },
  { id: "product", label: "Product" },
  { id: "wiki", label: "Wiki" },
  { id: "reports", label: "Reports" },
] as const;

function dateInput(d: Date | null | undefined) {
  if (!d) return "";
  return new Date(d).toISOString().slice(0, 10);
}

/** Depth-first WBS list (all levels) with indent + root→leaf code path. */
function flattenWbsHierarchy<
  T extends { id: string; code: string; parentId: string | null },
>(nodes: T[]): (T & { depth: number; codePath: string[] })[] {
  const byParent = new Map<string | null, T[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = byParent.get(key) || [];
    list.push(n);
    byParent.set(key, list);
  }
  const out: (T & { depth: number; codePath: string[] })[] = [];
  const walk = (parentId: string | null, depth: number, path: string[]) => {
    const kids = (byParent.get(parentId) || []).slice().sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true })
    );
    for (const k of kids) {
      const codePath = [...path, k.code];
      out.push({ ...k, depth, codePath });
      walk(k.id, depth + 1, codePath);
    }
  };
  walk(null, 0, []);
  // Orphans (broken parent pointer) — still selectable
  for (const n of nodes) {
    if (!out.find((x) => x.id === n.id)) {
      out.push({ ...n, depth: 0, codePath: [n.code] });
    }
  }
  return out;
}

export default async function PmoProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (Array.isArray(sp.tab) ? sp.tab[0] : sp.tab) || "overview";
  const pageSlug =
    (Array.isArray(sp.page) ? sp.page[0] : sp.page) || "home";

  const [
    project,
    users,
    products,
    programs,
    wbsNodes,
    campaigns,
    businessPriorities,
    projectBudgets,
  ] = await Promise.all([
    getProjectDetail(id),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, title: true },
    }),
    prisma.product.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    prisma.program.findMany({ orderBy: { name: "asc" } }),
    getWbsTree(id),
    listCampaignsForProject(id),
    prisma.businessPriority.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { priority: "asc" },
    }),
    listBudgets({ projectId: id }),
  ]);
  if (!project) notFound();

  const { spi, cpi, cv, sv } = computeEvm(
    project.plannedValue,
    project.earnedValue,
    project.actualCost
  );

  const wikiPage =
    project.wikiPages.find((p) => p.slug === pageSlug) ||
    project.wikiPages[0] ||
    null;

  const openRisks = project.risks.filter((r) => r.status !== "CLOSED").length;
  const openIssues = project.issues.filter(
    (i) => !["RESOLVED", "CLOSED"].includes(i.status)
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.number}${
          project.program ? ` · ${project.program.code}` : ""
        }${project.product ? ` · Product ${project.product.code}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {project.product && (
              <Link href={`/products/${project.product.id}`}>
                <Button size="sm" variant="outline">
                  Open product
                </Button>
              </Link>
            )}
            {project.program && (
              <Link href={`/pmo/programs/${project.program.id}`}>
                <Button size="sm" variant="outline">
                  Program
                </Button>
              </Link>
            )}
            <Link href="/pmo">
              <Button size="sm" variant="ghost">
                PMO home
              </Button>
            </Link>
          </div>
        }
      />

      <p className="text-xs text-slate-500">
        <StatusBadge status={project.status} />{" "}
        <span className="ml-1">
          {project.methodology} · PM {project.projectManager?.name || "—"} ·
          Sponsor {project.sponsor?.name || "—"}
        </span>
      </p>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={`/pmo/projects/${project.id}?tab=${t.id}`}
            scroll={false}
            data-no-loading="true"
            prefetch={true}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs sm:text-sm",
              tab === t.id
                ? "bg-slate-800 text-slate-50"
                : "text-slate-400 hover:text-slate-200"
            )}
          >
            {t.label}
            {t.id === "risks" && openRisks > 0 && (
              <span className="ml-1 text-amber-400">{openRisks}</span>
            )}
            {t.id === "issues" && openIssues > 0 && (
              <span className="ml-1 text-rose-400">{openIssues}</span>
            )}
            {t.id === "budgets" && projectBudgets.length > 0 && (
              <span className="ml-1 text-teal-400">{projectBudgets.length}</span>
            )}
          </Link>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: "SPI", value: spi.toFixed(2), good: spi >= 1 },
              { label: "CPI", value: cpi.toFixed(2), good: cpi >= 1 },
              { label: "Budget", value: formatCurrency(project.budgetCost) },
              {
                label: "Dev actual",
                value: formatCurrency(project.developmentActual),
              },
              {
                label: "% complete",
                value: `${project.percentComplete.toFixed(0)}%`,
              },
            ].map((m) => (
              <Card key={m.label} className="border-slate-800">
                <CardContent className="p-3 text-center">
                  <p
                    className={`text-xl font-bold tabular-nums ${
                      m.good === undefined
                        ? "text-slate-100"
                        : m.good
                          ? "text-emerald-400"
                          : "text-amber-400"
                    }`}
                  >
                    {m.value}
                  </p>
                  <p className="text-[10px] text-slate-500">{m.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            SV {formatCurrency(sv)} · CV {formatCurrency(cv)} · Contract{" "}
            {formatCurrency(project.contractValue)} · Dev budget{" "}
            {formatCurrency(project.developmentBudget)} ·{" "}
            {formatDate(project.startDate)} – {formatDate(project.endDate)}
          </p>
          {project.description && (
            <p className="text-sm text-slate-300">{project.description}</p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Upcoming milestones</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {project.milestones.slice(0, 6).map((m) => (
                  <div
                    key={m.id}
                    className="flex justify-between gap-2 text-sm"
                  >
                    <span>
                      <span className="text-[10px] uppercase text-slate-500">
                        {m.kind}
                      </span>{" "}
                      {m.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">
                        {formatDate(m.dueDate)}
                      </span>
                      <StatusBadge status={m.status} />
                    </div>
                  </div>
                ))}
                {project.milestones.length === 0 && (
                  <p className="text-xs text-slate-500">No milestones yet.</p>
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Open risks & issues</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {project.risks
                  .filter((r) => r.status !== "CLOSED")
                  .slice(0, 4)
                  .map((r) => (
                    <div key={r.id} className="flex justify-between gap-2">
                      <span className="text-slate-300">
                        {r.number} {r.title}
                      </span>
                      <span className="text-[10px] text-amber-400">
                        score {r.score}
                      </span>
                    </div>
                  ))}
                {project.issues
                  .filter((i) => !["RESOLVED", "CLOSED"].includes(i.status))
                  .slice(0, 4)
                  .map((i) => (
                    <div key={i.id} className="flex justify-between gap-2">
                      <span className="text-slate-300">
                        {i.number} {i.title}
                      </span>
                      <StatusBadge status={i.priority} />
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── CHARTER ── */}
      {tab === "charter" && (
        <form action={actionUpdateProjectCharter} className="space-y-4">
          <input type="hidden" name="id" value={project.id} />
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Project charter</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-[10px] uppercase text-slate-500">
                  Name
                </label>
                <Input name="name" defaultValue={project.name} className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Charter status
                </label>
                <select
                  name="charterStatus"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.charterStatus}
                >
                  <option value="DRAFT">Draft</option>
                  <option value="APPROVED">Approved</option>
                  <option value="SUPERSEDED">Superseded</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Project status
                </label>
                <select
                  name="status"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.status}
                >
                  <option value="PLANNING">Planning</option>
                  <option value="ACTIVE">Active</option>
                  <option value="ON_HOLD">On hold</option>
                  <option value="COMPLETED">Completed</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Methodology
                </label>
                <select
                  name="methodology"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.methodology}
                >
                  <option value="WATERFALL">Waterfall</option>
                  <option value="AGILE">Agile</option>
                  <option value="HYBRID">Hybrid</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Phase
                </label>
                <select
                  name="phase"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.phase}
                >
                  <option value="INITIATION">Initiation</option>
                  <option value="PLANNING">Planning</option>
                  <option value="EXECUTION">Execution</option>
                  <option value="MONITORING">Monitoring</option>
                  <option value="CLOSURE">Closure</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Program
                </label>
                <select
                  name="programId"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.programId || ""}
                >
                  <option value="">—</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Product
                </label>
                <select
                  name="productId"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.productId || ""}
                >
                  <option value="">—</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Sponsor
                </label>
                <select
                  name="sponsorId"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.sponsorId || ""}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">PM</label>
                <select
                  name="projectManagerId"
                  className={`${selectClass} mt-1`}
                  defaultValue={project.projectManagerId || ""}
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
              {(
                [
                  ["businessCase", "Business case", project.businessCase],
                  ["objectives", "Objectives", project.objectives],
                  ["scopeIn", "Scope in", project.scopeIn],
                  ["scopeOut", "Scope out", project.scopeOut],
                  ["successCriteria", "Success criteria", project.successCriteria],
                  ["assumptions", "Assumptions", project.assumptions],
                  ["constraints", "Constraints", project.constraints],
                  ["deliverables", "Deliverables", project.deliverables],
                  [
                    "stakeholdersSummary",
                    "Stakeholders",
                    project.stakeholdersSummary,
                  ],
                ] as const
              ).map(([name, label, val]) => (
                <div key={name} className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    {label}
                  </label>
                  <Textarea
                    name={name}
                    rows={2}
                    className="mt-1"
                    defaultValue={val || ""}
                  />
                </div>
              ))}
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Contract value
                </label>
                <Input
                  name="contractValue"
                  type="number"
                  step="0.01"
                  defaultValue={project.contractValue}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Budget
                </label>
                <Input
                  name="budgetCost"
                  type="number"
                  step="0.01"
                  defaultValue={project.budgetCost}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Dev / NRE budget
                </label>
                <Input
                  name="developmentBudget"
                  type="number"
                  step="0.01"
                  defaultValue={project.developmentBudget}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">
                  Start / End
                </label>
                <div className="mt-1 flex gap-2">
                  <Input
                    name="startDate"
                    type="date"
                    defaultValue={dateInput(project.startDate)}
                  />
                  <Input
                    name="endDate"
                    type="date"
                    defaultValue={dateInput(project.endDate)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
          <Button type="submit">Save charter</Button>
        </form>
      )}

      {/* ── WBS ── */}
      {tab === "wbs" && (() => {
        const flatWbs = flattenWbsHierarchy(wbsNodes);
        return (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Deliverable-oriented work breakdown (PMBOK). Expand line items;
            open an element for the full WBS dictionary (scope, acceptance,
            resources). Campaigns hang off work packages. Adding a child under
            a parent auto-creates its charge code (
            <span className="font-mono text-teal-400">
              Project-1.0-1.1
            </span>
            ).
          </p>
          <WbsTree
            nodes={wbsNodes.map((n) => ({
              id: n.id,
              code: n.code,
              name: n.name,
              kind: n.kind,
              parentId: n.parentId,
              level: n.level,
              status: n.status,
              budgetCost: n.budgetCost,
              actualCost: n.actualCost,
              percentComplete: n.percentComplete,
              description: n.description,
              _count: n._count,
              campaigns: n.campaigns,
            }))}
          />
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add WBS element</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateWbs}
                className="grid gap-2 sm:grid-cols-3"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <div className="sm:col-span-3">
                  <label className="text-[10px] uppercase text-slate-500">
                    Parent (pick a level to nest under — all levels listed)
                  </label>
                  <select name="parentId" className={`${selectClass} mt-1 font-mono text-xs`}>
                    <option value="">— Root (top level, e.g. 1.0) —</option>
                    {flatWbs.map((n) => (
                      <option key={n.id} value={n.id}>
                        {"\u00A0".repeat(n.depth * 2)}
                        {n.codePath.join(" › ")} · {n.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Input name="code" required placeholder="Code e.g. 1.1 or 2.3.1" className="font-mono self-end" />
                <Input name="name" required placeholder="Name" className="self-end" />
                <select name="kind" className={selectClass} defaultValue="WORK_PACKAGE">
                  <option value="SUMMARY">Summary</option>
                  <option value="CONTROL_ACCOUNT">Control account</option>
                  <option value="WORK_PACKAGE">Work package</option>
                  <option value="PLANNING_PACKAGE">Planning package</option>
                </select>
                <Input name="budgetCost" type="number" placeholder="Budget" />
                <Button type="submit" size="sm" className="self-end">
                  Add element
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
        );
      })()}

      {/* ── BUDGETS / CHARGE CODES (per WBS + contract/production) ── */}
      {tab === "budgets" && (() => {
        const flatWbs = flattenWbsHierarchy(wbsNodes);
        const projSlug = (project.name || project.number)
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^A-Za-z0-9._-]/g, "")
          .slice(0, 32);

        const wbsBudgets = projectBudgets
          .filter((b) => b.wbsElementId)
          .slice()
          .sort((a, b) =>
            (a.wbsElement?.code || "").localeCompare(
              b.wbsElement?.code || "",
              undefined,
              { numeric: true }
            )
          );
        const contractBudgets = projectBudgets.filter((b) => !b.wbsElementId);

        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="max-w-3xl text-xs text-slate-500">
                <strong className="text-slate-400">DIRECT</strong> project
                charge codes. WBS scheme:{" "}
                <span className="font-mono text-teal-400">
                  ProjectName-1.0-1.1
                </span>
                . Contract / production codes cover work sold on the contract
                but run by production (no WBS). Owner approves time + material
                PRs. Separate from Dev cost (NRE).
              </p>
              <ActionLoadingForm
                theme="planning"
                action={actionEnsureProjectWbsChargeCodes}
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Generate missing WBS codes
                </Button>
              </ActionLoadingForm>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="border-teal-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    WBS charge code
                  </CardTitle>
                  <p className="text-[11px] text-slate-500">
                    All WBS levels listed (indented). Code defaults to
                    ProjectName-parent-child.
                  </p>
                </CardHeader>
                <CardContent>
                  <ActionLoadingForm
                    theme="creating"
                    action={actionCreateBudget}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="sourceType" value="PROJECT" />
                    <input type="hidden" name="projectId" value={project.id} />
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-500">
                        WBS * (all levels)
                      </label>
                      <select
                        name="wbsElementId"
                        required
                        className={`${selectClass} mt-1 font-mono text-xs`}
                        size={Math.min(12, Math.max(6, flatWbs.length + 1))}
                      >
                        <option value="">— Select WBS (all levels) —</option>
                        {flatWbs.map((n) => {
                          const preview = projSlug
                            ? `${projSlug}-${n.codePath.join("-")}`
                            : n.codePath.join("-");
                          return (
                            <option key={n.id} value={n.id}>
                              {"\u00A0".repeat(n.depth * 2)}
                              {n.codePath.join(" › ")} · {n.name}
                              {"  →  "}
                              {preview}
                            </option>
                          );
                        })}
                      </select>
                      {!flatWbs.length && (
                        <p className="mt-1 text-[11px] text-amber-400">
                          No WBS yet — add elements on the WBS tab first
                          (choose a parent to nest sub-levels).
                        </p>
                      )}
                      {flatWbs.length > 0 &&
                        !flatWbs.some((n) => n.depth > 0) && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            Only top-level WBS so far. On the WBS tab, set
                            Parent to nest 1.1 under 1.0, etc. — then codes
                            appear here as Project-1.0-1.1.
                          </p>
                        )}
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-500">
                        Display name
                      </label>
                      <Input
                        name="name"
                        required
                        className="mt-1"
                        placeholder={`${project.name} · WBS labor`}
                        defaultValue={`${project.name} WBS budget`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Owner *
                      </label>
                      <select
                        name="ownerId"
                        required
                        className={`${selectClass} mt-1`}
                        defaultValue={project.projectManagerId || ""}
                      >
                        <option value="">— Select —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.title ? ` · ${u.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Charge code override
                      </label>
                      <Input
                        name="chargeCode"
                        className="mt-1 font-mono text-xs"
                        placeholder="Auto: Project-1.0-1.1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Labor hours
                      </label>
                      <Input
                        name="laborHoursBudget"
                        type="number"
                        step="0.5"
                        min={0}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Material $
                      </label>
                      <Input
                        name="materialBudget"
                        type="number"
                        step="0.01"
                        min={0}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          name="enact"
                          defaultChecked
                          className="rounded border-slate-600"
                        />
                        Enact now
                      </label>
                      <Button type="submit" size="sm">
                        Create WBS code
                      </Button>
                    </div>
                  </ActionLoadingForm>
                </CardContent>
              </Card>

              <Card className="border-amber-900/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Contract / production charge code
                  </CardTitle>
                  <p className="text-[11px] text-slate-500">
                    Work sold on this contract but run by production (or other
                    non-WBS scope). No WBS required — charge code defaults to
                    ProjectName-YourName.
                  </p>
                </CardHeader>
                <CardContent>
                  <ActionLoadingForm
                    theme="creating"
                    action={actionCreateBudget}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    <input type="hidden" name="sourceType" value="PROJECT" />
                    <input type="hidden" name="projectId" value={project.id} />
                    {/* no wbsElementId = contract/production channel */}
                    <div className="sm:col-span-2">
                      <label className="text-[10px] uppercase text-slate-500">
                        Name / charge code base *
                      </label>
                      <Input
                        name="name"
                        required
                        className="mt-1"
                        placeholder="Production-LRIP or Contract-Build"
                        defaultValue="Production"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Owner *
                      </label>
                      <select
                        name="ownerId"
                        required
                        className={`${selectClass} mt-1`}
                        defaultValue={project.projectManagerId || ""}
                      >
                        <option value="">— Select —</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.title ? ` · ${u.title}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Charge code override
                      </label>
                      <Input
                        name="chargeCode"
                        className="mt-1 font-mono text-xs"
                        placeholder={`${project.name.replace(/\s+/g, "-")}-Production`}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Labor hours
                      </label>
                      <Input
                        name="laborHoursBudget"
                        type="number"
                        step="0.5"
                        min={0}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase text-slate-500">
                        Material $
                      </label>
                      <Input
                        name="materialBudget"
                        type="number"
                        step="0.01"
                        min={0}
                        className="mt-1"
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-xs text-slate-400">
                        <input
                          type="checkbox"
                          name="enact"
                          defaultChecked
                          className="rounded border-slate-600"
                        />
                        Enact now
                      </label>
                      <Button type="submit" size="sm" variant="secondary">
                        Create contract / production code
                      </Button>
                    </div>
                  </ActionLoadingForm>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                WBS charge codes ({wbsBudgets.length})
              </h3>
              {wbsBudgets.map((b) => {
                const pct =
                  b.totalAmount > 0
                    ? Math.round((b.actualTotal / b.totalAmount) * 1000) / 10
                    : 0;
                return (
                  <Link key={b.id} href={`/budgets/${b.id}`}>
                    <Card className="mb-2 transition-colors hover:border-teal-500/30">
                      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-mono text-teal-400">
                            {b.chargeCode || b.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {b.wbsElement
                              ? `WBS ${b.wbsElement.code} · ${b.wbsElement.name}`
                              : "WBS"}
                            {b.owner ? ` · ${b.owner.name}` : ""}
                          </p>
                        </div>
                        <div className="text-right">
                          <StatusBadge status={b.status} />
                          <p className="mt-1 text-xs tabular-nums text-slate-400">
                            {b.actualLaborHours}h ·{" "}
                            {formatCurrency(b.actualTotal)} /{" "}
                            {formatCurrency(b.totalAmount)} ({pct}%)
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
              {!wbsBudgets.length && (
                <p className="text-sm text-slate-500">
                  No WBS codes yet — use Generate missing WBS codes or create
                  above.
                </p>
              )}

              <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Contract / production codes ({contractBudgets.length})
              </h3>
              {contractBudgets.map((b) => (
                <Link key={b.id} href={`/budgets/${b.id}`}>
                  <Card className="mb-2 border-amber-900/30 transition-colors hover:border-amber-500/30">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <p className="font-mono text-amber-300">
                          {b.chargeCode || b.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          Contract / production
                          {b.owner ? ` · ${b.owner.name}` : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={b.status} />
                        <p className="mt-1 text-xs tabular-nums text-slate-400">
                          {b.actualLaborHours}h ·{" "}
                          {formatCurrency(b.actualTotal)}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {!contractBudgets.length && (
                <p className="text-sm text-slate-500">
                  No contract/production codes — create one for production work
                  sold on this contract.
                </p>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── CAMPAIGNS ── */}
      {tab === "campaigns" && (
        <div className="space-y-4">
          {campaigns.map((c) => (
            <Card key={c.id} className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="font-mono text-violet-300">{c.number}</span>
                  {c.name}
                  <StatusBadge status={c.status} />
                  {c.wbsElement && (
                    <Link
                      href={`/pmo/wbs/${c.wbsElement.id}`}
                      className="text-xs font-normal text-teal-400 hover:underline"
                    >
                      WBS {c.wbsElement.code}
                    </Link>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.description && (
                  <p className="text-sm text-slate-400">{c.description}</p>
                )}
                {c.definitionOfDone && (
                  <div className="rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-400">
                    <span className="text-[10px] uppercase text-slate-500">
                      Definition of Done
                    </span>
                    <p className="mt-0.5 whitespace-pre-wrap">{c.definitionOfDone}</p>
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-xs text-slate-500">
                  <span>
                    {formatDate(c.startDate)} – {formatDate(c.endDate)}
                  </span>
                  <span>
                    Est {c.estimatedHours}h · Act {c.actualHours}h ·{" "}
                    {c.storyPoints} pts · {c.percentComplete}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={actionUpdateCampaign} className="flex gap-2">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={c.id} />
                    <select
                      name="status"
                      defaultValue={c.status}
                      className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                    >
                      <option value="BACKLOG">BACKLOG</option>
                      <option value="PLANNED">PLANNED</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="BLOCKED">BLOCKED</option>
                      <option value="DONE">DONE</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Update status
                    </Button>
                  </form>
                  <form
                    action={actionAlignBusinessPriority}
                    className="flex gap-2"
                  >
                    <input type="hidden" name="entityType" value="Campaign" />
                    <input type="hidden" name="entityId" value={c.id} />
                    <select
                      name="businessPriorityId"
                      defaultValue={c.businessPriorityId || "UNRATED"}
                      className="h-8 max-w-[14rem] rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                    >
                      <option value="UNRATED">Unrated</option>
                      {businessPriorities.map((bp) => (
                        <option key={bp.id} value={bp.id}>
                          {bp.number} — {bp.title}
                        </option>
                      ))}
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Align priority
                    </Button>
                  </form>
                </div>

                {/* Sagas */}
                <div className="space-y-2 border-t border-slate-800 pt-3">
                  <p className="text-[10px] uppercase text-slate-500">
                    Engineering sagas
                  </p>
                  {c.sagas.map((s) => (
                    <div
                      key={s.id}
                      className="rounded border border-slate-800/80 bg-slate-950/30 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-mono text-sky-400">{s.number}</span>
                        <span className="text-slate-200">{s.name}</span>
                        <StatusBadge status={s.discipline} />
                        <StatusBadge status={s.status} />
                        <span className="text-[10px] text-slate-500">
                          {s.engTasks.length} tasks · due {formatDate(s.dueDate)}
                        </span>
                      </div>
                      {s.definitionOfDone && (
                        <p className="mt-1 text-[11px] text-slate-500">
                          DoD: {s.definitionOfDone}
                        </p>
                      )}
                      <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
                        {s.engTasks.map((t) => (
                          <li key={t.id} className="flex justify-between gap-2">
                            <span>
                              <span className="font-mono text-slate-500">
                                {t.number}
                              </span>{" "}
                              {t.name}
                              {t.children.length > 0 && (
                                <span className="text-slate-600">
                                  {" "}
                                  (+{t.children.length} sub)
                                </span>
                              )}
                            </span>
                            <StatusBadge status={t.status} />
                          </li>
                        ))}
                      </ul>
                      <form
                        action={actionCreateEngTask}
                        className="mt-2 flex flex-wrap gap-1"
                      >
                        <input type="hidden" name="projectId" value={project.id} />
                        <input type="hidden" name="sagaId" value={s.id} />
                        <input type="hidden" name="campaignId" value={c.id} />
                        <input
                          type="hidden"
                          name="returnTo"
                          value={`/pmo/projects/${project.id}?tab=campaigns`}
                        />
                        <Input
                          name="name"
                          required
                          placeholder="New task"
                          className="h-8 max-w-xs text-xs"
                        />
                        <Input
                          name="estimatedHours"
                          type="number"
                          placeholder="Hrs"
                          className="h-8 w-16 text-xs"
                        />
                        <Button type="submit" size="sm" variant="outline">
                          + Task
                        </Button>
                      </form>
                    </div>
                  ))}
                  <p className="text-xs text-slate-500 rounded border border-dashed border-slate-700 p-2">
                    Sagas are created in Engineering swim lanes to satisfy campaigns — not in PMO.
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">New campaign</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionCreateCampaign}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="name"
                  required
                  placeholder="Campaign name"
                  className="sm:col-span-2"
                />
                <select name="wbsElementId" className={selectClass}>
                  <option value="">— WBS link (optional) —</option>
                  {wbsNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.code} {n.name}
                    </option>
                  ))}
                </select>
                <select name="priority" className={selectClass} defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                <Input name="startDate" type="date" />
                <Input name="endDate" type="date" />
                <Input name="dueDate" type="date" />
                <Input name="storyPoints" type="number" placeholder="Points" />
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="Description"
                  className="sm:col-span-2"
                />
                <Textarea
                  name="definitionOfDone"
                  rows={2}
                  placeholder="Campaign Definition of Done"
                  className="sm:col-span-2"
                />
                <Button type="submit" size="sm">
                  Create campaign
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── REPORTS link ── */}
      {tab === "reports" && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Burndown, discipline throughput, and cost burn for leaders.
          </p>
          <Link href={`/pmo/projects/${project.id}/reports`}>
            <Button>Open full reports dashboard</Button>
          </Link>
        </div>
      )}

      {/* ── SCHEDULE ── */}
      {tab === "schedule" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Gates & milestones (PDR / CDR / …)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.milestones.map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1.5 text-sm"
                >
                  <div>
                    <span className="text-[10px] uppercase text-violet-400">
                      {m.kind}
                    </span>{" "}
                    {m.name}
                    <span className="ml-2 text-xs text-slate-500">
                      {formatDate(m.dueDate)}
                    </span>
                  </div>
                  <form action={actionUpdatePmoMilestone} className="flex gap-1">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={m.id} />
                    <select
                      name="status"
                      defaultValue={m.status}
                      className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                    >
                      <option value="PENDING">PENDING</option>
                      <option value="ACHIEVED">ACHIEVED</option>
                      <option value="MISSED">MISSED</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </div>
              ))}
              <form
                action={actionAddPmoMilestone}
                className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-4"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input name="name" required placeholder="Milestone name" />
                <select name="kind" className={selectClass} defaultValue="PDR">
                  {MILESTONE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <Input name="dueDate" type="date" />
                <Button type="submit" size="sm">
                  Add gate
                </Button>
              </form>
              {project.productId && (
                <form action={actionSyncMilestonesToProduct}>
                  <input type="hidden" name="projectId" value={project.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    Push gates → product PLM
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tasks / backlog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {project.tasks.map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 px-2 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase text-slate-500">
                      {t.kind}
                    </span>{" "}
                    <span className="text-slate-200">{t.name}</span>
                    {t.sprintLabel && (
                      <span className="ml-2 text-[10px] text-sky-400">
                        {t.sprintLabel}
                      </span>
                    )}
                    {t.storyPoints != null && (
                      <span className="ml-1 text-[10px] text-slate-500">
                        {t.storyPoints} pts
                      </span>
                    )}
                    <div className="mt-0.5 w-40">
                      <Progress value={t.percentComplete} className="h-1" />
                    </div>
                  </div>
                  <form action={actionUpdatePmoTask} className="flex gap-1">
                    <input type="hidden" name="projectId" value={project.id} />
                    <input type="hidden" name="id" value={t.id} />
                    <select
                      name="status"
                      defaultValue={t.status}
                      className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                    >
                      <option value="TODO">TODO</option>
                      <option value="IN_PROGRESS">IN_PROGRESS</option>
                      <option value="BLOCKED">BLOCKED</option>
                      <option value="DONE">DONE</option>
                    </select>
                    <Button type="submit" size="sm" variant="outline">
                      Save
                    </Button>
                  </form>
                </div>
              ))}
              <form
                action={actionAddPmoTask}
                className="grid gap-2 border-t border-slate-800 pt-3 sm:grid-cols-3"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="name"
                  required
                  placeholder="Task / story name"
                  className="sm:col-span-2"
                />
                <select name="kind" className={selectClass} defaultValue="TASK">
                  <option value="TASK">Task</option>
                  <option value="STORY">Story</option>
                  <option value="SPIKE">Spike</option>
                  <option value="ENABLER">Enabler</option>
                  <option value="BUG">Bug</option>
                </select>
                <Input name="sprintLabel" placeholder="Sprint / iteration" />
                <Input
                  name="storyPoints"
                  type="number"
                  step="0.5"
                  placeholder="Points"
                />
                <Input name="estimatedHours" type="number" placeholder="Hours" />
                <Input name="startDate" type="date" />
                <Input name="endDate" type="date" />
                <Button type="submit" size="sm">
                  Add task
                </Button>
              </form>
            </CardContent>
          </Card>

          {project.wbsElements.length > 0 && (
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">WBS</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {project.wbsElements.map((w) => (
                  <div key={w.id}>
                    <div className="flex justify-between text-sm">
                      <span className="font-mono text-teal-400">{w.code}</span>
                      <span className="text-slate-300">{w.name}</span>
                      <span className="tabular-nums text-slate-500">
                        {formatCurrency(w.actualCost)} /{" "}
                        {formatCurrency(w.budgetCost)}
                      </span>
                    </div>
                    <Progress value={w.percentComplete} className="mt-1 h-1" />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── PI PLANNING ── */}
      {tab === "pi" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Program Increment planning for agile / hybrid projects — goals,
            capacity, and feature commitments.
          </p>
          {project.piIncrements.map((pi) => (
            <Card key={pi.id} className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  PI {pi.number}: {pi.name}
                  <StatusBadge status={pi.status} />
                  <span className="text-xs font-normal text-slate-500">
                    {formatDate(pi.startDate)} – {formatDate(pi.endDate)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pi.goals && (
                  <p className="text-sm text-slate-400 whitespace-pre-wrap">
                    {pi.goals}
                  </p>
                )}
                <p className="text-xs text-slate-500">
                  Capacity {pi.capacityPoints ?? "—"} pts · Committed{" "}
                  {pi.committedPoints ?? "—"} pts
                </p>
                {pi.features.map((f) => (
                  <div
                    key={f.id}
                    className="flex justify-between rounded border border-slate-800 px-2 py-1 text-sm"
                  >
                    <span>
                      {f.name}
                      {f.storyPoints != null && (
                        <span className="ml-2 text-[10px] text-slate-500">
                          {f.storyPoints} pts
                        </span>
                      )}
                    </span>
                    <StatusBadge status={f.status} />
                  </div>
                ))}
                <form
                  action={actionAddPiFeature}
                  className="flex flex-wrap gap-2 border-t border-slate-800 pt-2"
                >
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="piId" value={pi.id} />
                  <Input name="name" required placeholder="Feature" className="max-w-xs" />
                  <Input
                    name="storyPoints"
                    type="number"
                    placeholder="Pts"
                    className="w-20"
                  />
                  <Button type="submit" size="sm">
                    Add feature
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Plan next PI</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionCreatePi} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="projectId" value={project.id} />
                <Input name="name" required placeholder="PI name e.g. PI-3" />
                <Input
                  name="capacityPoints"
                  type="number"
                  placeholder="Capacity points"
                />
                <Input name="startDate" type="date" />
                <Input name="endDate" type="date" />
                <Textarea
                  name="goals"
                  rows={2}
                  className="sm:col-span-2"
                  placeholder="PI goals / objectives"
                />
                <Button type="submit" size="sm">
                  Create PI
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── RISKS ── */}
      {tab === "risks" && (
        <div className="space-y-4">
          {project.risks.map((r) => (
            <Card key={r.id} className="border-slate-800">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-amber-300">
                    {r.number}
                  </span>
                  <span className="font-medium text-slate-100">{r.title}</span>
                  <StatusBadge status={r.status} />
                  <span className="text-[10px] text-slate-500">
                    P={r.probability} I={r.impact} score={r.score}
                  </span>
                </div>
                {r.description && (
                  <p className="text-xs text-slate-400">{r.description}</p>
                )}
                {r.mitigation && (
                  <p className="text-xs text-teal-400/90">
                    Mitigation: {r.mitigation}
                  </p>
                )}
                {r.contingency && (
                  <p className="text-xs text-sky-400/80">
                    Contingency: {r.contingency}
                  </p>
                )}
                <form action={actionUpdateProjectRisk} className="flex gap-2">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="id" value={r.id} />
                  <select
                    name="status"
                    defaultValue={r.status}
                    className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="MITIGATING">MITIGATING</option>
                    <option value="ACCEPTED">ACCEPTED</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Update
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Log risk</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProjectRisk}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="title"
                  required
                  placeholder="Risk title"
                  className="sm:col-span-2"
                />
                <Textarea
                  name="description"
                  rows={2}
                  placeholder="Description"
                  className="sm:col-span-2"
                />
                <select name="category" className={selectClass}>
                  <option value="TECHNICAL">Technical</option>
                  <option value="SCHEDULE">Schedule</option>
                  <option value="COST">Cost</option>
                  <option value="SUPPLY">Supply</option>
                  <option value="QUALITY">Quality</option>
                  <option value="OTHER">Other</option>
                </select>
                <div className="flex gap-2">
                  <select name="probability" className={selectClass} defaultValue="MEDIUM">
                    <option value="LOW">P Low</option>
                    <option value="MEDIUM">P Med</option>
                    <option value="HIGH">P High</option>
                  </select>
                  <select name="impact" className={selectClass} defaultValue="MEDIUM">
                    <option value="LOW">I Low</option>
                    <option value="MEDIUM">I Med</option>
                    <option value="HIGH">I High</option>
                  </select>
                </div>
                <Textarea
                  name="mitigation"
                  rows={2}
                  placeholder="Mitigation plan"
                  className="sm:col-span-2"
                />
                <Textarea
                  name="contingency"
                  rows={2}
                  placeholder="Contingency"
                  className="sm:col-span-2"
                />
                <Input name="targetDate" type="date" />
                <Button type="submit" size="sm">
                  Add risk
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── ISSUES ── */}
      {tab === "issues" && (
        <div className="space-y-4">
          {project.issues.map((i) => (
            <Card key={i.id} className="border-slate-800">
              <CardContent className="flex flex-wrap items-start justify-between gap-2 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-rose-300">
                      {i.number}
                    </span>
                    <span className="text-slate-100">{i.title}</span>
                    <StatusBadge status={i.status} />
                    <StatusBadge status={i.priority} />
                  </div>
                  {i.description && (
                    <p className="mt-1 text-xs text-slate-400">{i.description}</p>
                  )}
                  {i.resolution && (
                    <p className="mt-1 text-xs text-teal-400">
                      Resolution: {i.resolution}
                    </p>
                  )}
                </div>
                <form action={actionUpdateProjectIssue} className="flex gap-1">
                  <input type="hidden" name="projectId" value={project.id} />
                  <input type="hidden" name="id" value={i.id} />
                  <select
                    name="status"
                    defaultValue={i.status}
                    className="h-8 rounded border border-slate-700 bg-slate-950 px-1 text-[11px]"
                  >
                    <option value="OPEN">OPEN</option>
                    <option value="IN_PROGRESS">IN_PROGRESS</option>
                    <option value="RESOLVED">RESOLVED</option>
                    <option value="CLOSED">CLOSED</option>
                  </select>
                  <Button type="submit" size="sm" variant="outline">
                    Save
                  </Button>
                </form>
              </CardContent>
            </Card>
          ))}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Log issue</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProjectIssue}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input name="title" required className="sm:col-span-2" />
                <Textarea name="description" rows={2} className="sm:col-span-2" />
                <select name="priority" className={selectClass} defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                <Button type="submit" size="sm">
                  Add issue
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── RACI ── */}
      {tab === "raci" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Activity</th>
                    <th className="px-3 py-2">R</th>
                    <th className="px-3 py-2">A</th>
                    <th className="px-3 py-2">C</th>
                    <th className="px-3 py-2">I</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {project.raciEntries.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800/80">
                      <td className="px-3 py-2 text-slate-200">{row.activity}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.responsible || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.accountable || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.consulted || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.informed || "—"}
                      </td>
                      <td className="px-3 py-2">
                        <form action={actionDeleteRaci}>
                          <input
                            type="hidden"
                            name="projectId"
                            value={project.id}
                          />
                          <input type="hidden" name="id" value={row.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-rose-400"
                          >
                            ×
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add RACI row</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionUpsertRaci} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="projectId" value={project.id} />
                <Input
                  name="activity"
                  required
                  placeholder="Activity / deliverable"
                  className="sm:col-span-2"
                />
                <Input name="responsible" placeholder="Responsible (R)" />
                <Input name="accountable" placeholder="Accountable (A)" />
                <Input name="consulted" placeholder="Consulted (C)" />
                <Input name="informed" placeholder="Informed (I)" />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── COMMS ── */}
      {tab === "comms" && (
        <div className="space-y-4">
          <Card className="border-slate-800">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Audience</th>
                    <th className="px-3 py-2">Purpose</th>
                    <th className="px-3 py-2">Frequency</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Owner</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {project.communications.map((c) => (
                    <tr key={c.id} className="border-b border-slate-800/80">
                      <td className="px-3 py-2 text-slate-200">{c.audience}</td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {c.purpose || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">{c.frequency || "—"}</td>
                      <td className="px-3 py-2 text-xs">{c.channel || "—"}</td>
                      <td className="px-3 py-2 text-xs">{c.ownerName || "—"}</td>
                      <td className="px-3 py-2">
                        <form action={actionDeleteCommunication}>
                          <input
                            type="hidden"
                            name="projectId"
                            value={project.id}
                          />
                          <input type="hidden" name="id" value={c.id} />
                          <Button
                            type="submit"
                            size="sm"
                            variant="ghost"
                            className="text-rose-400"
                          >
                            ×
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add communication</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddCommunication}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input name="audience" required placeholder="Audience" />
                <Input name="purpose" placeholder="Purpose" />
                <select name="frequency" className={selectClass}>
                  <option value="WEEKLY">Weekly</option>
                  <option value="DAILY">Daily</option>
                  <option value="BIWEEKLY">Biweekly</option>
                  <option value="MONTHLY">Monthly</option>
                  <option value="MILESTONE">Milestone</option>
                  <option value="AD_HOC">Ad hoc</option>
                </select>
                <select name="channel" className={selectClass}>
                  <option value="MEETING">Meeting</option>
                  <option value="EMAIL">Email</option>
                  <option value="SLACK">Slack</option>
                  <option value="REPORT">Report</option>
                  <option value="WIKI">Wiki</option>
                </select>
                <Input name="ownerName" placeholder="Owner" />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── REQUIREMENTS ── */}
      {tab === "requirements" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {project.productId && (
              <form action={actionSyncReqsToProduct}>
                <input type="hidden" name="projectId" value={project.id} />
                <Button type="submit" size="sm" variant="secondary">
                  Push requirements → product PLM
                </Button>
              </form>
            )}
          </div>
          {project.requirements.map((r) => (
            <div
              key={r.id}
              className="rounded border border-slate-800 px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-violet-300">
                  {r.number}
                </span>
                <span className="text-slate-100">{r.title}</span>
                <StatusBadge status={r.status} />
                {r.productRequirementId && (
                  <span className="text-[10px] text-teal-500">synced</span>
                )}
              </div>
              {r.description && (
                <p className="text-xs text-slate-500">{r.description}</p>
              )}
            </div>
          ))}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Add requirement</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionAddProjectRequirement}
                className="grid gap-2 sm:grid-cols-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <Input name="number" placeholder="Number (auto)" className="font-mono" />
                <select name="category" className={selectClass} defaultValue="FUNCTIONAL">
                  <option value="FUNCTIONAL">Functional</option>
                  <option value="PERFORMANCE">Performance</option>
                  <option value="SAFETY">Safety</option>
                  <option value="REGULATORY">Regulatory</option>
                  <option value="INTERFACE">Interface</option>
                  <option value="OTHER">Other</option>
                </select>
                <Input name="title" required className="sm:col-span-2" />
                <Textarea name="description" rows={2} className="sm:col-span-2" />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── COST ── */}
      {tab === "cost" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="border-slate-800">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold tabular-nums text-slate-100">
                  {formatCurrency(project.developmentBudget)}
                </p>
                <p className="text-xs text-slate-500">Dev budget</p>
              </CardContent>
            </Card>
            <Card className="border-slate-800">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold tabular-nums text-teal-300">
                  {formatCurrency(project.developmentActual)}
                </p>
                <p className="text-xs text-slate-500">Dev actual (entries)</p>
              </CardContent>
            </Card>
            <Card className="border-slate-800">
              <CardContent className="p-4 text-center">
                <p className="text-xl font-bold tabular-nums text-slate-100">
                  {formatCurrency(
                    project.developmentBudget - project.developmentActual
                  )}
                </p>
                <p className="text-xs text-slate-500">Remaining</p>
              </CardContent>
            </Card>
          </div>
          {project.product && (
            <p className="text-xs text-slate-500">
              Product {project.product.code} NRE rollup: budget{" "}
              {formatCurrency(project.product.developmentBudget)} · actual{" "}
              {formatCurrency(project.product.developmentActual)}
            </p>
          )}
          <Card className="border-slate-800">
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {project.costEntries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-800/80">
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatDate(e.entryDate)}
                      </td>
                      <td className="px-3 py-2 text-xs">{e.category}</td>
                      <td className="px-3 py-2 text-slate-300">
                        {e.description || "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-200">
                        {formatCurrency(e.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Log development cost</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={actionAddCostEntry} className="grid gap-2 sm:grid-cols-3">
                <input type="hidden" name="projectId" value={project.id} />
                <input
                  type="hidden"
                  name="productId"
                  value={project.productId || ""}
                />
                <select name="category" className={selectClass} defaultValue="LABOR">
                  <option value="LABOR">Labor</option>
                  <option value="MATERIAL">Material</option>
                  <option value="NRE">NRE</option>
                  <option value="TOOLING">Tooling</option>
                  <option value="TEST">Test</option>
                  <option value="TRAVEL">Travel</option>
                  <option value="OTHER">Other</option>
                </select>
                <Input name="amount" type="number" step="0.01" required placeholder="Amount" />
                <Input name="hours" type="number" step="0.25" placeholder="Hours" />
                <Input name="entryDate" type="date" />
                <Input
                  name="description"
                  placeholder="Description"
                  className="sm:col-span-2"
                />
                <Button type="submit" size="sm">
                  Add cost
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── PRODUCT LINK ── */}
      {tab === "product" && (
        <div className="space-y-4">
          {project.product ? (
            <Card className="border-teal-900/40">
              <CardContent className="p-4">
                <p className="text-sm text-slate-400">Primary product</p>
                <Link
                  href={`/products/${project.product.id}`}
                  className="text-lg font-semibold text-teal-300 hover:underline"
                >
                  {project.product.code} · {project.product.name}
                </Link>
                <p className="mt-1 text-xs text-slate-500">
                  Lifecycle {project.product.lifecyclePhase} · Dev cost{" "}
                  {formatCurrency(project.product.developmentActual)} / budget{" "}
                  {formatCurrency(project.product.developmentBudget)}
                </p>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-slate-500">
              No primary product linked. Link one below so PDR/CDR and costs
              flow into PLM.
            </p>
          )}
          {project.productLinks.length > 0 && (
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Linked products</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {project.productLinks.map((l) => (
                  <div
                    key={l.id}
                    className="flex justify-between text-sm"
                  >
                    <Link
                      href={`/products/${l.product.id}`}
                      className="text-teal-400 hover:underline"
                    >
                      {l.product.code} · {l.product.name}
                    </Link>
                    <span className="text-[10px] uppercase text-slate-500">
                      {l.role}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Link product</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                action={actionLinkProductToProject}
                className="flex flex-wrap gap-2"
              >
                <input type="hidden" name="projectId" value={project.id} />
                <select name="productId" required className={`${selectClass} max-w-sm`}>
                  <option value="">— Select product —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} · {p.name}
                    </option>
                  ))}
                </select>
                <select name="role" className={selectClass} defaultValue="PRIMARY">
                  <option value="PRIMARY">Primary</option>
                  <option value="ENABLING">Enabling</option>
                  <option value="DERIVATIVE">Derivative</option>
                  <option value="SUSTAINMENT">Sustainment</option>
                </select>
                <Button type="submit" size="sm">
                  Link
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── WIKI ── */}
      {tab === "wiki" && (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="border-slate-800 lg:col-span-3">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {project.wikiPages.map((p) => (
                <Link
                  key={p.id}
                  href={`/pmo/projects/${project.id}?tab=wiki&page=${p.slug}`}
                  className={cn(
                    "block rounded px-2 py-1.5 text-sm",
                    wikiPage?.id === p.id
                      ? "bg-slate-800 text-teal-300"
                      : "text-slate-400 hover:bg-slate-900"
                  )}
                >
                  {p.title}
                </Link>
              ))}
            </CardContent>
          </Card>
          <div className="space-y-4 lg:col-span-9">
            {wikiPage && (
              <Card className="border-slate-800">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{wikiPage.title}</CardTitle>
                  <p className="text-[11px] text-slate-500">
                    /{wikiPage.slug}
                    {wikiPage.updatedBy
                      ? ` · edited by ${wikiPage.updatedBy.name}`
                      : ""}
                  </p>
                </CardHeader>
                <CardContent>
                  <pre className="whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/50 p-4 text-sm text-slate-300 font-sans">
                    {wikiPage.body || "(empty)"}
                  </pre>
                </CardContent>
              </Card>
            )}
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {wikiPage ? "Edit page" : "New page"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={actionSaveWikiPage} className="space-y-2">
                  <input type="hidden" name="projectId" value={project.id} />
                  {wikiPage && (
                    <input type="hidden" name="id" value={wikiPage.id} />
                  )}
                  <Input
                    name="title"
                    required
                    defaultValue={wikiPage?.title || ""}
                    placeholder="Page title"
                  />
                  {!wikiPage && (
                    <Input name="slug" placeholder="slug (optional)" className="font-mono" />
                  )}
                  <Textarea
                    name="body"
                    rows={14}
                    className="font-mono text-sm"
                    defaultValue={wikiPage?.body || ""}
                    placeholder="Markdown content — meeting notes, decisions, design docs…"
                  />
                  <Button type="submit" size="sm">
                    Save page
                  </Button>
                </form>
                {!wikiPage && (
                  <p className="mt-2 text-xs text-slate-500">
                    Or open a page from the sidebar. Create a new page by
                    clearing selection — use title only.
                  </p>
                )}
              </CardContent>
            </Card>
            <Card className="border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">New wiki page</CardTitle>
              </CardHeader>
              <CardContent>
                <form action={actionSaveWikiPage} className="space-y-2">
                  <input type="hidden" name="projectId" value={project.id} />
                  <Input name="title" required placeholder="Title" />
                  <Input name="slug" placeholder="slug" className="font-mono" />
                  <Textarea name="body" rows={6} placeholder="Content…" />
                  <Button type="submit" size="sm">
                    Create page
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
