import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StationNextGuide } from "@/lib/services/receiving-station-guide";
import {
  ArrowRight,
  ClipboardCheck,
  FlaskConical,
  MapPin,
  OctagonAlert,
} from "lucide-react";

/** MH-style “what to do next” strip for QA / Test receiving cards. */
export function StationNextGuideBanner({
  guide,
  className,
}: {
  guide: StationNextGuide;
  className?: string;
}) {
  const styles: Record<
    StationNextGuide["kind"],
    { border: string; bg: string; accent: string; icon: typeof MapPin }
  > = {
    WORK: {
      border: "border-sky-500/40",
      bg: "bg-sky-500/10",
      accent: "text-sky-300",
      icon: ClipboardCheck,
    },
    TO_TEST: {
      border: "border-violet-500/40",
      bg: "bg-violet-500/10",
      accent: "text-violet-300",
      icon: FlaskConical,
    },
    TO_QA: {
      border: "border-amber-500/40",
      bg: "bg-amber-500/10",
      accent: "text-amber-300",
      icon: ClipboardCheck,
    },
    TO_DOCK: {
      border: "border-teal-500/40",
      bg: "bg-teal-500/10",
      accent: "text-teal-300",
      icon: MapPin,
    },
    PUTAWAY: {
      border: "border-teal-500/50",
      bg: "bg-teal-500/15",
      accent: "text-teal-200",
      icon: MapPin,
    },
    HOLD: {
      border: "border-rose-500/40",
      bg: "bg-rose-500/10",
      accent: "text-rose-300",
      icon: OctagonAlert,
    },
  };

  const s = styles[guide.kind];
  const Icon = s.icon;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2.5",
        s.border,
        s.bg,
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.accent)} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              What to do next
            </p>
            <p className={cn("text-sm font-semibold", s.accent)}>
              {guide.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-300">{guide.detail}</p>
            {guide.travelerNumber && (
              <p className="mt-1 font-mono text-[11px] text-sky-400">
                Traveler {guide.travelerNumber}
              </p>
            )}
          </div>
        </div>
        {guide.href && guide.label && (
          <Link href={guide.href}>
            <Button size="sm" variant="secondary" className="shrink-0">
              {guide.label}
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
