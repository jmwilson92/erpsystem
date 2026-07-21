import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionCreateCustomer, actionUpdateCustomer } from "@/app/actions";
import { AddressInput } from "@/components/customers/address-input";
import Link from "next/link";

export type CustomerFormValues = {
  id?: string;
  code?: string;
  name?: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  billToAddress?: string | null;
  shipToAddress?: string | null;
  paymentTerms?: string | null;
  creditLimit?: number | null;
  creditTermsRequested?: string | null;
  creditDocUrl?: string | null;
  creditDocName?: string | null;
  isActive?: boolean;
};

export function CustomerForm({
  customer,
  returnTo,
  cancelHref = "/customers",
  submitLabel,
}: {
  customer?: CustomerFormValues;
  returnTo?: string | null;
  cancelHref?: string;
  submitLabel?: string;
}) {
  const isEdit = Boolean(customer?.id);
  const action = isEdit ? actionUpdateCustomer : actionCreateCustomer;

  return (
    <form action={action} className="space-y-6">
      {isEdit && <input type="hidden" name="id" value={customer!.id} />}
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Customer name *
          </label>
          <Input
            name="name"
            required
            defaultValue={customer?.name || ""}
            placeholder="Legal company name"
            className="mt-1 h-9"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Customer code
          </label>
          <Input
            name="code"
            defaultValue={customer?.code || ""}
            placeholder="Auto if blank (e.g. CUST-0002)"
            className="mt-1 h-9 font-mono"
          />
          <p className="mt-1 text-[11px] text-slate-600">
            Leave blank to auto-generate from name / sequence
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Contact name
          </label>
          <Input
            name="contactName"
            defaultValue={customer?.contactName || ""}
            className="mt-1 h-9"
            placeholder="Buyer / procurement"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Contact email
          </label>
          <Input
            name="contactEmail"
            type="email"
            defaultValue={customer?.contactEmail || ""}
            className="mt-1 h-9"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Contact phone
          </label>
          <Input
            name="contactPhone"
            defaultValue={customer?.contactPhone || ""}
            className="mt-1 h-9"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Payment terms
          </label>
          <select
            name="paymentTerms"
            className="mt-1 flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm"
            defaultValue={customer?.paymentTerms || "NET30"}
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
            Credit limit ($)
          </label>
          <Input
            name="creditLimit"
            type="number"
            min={0}
            step="1"
            defaultValue={customer?.creditLimit ?? 0}
            className="mt-1 h-9"
          />
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-500">
          Credit terms request
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Requested terms
            </label>
            <Input
              name="creditTermsRequested"
              defaultValue={customer?.creditTermsRequested || ""}
              placeholder="e.g. NET45 — under review"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Credit application doc (URL / path)
            </label>
            <Input
              name="creditDocUrl"
              defaultValue={customer?.creditDocUrl || ""}
              placeholder="/uploads/credit/… or https://…"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Doc label
            </label>
            <Input
              name="creditDocName"
              defaultValue={customer?.creditDocName || ""}
              placeholder="Signed credit application"
              className="mt-1 h-9"
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-600">
          Track terms the customer has asked for while credit review is pending —
          approved terms go in “Payment terms” above.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
            Bill to address
          </p>
          <AddressInput
            name="billToAddress"
            rows={5}
            className="text-sm"
            defaultValue={customer?.billToAddress || ""}
            placeholder={"Company\nStreet\nCity, ST ZIP"}
          />
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-teal-500">
            Ship to address
          </p>
          <AddressInput
            name="shipToAddress"
            rows={5}
            className="text-sm"
            defaultValue={customer?.shipToAddress || ""}
            placeholder="Defaults to bill-to if blank"
          />
          <p className="mt-1 text-[11px] text-slate-600">
            Leave blank on create to copy bill-to
          </p>
        </div>
      </div>

      {isEdit && (
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={customer?.isActive !== false}
            className="rounded border-slate-600"
          />
          Active customer
        </label>
      )}
      {!isEdit && <input type="hidden" name="isActive" value="true" />}

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-5">
        <Link href={cancelHref}>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </Link>
        <Button type="submit">
          {submitLabel || (isEdit ? "Save customer" : "Create customer")}
        </Button>
      </div>
    </form>
  );
}
