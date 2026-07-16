import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  MapPin,
  PackageOpen,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NextStepKind =
  | "RECEIVE"
  | "AT_QA"
  | "AT_TEST"
  | "PUTAWAY"
  | "ATTEST"
  | "DONE"
  | "FOLLOW_CHILD";

export function ReceivingNextStep({
  kind,
  title,
  detail,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  childNumber,
  /** When true, primary is an in-page anchor (e.g. #receive-form) */
  primaryIsAnchor,
}: {
  kind: NextStepKind;
  title: string;
  detail: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  childNumber?: string;
  primaryIsAnchor?: boolean;
}) {
  const styles: Record<
    NextStepKind,
    { border: string; bg: string; icon: typeof PackageOpen; accent: string }
  > = {
    RECEIVE: {
      border: "border-teal-500/40",
      bg: "bg-teal-500/10",
      icon: PackageOpen,
      accent: "text-teal-300",
    },
    AT_QA: {
      border: "border-amber-500/40",
      bg: "bg-amber-500/10",
      icon: ClipboardCheck,
      accent: "text-amber-300",
    },
    AT_TEST: {
      border: "border-violet-500/40",
      bg: "bg-violet-500/10",
      icon: FlaskConical,
      accent: "text-violet-300",
    },
    PUTAWAY: {
      border: "border-teal-500/50",
      bg: "bg-teal-500/15",
      icon: MapPin,
      accent: "text-teal-200",
    },
    ATTEST: {
      border: "border-sky-500/40",
      bg: "bg-sky-500/10",
      icon: PenLine,
      accent: "text-sky-300",
    },
    DONE: {
      border: "border-emerald-500/30",
      bg: "bg-emerald-500/5",
      icon: CheckCircle2,
      accent: "text-emerald-300",
    },
    FOLLOW_CHILD: {
      border: "border-sky-500/40",
      bg: "bg-sky-500/10",
      icon: ArrowRight,
      accent: "text-sky-300",
    },
  };

  const s = styles[kind];
  const Icon = s.icon;

  return (
    <Card className={cn(s.border, s.bg)}>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className={cn("mt-0.5 rounded-lg bg-slate-950/40 p-2", s.accent)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              What to do next
            </p>
            <p className={cn("text-lg font-semibold", s.accent)}>{title}</p>
            <p className="mt-0.5 text-sm text-slate-300">{detail}</p>
            {childNumber && (
              <p className="mt-1 font-mono text-xs text-sky-400">
                Follow traveler {childNumber}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {primaryHref && primaryLabel && (
            primaryIsAnchor ? (
              <a href={primaryHref}>
                <Button size="sm">{primaryLabel}</Button>
              </a>
            ) : (
              <Link href={primaryHref}>
                <Button size="sm">{primaryLabel}</Button>
              </Link>
            )
          )}
          {secondaryHref && secondaryLabel && (
            <Link href={secondaryHref}>
              <Button size="sm" variant="outline">
                {secondaryLabel}
              </Button>
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
