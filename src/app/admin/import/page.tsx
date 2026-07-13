import { PageHeader } from "@/components/shared/page-header";
import { ImportWizard } from "@/components/admin/import-wizard";

export const dynamic = "force-dynamic";

export default function DataImportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Import"
        description="Bring your existing item master, customers, suppliers, and people in — paste straight from Excel, no file formats to fight."
      />
      <ImportWizard />
    </div>
  );
}
