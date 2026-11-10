import { LockKeyhole } from "lucide-react";

/** Shared offer copy; prices remain sourced from the existing plan catalog. */
export function FoundingMemberOffer({ className = "" }: { className?: string }) {
  return (
    <aside aria-label="Founding member offer" className={`rounded-2xl border border-[#0f766e]/25 bg-[#e7f7f4] px-5 py-4 text-center text-[#10203f] ${className}`}>
      <p className="flex items-center justify-center gap-2 text-sm font-semibold">
        <LockKeyhole className="h-4 w-4 shrink-0 text-[#0f766e]" aria-hidden />
        Founding members · Prices locked for life
      </p>
      <p className="mt-1 text-sm leading-relaxed">
        Purchase by March 9, 2027 to lock in these first-year prices for life.
        {" "}Offer ends March 9, 2027.
      </p>
    </aside>
  );
}
