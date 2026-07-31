import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  portalOrders,
} from "@/lib/services/supplier-portal";
import { actionAcknowledge, actionUploadDocument } from "../actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().slice(0, 10) : "—";
}

/**
 * Public, token-authenticated. There is no session here — the token in the URL
 * is the entire access control, and every query is scoped by the supplier it
 * resolves to.
 */
export default async function SupplierPortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const data = await portalOrders(token);

  if (!data) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Link not valid</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-400">
            This portal link has expired or is no longer active. Ask your buyer
            contact for a fresh one.
          </CardContent>
        </Card>
      </div>
    );
  }

  const { supplier, orders, documents } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">
          {supplier.name}
        </h1>
        <p className="text-sm text-slate-400">
          Purchase order acknowledgement and documents
        </p>
      </div>

      {sp.error && (
        <div className="rounded-md border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </div>
      )}
      {sp.saved && !sp.error && (
        <div className="rounded-md border border-emerald-800/60 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">
          Thank you — your response has been recorded.
        </div>
      )}

      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-slate-400">
            No open purchase orders at the moment.
          </CardContent>
        </Card>
      ) : (
        orders.map((po) => (
          <Card key={po.id}>
            <CardHeader>
              <CardTitle className="text-base">
                PO {po.number}
                <span className="ml-3 text-xs font-normal text-slate-500">
                  {po.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>#</th>
                    <th className={th}>Part</th>
                    <th className={th}>Description</th>
                    <th className={`${th} text-right`}>Qty</th>
                    <th className={th}>Required</th>
                    <th className={th}>Your response</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {po.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 text-slate-400">{l.lineNumber}</td>
                      <td className="py-2 font-mono text-slate-300">
                        {l.part?.partNumber || "—"}
                      </td>
                      <td className="py-2 text-slate-300">{l.description}</td>
                      <td className="py-2 text-right text-slate-400">
                        {l.quantity} {l.uom}
                      </td>
                      <td className="py-2 text-slate-400">
                        {fmtDate(l.promisedDate)}
                      </td>
                      <td className="py-2">
                        {l.acknowledgement ? (
                          <div className="text-xs">
                            <span
                              className={
                                l.acknowledgement.status === "REJECTED"
                                  ? "text-rose-300"
                                  : l.acknowledgement.status === "DATE_PROPOSED"
                                    ? "text-amber-300"
                                    : "text-emerald-300"
                              }
                            >
                              {l.acknowledgement.status}
                            </span>
                            {l.acknowledgement.confirmedDate && (
                              <span className="ml-2 text-slate-400">
                                {fmtDate(l.acknowledgement.confirmedDate)}
                              </span>
                            )}
                            {l.acknowledgement.acceptedAt && (
                              <span className="ml-2 text-slate-500">accepted</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">awaiting</span>
                        )}
                        <form
                          action={actionAcknowledge}
                          className="mt-2 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="token" value={token} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <select
                            name="status"
                            defaultValue={l.acknowledgement?.status || "ACKNOWLEDGED"}
                            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                          >
                            <option value="ACKNOWLEDGED">Accept as-is</option>
                            <option value="DATE_PROPOSED">Propose a date</option>
                            <option value="REJECTED">Cannot supply</option>
                          </select>
                          <Input
                            name="confirmedDate"
                            type="date"
                            defaultValue={
                              l.acknowledgement?.confirmedDate
                                ? fmtDate(l.acknowledgement.confirmedDate)
                                : ""
                            }
                            className="h-7 w-36 text-xs"
                          />
                          <Input
                            name="note"
                            placeholder="Note"
                            defaultValue={l.acknowledgement?.supplierNote || ""}
                            className="h-7 w-40 text-xs"
                          />
                          <Button type="submit" variant="outline" size="sm">
                            Send
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Certificates and documents</CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length > 0 && (
            <ul className="mb-4 space-y-1 text-sm">
              {documents.map((d) => (
                <li key={d.id} className="text-slate-300">
                  <span className="text-slate-500">
                    {fmtDate(d.uploadedAt)} ·{" "}
                    {DOC_TYPE_LABELS[d.docType] || d.docType} ·{" "}
                  </span>
                  {d.fileName}
                </li>
              ))}
            </ul>
          )}

          <form
            action={actionUploadDocument}
            className="grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <input type="hidden" name="token" value={token} />
            <label className="text-sm text-slate-400">
              Against PO
              <select name="purchaseOrderId" className={selectClass} defaultValue="">
                <option value="">— general</option>
                {orders.map((po) => (
                  <option key={po.id} value={po.id}>
                    {po.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Type
              <select name="docType" className={selectClass} defaultValue="COC">
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              File name *
              <Input name="fileName" required placeholder="CoC-12345.pdf" />
            </label>
            <label className="text-sm text-slate-400">
              Link *
              <Input name="fileUrl" required placeholder="https://…" />
            </label>
            <div className="sm:col-span-4">
              <Button type="submit">Upload</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
