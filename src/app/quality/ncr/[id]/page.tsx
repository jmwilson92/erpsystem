import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { DocBacklinks } from "@/components/docs/backlinks";
export const dynamic = "force-dynamic";
export default async function NcrDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("quality.view");
  const { id } = await params;
  const ncr = await prisma.nonConformance.findUnique({ where: { id }, include: { part: true, workOrder: true, mrbCases: true } });
  if (!ncr) notFound();
  return <div className="mx-auto max-w-4xl space-y-6"><PageHeader title={`${ncr.number} — ${ncr.title}`} actions={<Link href="/quality" className="text-teal-400">NCR list</Link>} /><Card><CardContent className="space-y-4 p-6"><div className="flex gap-2"><StatusBadge status={ncr.status} /><StatusBadge status={ncr.severity} /></div><p className="whitespace-pre-wrap text-sm">{ncr.description}</p>{ncr.part ? <p className="text-sm">Part: <Link href={`/items/${ncr.part.id}`} className="text-teal-400">{ncr.part.partNumber}</Link></p> : null}{ncr.workOrder ? <p className="text-sm">Work order: <Link href={`/work-orders/${ncr.workOrder.id}`} className="text-teal-400">{ncr.workOrder.number}</Link></p> : null}{ncr.mrbCases.length ? <Link href="/mrb?filter=all" className="text-sm text-teal-400">Open MRB disposition workflow →</Link> : null}</CardContent></Card><DocBacklinks type="NCR" targetId={id} /></div>;
}
