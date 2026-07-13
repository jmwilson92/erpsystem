"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fireConfetti } from "@/lib/confetti";
import { actionReviewTimecard } from "@/app/actions";
import type { TimecardReviewItem } from "@/lib/services/timesheets";
import { Clock, ChevronRight, X } from "lucide-react";

function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function TimecardReviewQueue({
  items,
}: {
  items: (Omit<TimecardReviewItem, "periodStart" | "periodEnd"> & {
    periodStart: string;
    periodEnd: string;
  })[];
}) {
  const [queue, setQueue] = useState(items);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function decide(
    timesheetId: string,
    decision: "APPROVED" | "REJECTED",
    notes?: string
  ) {
    startTransition(async () => {
      const res = await actionReviewTimecard({ timesheetId, decision, notes });
      if (!res.ok) {
        toast.error(res.error || "Could not record the decision");
        return;
      }
      setQueue((q) => q.filter((i) => i.timesheetId !== timesheetId));
      setRejecting(null);
      setReason("");
      toast.success(
        decision === "APPROVED" ? "Timecard approved" : "Timecard rejected"
      );
      if (res.remaining === 0) {
        // Queue cleared — celebrate.
        fireConfetti();
        setTimeout(
          () => toast.success("Queue cleared — every timecard reviewed! 🎉"),
          150
        );
      }
    });
  }

  if (queue.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-8 text-center text-sm text-slate-500">
        No timecards waiting on you. 🎉
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800">
      <div className="grid grid-cols-12 gap-2 border-b border-slate-800 bg-slate-900/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        <div className="col-span-4">Employee</div>
        <div className="col-span-3">Period</div>
        <div className="col-span-2 text-right">Your buckets</div>
        <div className="col-span-3 text-right">Decision</div>
      </div>
      {queue.map((item) => (
        <div key={item.timesheetId} className="border-b border-slate-800/60 last:border-0">
          <div className="grid grid-cols-12 items-center gap-2 px-4 py-3 transition-colors hover:bg-slate-900/40">
            <div className="col-span-4 min-w-0">
              <Link
                href={`/hr/timesheet/${item.timesheetId}`}
                className="group flex items-center gap-1.5"
              >
                <span className="truncate text-sm font-medium text-slate-200 group-hover:text-teal-300">
                  {item.employeeName}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-teal-400" />
              </Link>
              <p className="truncate text-[11px] text-slate-500">
                {item.employeeTitle || "—"}
                {item.department ? ` · ${item.department}` : ""}
              </p>
            </div>
            <div className="col-span-3 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-slate-600" />
                {fmt(item.periodStart)} → {fmt(item.periodEnd)}
              </span>
              <span className="text-[11px] text-slate-600">
                {item.totalHours}h on the card
              </span>
            </div>
            <div className="col-span-2 text-right">
              <span className="tabular-nums text-sm text-teal-400">
                {item.myHours}h
              </span>
              <p className="truncate text-[11px] text-slate-600">
                {item.myBuckets.map((b) => b.label).join(", ")}
              </p>
            </div>
            <div className="col-span-3 flex justify-end gap-1.5">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => decide(item.timesheetId, "APPROVED")}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  setRejecting((r) =>
                    r === item.timesheetId ? null : item.timesheetId
                  )
                }
              >
                Reject
              </Button>
            </div>
          </div>
          {rejecting === item.timesheetId && (
            <div className="flex items-center gap-2 border-t border-slate-800/60 bg-rose-500/5 px-4 py-2.5">
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for rejection (required) — the employee sees this"
                className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 placeholder:text-slate-600"
              />
              <Button
                size="sm"
                variant="outline"
                disabled={pending || !reason.trim()}
                onClick={() =>
                  decide(item.timesheetId, "REJECTED", reason.trim())
                }
              >
                Confirm reject
              </Button>
              <button
                onClick={() => {
                  setRejecting(null);
                  setReason("");
                }}
                className="rounded-lg p-1.5 text-slate-500 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
