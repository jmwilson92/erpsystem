"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Factory,
  ClipboardList,
  FileText,
  Boxes,
  ShoppingCart,
  Package,
  FlaskConical,
  Gauge,
  FolderKanban,
  Landmark,
  Truck,
  Award,
  Network,
  Monitor,
  Shield,
  Users2,
  Briefcase,
  Bot,
  GitBranch,
} from "lucide-react";

const pages = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, group: "Navigation" },
  { href: "/floor", label: "Production Floor", icon: Factory, group: "Navigation" },
  { href: "/work-orders", label: "Work Orders", icon: ClipboardList, group: "Manufacturing" },
  { href: "/work-instructions", label: "Work Instructions", icon: FileText, group: "Manufacturing" },
  { href: "/bom", label: "BOM & Parts", icon: Boxes, group: "Manufacturing" },
  { href: "/cm", label: "Configuration Management", icon: GitBranch, group: "Manufacturing" },
  { href: "/purchasing", label: "Purchasing", icon: ShoppingCart, group: "Supply Chain" },
  { href: "/suppliers", label: "Supplier Scorecards", icon: Award, group: "Supply Chain" },
  { href: "/inventory", label: "Inventory", icon: Package, group: "Supply Chain" },
  { href: "/shipping", label: "Shipping", icon: Truck, group: "Supply Chain" },
  { href: "/value-stream", label: "Value Stream Map", icon: Network, group: "Supply Chain" },
  { href: "/quality", label: "Quality & NCR", icon: FlaskConical, group: "Quality" },
  { href: "/mrb", label: "Material Review Board", icon: Gauge, group: "Quality" },
  { href: "/government-property", label: "Government Property", icon: Shield, group: "Quality" },
  { href: "/projects", label: "Projects / EVM", icon: FolderKanban, group: "Business" },
  { href: "/accounting", label: "Accounting", icon: Landmark, group: "Business" },
  { href: "/engineering", label: "Engineering Tracker", icon: Briefcase, group: "Business" },
  { href: "/hr", label: "HR & Workforce", icon: Users2, group: "Business" },
  { href: "/radiators", label: "Information Radiators", icon: Monitor, group: "Visual" },
  { href: "/ai", label: "AI Assistant", icon: Bot, group: "Visual" },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");

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

  const run = useCallback(
    (href: string) => {
      onOpenChange(false);
      setSearch("");
      router.push(href);
    },
    [router, onOpenChange]
  );

  if (!open) return null;

  const groups = [...new Set(pages.map((p) => p.group))];

  return (
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute left-1/2 top-[20%] w-full max-w-xl -translate-x-1/2 px-4">
        <Command
          className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl"
          label="Global command palette"
        >
          <div className="flex items-center border-b border-slate-800 px-3">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder="Jump to module, search actions…"
              className="h-12 w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
            />
          </div>
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="py-6 text-center text-sm text-slate-500">
              No results found.
            </Command.Empty>
            {groups.map((group) => (
              <Command.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-600"
              >
                {pages
                  .filter((p) => p.group === group)
                  .map((page) => {
                    const Icon = page.icon;
                    return (
                      <Command.Item
                        key={page.href}
                        value={page.label}
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
