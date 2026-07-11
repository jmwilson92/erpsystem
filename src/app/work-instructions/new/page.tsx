import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { NewWiForm } from "@/components/work-instructions/new-wi-form";

export const dynamic = "force-dynamic";

export default async function NewWorkInstructionPage() {
  const [parts, toolParts, boms, measureUoms, workCenters] = await Promise.all([
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: { partNumber: "asc" },
      select: { id: true, partNumber: true, description: true },
    }),
    // Tools / tooling-ish items for WI required tools (purchase or any active)
    prisma.part.findMany({
      where: {
        isActive: true,
        OR: [
          { sourcingMethod: "PURCHASE" },
          { partType: "BUY" },
          { description: { contains: "tool" } },
          { description: { contains: "Tool" } },
          { partNumber: { contains: "TOOL" } },
        ],
      },
      orderBy: { partNumber: "asc" },
      select: { id: true, partNumber: true, description: true },
      take: 200,
    }),
    prisma.bomHeader.findMany({
      where: { status: { in: ["CERTIFIED", "PROTOTYPE", "PRODUCTION"] } },
      include: { part: { select: { partNumber: true } } },
      orderBy: { revision: "desc" },
      take: 80,
    }),
    prisma.uomUnit.findMany({
      where: {
        isActive: true,
        category: { in: ["ELECTRICAL", "MEASURE", "OTHER", "TIME", "COUNT"] },
      },
      orderBy: [{ category: "asc" }, { code: "asc" }],
    }),
    prisma.workCenter.findMany({
      where: { isActive: true },
      orderBy: [{ area: "asc" }, { code: "asc" }],
    }),
  ]);

  // Fallback: all UOMs if measure category empty
  const uoms =
    measureUoms.length > 0
      ? measureUoms
      : await prisma.uomUnit.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
        });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New work instruction"
        description="Author steps, measurements, photos, and cure times — then submit to CM for release"
        actions={
          <Link href="/work-instructions">
            <Button size="sm" variant="outline">
              Cancel
            </Button>
          </Link>
        }
      />
      <NewWiForm
        parts={parts}
        toolParts={toolParts.length > 0 ? toolParts : parts}
        boms={boms.map((b) => ({
          id: b.id,
          label: `${b.part.partNumber} Rev ${b.revision} (${b.status})`,
        }))}
        uoms={uoms.map((u) => ({ id: u.id, code: u.code, name: u.name }))}
        workCenters={workCenters.map((w) => ({
          code: w.code,
          name: w.name,
          area: w.area,
        }))}
      />
    </div>
  );
}
