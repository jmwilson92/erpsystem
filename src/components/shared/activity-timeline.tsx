import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History } from "lucide-react";

function humanize(action: string) {
  const s = action.replace(/[_-]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function metaSummary(raw: string | null): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return "";
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (parts.length >= 3) break;
      if (v == null) continue;
      if (typeof v === "object") {
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          parts.push(`${k}: ${v.slice(0, 3).join(", ")}${v.length > 3 ? "…" : ""}`);
        }
        continue;
      }
      const val = String(v);
      parts.push(`${k}: ${val.length > 60 ? `${val.slice(0, 57)}…` : val}`);
    }
    return parts.join(" · ");
  } catch {
    return "";
  }
}

function when(d: Date) {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * "Who did what, when" for any record — reads the audit log that every
 * service already writes. Drop into a detail page with the record's
 * entityType/entityId.
 */
export async function ActivityTimeline({
  entityType,
  entityId,
  extraIds,
  limit = 15,
}: {
  entityType: string;
  entityId: string;
  /** Additional entity ids whose events belong on this record's trail. */
  extraIds?: { entityType: string; entityId: string }[];
  limit?: number;
}) {
  const scopes = [{ entityType, entityId }, ...(extraIds || [])];
  const events = await prisma.auditLog.findMany({
    where: { OR: scopes },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  if (events.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-slate-500" />
          Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="relative ml-1.5 space-y-0 border-l border-slate-800">
          {events.map((e) => {
            const meta = metaSummary(e.metadata);
            return (
              <li key={e.id} className="relative pb-3 pl-4 last:pb-0">
                <span className="absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full border border-slate-600 bg-slate-900" />
                <p className="text-sm text-slate-300">
                  {humanize(e.action)}
                  <span className="ml-2 text-xs text-slate-500">
                    {e.user?.name || "System"} · {when(e.createdAt)}
                  </span>
                </p>
                {meta && (
                  <p className="mt-0.5 break-all text-[11px] text-slate-500">
                    {meta}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
