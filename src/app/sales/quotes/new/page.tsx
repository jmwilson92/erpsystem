import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CompanyLetterhead } from "@/components/sales/document-header";
import { actionCreateQuote } from "@/app/actions";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const sp = await searchParams;
  const [customers, parts] = await Promise.all([
    prisma.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.part.findMany({ where: { isActive: true }, orderBy: { partNumber: "asc" } }),
  ]);

  const today = formatDate(new Date());
  const defaultDue = new Date();
  defaultDue.setDate(defaultDue.getDate() + 30);
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 14);
  const defaultShip = new Date();
  defaultShip.setDate(defaultShip.getDate() + 21);
  const dueStr = defaultDue.toISOString().slice(0, 10);
  const validStr = validUntil.toISOString().slice(0, 10);
  const shipStr = defaultShip.toISOString().slice(0, 10);
  const defaultCustomer =
    customers.find((c) => c.id === sp.customerId) || customers[0];
  const defaultPart = parts.find((p) => p.partNumber === "ASM-1000") || parts[0];
  const newCustomerHref = `/customers/new?returnTo=${encodeURIComponent("/sales/quotes/new")}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New quote"
        description="Issue a customer quotation — accept later to create a sales order"
        actions={
          <Link href="/sales/quotes">
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </Link>
        }
      />

      <Card className="border-slate-700 bg-slate-950/80">
        <CardContent className="space-y-6 p-6 md:p-8">
          <CompanyLetterhead docTitle="Quotation" docNumber="NEW" docDate={today} />

          <form action={actionCreateQuote} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Quote date
                </label>
                <p className="mt-1 text-sm text-slate-300">{today}</p>
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Valid until
                </label>
                <Input name="validUntil" type="date" defaultValue={validStr} className="mt-1 h-9" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Customer PO / RFQ ref
                </label>
                <Input name="customerPo" placeholder="RFQ / PO ref" className="mt-1 h-9" />
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
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
              <div className="grid grid-cols-2 gap-3">
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
                  <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      name="allowEarlyShip"
                      className="rounded border-slate-600"
                    />
                    Customer accepts early shipment
                  </label>
                </div>
              </div>
            </div>

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
                <select
                  name="customerId"
                  required
                  className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                  defaultValue={defaultCustomer?.id}
                  key={defaultCustomer?.id || "none"}
                >
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
                <Input
                  name="contactName"
                  className="mt-3 h-9"
                  placeholder="Contact"
                  defaultValue={defaultCustomer?.contactName || ""}
                  key={`cn-${defaultCustomer?.id}`}
                />
                <Input
                  name="contactEmail"
                  type="email"
                  className="mt-2 h-9"
                  placeholder="Email"
                  defaultValue={defaultCustomer?.contactEmail || ""}
                  key={`ce-${defaultCustomer?.id}`}
                />
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                  Bill to
                </p>
                <Input
                  name="billToName"
                  className="h-9"
                  defaultValue={defaultCustomer?.name || ""}
                  key={`btn-${defaultCustomer?.id}`}
                />
                <Textarea
                  name="billToAddress"
                  rows={4}
                  className="mt-2 text-sm"
                  defaultValue={defaultCustomer?.billToAddress || ""}
                  key={`bta-${defaultCustomer?.id}`}
                />
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
                <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
                  Ship to
                </p>
                <Input
                  name="shipToName"
                  className="h-9"
                  defaultValue={defaultCustomer?.name || ""}
                  key={`stn-${defaultCustomer?.id}`}
                />
                <Textarea
                  name="shipToAddress"
                  rows={4}
                  className="mt-2 text-sm"
                  defaultValue={
                    defaultCustomer?.shipToAddress || defaultCustomer?.billToAddress || ""
                  }
                  key={`sta-${defaultCustomer?.id}`}
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Part number</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Unit price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-slate-800">
                    <td className="px-3 py-3">
                      <select
                        name="partId"
                        required
                        className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
                        defaultValue={defaultPart?.id}
                      >
                        {parts.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.partNumber} — {p.description}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        name="quantity"
                        type="number"
                        min={1}
                        defaultValue={1}
                        required
                        className="ml-auto h-9 w-24 text-right"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <Input
                        name="unitPrice"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder={String(defaultPart?.standardCost || "")}
                        className="ml-auto h-9 w-32 text-right"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Notes
              </label>
              <Textarea name="notes" rows={2} className="mt-1" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
              <label className="flex items-center gap-2 text-sm text-slate-400">
                <input type="checkbox" name="sendNow" className="rounded border-slate-600" />
                Mark as sent to customer
              </label>
              <div className="flex gap-2">
                <Link href="/sales/quotes">
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Link>
                <Button type="submit">Create quote</Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
