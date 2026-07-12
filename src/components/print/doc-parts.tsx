/** Server-safe building blocks shared by the printable documents. */

export function DocHeader({
  company,
  tagline,
  title,
  number,
  meta,
}: {
  company: string;
  tagline?: string | null;
  title: string;
  number: string;
  meta: { label: string; value: string }[];
}) {
  return (
    <header className="flex items-start justify-between border-b-2 border-neutral-900 pb-4">
      <div>
        <p className="text-2xl font-bold tracking-tight">{company}</p>
        {tagline ? <p className="text-xs text-neutral-500">{tagline}</p> : null}
      </div>
      <div className="text-right">
        <p className="text-lg font-bold uppercase tracking-wide">{title}</p>
        <p className="font-mono text-sm">{number}</p>
        {meta.map((m) => (
          <p key={m.label} className="text-xs text-neutral-600">
            {m.label}: <span className="text-neutral-900">{m.value}</span>
          </p>
        ))}
      </div>
    </header>
  );
}

export function DocTable({
  columns,
  rows,
  align,
}: {
  columns: string[];
  rows: (string | number)[][];
  /** per-column: "r" right-aligns (numbers) */
  align?: string[];
}) {
  return (
    <table className="mt-4 w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-neutral-900 text-left text-[11px] uppercase tracking-wide">
          {columns.map((c, i) => (
            <th
              key={c}
              className={`px-2 py-1.5 ${align?.[i] === "r" ? "text-right" : ""}`}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="border-b border-neutral-300">
            {row.map((cell, j) => (
              <td
                key={j}
                className={`px-2 py-1.5 align-top ${
                  align?.[j] === "r" ? "text-right tabular-nums" : ""
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SignatureRow({ labels }: { labels: string[] }) {
  return (
    <div
      className="mt-12 grid gap-8"
      style={{ gridTemplateColumns: `repeat(${labels.length}, 1fr)` }}
    >
      {labels.map((l) => (
        <div key={l}>
          <div className="border-b border-neutral-900 pb-8" />
          <p className="mt-1 text-xs uppercase tracking-wide text-neutral-600">
            {l}
          </p>
        </div>
      ))}
    </div>
  );
}
