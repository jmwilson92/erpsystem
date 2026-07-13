"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { NAV_GROUPS } from "@/lib/navigation";
import { FileSearch, Loader2 } from "lucide-react";

type SearchHit = {
  type: string;
  label: string;
  sublabel: string;
  href: string;
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Debounced record search against /api/search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = search.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits(Array.isArray(data.hits) ? data.hits : []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const run = useCallback(
    (href: string) => {
      onOpenChange(false);
      setSearch("");
      setHits([]);
      router.push(href);
    },
    [router, onOpenChange]
  );

  if (!open) return null;

  // Manual module filtering (cmdk's filter is off so record hits always show)
  const q = search.trim().toLowerCase();
  const moduleGroups = NAV_GROUPS.map((g) => ({
    label: g.label,
    items: g.items.filter(
      (p) =>
        !q ||
        p.label.toLowerCase().includes(q) ||
        (p.keywords || []).some((k) => k.toLowerCase().includes(q))
    ),
  })).filter((g) => g.items.length > 0);

  const empty = hits.length === 0 && moduleGroups.length === 0 && !searching;

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute left-1/2 top-[20%] w-full max-w-xl -translate-x-1/2 px-4">
        <Command
          shouldFilter={false}
          className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
          label="Global command palette"
        >
          <div className="flex items-center border-b border-slate-800 px-3">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Search WOs, POs, parts, people… or jump to a module"
              className="h-12 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
            {searching && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-slate-500" />
            )}
          </div>
          <Command.List className="max-h-96 overflow-y-auto p-2">
            {empty && (
              <div className="py-6 text-center text-sm text-slate-500">
                No results found.
              </div>
            )}
            {hits.length > 0 && (
              <Command.Group
                heading="Records"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600"
              >
                {hits.map((h) => (
                  <Command.Item
                    key={h.href}
                    value={h.href}
                    onSelect={() => run(h.href)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-slate-300 aria-selected:bg-teal-500/10 aria-selected:text-teal-300"
                  >
                    <FileSearch className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{h.label}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {h.sublabel}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                      {h.type}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
            {moduleGroups.map((group) => (
              <Command.Group
                key={group.label}
                heading={group.label}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600"
              >
                {group.items.map((page) => {
                  const Icon = page.icon;
                  return (
                    <Command.Item
                      key={page.href}
                      value={page.href}
                      onSelect={() => run(page.href)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-300 aria-selected:bg-teal-500/10 aria-selected:text-teal-300"
                    >
                      <Icon className="h-4 w-4 opacity-70" />
                      {page.label}
                    </Command.Item>
                  );
                })}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
