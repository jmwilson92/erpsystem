import { StatusBadge } from "@/components/shared/status-badge";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  body: string;
  isStaff: boolean;
  createdAt: Date | string;
  author: { id: string; name: string; role?: string | null } | null;
};

export function ChatThread({
  messages,
  currentUserId,
}: {
  messages: ChatMessage[];
  currentUserId: string;
}) {
  if (messages.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-slate-500">
        No messages yet. Say hello.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const mine = m.author?.id === currentUserId;
        return (
          <div
            key={m.id}
            className={cn(
              "flex flex-col gap-1",
              mine ? "items-end" : "items-start"
            )}
          >
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="font-medium text-slate-400">
                {m.author?.name || "Someone"}
              </span>
              {m.isStaff && (
                <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                  Staff
                </span>
              )}
              <time dateTime={new Date(m.createdAt).toISOString()}>
                {formatWhen(m.createdAt)}
              </time>
            </div>
            <div
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                mine
                  ? "rounded-br-md bg-teal-600/90 text-white"
                  : m.isStaff
                    ? "rounded-bl-md border border-violet-500/30 bg-violet-500/10 text-slate-100"
                    : "rounded-bl-md border border-slate-800 bg-slate-900/80 text-slate-200"
              )}
            >
              {m.body}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TicketMetaPills({
  status,
  priority,
  category,
}: {
  status: string;
  priority: string;
  category: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={status} />
      <StatusBadge status={priority} />
      <span className="rounded-md border border-slate-800 px-2 py-0.5 text-xs text-slate-400">
        {category.replace(/_/g, " ")}
      </span>
    </div>
  );
}

function formatWhen(d: Date | string) {
  const date = new Date(d);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
