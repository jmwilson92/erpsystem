import { prisma } from "@/lib/db";
import { PrintFrame } from "@/components/print/print-frame";
import { Barcode } from "@/components/print/barcode";

export const dynamic = "force-dynamic";

type Label = {
  barcode: string;
  title: string;
  sub?: string;
};

async function buildLabels(
  sp: Record<string, string | string[] | undefined>
): Promise<{ heading: string; labels: Label[] }> {
  const pick = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const kind = pick("kind") || "parts";
  const ids = (pick("ids") || "").split(",").filter(Boolean);

  if (kind === "bins") {
    const locations = await prisma.location.findMany({
      include: { warehouse: { select: { code: true } } },
      orderBy: [{ warehouse: { code: "asc" } }, { code: "asc" }],
    });
    return {
      heading: "Bin / Location Labels",
      labels: locations.map((l) => ({
        barcode: `${l.warehouse.code}-${l.code}`,
        title: `${l.warehouse.code}-${l.code}`,
        sub: `${l.name || l.type}`,
      })),
    };
  }

  if (kind === "wo") {
    const wos = await prisma.workOrder.findMany({
      where: ids.length ? { id: { in: ids } } : undefined,
      include: { part: { select: { partNumber: true } } },
      orderBy: { number: "asc" },
      take: ids.length ? undefined : 60,
    });
    return {
      heading: "Work Order Traveler Labels",
      labels: wos.map((w) => ({
        barcode: w.number,
        title: w.number,
        sub: `${w.part?.partNumber || w.type} · qty ${w.quantity}`,
      })),
    };
  }

  // parts (default)
  const parts = await prisma.part.findMany({
    where: ids.length ? { id: { in: ids } } : { isActive: true },
    orderBy: { partNumber: "asc" },
    take: ids.length ? undefined : 60,
  });
  return {
    heading: "Item / Part Labels",
    labels: parts.map((p) => ({
      barcode: p.partNumber,
      title: p.partNumber,
      sub: p.description,
    })),
  };
}

export default async function LabelsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const { heading, labels } = await buildLabels(sp);

  return (
    <PrintFrame>
      <div className="mb-4 flex items-center justify-between border-b border-neutral-300 pb-2 print:hidden">
        <h1 className="text-lg font-bold text-neutral-900">{heading}</h1>
        <p className="text-xs text-neutral-500">
          {labels.length} label{labels.length === 1 ? "" : "s"} · Code 39 ·
          scans on any 1D scanner
        </p>
      </div>

      {labels.length === 0 ? (
        <p className="text-sm text-neutral-600">Nothing to label here yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {labels.map((l, i) => (
            <div
              key={i}
              className="flex break-inside-avoid flex-col items-center rounded-lg border border-neutral-400 p-3 text-center"
            >
              <Barcode value={l.barcode} width={200} height={40} />
              <p className="mt-1 font-mono text-sm font-bold text-neutral-900">
                {l.title}
              </p>
              {l.sub ? (
                <p className="line-clamp-2 text-[10px] leading-tight text-neutral-600">
                  {l.sub}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PrintFrame>
  );
}
