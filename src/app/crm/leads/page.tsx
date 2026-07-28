import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listUsers } from "@/lib/auth";
import { LEAD_STATUSES, listLeads } from "@/lib/services/crm";
import { checkModuleHealth } from "@/lib/services/module-health";
import { ModuleNotMigrated } from "@/components/shared/module-not-migrated";
import {
  actionConvertLead,
  actionCreateLead,
  actionUpdateLeadStatus,
} from "../actions";

export const dynamic = "force-dynamic";

const selectClass =
  "mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200";

const STATUS_TONE: Record<string, string> = {
  NEW: "text-sky-300",
  WORKING: "text-amber-300",
  QUALIFIED: "text-emerald-300",
  DISQUALIFIED: "text-slate-500",
  CONVERTED: "text-teal-300",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const health = await checkModuleHealth(() => listLeads());
  if (!health.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="Leads" description="Inbound interest before it's a deal." />
        <ModuleNotMigrated module="CRM" health={health} />
      </div>
    );
  }

  const { status } = await searchParams;
  // No status filter = open leads only (listLeads hides converted/disqualified).
  const [all, users] = await Promise.all([
    listLeads(status),
    listUsers().catch(() => []),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leads"
        description="Inbound interest that hasn't been qualified into a deal yet. Convert a lead and it becomes an opportunity — the lead is kept so you can still answer where deals come from."
      />

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Link href="/crm" className="text-teal-300 hover:underline">
          ← Pipeline
        </Link>
        <span className="text-slate-600">|</span>
        <Link
          href="/crm/leads"
          className={!status ? "text-teal-300" : "text-slate-400 hover:text-slate-200"}
        >
          Open
        </Link>
        {LEAD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/crm/leads?status=${s}`}
            className={status === s ? "text-teal-300" : "text-slate-400 hover:text-slate-200"}
          >
            {s}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {status || "Open"} leads <span className="text-xs font-normal text-slate-500">({all.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {all.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-800 py-10 text-center text-sm text-slate-500">
              No open leads — capture one below.
            </p>
          ) : (
            <div className="space-y-2">
              {all.map((l) => (
                <div
                  key={l.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/40 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200">{l.company}</p>
                      <p className="text-xs text-slate-500">
                        {[l.contactName, l.email, l.phone].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {l.source && (
                        <p className="text-[11px] text-slate-600">via {l.source}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 text-xs font-medium ${STATUS_TONE[l.status] || ""}`}
                    >
                      {l.status}
                      {l.ownerId && (
                        <span className="ml-2 text-slate-500">
                          {userName.get(l.ownerId) || ""}
                        </span>
                      )}
                    </span>
                  </div>
                  {l.notes && (
                    <p className="mt-1 text-xs text-slate-400">{l.notes}</p>
                  )}

                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-800 pt-2">
                    <form action={actionUpdateLeadStatus} className="flex items-end gap-1.5">
                      <input type="hidden" name="id" value={l.id} />
                      <select
                        key={`ls-${l.status}`}
                        name="status"
                        defaultValue={l.status}
                        className="h-8 rounded-md border border-slate-700 bg-slate-950 px-2 text-[11px] text-slate-200"
                      >
                        {LEAD_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
                      >
                        Set
                      </button>
                    </form>

                    {l.status !== "CONVERTED" && (
                      <form action={actionConvertLead} className="flex flex-wrap items-end gap-1.5">
                        <input type="hidden" name="leadId" value={l.id} />
                        <label className="text-[11px] text-slate-500">
                          Est. value
                          <Input
                            name="value"
                            type="number"
                            step="0.01"
                            className="h-8 w-28"
                            placeholder="25000"
                          />
                        </label>
                        <label className="text-[11px] text-slate-500">
                          Expected close
                          <Input name="expectedCloseAt" type="date" className="h-8 w-36" />
                        </label>
                        <Button type="submit" size="sm" variant="outline">
                          Convert to deal
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Capture a lead</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={actionCreateLead} className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs text-slate-500">
              Company *
              <Input name="company" required placeholder="Acme Fabrication" />
            </label>
            <label className="text-xs text-slate-500">
              Contact
              <Input name="contactName" placeholder="Dana Ruiz" />
            </label>
            <label className="text-xs text-slate-500">
              Email
              <Input name="email" type="email" placeholder="dana@acme.com" />
            </label>
            <label className="text-xs text-slate-500">
              Phone
              <Input name="phone" placeholder="555-0142" />
            </label>
            <label className="text-xs text-slate-500">
              Source
              <Input name="source" placeholder="Website, referral, trade show" />
            </label>
            <label className="text-xs text-slate-500">
              Owner
              <select name="ownerId" className={selectClass} defaultValue="">
                <option value="">Me</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500 sm:col-span-3">
              Notes
              <Input name="notes" placeholder="What they're after" />
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" size="sm">
                Add lead
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
