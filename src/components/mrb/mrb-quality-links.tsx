import Link from "next/link";
import { Ruler, Zap, ScanEye, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  actionLinkCalToolToMrb,
  actionSetCalToolDisposition,
  actionTriggerIncidentFromMrb,
} from "@/app/actions";

const selectClass =
  "flex h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200";

/**
 * Per-MRB-case panel: link a suspect calibration tool (and disposition whether
 * to pull it for recal), and flag the nonconformance as ESD- or FOD-caused,
 * which opens an incident in that program that runs a disposition process.
 */
export function MrbQualityLinks({
  mrb,
  calTools,
  canManage,
}: {
  mrb: {
    id: string;
    calToolId: string | null;
    calToolIdentifier: string | null;
    calToolDisposition: string | null;
    esdEventId: string | null;
    fodEventId: string | null;
    suspectCounterfeit: boolean;
    counterfeitEventId: string | null;
  };
  calTools: { id: string; identifier: string; name: string }[];
  canManage: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3" data-tour="mrb-quality-links">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quality program links</p>

      {/* Calibration tool */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Ruler className="h-4 w-4 text-slate-500" />
        {mrb.calToolId ? (
          <>
            <span className="text-slate-300">
              Suspect tool <span className="font-mono text-teal-400">{mrb.calToolIdentifier}</span>
            </span>
            {mrb.calToolDisposition && mrb.calToolDisposition !== "PENDING" && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                  mrb.calToolDisposition === "PULL_FOR_RECAL"
                    ? "bg-rose-500/15 text-rose-300"
                    : "bg-slate-700/40 text-slate-300"
                }`}
              >
                {mrb.calToolDisposition.replace(/_/g, " ")}
              </span>
            )}
            {canManage && mrb.calToolDisposition === "PENDING" && (
              <form action={actionSetCalToolDisposition} className="flex items-center gap-1">
                <input type="hidden" name="mrbCaseId" value={mrb.id} />
                <Button type="submit" name="disposition" value="PULL_FOR_RECAL" size="sm" variant="outline" className="h-7 text-[11px] text-rose-300">
                  Pull for recal
                </Button>
                <Button type="submit" name="disposition" value="NO_ACTION" size="sm" variant="ghost" className="h-7 text-[11px]">
                  No action
                </Button>
              </form>
            )}
            {canManage && (
              <form action={actionLinkCalToolToMrb}>
                <input type="hidden" name="mrbCaseId" value={mrb.id} />
                <input type="hidden" name="toolId" value="" />
                <Button type="submit" size="sm" variant="ghost" className="h-7 text-[11px] text-slate-500">
                  Unlink
                </Button>
              </form>
            )}
          </>
        ) : canManage ? (
          <form action={actionLinkCalToolToMrb} className="flex items-center gap-1">
            <input type="hidden" name="mrbCaseId" value={mrb.id} />
            <select name="toolId" defaultValue="" className={selectClass}>
              <option value="">Link a calibration tool…</option>
              {calTools.map((t) => (
                <option key={t.id} value={t.id}>{t.identifier} — {t.name}</option>
              ))}
            </select>
            <Button type="submit" size="sm" variant="outline" className="h-8 text-[11px]">Link</Button>
          </form>
        ) : (
          <span className="text-xs text-slate-500">No calibration tool linked.</span>
        )}
      </div>

      {/* ESD / FOD cause → incident */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Zap className="h-4 w-4 text-slate-500" />
        {mrb.esdEventId ? (
          <Link href={`/quality/programs/incident/${mrb.esdEventId}`} className="text-teal-400 hover:underline">
            ESD incident opened →
          </Link>
        ) : (
          canManage && (
            <form action={actionTriggerIncidentFromMrb}>
              <input type="hidden" name="mrbCaseId" value={mrb.id} />
              <input type="hidden" name="programKey" value="esd" />
              <Button type="submit" size="sm" variant="outline" className="h-7 text-[11px]">
                Caused by ESD → open incident
              </Button>
            </form>
          )
        )}
        <ScanEye className="ml-2 h-4 w-4 text-slate-500" />
        {mrb.fodEventId ? (
          <Link href={`/quality/programs/incident/${mrb.fodEventId}`} className="text-teal-400 hover:underline">
            FOD incident opened →
          </Link>
        ) : (
          canManage && (
            <form action={actionTriggerIncidentFromMrb}>
              <input type="hidden" name="mrbCaseId" value={mrb.id} />
              <input type="hidden" name="programKey" value="fod" />
              <Button type="submit" size="sm" variant="outline" className="h-7 text-[11px]">
                Caused by FOD → open incident
              </Button>
            </form>
          )
        )}
      </div>

      {/* Suspect counterfeit */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ShieldAlert className="h-4 w-4 text-slate-500" />
        {mrb.counterfeitEventId ? (
          <Link href={`/quality/programs/incident/${mrb.counterfeitEventId}`} className="text-rose-300 hover:underline">
            Suspect counterfeit — tracked in Counterfeit program →
          </Link>
        ) : (
          canManage && (
            <form action={actionTriggerIncidentFromMrb}>
              <input type="hidden" name="mrbCaseId" value={mrb.id} />
              <input type="hidden" name="programKey" value="counterfeit" />
              <Button type="submit" size="sm" variant="outline" className="h-7 text-[11px] text-rose-300">
                Suspect counterfeit → log &amp; track
              </Button>
            </form>
          )
        )}
      </div>
    </div>
  );
}
