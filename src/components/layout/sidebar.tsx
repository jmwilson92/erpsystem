"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Factory,
  ClipboardList,
  FileText,
  Boxes,
  ShoppingCart,
  ShoppingBag,
  Building2,
  PackageCheck,
  Users2,
  Shield,
  FlaskConical,
  Truck,
  Landmark,
  FolderKanban,
  GitBranch,
  Gauge,
  Monitor,
  Package,
  Award,
  Network,
  Briefcase,
  Bot,
  ChevronLeft,
  Flame,
} from "lucide-react";
import { useState } from "react";

const nav = [
  {
    label: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/floor", label: "Production Floor", icon: Factory },
      { href: "/radiators", label: "Info Radiators", icon: Monitor },
      { href: "/value-stream", label: "Value Stream", icon: Network },
      { href: "/ai", label: "AI Assistant", icon: Bot },
    ],
  },
  {
    label: "Manufacturing",
    items: [
      { href: "/work-orders", label: "Work Orders", icon: ClipboardList },
      { href: "/work-instructions", label: "Work Instructions", icon: FileText },
      { href: "/qa", label: "QA", icon: FlaskConical },
      { href: "/test-center", label: "Test Center", icon: FlaskConical },
      { href: "/workcenters", label: "Workcenters", icon: Factory },
      { href: "/items", label: "Items", icon: Package },
      { href: "/bom", label: "BOMs", icon: Boxes },
      { href: "/uom", label: "UOM Master", icon: Gauge },
      { href: "/cm", label: "Config Mgmt", icon: GitBranch },
    ],
  },
  {
    label: "Supply Chain",
    items: [
      { href: "/sales", label: "Sales Orders", icon: ShoppingBag },
      { href: "/customers", label: "Customers", icon: Building2 },
      { href: "/purchasing", label: "Purchasing", icon: ShoppingCart },
      { href: "/receiving", label: "Receiving", icon: PackageCheck },
      { href: "/suppliers", label: "Suppliers / ASL", icon: Award },
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/kitting", label: "Kitting", icon: Boxes },
      { href: "/shipping", label: "Shipping", icon: Truck },
    ],
  },
  {
    label: "Quality & Compliance",
    items: [
      { href: "/quality", label: "NCR / Quality", icon: FlaskConical },
      { href: "/mrb", label: "MRB / CAR", icon: Gauge },
      { href: "/government-property", label: "Gov Property", icon: Shield },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/projects", label: "Projects", icon: FolderKanban },
      { href: "/accounting", label: "Accounting", icon: Landmark },
      { href: "/engineering", label: "Engineering", icon: Briefcase },
      { href: "/hr", label: "HR / Workforce", icon: Users2 },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-slate-800/80 bg-slate-950/95 transition-all duration-200",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-slate-800/80 px-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-900/40">
          <Flame className="h-4 w-4 text-white" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight text-slate-50">ForgeERP</span>
            <span className="text-[10px] uppercase tracking-widest text-teal-500/80">
              Manufacturing
            </span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          aria-label="Toggle sidebar"
        >
          <ChevronLeft className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {nav.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "bg-teal-500/10 text-teal-400 shadow-sm"
                          : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active && "text-teal-400")} />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {!collapsed && (
        <div className="border-t border-slate-800/80 p-3">
          <div className="rounded-lg bg-slate-900/80 p-2.5">
            <p className="text-xs font-medium text-slate-300">Demo Mode</p>
            <p className="text-[10px] text-slate-500">Alex Morgan · ADMIN</p>
          </div>
        </div>
      )}
    </aside>
  );
}
