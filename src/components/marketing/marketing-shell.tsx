import { SiteHeader } from "./site-header";
import { SiteFooter } from "./site-footer";

/**
 * Wraps a public page with the constant marketing header + footer so every
 * public surface (demo, signup, legal) keeps the same nav and a way home.
 * `flex` column keeps the footer at the bottom on short pages.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
