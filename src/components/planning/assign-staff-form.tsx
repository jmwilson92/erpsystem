"use client";

import { useState, useTransition } from "react";
import { actionAssignWorkCenterStaff } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type UserOpt = { id: string; name: string };
type Assignment = { workCenterId: string; code: string; name: string };

export function AssignStaffForm({
  workCenterId,
  workCenterCode,
  users,
  assignmentsByUser,
  selectClass,
}: {
  workCenterId: string;
  workCenterCode: string;
  users: UserOpt[];
  /** userId → current active center (if any) */
  assignmentsByUser: Record<string, Assignment>;
  selectClass: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);
  const [userId, setUserId] = useState("");

  const selectedElsewhere =
    userId &&
    assignmentsByUser[userId] &&
    assignmentsByUser[userId].workCenterId !== workCenterId
      ? assignmentsByUser[userId]
      : null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await actionAssignWorkCenterStaff(fd);
        if (result?.movedFrom) {
          setMessage({
            type: "ok",
            text: `Moved from ${result.movedFrom.code} to ${workCenterCode}.`,
          });
        } else {
          setMessage({ type: "ok", text: `Assigned to ${workCenterCode}.` });
        }
        setUserId("");
        // Refresh server data so assigned lists update
        window.location.href = `/planning?tab=capacity`;
      } catch (err) {
        setMessage({
          type: "err",
          text:
            err instanceof Error
              ? err.message
              : "Could not assign staff to this work center.",
        });
      }
    });
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-end gap-2 border-t border-slate-800 pt-3"
    >
      <input type="hidden" name="workCenterId" value={workCenterId} />
      <div>
        <label className="text-[10px] uppercase text-slate-500">
          Assign staff (one center per person)
        </label>
        <select
          name="userId"
          required
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className={`${selectClass} mt-1 min-w-[14rem]`}
        >
          <option value="">— Person —</option>
          {users.map((u) => {
            const a = assignmentsByUser[u.id];
            const here = a?.workCenterId === workCenterId;
            if (here) {
              return (
                <option key={u.id} value={u.id} disabled>
                  {u.name} (already here)
                </option>
              );
            }
            if (a) {
              return (
                <option key={u.id} value={u.id}>
                  {u.name} — move from {a.code}
                </option>
              );
            }
            return (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            );
          })}
        </select>
      </div>
      <div>
        <label className="text-[10px] uppercase text-slate-500">Hrs/day</label>
        <Input
          name="hoursPerDay"
          type="number"
          defaultValue={8}
          min={1}
          max={24}
          className="mt-1 w-20"
        />
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending
          ? "Saving…"
          : selectedElsewhere
            ? `Move from ${selectedElsewhere.code}`
            : "Add"}
      </Button>
      {selectedElsewhere && (
        <p className="w-full text-[11px] text-amber-400/90">
          {selectedElsewhere.code} will lose this person when you move them
          here.
        </p>
      )}
      {message && (
        <p
          className={`w-full text-[11px] ${
            message.type === "ok" ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {message.text}
        </p>
      )}
    </form>
  );
}
