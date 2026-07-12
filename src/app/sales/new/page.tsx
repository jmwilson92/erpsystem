import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CompanyLetterhead } from "@/components/sales/document-header";
import { SalesLineItemsEditor } from "@/components/sales/line-items-editor";
import { actionCreateSalesOrder } from "@/app/actions";
import { getCustomerCreditSnapshot } from "@/lib/services/credit";
import Link from "next/link";
import { formatCurrency, formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewSalesOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const sp = await searchParams;
  const [customers, parts] = await Promise.all([
    prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    // Prefer sellable assemblies / make items; include certified-BOM flag via join
    prisma.part.findMany({
      where: { isActive: true },
      orderBy: [{ partType: "asc" }, { partNumber: "asc" }],
      include: {
        bomHeaders: {
          where: { status: "CERTIFIED" },
          select: { id: true, revision: true },
          take: 1,
        },
      },
    }),
  ]);

  // Sort: assemblies with certified BOM first, then other make, then buy
  const sortedParts = [...parts].sort((a, b) => {
    const score = (p: (typeof parts)[0]) =>
      (p.bomHeaders.length ? 0 : 10) +
      (p.partType === "ASSEMBLY" ? 0 : p.partType === "MAKE" ? 1 : 2);
    return score(a) - score(b) || a.partNumber.localeCompare(b.partNumber);
  });

  const today = formatDate(new Date());
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 30);
  const defaultShip = new Date();
  defaultShip.setDate(defaultShip.getDate() + 21);
  const dueStr = defaultDue.toISOString().slice(0, 10);
  const shipStr = defaultShip.toISOString().slice(0, 10);
  const defaultCustomer =
    customers.find((c) => c.id === sp.customerId) || customers[0];
  const newCustomerHref = `/customers/new?returnTo=${encodeURIComponent("/sales/new")}`;
  const partOptions = sortedParts.map((p) => ({
    id: p.id,
    partNumber: p.partNumber,
    description: p.description,
    standardCost: p.standardCost,
  }));

  const credit = defaultCustomer
    ? await getCustomerCreditSnapshot(defaultCustomer.id)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create sales order"
        description="Document-style order entry · customer PO"
        actions={
          <div className="flex gap-2">
            <Link href="/customers">
              <Button variant="ghost" size="sm">
                Customers
              </Button>
            </Link>
            <Link href="/sales">
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </Link>
          </div>
        }
      />

      {credit?.hasLimit && credit.isOverLimit && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardContent className="p-4 text-sm text-amber-100">
            <p className="font-medium">
              {defaultCustomer?.name} is over credit limit — deposit will be
              required
            </p>
            <p className="mt-1 text-xs text-amber-200/90">
              Exposure {formatCurrency(credit.exposure)} / limit{" "}
              {formatCurrency(credit.creditLimit)} ({credit.utilizationPct}%
              used). When you save this PO/order, the system will flag a
              deposit for the amount that exceeds available credit.
            </p>
          </CardContent>
        </Card>
      )}

      {credit?.hasLimit && !credit.isOverLimit && credit.utilizationPct >= 80 && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-4 text-xs text-amber-200/90">
            Credit nearly full: {formatCurrency(credit.availableCredit)}{" "}
            available of {formatCurrency(credit.creditLimit)}. Large orders may
            trigger a deposit requirement.
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-700 bg-slate-950/80">
        <CardContent className="space-y-6 p-6 md:p-8">
          <CompanyLetterhead docTitle="Sales Order" docNumber="NEW" docDate={today} />

          <form action={actionCreateSalesOrder} className="space-y-6">
            {/* Meta row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Order date
                </label>
                <p className="mt-1 text-sm text-slate-300">{today}</p>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Customer PO
                </label>
                <Input name="customerPo" placeholder="Customer PO #" className="mt-1 h-9" />
              </div>
              <div>
                <label className="text-xs text-slate-500">
                  Owning department (routes direct-charge time approvals)
                </label>
                <select
                  name="department"
                  defaultValue="PRODUCTION"
                  className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200"
                >
                  {["PRODUCTION", "MANUFACTURING", "ENGINEERING", "QUALITY", "PROGRAMS", "OPERATIONS"].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Payment terms
                </label>
                <select
                  name="paymentTerms"
                  className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                  defaultValue={defaultCustomer?.paymentTerms || "NET30"}
                >
                  <option value="NET15">NET 15</option>
                  <option value="NET30">NET 30</option>
                  <option value="NET45">NET 45</option>
                  <option value="NET60">NET 60</option>
                  <option value="DUE_ON_RECEIPT">Due on receipt</option>
                  <option value="CIA">Cash in advance</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  FOB
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input type="checkbox" name="isFob" className="rounded border-slate-600" />
                    FOB applies
                  </label>
                  <select
                    name="fobPoint"
                    className="flex h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs"
                    defaultValue="ORIGIN"
                  >
                    <option value="ORIGIN">Origin</option>
                    <option value="DESTINATION">Destination</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Customer / Bill-to / Ship-to */}
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                    Customer
                  </p>
                  <Link
                    href={newCustomerHref}
                    className="text-[11px] font-medium text-sky-400 hover:underline"
                  >
                    + New customer
                  </Link>
                </div>
                <label className="text-[10px] uppercase text-slate-500">Account</label>
                <select
                  name="customerId"
                  required
                  className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                  defaultValue={defaultCustomer?.id}
                  key={defaultCustomer?.id || "none"}
                >
                  {customers.length === 0 && (
                    <option value="">No customers — create one</option>
                  )}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                      {c.creditLimit > 0 ? ` (limit $${c.creditLimit.toLocaleString()})` : ""}
                    </option>
                  ))}
                </select>
                {credit?.hasLimit && (
                  <p
                    className={`mt-2 text-xs ${
                      credit.isOverLimit ? "text-amber-400" : "text-slate-500"
                    }`}
                  >
                    Credit: {formatCurrency(credit.exposure)} exposed /{" "}
                    {formatCurrency(credit.creditLimit)}
                    {credit.isOverLimit ? " — deposit required" : ""}
                  </p>
                )}
                {customers.length === 0 && (
                  <p className="mt-2 text-xs text-amber-400">
                    <Link href={newCustomerHref} className="underline">
                      Create a customer
                    </Link>{" "}
                    before saving this order.
                  </p>
                )}
                <label className="mt-3 block text-[10px] uppercase text-slate-500">
                  Contact name
                </label>
                <Input
                  name="contactName"
                  className="mt-1 h-9"
                  defaultValue={defaultCustomer?.contactName || ""}
                  placeholder="Buyer / contact"
                  key={`cn-${defaultCustomer?.id}`}
                />
                <label className="mt-3 block text-[10px] uppercase text-slate-500">
                  Contact email
                </label>
                <Input
                  name="contactEmail"
                  type="email"
                  className="mt-1 h-9"
                  defaultValue={defaultCustomer?.contactEmail || ""}
                  key={`ce-${defaultCustomer?.id}`}
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                  Bill to
                </p>
                <label className="text-[10px] uppercase text-slate-500">Name</label>
                <Input
                  name="billToName"
                  className="mt-1 h-9"
                  defaultValue={defaultCustomer?.name || ""}
                  key={`btn-${defaultCustomer?.id}`}
                />
                <label className="mt-3 block text-[10px] uppercase text-slate-500">Address</label>
                <Textarea
                  name="billToAddress"
                  rows={4}
                  className="mt-1 text-sm"
                  defaultValue={defaultCustomer?.billToAddress || ""}
                  placeholder={"Street\nCity, ST ZIP"}
                  key={`bta-${defaultCustomer?.id}`}
                />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                  Ship to
                </p>
                <label className="text-[10px] uppercase text-slate-500">Name</label>
                <Input
                  name="shipToName"
                  className="mt-1 h-9"
                  defaultValue={defaultCustomer?.name || ""}
                  key={`stn-${defaultCustomer?.id}`}
                />
                <label className="mt-3 block text-[10px] uppercase text-slate-500">Address</label>
                <Textarea
                  name="shipToAddress"
                  rows={4}
                  className="mt-1 text-sm"
                  defaultValue={
                    defaultCustomer?.shipToAddress || defaultCustomer?.billToAddress || ""
                  }
                  placeholder={"Street\nCity, ST ZIP"}
                  key={`sta-${defaultCustomer?.id}`}
                />
              </div>
            </div>

            {/* Dates */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Due date *
                </label>
                <Input
                  name="requiredDate"
                  type="date"
                  required
                  defaultValue={dueStr}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Ship date
                </label>
                <Input name="shipDate" type="date" defaultValue={shipStr} className="mt-1 h-9" />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-300">
                  <input type="checkbox" name="allowEarlyShip" className="rounded border-slate-600" />
                  Allow early ship
                </label>
              </div>
            </div>

            {/* Line items — multi-row, add more with + */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Line items
              </p>
              <SalesLineItemsEditor
                parts={partOptions}
                defaultPartId=""
                initialRows={4}
              />
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Notes
              </label>
              <Textarea name="notes" rows={2} className="mt-1" placeholder="Internal / customer notes" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="autoPlan"
                    defaultChecked
                    className="rounded border-slate-600"
                  />
                  Plan fulfillment after create (stock check → WO / PRs)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                  <input
                    type="checkbox"
                    name="bypassStockCheck"
                    className="rounded border-slate-600"
                  />
                  Bypass stock check — PR full BOM / demand (ignore on-hand)
                </label>
              </div>
              <div className="flex gap-2">
                <Link href="/sales">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create sales order</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
