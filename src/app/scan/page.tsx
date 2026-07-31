import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SCAN_PREFIXES, SCAN_TYPE_LABELS, type ScanType } from "@/lib/scan-ids";
import { resolveScan } from "@/lib/services/scan-resolver";

export const dynamic = "force-dynamic";

/**
 * The scan screen. Built for a rugged Android scanner rather than a phone
 * camera: the hardware trigger is a keyboard wedge, so a plain autofocused
 * text input already receives the scan and the trailing Enter submits the
 * form. No camera permission, no SDK, nothing to install.
 *
 * A GET form is deliberate — the result is a URL, so a supervisor can be sent
 * the exact scan that misbehaved.
 */
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const raw = (sp.q || "").trim();
  const result = raw ? await resolveScan(raw) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Scan" description="Scan a label, badge or barcode" />

      <Card>
        <CardContent className="pt-6">
          <form method="get" className="flex gap-2">
            <input
              name="q"
              defaultValue={raw}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Scan or type…"
              className="h-14 flex-1 rounded-md border border-slate-700 bg-slate-950 px-4 font-mono text-lg text-slate-100"
            />
            <Button type="submit" className="h-14 px-6">
              Go
            </Button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            A hardware scan gun types the code and presses Enter — this box is
            all it needs.
          </p>
        </CardContent>
      </Card>

      {result?.status === "FOUND" && (
        <Card className="border-emerald-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {SCAN_TYPE_LABELS[result.hit.type]}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-xl text-slate-100">{result.hit.label}</p>
            {result.hit.detail && (
              <p className="mt-1 text-sm text-slate-400">{result.hit.detail}</p>
            )}
            {!result.typed && (
              <p className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
                This label has no type prefix, so it was matched by searching.
                Reprint it from the label sheet to make future scans exact.
              </p>
            )}
            <div className="mt-4">
              <Link href={result.hit.href}>
                <Button className="h-12 w-full">Open</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {result?.status === "AMBIGUOUS" && (
        <Card className="border-amber-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-300">
              That code matches more than one record
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-300">
              {result.raw} is an untyped label and matches {result.hits.length}{" "}
              records. Pick the right one — nothing is assumed.
            </p>
            {result.hits.map((h) => (
              <Link key={`${h.type}-${h.id}`} href={h.href} className="block">
                <div className="rounded-md border border-slate-700 px-4 py-3 hover:border-sky-700">
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {SCAN_TYPE_LABELS[h.type]}
                  </p>
                  <p className="font-mono text-slate-100">{h.label}</p>
                  {h.detail && (
                    <p className="text-xs text-slate-400">{h.detail}</p>
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {result?.status === "NOT_FOUND" && (
        <Card className="border-rose-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-rose-300">No match</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-400">
            <p className="font-mono text-slate-200">{result.raw}</p>
            <p className="mt-2">
              Looked in:{" "}
              {result.triedTypes.map((t) => SCAN_TYPE_LABELS[t]).join(", ")}.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-400">Label prefixes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {(Object.keys(SCAN_PREFIXES) as ScanType[]).map((t) => (
              <div key={t}>
                <span className="font-mono text-sky-300">{SCAN_PREFIXES[t]}-</span>{" "}
                <span className="text-slate-400">{SCAN_TYPE_LABELS[t]}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Badge scanning is not wired up yet. It needs a keyed hash of the
            credential rather than the raw card id — prox and MIFARE cards clone
            in seconds, so storing raw ids would be storing working keys to the
            building.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
