/** Company letterhead for SO / Quote documents */
export function CompanyLetterhead({
  docTitle,
  docNumber,
  docDate,
}: {
  docTitle: string;
  docNumber?: string;
  docDate?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-5">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-cyan-600 text-lg font-bold text-white shadow-lg shadow-teal-900/40">
          F
        </div>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-50">Forge Dynamics LLC</h1>
          <p className="text-xs text-slate-400">Manufacturing · Aerospace & Defense</p>
          <p className="mt-1 text-xs text-slate-500">
            1200 Precision Way · Huntsville, AL 35806
          </p>
          <p className="text-xs text-slate-500">
            Tel (256) 555-0100 · sales@forgedynamics.example · CAGE 1FORG
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-500">
          {docTitle}
        </p>
        {docNumber && (
          <p className="mt-1 font-mono text-2xl font-bold text-slate-100">{docNumber}</p>
        )}
        {docDate && <p className="mt-1 text-xs text-slate-500">Date: {docDate}</p>}
      </div>
    </div>
  );
}
