import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CustomerForm } from "@/components/customers/customer-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const sp = await searchParams;
  const returnTo = sp.returnTo && sp.returnTo.startsWith("/") ? sp.returnTo : null;
  const cancelHref = returnTo || "/customers";

  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description={
          returnTo
            ? "Create an account, then return to your document"
            : "Add a customer account for quotes and sales orders"
        }
        actions={
          <Link href={cancelHref}>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </Link>
        }
      />

      {returnTo && (
        <p className="rounded-lg border border-teal-900/40 bg-teal-950/20 px-4 py-2 text-sm text-teal-300/90">
          After save you will return to the sales document with this customer selected.
        </p>
      )}

      <Card className="border-slate-700 bg-slate-950/80">
        <CardContent className="p-6 md:p-8">
          <CustomerForm
            returnTo={returnTo}
            cancelHref={cancelHref}
            submitLabel={returnTo ? "Create & return" : "Create customer"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
