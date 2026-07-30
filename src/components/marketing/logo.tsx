import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * Protessera brand mark — a flame in a rounded badge. Self-contained SVG so
 * it renders anywhere (header, footer, auth screens) without an image request.
 * The favicon at src/app/icon.svg mirrors this mark.
 */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="brandMarkGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0891b2" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#brandMarkGrad)" />
      <path
        d="M16.4 4.2c-.5 3.1-2.2 4.6-4 6.2-1.9 1.7-4.4 3.9-4.4 8 0 4.5 3.6 7.9 8 7.9s8-3.4 8-7.9c0-2.6-1.2-4.4-2.4-6-.3 1.7-1.3 2.6-2.6 2.6 1.2-3.6-.2-8-2.6-10.8Z"
        fill="#ffffff"
      />
      <path
        d="M16 15.2c-.3 1.7-1.2 2.5-2.1 3.4-1 .9-2 2-2 3.7 0 2.2 1.9 3.7 4.1 3.7s4.1-1.5 4.1-3.7c0-1.7-1-2.8-2-3.7-.9-.9-1.8-1.7-2.1-3.4Z"
        fill="#0e7490"
      />
    </svg>
  );
}

/**
 * Full lockup: mark + wordmark, with the tagline stacked under the wordmark
 * when `tagline` is set.
 *
 * The tagline is hidden on the narrowest screens rather than wrapped — at that
 * width it would push the header nav onto a second line, and a tagline is worth
 * less than a usable nav bar.
 */
export function BrandLogo({
  className = "",
  tagline = false,
}: {
  className?: string;
  tagline?: boolean;
}) {
  return (
    <span className={`flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <BrandMark className="h-7 w-7" />
      {tagline ? (
        <span className="flex flex-col leading-tight">
          <span>{SITE_NAME}</span>
          <span className="hidden text-[11px] font-normal tracking-wide text-teal-300/70 sm:block">
            {SITE_TAGLINE}
          </span>
        </span>
      ) : (
        SITE_NAME
      )}
    </span>
  );
}
