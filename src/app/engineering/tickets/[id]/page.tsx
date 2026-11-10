import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { DocBacklinks } from "@/components/docs/backlinks";
export const dynamic = "force-dynamic";
/** Legacy ticket records coexist with the active EngTask board. Both can link Docs. */
export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("engineering.view");
  const { id } = await params;
  const ticket = await prisma.engineeringTicket.findUnique({ where: { id }, include: { comments: { orderBy: { createdAt: "asc" } }, assignee: { select: { name: true } } } });
  if (!ticket) notFound();
  return <div className="mx-auto max-w-4xl space-y-6"><PageHeader title={`${ticket.number} — ${ticket.title}`} actions={<Link href="/engineering" className="text-teal-400">Engineering</Link>} /><Card><CardContent className="space-y-4 p-6"><div className="flex gap-2"><StatusBadge status={ticket.status} /><StatusBadge status={ticket.priority} /></div><p className="whitespace-pre-wrap text-sm">{ticket.description}</p><p className="text-sm text-slate-400">Assigned to {ticket.assignee?.name ?? "Unassigned"}</p>{ticket.engTaskId ? <Link href={`/engineering/tasks/${ticket.engTaskId}`} className="text-sm text-teal-400">Open task on the current board →</Link> : null}{ticket.comments.map(c => <p key={c.id} className="whitespace-pre-wrap rounded border border-slate-800 p-3 text-sm">{c.body}</p>)}</CardContent></Card><DocBacklinks type="TICKET" targetId={id} /></div>;
}
