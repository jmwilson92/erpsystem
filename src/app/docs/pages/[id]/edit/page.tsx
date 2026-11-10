import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireDocsAccess } from "@/lib/services/docs";
import { PageHeader } from "@/components/shared/page-header";
import { DocEditorLoader } from "@/components/docs/editor-loader";
export const dynamic = "force-dynamic";
export default async function EditDocPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDocsAccess("docs.edit");
  const { id } = await params;
  const page = await prisma.docPage.findUnique({ where: { id } });
  if (!page) notFound();
  const parents = await prisma.docPage.findMany({ where: { spaceId: page.spaceId }, select: { id: true, title: true }, orderBy: { title: "asc" } });
  return <div className="mx-auto max-w-5xl space-y-6"><PageHeader title="Edit page" actions={<Link href={`/docs/pages/${id}`} className="text-sm text-teal-400">Back to page</Link>} /><DocEditorLoader key={`${id}-${page.version}`} page={{ id, title: page.title, content: page.content, version: page.version, controlled: page.controlled, isTemplate: page.isTemplate, parentId: page.parentId, status: page.status }} parents={parents} /></div>;
}
