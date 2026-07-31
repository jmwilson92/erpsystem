/**
 * Resolve a scan to the thing it names.
 *
 * This is the keystone the mobile screens hang off: one box takes whatever the
 * gun typed, and this decides whether it is a part, a bin, a work order, a lot,
 * a serial, a PO or a badge, and what can be done with it.
 *
 * A typed scan looks up exactly one table. An untyped legacy scan tries each
 * plausible table and — importantly — reports every hit rather than the first.
 * If a bare string matches both a part number and a bin code, the operator is
 * asked which they meant. Silently taking the first match is how stock gets
 * moved against the wrong record, and unlike a wrong search result nobody sees
 * it happen.
 */
import { prisma } from "@/lib/db";
import { parseScan, type ScanType } from "@/lib/scan-ids";

export type ScanHit = {
  type: ScanType;
  id: string;
  code: string;
  label: string;
  detail?: string | null;
  href: string;
};

export type ScanResolution =
  | { status: "EMPTY" }
  | { status: "NOT_FOUND"; raw: string; triedTypes: ScanType[] }
  | { status: "FOUND"; hit: ScanHit; typed: boolean; raw: string }
  | { status: "AMBIGUOUS"; hits: ScanHit[]; raw: string };

async function lookup(type: ScanType, value: string): Promise<ScanHit | null> {
  switch (type) {
    case "PART": {
      const p = await prisma.part.findFirst({
        where: { partNumber: { equals: value } },
        select: { id: true, partNumber: true, description: true },
      });
      return p
        ? {
            type,
            id: p.id,
            code: p.partNumber,
            label: p.partNumber,
            detail: p.description,
            href: `/items/${p.id}`,
          }
        : null;
    }
    case "BIN": {
      const l = await prisma.location.findFirst({
        where: { code: { equals: value } },
        select: { id: true, code: true, name: true, type: true },
      });
      return l
        ? {
            type,
            id: l.id,
            code: l.code,
            label: l.name || l.code,
            detail: l.type,
            href: `/inventory?location=${encodeURIComponent(l.code)}`,
          }
        : null;
    }
    case "WORK_ORDER": {
      const w = await prisma.workOrder.findFirst({
        where: { number: { equals: value } },
        select: { id: true, number: true, status: true, quantity: true },
      });
      return w
        ? {
            type,
            id: w.id,
            code: w.number,
            label: w.number,
            detail: `${w.status} · qty ${w.quantity}`,
            href: `/work-orders/${w.id}`,
          }
        : null;
    }
    case "LOT": {
      const l = await prisma.lot.findFirst({
        where: { lotNumber: { equals: value } },
        select: { id: true, lotNumber: true, quantity: true, status: true },
      });
      return l
        ? {
            type,
            id: l.id,
            code: l.lotNumber,
            label: l.lotNumber,
            detail: `${l.status} · qty ${l.quantity}`,
            href: `/inventory?lot=${encodeURIComponent(l.lotNumber)}`,
          }
        : null;
    }
    case "SERIAL": {
      const s = await prisma.serialNumber.findFirst({
        where: { serial: { equals: value } },
        select: { id: true, serial: true, status: true },
      });
      return s
        ? {
            type,
            id: s.id,
            code: s.serial,
            label: s.serial,
            detail: s.status,
            href: `/trace/serials/${encodeURIComponent(s.serial)}`,
          }
        : null;
    }
    case "PO": {
      const p = await prisma.purchaseOrder.findFirst({
        where: { number: { equals: value } },
        select: { id: true, number: true, status: true },
      });
      return p
        ? {
            type,
            id: p.id,
            code: p.number,
            label: p.number,
            detail: p.status,
            href: `/purchasing/${p.id}`,
          }
        : null;
    }
    case "SHIPMENT": {
      const s = await prisma.shipment
        .findFirst({
          where: { number: { equals: value } },
          select: { id: true, number: true, status: true },
        })
        .catch(() => null);
      return s
        ? {
            type,
            id: s.id,
            code: s.number,
            label: s.number,
            detail: s.status,
            href: `/shipping`,
          }
        : null;
    }
    case "BADGE": {
      // Badge-to-user mapping is deliberately not implemented here. The
      // roadmap calls for a keyed hash of the credential rather than the raw
      // card id, because prox and MIFARE Classic cards clone trivially, and
      // storing raw ids would be storing working keys to the building. A
      // half-done version now would be the thing that ships.
      return null;
    }
    default:
      return null;
  }
}

export async function resolveScan(raw: string): Promise<ScanResolution> {
  const parsed = parseScan(raw);
  if (!parsed.ok) return { status: "EMPTY" };

  if (parsed.typed) {
    const hit = await lookup(parsed.type, parsed.value);
    return hit
      ? { status: "FOUND", hit, typed: true, raw: parsed.raw }
      : { status: "NOT_FOUND", raw: parsed.raw, triedTypes: [parsed.type] };
  }

  // Legacy bare label: try each plausible table and keep every hit.
  const hits: ScanHit[] = [];
  for (const type of parsed.candidates) {
    const hit = await lookup(type, parsed.value);
    if (hit) hits.push(hit);
  }

  if (hits.length === 0) {
    return { status: "NOT_FOUND", raw: parsed.raw, triedTypes: parsed.candidates };
  }
  if (hits.length === 1) {
    return { status: "FOUND", hit: hits[0], typed: false, raw: parsed.raw };
  }
  return { status: "AMBIGUOUS", hits, raw: parsed.raw };
}
