import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ensureWorkOrderUnits,
  listKitSerialPlan,
  getSerialTree,
} from "@/lib/services/serials";
import { listStockSerialsForParts } from "@/lib/services/stock-serials";
import { AsBuiltKitPlan } from "@/components/work-orders/as-built-kit-plan";

export async function WorkOrderSerialSection({
  workOrderId,
}: {
  workOrderId: string;
}) {
  const wo = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    include: {
      part: true,
      bomHeader: { include: { lines: { include: { componentPart: true } } } },
    },
  });
  if (!wo) return null;
  if (!wo.part?.isSerialized) return null;

  const units = await ensureWorkOrderUnits({ workOrderId: wo.id });
  const kitSerialPlan = await listKitSerialPlan(wo.id);
  const serializedComponents = (wo.bomHeader?.lines || [])
    .filter((l) => l.componentPart?.isSerialized)
    .map((l) => ({
      id: l.componentPart.id,
      partNumber: l.componentPart.partNumber,
      description: l.componentPart.description,
      qty: Math.max(1, (l as { quantity?: number }).quantity || 1),
    }));
  const stockSerials = (
    await listStockSerialsForParts(serializedComponents.map((c) => c.id))
  ).map((s) => ({
    serial: s.serial,
    partId: s.partId,
    partNumber: s.part.partNumber,
    status: s.status,
    lotNumber: s.lotNumber,
  }));
  const unitTrees = await Promise.all(
    units
      .filter((u) => u.serialId)
      .map(async (u) => ({
        unitIndex: u.unitIndex,
        serial: u.serial!.serial,
        tree: await getSerialTree(u.serialId!, { includeRemoved: true }),
      }))
  );

  return (
    <Card className="border-teal-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-teal-200">
          As-built &amp; kit serial plan
        </CardTitle>
      </CardHeader>
      <CardContent>
        <AsBuiltKitPlan
          workOrderId={wo.id}
          workOrderNumber={wo.number}
          topPartId={wo.partId}
          topPartNumber={wo.part?.partNumber || "ASSEMBLY"}
          rmaId={wo.rmaId}
          units={units.map((u) => ({
            id: u.id,
            unitIndex: u.unitIndex,
            status: u.status,
            serial: u.serial ? { serial: u.serial.serial } : null,
          }))}
          kitSerialPlan={kitSerialPlan.map((a) => ({
            id: a.id,
            unitIndex: a.unitIndex,
            status: a.status,
            serial: {
              serial: a.serial.serial,
              part: { partNumber: a.serial.part.partNumber },
            },
          }))}
          unitTrees={unitTrees.map((ut) => ({
            unitIndex: ut.unitIndex,
            serial: ut.serial,
            tree: ut.tree
              ? {
                  children: ut.tree.children.map((c) => ({
                    installId: c.installId,
                    serial: c.serial,
                    partNumber: c.partNumber,
                    status: c.status,
                  })),
                }
              : null,
          }))}
          components={serializedComponents}
          stockSerials={stockSerials}
        />
      </CardContent>
    </Card>
  );
}
