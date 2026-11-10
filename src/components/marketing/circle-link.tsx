import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Text link with a circular arrow, used on the marketing homepage. */
export function CircleLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-3 rounded-full text-sm font-semibold text-[#10203f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#10203f]"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#c5d0de] bg-white text-[#10203f] transition-colors group-hover:border-[#10203f] group-hover:bg-[#10203f] group-hover:text-white">
        <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
      {children}
    </Link>
  );
}
