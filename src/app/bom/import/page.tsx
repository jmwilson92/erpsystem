import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser, userHasPermission } from "@/lib/auth";
import { BomImportUploadForm } from "@/components/bom/bom-import-upload";
import { MAX_BOM_IMPORT_BYTES } from "@/lib/bom-import/types";

export const dynamic = "force-dynamic";

export default async function BomImportPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const canImport = await userHasPermission(user.id, "bom.edit");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import BOM from file"
        description="Upload a parts list and review a draft BOM before it is saved"
        actions={
          <Link href="/bom">
            <Button size="sm" variant="outline">All BOMs</Button>
          </Link>
        }
      />

      {!canImport ? (
        <Card>
          <CardContent className="py-8 text-sm text-slate-400">
            You need BOM edit permission to import a file. Ask an administrator if you should have that right.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5 text-sm text-slate-300">
            <p>
              Anyone with BOM edit rights can submit a file. The result is always a <span className="font-medium text-slate-100">DRAFT</span> revision —
              never certified — and it follows the company&apos;s direct-certify / prototype setting. Review every line before you approve it.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-slate-400">
              <li><span className="text-slate-200">Excel / CSV</span> — columns are auto-mapped (part number, description, qty, UoM, rev, find number, level). You can fix the mapping on the next screen.</li>
              <li><span className="text-slate-200">PDF</span> — text is extracted first. If the table is weak and the AI provider is configured, a second language-model pass runs over that text. Scanned drawings with no text layer need an Excel or text-PDF export.</li>
              <li><span className="text-slate-200">SolidWorks / eDrawings</span> (.sldasm, .sldprt, .slddrw, .easm, .edrw, .eprt) — these are proprietary. The system reads OLE properties and any embedded table it can actually find. If there is no table, you will be asked to export the BOM from SolidWorks or eDrawings and attach that companion file. Parsing is never faked.</li>
            </ul>
            <p className="text-xs text-slate-500">Maximum size {Math.round(MAX_BOM_IMPORT_BYTES / (1024 * 1024))} MB. The original file is stored with the draft BOM for history.</p>
            <BomImportUploadForm />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
