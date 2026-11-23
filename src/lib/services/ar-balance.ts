/** Open AR is invoice total minus cash applied minus sales-return credits. */
export function openReceivable(inv: {
  total: number;
  amountPaid: number;
  amountCredited?: number | null;
}) {
  return Math.round(((inv.total || 0) - (inv.amountPaid || 0) - (inv.amountCredited || 0)) * 100) / 100;
}
