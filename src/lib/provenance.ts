/**
 * Derives "why is this tag showing" metadata for status badges: a hover
 * hint plus a link to the record driving the status.
 */

type HistoryEntry = {
  toStatus: string;
  notes: string | null;
  createdAt: Date;
};

export function workOrderHoldProvenance(wo: {
  status: string;
  mrbCaseId?: string | null;
  statusHistory?: HistoryEntry[];
}): { hint: string | null; href: string | null } {
  if (wo.status !== "ON_HOLD") return { hint: null, href: null };
  const holdEntry = [...(wo.statusHistory || [])]
    .reverse()
    .find((h) => h.toStatus === "ON_HOLD");
  const hint = holdEntry?.notes || "On hold — see status trail";
  // Link to whatever the hold references: MRB case, NCR, else the trail.
  let href: string | null = null;
  if (wo.mrbCaseId) href = "/mrb";
  else if (/NCR-\d+/.test(hint)) href = "/quality";
  return { hint, href };
}

/** MRB-spawned work orders: show which case created them. */
export function workOrderMrbProvenance(wo: {
  type: string;
  mrbCaseId?: string | null;
  mrbCase?: { number: string } | null;
}): { hint: string | null; href: string | null } {
  if (!wo.mrbCaseId) return { hint: null, href: null };
  return {
    hint: `Created by MRB disposition${wo.mrbCase ? ` ${wo.mrbCase.number}` : ""}`,
    href: "/mrb",
  };
}
