import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatCurrency } from "@/lib/utils";
import {
  actionApproveProductionJournal,
  actionRejectProductionJournal,
} from "@/app/actions";

export type ProductionJournalReviewModel = {
  id: string;
  number: string;
  type: string;
  status: string;
  workOrderId: string;
  quantityRequested: number;
  quantityApproved: number | null;
  amount: number;
  rejectReason: string | null;
  quantityEditNote: string | null;
  notes: string | null;
  payload?: string | null;
  workOrder?: { id: string; number: string } | null;
  part?: { partNumber: string; description: string } | null;
  kitOrder?: { id: string; number: string } | null;
};

function typeLabel(type: string) {
  if (type === "KIT") return "Kit";
  if (type === "CONSUME") return "Consumption";
  if (type === "OUTPUT") return "Finished-goods output";
  return type;
}

function payloadLines(raw: string | null | undefined) {
  try {
    const parsed = raw ? (JSON.parse(raw) as { lines?: { lineId: string; partNumber?: string; quantityRequested: number }[] }) : {};
    return parsed.lines || [];
  } catch {
    return [];
  }
}

export function ProductionJournalReviewRow({
  journal,
  canDecide,
  showWorkOrder = true,
}: {
  journal: ProductionJournalReviewModel;
  canDecide: boolean;
  showWorkOrder?: boolean;
}) {
  const qty = journal.quantityApproved ?? journal.quantityRequested;
  const lines = payloadLines(journal.payload);
  const pending = journal.status === "PENDING" || journal.status === "POSTING";

  return (
    <div
      id={`pj-${journal.id}`}
      className="space-y-2 rounded-lg border border-slate-800 px-4 py-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-slate-200">
            <span className="font-mono text-sky-400">{journal.number}</span>{" "}
            {typeLabel(journal.type)}
            {showWorkOrder && journal.workOrder && (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/work-orders/${journal.workOrder.id}`}
                  className="font-mono text-teal-400 hover:underline"
                >
                  {journal.workOrder.number}
                </Link>
              </>
            )}
          </p>
          <p className="text-xs text-slate-500">
            Qty {qty}
            {journal.quantityApproved != null &&
            journal.quantityApproved !== journal.quantityRequested
              ? ` (requested ${journal.quantityRequested})`
              : ""}
            {" · "}
            {formatCurrency(journal.amount)}
            {journal.part ? ` · ${journal.part.partNumber}` : ""}
            {journal.kitOrder ? ` · kit ${journal.kitOrder.number}` : ""}
          </p>
          {journal.notes && <p className="text-xs text-slate-500">{journal.notes}</p>}
          {journal.quantityEditNote && (
            <p className="text-xs text-amber-400/80">{journal.quantityEditNote}</p>
          )}
          {journal.rejectReason && (
            <p className="text-xs text-rose-400">Returned: {journal.rejectReason}</p>
          )}
        </div>
        <StatusBadge status={journal.status} />
      </div>

      {pending && canDecide && (
        <div className="flex flex-wrap items-end gap-2">
          <form action={actionApproveProductionJournal} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="productionJournalId" value={journal.id} />
            <label className="text-[10px] uppercase text-slate-500">
              Quantity
              <Input
                name="quantity"
                type="number"
                step="any"
                min="0"
                defaultValue={String(qty)}
                className="mt-0.5 h-8 w-24"
              />
            </label>
            {lines.map((line) => (
              <label key={line.lineId} className="text-[10px] uppercase text-slate-500">
                {line.partNumber || "Line"}
                <Input
                  name={`lineQty_${line.lineId}`}
                  type="number"
                  step="any"
                  min="0"
                  defaultValue={String(line.quantityRequested)}
                  className="mt-0.5 h-8 w-24"
                />
              </label>
            ))}
            <label className="text-[10px] uppercase text-slate-500">
              Qty change note
              <Input
                name="quantityEditNote"
                placeholder="Optional"
                className="mt-0.5 h-8 w-40 text-xs"
              />
            </label>
            <Button type="submit" size="sm">
              Approve and post
            </Button>
          </form>
          <form action={actionRejectProductionJournal} className="flex flex-wrap items-end gap-1">
            <input type="hidden" name="productionJournalId" value={journal.id} />
            <Input
              name="reason"
              required
              placeholder="Reason (required)"
              className="h-8 w-44 text-xs"
            />
            <Button type="submit" size="sm" variant="outline">
              Reject
            </Button>
          </form>
        </div>
      )}
      {pending && !canDecide && (
        <p className="text-[11px] text-slate-500">
          Waiting on an assigned approver. This job cannot close until the journal is posted or returned.
        </p>
      )}
    </div>
  );
}
