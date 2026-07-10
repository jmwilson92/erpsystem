"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import Link from "next/link";
import {
  actionAssignCmNumber,
  actionRejectCmNumberRequest,
  actionCancelCmNumberRequest,
  actionRegisterCmNumber,
  actionUpdateCmNumberScheme,
  actionUpdateRegistryStatus,
} from "@/app/actions";
import { NumberRequestForm } from "@/components/cm/number-request-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, cn } from "@/lib/utils";
import {
  BookMarked,
  ClipboardList,
  Settings2,
  ListOrdered,
  Check,
  X,
} from "lucide-react";

const selectClass =
  "flex h-9 w-full rounded-md border border-slate-700 bg-slate-950 px-2 text-sm text-slate-200";

type Scheme = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  appliesTo: string;
  prefix: string;
  separator: string;
  padLength: number;
  suffix: string | null;
  nextSequence: number;
  example: string | null;
  isActive: boolean;
  sortOrder: number;
};

type NumberRequest = {
  id: string;
  requestNumber: string;
  status: string;
  category: string;
  title: string;
  description: string | null;
  preferredNumber: string | null;
  productName: string | null;
  assignedNumber: string | null;
  assignedAt: string | null;
  cmNotes: string | null;
  rejectedReason: string | null;
  requestedByName: string | null;
  createdAt: string;
  scheme: { id: string; code: string; name: string; example: string | null } | null;
};

type RegistryRow = {
  id: string;
  number: string;
  category: string;
  title: string;
  description: string | null;
  status: string;
  productName: string | null;
  assignedAt: string;
  notes: string | null;
  scheme: { id: string; code: string; name: string; prefix: string } | null;
  request: {
    id: string;
    requestNumber: string;
    requestedByName: string | null;
    status: string;
  } | null;
};

type Panel = "request" | "requests" | "master" | "schemes";

export function CmNumbersPanel({
  schemes,
  requests,
  registry,
  productFolders,
  initialPanel = "request",
  searchQuery = "",
}: {
  schemes: Scheme[];
  requests: NumberRequest[];
  registry: RegistryRow[];
  productFolders: { id: string; name: string; productName: string | null }[];
  initialPanel?: Panel;
  searchQuery?: string;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(initialPanel);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [assignOverrides, setAssignOverrides] = useState<
    Record<string, string>
  >({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>(
    {}
  );

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  const filteredRegistry = useMemo(() => {
    const q = localSearch.trim().toUpperCase();
    return registry.filter((r) => {
      if (filterCat && r.category !== filterCat) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (!q) return true;
      return (
        r.number.includes(q) ||
        r.title.toUpperCase().includes(q) ||
        (r.productName || "").toUpperCase().includes(q)
      );
    });
  }, [registry, filterCat, filterStatus, localSearch]);

  function runAction(
    fn: (fd: FormData) => Promise<void>,
    fd: FormData
  ) {
    setError(null);
    startTransition(async () => {
      try {
        await fn(fd);
        router.refresh();
      } catch (err) {
        if (isRedirectError(err)) throw err;
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  const tabs: {
    id: Panel;
    label: string;
    icon: typeof ClipboardList;
    badge?: number;
  }[] = [
    { id: "request", label: "Request number", icon: ClipboardList },
    {
      id: "requests",
      label: "Request queue",
      icon: ListOrdered,
      badge: pendingCount,
    },
    { id: "master", label: "Master list", icon: BookMarked },
    { id: "schemes", label: "Number schemes", icon: Settings2 },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        <strong className="text-slate-200">How number control works</strong>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
          <li>
            Anyone requests a part number or document number (drawing, policy,
            test, form, etc.).
          </li>
          <li>
            CM manager assigns a number using the company scheme (or a manual
            override) — it is recorded on the{" "}
            <strong className="text-slate-300">master list</strong>.
          </li>
          <li>
            The requester uses that assigned number when filing their ECR so
            the document can move through CM.
          </li>
        </ol>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setPanel(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
                panel === t.id
                  ? "bg-slate-800 text-slate-50"
                  : "text-slate-400 hover:text-slate-200"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className="ml-0.5 rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-300">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-md border border-rose-900/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      )}

      {/* ── Request form ── */}
      {panel === "request" && (
        <NumberRequestForm schemes={schemes} productFolders={productFolders} />
      )}

      {/* ── CM request queue ── */}
      {panel === "requests" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            CM assigns controlled numbers to pending requests. Assigned numbers
            appear on the master list as RESERVED until the requester files an
            ECR.
          </p>
          {requests.length === 0 && (
            <p className="text-sm text-slate-500">No number requests yet.</p>
          )}
          {requests.map((r) => (
            <Card
              key={r.id}
              className={cn(
                "border-slate-800",
                r.status === "PENDING" && "border-amber-900/40"
              )}
            >
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-violet-300">
                        {r.requestNumber}
                      </span>
                      <StatusBadge status={r.status} />
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                        {r.category}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-100">
                      {r.title}
                    </p>
                    {r.description && (
                      <p className="mt-0.5 text-xs text-slate-400">
                        {r.description}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      Requested by {r.requestedByName || "—"} ·{" "}
                      {formatDate(r.createdAt)}
                      {r.productName ? ` · ${r.productName}` : ""}
                      {r.preferredNumber
                        ? ` · preferred ${r.preferredNumber}`
                        : ""}
                    </p>
                  </div>
                  {r.assignedNumber && (
                    <div className="rounded-md border border-teal-800/50 bg-teal-950/30 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase text-teal-500/80">
                        Assigned
                      </p>
                      <p className="font-mono text-lg text-teal-300">
                        {r.assignedNumber}
                      </p>
                    </div>
                  )}
                </div>

                {r.status === "PENDING" && (
                  <div className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/50 p-3 sm:grid-cols-3">
                    <div className="sm:col-span-1">
                      <label className="text-[10px] uppercase text-slate-500">
                        Assign number{" "}
                        <span className="normal-case text-slate-600">
                          (blank = next from scheme
                          {r.scheme?.example
                            ? `: ${r.scheme.example}`
                            : ""}
                          )
                        </span>
                      </label>
                      <Input
                        className="mt-1 font-mono"
                        placeholder={
                          r.preferredNumber ||
                          r.scheme?.example ||
                          "Auto from scheme"
                        }
                        value={assignOverrides[r.id] ?? ""}
                        onChange={(e) =>
                          setAssignOverrides((p) => ({
                            ...p,
                            [r.id]: e.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </div>
                    <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        className="gap-1"
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("requestId", r.id);
                          if (assignOverrides[r.id]?.trim()) {
                            fd.set(
                              "overrideNumber",
                              assignOverrides[r.id].trim()
                            );
                          }
                          runAction(actionAssignCmNumber, fd);
                        }}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Assign number
                      </Button>
                      <Input
                        className="max-w-[220px]"
                        placeholder="Reject reason…"
                        value={rejectReasons[r.id] ?? ""}
                        onChange={(e) =>
                          setRejectReasons((p) => ({
                            ...p,
                            [r.id]: e.target.value,
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !(rejectReasons[r.id] || "").trim()}
                        className="gap-1 border-rose-800/50 text-rose-300"
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("requestId", r.id);
                          fd.set("reason", rejectReasons[r.id] || "");
                          runAction(actionRejectCmNumberRequest, fd);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        className="text-slate-500"
                        onClick={() => {
                          const fd = new FormData();
                          fd.set("requestId", r.id);
                          runAction(actionCancelCmNumberRequest, fd);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {r.status === "REJECTED" && r.rejectedReason && (
                  <p className="text-xs text-rose-400">
                    Rejected: {r.rejectedReason}
                  </p>
                )}
                {r.status === "ASSIGNED" && (
                  <p className="text-xs text-teal-400/90">
                    Use <span className="font-mono">{r.assignedNumber}</span> when
                    creating your document ECR on the{" "}
                    <Link
                      href="/cm?tab=submissions"
                      className="underline hover:text-teal-300"
                    >
                      CM submissions
                    </Link>{" "}
                    tab.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Master list ── */}
      {panel === "master" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <label className="text-[10px] uppercase text-slate-500">
                Search
              </label>
              <Input
                className="mt-1 font-mono"
                placeholder="Number, title, product…"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Category
              </label>
              <select
                className={`${selectClass} mt-1 w-[140px]`}
                value={filterCat}
                onChange={(e) => setFilterCat(e.target.value)}
              >
                <option value="">All</option>
                {schemes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase text-slate-500">
                Status
              </label>
              <select
                className={`${selectClass} mt-1 w-[130px]`}
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">All</option>
                <option value="RESERVED">Reserved</option>
                <option value="ACTIVE">Active</option>
                <option value="RELEASED">Released</option>
                <option value="OBSOLETE">Obsolete</option>
              </select>
            </div>
          </div>

          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Master CM number list{" "}
                <span className="text-sm font-normal text-slate-500">
                  ({filteredRegistry.length})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-800 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Number</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Title</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Request</th>
                    <th className="px-3 py-2">Assigned</th>
                    <th className="px-3 py-2">CM</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRegistry.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-8 text-center text-slate-500"
                      >
                        No numbers on the master list yet. Assign a request or
                        register legacy numbers below.
                      </td>
                    </tr>
                  )}
                  {filteredRegistry.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-slate-800/80 hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 font-mono text-teal-300">
                        {row.number}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.category}
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        <div>{row.title}</div>
                        {row.description && (
                          <div className="text-[11px] text-slate-500 line-clamp-1">
                            {row.description}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.productName || "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-400">
                        {row.request ? (
                          <span>
                            {row.request.requestNumber}
                            {row.request.requestedByName
                              ? ` · ${row.request.requestedByName}`
                              : ""}
                          </span>
                        ) : (
                          "Manual"
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-500">
                        {formatDate(row.assignedAt)}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="h-7 rounded border border-slate-700 bg-slate-950 px-1 text-[11px] text-slate-300"
                          value={row.status}
                          disabled={pending}
                          onChange={(e) => {
                            const fd = new FormData();
                            fd.set("id", row.id);
                            fd.set("status", e.target.value);
                            runAction(actionUpdateRegistryStatus, fd);
                          }}
                        >
                          <option value="RESERVED">RESERVED</option>
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="RELEASED">RELEASED</option>
                          <option value="OBSOLETE">OBSOLETE</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Manual register (CM bootstrap / legacy) */}
          <Card className="border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Manually register a number
              </CardTitle>
              <p className="text-xs text-slate-500">
                For legacy numbers or CM-only adds without a request.
              </p>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3 sm:grid-cols-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  runAction(actionRegisterCmNumber, fd);
                  e.currentTarget.reset();
                }}
              >
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Number *
                  </label>
                  <Input name="number" required className="mt-1 font-mono" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Category *
                  </label>
                  <select
                    name="category"
                    required
                    className={`${selectClass} mt-1`}
                    defaultValue="DRAWING"
                  >
                    {schemes.map((s) => (
                      <option key={s.id} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Status
                  </label>
                  <select
                    name="status"
                    className={`${selectClass} mt-1`}
                    defaultValue="ACTIVE"
                  >
                    <option value="RESERVED">Reserved</option>
                    <option value="ACTIVE">Active</option>
                    <option value="RELEASED">Released</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="text-[10px] uppercase text-slate-500">
                    Title *
                  </label>
                  <Input name="title" required className="mt-1" />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-slate-500">
                    Product
                  </label>
                  <Input name="productName" className="mt-1" />
                </div>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm" disabled={pending}>
                    Add to master list
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Schemes ── */}
      {panel === "schemes" && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Customize prefixes, padding, and next sequence for each document /
            part type so numbering matches your company policy. Format:{" "}
            <span className="font-mono text-slate-400">
              PREFIX + separator + zero-padded sequence [+ separator + suffix]
            </span>
          </p>
          {schemes.map((s) => (
            <Card key={s.id} className="border-slate-800">
              <CardContent className="p-4">
                <form
                  className="grid gap-3 sm:grid-cols-6"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    fd.set("id", s.id);
                    runAction(actionUpdateCmNumberScheme, fd);
                  }}
                >
                  <div className="sm:col-span-2">
                    <p className="text-[10px] uppercase text-slate-500">
                      {s.code} · {s.appliesTo}
                    </p>
                    <Input
                      name="name"
                      defaultValue={s.name}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Prefix
                    </label>
                    <Input
                      name="prefix"
                      defaultValue={s.prefix}
                      className="mt-1 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Sep
                    </label>
                    <Input
                      name="separator"
                      defaultValue={s.separator}
                      className="mt-1 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Pad
                    </label>
                    <Input
                      name="padLength"
                      type="number"
                      min={1}
                      max={10}
                      defaultValue={s.padLength}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Next seq
                    </label>
                    <Input
                      name="nextSequence"
                      type="number"
                      min={1}
                      defaultValue={s.nextSequence}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-slate-500">
                      Suffix
                    </label>
                    <Input
                      name="suffix"
                      defaultValue={s.suffix || ""}
                      className="mt-1 font-mono"
                      placeholder="optional"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="text-[10px] uppercase text-slate-500">
                      Description
                    </label>
                    <Textarea
                      name="description"
                      rows={2}
                      defaultValue={s.description || ""}
                      className="mt-1"
                    />
                  </div>
                  <div className="flex flex-col justify-end gap-2 sm:col-span-2">
                    <p className="font-mono text-sm text-violet-300">
                      Next:{" "}
                      {s.example ||
                        `${s.prefix}${s.separator}${String(s.nextSequence).padStart(s.padLength, "0")}`}
                    </p>
                    <label className="flex items-center gap-2 text-xs text-slate-400">
                      <input
                        type="checkbox"
                        name="isActiveOn"
                        value="true"
                        defaultChecked={s.isActive}
                        className="rounded border-slate-600"
                      />
                      Active
                    </label>
                  </div>
                  <div className="flex items-end sm:col-span-1">
                    <Button type="submit" size="sm" disabled={pending}>
                      Save
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
