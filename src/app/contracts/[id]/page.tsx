import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { prisma } from "@/lib/db";
import {
  getContract,
  reconcileModDeltas,
  CLIN_CATEGORIES,
} from "@/lib/services/contracts";
import { listUsers } from "@/lib/auth";
import {
  actionAddCdrl,
  actionAddClin,
  actionAddMod,
  actionExecuteMod,
  actionExerciseOption,
  actionSubmitCdrl,
} from "../actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";
const th = "pb-2 text-left text-xs uppercase tracking-wide text-slate-500";

function fmtDate(d: Date | null | undefined) {
  return d ? new Date(d).toLocaleDateString() : "—";
}

function money(n: number) {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const contract = await getContract(id);
  if (!contract) notFound();

  const [reconcile, users, parts] = await Promise.all([
    reconcileModDeltas(id).catch(() => null),
    listUsers().catch(() => []),
    prisma.part.findMany({ orderBy: { partNumber: "asc" }, take: 500 }).catch(() => []),
  ]);

  // Only DATA lines carry a separately priced deliverable, so the CDRL form
  // offers those rather than every line on the contract.
  const dataClins = contract.clins.filter((c) => c.category === "DATA");
  const unexercised = contract.clins.filter((c) => c.isOption && !c.optionExercisedAt);
  const optionValue = unexercised.reduce((s, c) => s + c.totalValue, 0);
  const mismatch =
    reconcile && (reconcile.valueVariance !== 0 || reconcile.fundingVariance !== 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${contract.number} — ${contract.name}`}
        description={[
          contract.contractType,
          contract.isPrime ? "Prime" : `Sub to ${contract.primeContractor || "—"}`,
          contract.customer?.name,
          contract.program?.code,
        ]
          .filter(Boolean)
          .join(" · ")}
      />

      <Link href="/contracts" className="text-sm text-sky-300 hover:underline">
        ← All contracts
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-slate-100">{contract.status}</p>
            <p className="mt-1 text-xs text-slate-500">
              {fmtDate(contract.startDate)} – {fmtDate(contract.endDate)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Value / funded</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-slate-100">
              {money(contract.totalValue)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {money(contract.fundedValue)} funded
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">Unexercised options</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold text-slate-100">{money(optionValue)}</p>
            <p className="mt-1 text-xs text-slate-500">
              {unexercised.length} line{unexercised.length === 1 ? "" : "s"}, excluded
              from value
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-400">DPAS</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xl font-semibold text-amber-300">
              {contract.dpasRating || "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              CO: {contract.contractingOfficer || "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {mismatch && reconcile && (
        <Card className="border-amber-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-300">
              CLIN rollup does not match executed modifications
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-300">
            <p>
              Lines total {money(reconcile.clinTotal)}; executed mods claim{" "}
              {money(reconcile.modTotal)} — variance {money(reconcile.valueVariance)}.
              Funding variance {money(reconcile.fundingVariance)}.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Not necessarily wrong — an administrative mod carries no dollars — but
              this is the gap an auditor asks about, so it is surfaced rather than
              reconciled away.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract line items</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contract.clins.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No CLINs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>CLIN</th>
                  <th className={th}>Description</th>
                  <th className={th}>Category</th>
                  <th className={th}>Part</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={`${th} text-right`}>Value</th>
                  <th className={`${th} text-right`}>Funded</th>
                  <th className={th}>Delivery</th>
                  <th className={th}>Option</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contract.clins.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 font-mono text-slate-200">{c.number}</td>
                    <td className="py-2 text-slate-300">{c.description}</td>
                    <td className="py-2 text-slate-400">{c.category}</td>
                    <td className="py-2 font-mono text-slate-400">
                      {c.part?.partNumber || "—"}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {c.quantity} {c.uom}
                    </td>
                    <td className="py-2 text-right text-slate-200">
                      {money(c.totalValue)}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {money(c.fundedValue)}
                    </td>
                    <td className="py-2 text-slate-400">{fmtDate(c.deliveryDate)}</td>
                    <td className="py-2">
                      {!c.isOption ? (
                        <span className="text-slate-600">—</span>
                      ) : c.optionExercisedAt ? (
                        <span className="text-emerald-300">
                          Exercised {fmtDate(c.optionExercisedAt)}
                        </span>
                      ) : (
                        <form action={actionExerciseOption}>
                          <input type="hidden" name="clinId" value={c.id} />
                          <input type="hidden" name="contractId" value={contract.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Exercise
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={actionAddClin}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <input type="hidden" name="contractId" value={contract.id} />
            <label className="text-sm text-slate-400">
              CLIN *<Input name="number" required placeholder="0001" />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Description *<Input name="description" required />
            </label>
            <label className="text-sm text-slate-400">
              Category
              <select name="category" className={selectClass} defaultValue="SUPPLY">
                {CLIN_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Part
              <select name="partId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {parts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.partNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Quantity
              <Input name="quantity" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Unit price
              <Input name="unitPrice" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Funded
              <Input name="fundedValue" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Delivery date
              <Input name="deliveryDate" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              Option line
              <select name="isOption" className={selectClass} defaultValue="0">
                <option value="0">No</option>
                <option value="1">Yes</option>
              </select>
            </label>
            <div className="sm:col-span-2 sm:self-end">
              <Button type="submit">Add CLIN</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modifications</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contract.mods.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No modifications.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>Mod</th>
                  <th className={th}>Type</th>
                  <th className={th}>Description</th>
                  <th className={`${th} text-right`}>Value Δ</th>
                  <th className={`${th} text-right`}>Funding Δ</th>
                  <th className={th}>Effective</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contract.mods.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 font-mono text-slate-200">{m.number}</td>
                    <td className="py-2 text-slate-400">{m.modType}</td>
                    <td className="py-2 text-slate-300">{m.description}</td>
                    <td className="py-2 text-right text-slate-300">
                      {money(m.valueDelta)}
                    </td>
                    <td className="py-2 text-right text-slate-400">
                      {money(m.fundingDelta)}
                    </td>
                    <td className="py-2 text-slate-400">{fmtDate(m.effectiveDate)}</td>
                    <td className="py-2">
                      {m.status === "EXECUTED" ? (
                        <span className="text-emerald-300">
                          Executed {fmtDate(m.executedAt)}
                        </span>
                      ) : (
                        <form action={actionExecuteMod}>
                          <input type="hidden" name="modId" value={m.id} />
                          <input type="hidden" name="contractId" value={contract.id} />
                          <Button type="submit" variant="outline" size="sm">
                            Execute
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={actionAddMod}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <input type="hidden" name="contractId" value={contract.id} />
            <label className="text-sm text-slate-400">
              Mod number *<Input name="number" required placeholder="P00001" />
            </label>
            <label className="text-sm text-slate-400">
              Type
              <select name="modType" className={selectClass} defaultValue="BILATERAL">
                {[
                  "BILATERAL",
                  "UNILATERAL",
                  "ADMINISTRATIVE",
                  "FUNDING",
                  "TERMINATION",
                ].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Description *<Input name="description" required />
            </label>
            <label className="text-sm text-slate-400">
              Value delta
              <Input name="valueDelta" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Funding delta
              <Input name="fundingDelta" type="number" step="any" defaultValue="0" />
            </label>
            <label className="text-sm text-slate-400">
              Effective date
              <Input name="effectiveDate" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              New PoP end
              <Input name="newEndDate" type="date" />
            </label>
            <div className="sm:col-span-4">
              <Button type="submit">Add modification</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CDRL deliverables</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {contract.cdrls.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No CDRLs.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={th}>CDRL</th>
                  <th className={th}>Title</th>
                  <th className={th}>DID</th>
                  <th className={th}>Freq</th>
                  <th className={th}>Code</th>
                  <th className={th}>Due</th>
                  <th className={th}>Status</th>
                  <th className={th}>Submit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {contract.cdrls.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 font-mono text-slate-200">{c.number}</td>
                    <td className="py-2 text-slate-300">
                      {c.title}
                      {c.submissions.length > 0 && (
                        <span className="ml-2 text-xs text-slate-500">
                          rev {c.submissions[0].revision}
                        </span>
                      )}
                    </td>
                    <td className="py-2 font-mono text-slate-400">
                      {c.didNumber || "—"}
                    </td>
                    <td className="py-2 text-slate-400">{c.frequency}</td>
                    <td className="py-2 text-slate-400">{c.approvalCode}</td>
                    <td className="py-2 text-slate-400">{fmtDate(c.nextDueDate)}</td>
                    <td className="py-2 text-slate-300">{c.status}</td>
                    <td className="py-2">
                      <form action={actionSubmitCdrl} className="flex gap-2">
                        <input type="hidden" name="cdrlId" value={c.id} />
                        <input type="hidden" name="contractId" value={contract.id} />
                        <Input
                          name="documentName"
                          placeholder="Document"
                          className="h-8 w-36"
                        />
                        <Button type="submit" variant="outline" size="sm">
                          Submit
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            action={actionAddCdrl}
            className="mt-6 grid gap-3 border-t border-slate-800 pt-4 sm:grid-cols-4"
          >
            <input type="hidden" name="contractId" value={contract.id} />
            <label className="text-sm text-slate-400">
              CDRL number *<Input name="number" required placeholder="A001" />
            </label>
            <label className="text-sm text-slate-400 sm:col-span-2">
              Title *
              <Input name="title" required placeholder="Monthly status report" />
            </label>
            <label className="text-sm text-slate-400">
              DID
              <Input name="didNumber" placeholder="DI-MGMT-81334D" />
            </label>
            <label className="text-sm text-slate-400">
              Data CLIN
              <select name="clinId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {dataClins.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number} — {c.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Frequency
              <select name="frequency" className={selectClass} defaultValue="ONE_TIME">
                {["ONE_TIME", "RECURRING", "AS_REQUIRED", "EVENT_DRIVEN"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Approval code
              <select name="approvalCode" className={selectClass} defaultValue="A">
                <option value="A">A — approval required</option>
                <option value="I">I — information only</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Review days
              <Input name="reviewDays" type="number" defaultValue="30" />
            </label>
            <label className="text-sm text-slate-400">
              First due date
              <Input name="firstDueDate" type="date" />
            </label>
            <label className="text-sm text-slate-400">
              Owner
              <select name="ownerId" className={selectClass} defaultValue="">
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 sm:self-end">
              <Button type="submit">Add CDRL</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
