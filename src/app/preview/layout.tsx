import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Marketing preview mocks",
  robots: { index: false, follow: false },
};

/**
 * Bare shell for splash / demo-hub / tenant-login concept mocks.
 * Always public (even when signed into the ERP) so you can review without logout.
 */
export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-50 border-b border-amber-500/30 bg-amber-950/90 px-4 py-2 text-center text-xs text-amber-100 backdrop-blur">
        <strong className="font-semibold">PREVIEW MOCKS</strong>
        {" — "}
        not production.{" "}
        <Link href="/preview" className="underline hover:text-white">
          All mocks
        </Link>
        {" · "}
        <Link href="/" className="underline hover:text-white">
          Back to app / home
        </Link>
      </div>
      {children}
    </div>
  );
}
