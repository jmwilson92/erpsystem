import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InspectionRunner } from "@/components/quality/inspection-runner";
import { actionPerformInspection } from "@/app/actions";
import { getProgramByKey } from "@/lib/services/quality-programs";
import { parseTemplate, supportsInspections } from "@/lib/services/inspections";

export const dynamic = "force-dynamic";

export default async function PerformInspectionPage({
  params,
}: {
  params: Promise<{ key: string; itemId: string }>;
}) {
  const { key, itemId } = await params;
  const program = await getProgramByKey(key);
  if (!program || !supportsInspections(key)) notFound();

  const user = await getCurrentUser();
  const canManage = await userHasPermission(user?.id, "quality.programs.manage");
  if (!canManage) notFound();

  const item = await prisma.qualityItem.findUnique({ where: { id: itemId } });
  if (!item) notFound();

  const steps = parseTemplate(program.inspectionTemplate);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Inspect ${item.identifier}`}
        description={`${item.name} · ${program.name}`}
        actions={
          <Link href={`/quality/programs/${key}`}>
            <Button size="sm" variant="outline">← {program.name}</Button>
          </Link>
        }
      />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{program.eventNoun}</CardTitle>
        </CardHeader>
        <CardContent>
          <InspectionRunner
            action={actionPerformInspection}
            hiddenFields={{ programId: program.id, programKey: key, itemId: item.id }}
            steps={steps}
          />
        </CardContent>
      </Card>
    </div>
  );
}
