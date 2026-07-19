import Link from "next/link";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StandalonePrForm } from "@/components/purchasing/standalone-pr-form";

export const dynamic = "force-dynamic";

export default async function NewStandalonePrPage() {
  const [parts, suppliers, projects, wbsElements, budgets, company] =
    await Promise.all([
      prisma.part.findMany({
        where: { isActive: true },
        orderBy: { partNumber: "asc" },
        take: 800,
        select: {
          id: true,
          partNumber: true,
          description: true,
          standardCost: true,
          uom: true,
        },
      }),
      prisma.supplier.findMany({
        where: { status: { in: ["APPROVED", "CONDITIONAL"] } },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.project.findMany({
        where: { status: { notIn: ["CANCELLED", "CLOSED"] } },
        orderBy: { number: "asc" },
        take: 200,
        select: { id: true, number: true, name: true },
      }),
      prisma.wbsElement.findMany({
        orderBy: { code: "asc" },
        take: 500,
        select: { id: true, code: true, name: true, projectId: true },
      }),
      prisma.budget.findMany({
        where: { status: "ENACTED" },
        orderBy: { chargeCode: "asc" },
        take: 200,
        select: {
          id: true,
          chargeCode: true,
          name: true,
          status: true,
          sourceType: true,
          costClass: true,
        },
      }),
      prisma.companySettings.findUnique({ where: { id: "default" } }),
    ]);

  let departments: string[] = [];
  if (company?.departments) {
    try {
      const parsed = JSON.parse(company.departments);
      if (Array.isArray(parsed)) {
        departments = parsed.filter((d): d is string => typeof d === "string");
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="New purchase request"
        description="Office/facility buys (chairs, tables, supplies): just describe them — no vendor, project, or catalog needed. Manufacturing & project still require catalog parts."
        actions={
          <Link href="/purchasing?tab=prs">
            <Button size="sm" variant="outline">
              All PRs
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Request details</CardTitle>
          <p className="text-xs text-slate-500">
            Use this for ad-hoc buys (tools, MRO, services, non-shortage
            materials). WO shortages and kanban still auto-create PRs elsewhere.
          </p>
        </CardHeader>
        <CardContent>
          <StandalonePrForm
            parts={parts}
            suppliers={suppliers}
            projects={projects}
            wbsElements={wbsElements}
            budgets={budgets}
            departments={departments}
          />
        </CardContent>
      </Card>
    </div>
  );
}
