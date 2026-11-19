import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { getBomImport } from "@/lib/services/bom-import";
import { BomImportReviewForm } from "@/components/bom/bom-import-review";

export const dynamic = "force-dynamic";

export default async function BomImportReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const canImport = await userHasPermission(user.id, "bom.edit");
  if (!canImport) {
    return (
      <div className="space-y-4">
        <PageHeader title="Import BOM from file" description="Review a draft extracted from an uploaded file" />
        <p className="text-sm text-slate-400">You need BOM edit permission to review this import.</p>
      </div>
    );
  }

  const { id } = await params;
  const rec = await getBomImport(id);
  if (!rec) notFound();

  if (rec.status === "APPROVED" && rec.bomHeaderId) {
    redirect(`/bom/${rec.bomHeaderId}`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review imported BOM"
        description={
          rec.status === "DISCARDED"
            ? "This import was discarded and cannot be approved."
            : "Compare the source to the extracted lines, then approve a DRAFT BOM or discard it."
        }
        actions={
          <Link href="/bom/import">
            <Button size="sm" variant="outline">Import another file</Button>
          </Link>
        }
      />
      {rec.status === "DISCARDED" ? (
        <p className="text-sm text-slate-400">Discarded imports are kept for history only. Start a new import to try again.</p>
      ) : (
        <BomImportReviewForm
          importId={rec.id}
          fileName={rec.fileName}
          sourceKind={rec.sourceKind}
          needsExport={rec.needsExport}
          extractionNotes={rec.extractionNotes}
          previewText={rec.previewText}
          previewKind={rec.previewKind}
          fileUrl={rec.fileUrl}
          fileMime={rec.fileMime}
          companionFileName={rec.companionFileName}
          columnMappingJson={rec.columnMapping}
          assemblyPartNumber={rec.assemblyPartNumber || ""}
          assemblyDescription={rec.assemblyDescription || ""}
          assemblyRevision={rec.assemblyRevision || "A"}
          lines={rec.lines.map((l) => ({
            id: l.id,
            sortOrder: l.sortOrder,
            level: l.level,
            findNumber: l.findNumber,
            partNumber: l.partNumber,
            description: l.description,
            revision: l.revision,
            quantity: l.quantity,
            uom: l.uom,
            confidence: l.confidence,
            flag: l.flag,
            matchedPartId: l.matchedPartId,
            createNewItem: l.createNewItem,
            notes: l.notes,
          }))}
        />
      )}
    </div>
  );
}
