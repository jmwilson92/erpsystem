import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toolLabelDxf } from "@/lib/dxf";

export const dynamic = "force-dynamic";

/** Download a laser-etch DXF label for a tool / calibrated instrument. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await params;
  const item = await prisma.qualityItem.findUnique({ where: { id } });
  if (!item) return new NextResponse("Not found", { status: 404 });

  const dxf = toolLabelDxf(item.identifier, item.name);
  const safe = item.identifier.replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(dxf, {
    headers: {
      "Content-Type": "application/dxf",
      "Content-Disposition": `attachment; filename="${safe}.dxf"`,
    },
  });
}
