import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ToolLabel } from "@/components/quality/tool-label";

export const dynamic = "force-dynamic";

export default async function ToolLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) notFound();
  const { id } = await params;
  const item = await prisma.qualityItem.findUnique({
    where: { id },
    include: { program: { select: { name: true } } },
  });
  if (!item) notFound();

  return (
    <ToolLabel
      id={item.id}
      identifier={item.identifier}
      name={item.name}
      program={item.program.name}
      needsCalibration={item.needsCalibration}
    />
  );
}
