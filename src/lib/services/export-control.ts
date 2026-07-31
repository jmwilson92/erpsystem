/**
 * Export control classification (ITAR / EAR) for parts.
 *
 * Every physical part a defense shop touches sits under exactly one export
 * jurisdiction: the ITAR (State, USML categories) or the EAR (Commerce, ECCN
 * or EAR99). The two are mutually exclusive — an item is not "ITAR and EAR" —
 * so this module treats jurisdiction as the primary field and validates that
 * only the matching classifier is populated.
 *
 * The default jurisdiction is UNDETERMINED rather than EAR99. That distinction
 * carries the compliance weight: EAR99 is a determination someone made and can
 * defend, while UNDETERMINED means nobody has looked yet. Defaulting to EAR99
 * would silently mark an entire existing catalogue as cleared for export.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const EXPORT_JURISDICTIONS = [
  "UNDETERMINED",
  "ITAR",
  "EAR",
  "NOT_CONTROLLED",
] as const;

export type ExportJurisdiction = (typeof EXPORT_JURISDICTIONS)[number];

export const JURISDICTION_LABELS: Record<string, string> = {
  UNDETERMINED: "Not yet classified",
  ITAR: "ITAR — USML",
  EAR: "EAR — Commerce",
  NOT_CONTROLLED: "Not export controlled",
};

/** USML categories I–XXI (22 CFR 121.1). */
export const USML_CATEGORIES = [
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
  "XVII",
  "XVIII",
  "XIX",
  "XX",
  "XXI",
] as const;

export const USML_CATEGORY_TITLES: Record<string, string> = {
  I: "Firearms and related articles",
  II: "Guns and armament",
  III: "Ammunition and ordnance",
  IV: "Launch vehicles, missiles, rockets, mines",
  V: "Explosives and energetic materials",
  VI: "Surface vessels of war",
  VII: "Ground vehicles",
  VIII: "Aircraft and related articles",
  IX: "Military training equipment",
  X: "Personal protective equipment",
  XI: "Military electronics",
  XII: "Fire control, laser, imaging, guidance",
  XIII: "Materials and miscellaneous articles",
  XIV: "Toxicological agents",
  XV: "Spacecraft and related articles",
  XVI: "Nuclear weapons related articles",
  XVII: "Classified articles and services",
  XVIII: "Directed energy weapons",
  XIX: "Gas turbine engines",
  XX: "Submersible vessels",
  XXI: "Articles not otherwise enumerated",
};

/**
 * A USML designation is a category, optionally with paragraphs: "XI",
 * "XI(c)", "XI(c)(4)". The pattern only splits category from paragraphs —
 * the category itself is checked against USML_CATEGORIES rather than being
 * described by a Roman-numeral regex, which keeps "XXII" out without needing
 * the pattern to encode numeral grammar.
 */
const USML_PATTERN = /^([IVX]+)((?:\([a-z0-9]+\))*)$/;

/**
 * An ECCN is digit, letter A–E, three digits, optional paragraph suffix:
 * "9A610", "3A001.b.1". EAR99 is the catch-all for EAR items on no CCL entry.
 */
const ECCN_PATTERN = /^[0-9][A-E][0-9]{3}(\.[a-z0-9]+)*$/;

/**
 * Category uppercase, paragraphs lowercase — "xi(C)" and "XI(c)" are the same
 * designation, and USML paragraphs are conventionally lower case.
 */
export function normalizeUsml(raw: string): string {
  const v = raw.trim().replace(/\s+/g, "");
  const split = /^([IVXivx]+)(.*)$/.exec(v);
  if (!split) return v.toUpperCase();
  return split[1].toUpperCase() + split[2].toLowerCase();
}

export function normalizeEccn(raw: string): string {
  const v = raw.trim().replace(/\s+/g, "");
  if (v.toUpperCase() === "EAR99") return "EAR99";
  // Category digit and group letter are uppercase; paragraph letters are lower.
  return v.slice(0, 2).toUpperCase() + v.slice(2).toLowerCase();
}

export function isValidUsml(raw: string): boolean {
  const v = normalizeUsml(raw);
  const m = USML_PATTERN.exec(v);
  if (!m) return false;
  return (USML_CATEGORIES as readonly string[]).includes(m[1]);
}

export function isValidEccn(raw: string): boolean {
  const v = normalizeEccn(raw);
  if (v === "EAR99") return true;
  return ECCN_PATTERN.test(v);
}

/** The category part of a USML designation: "XI(c)(4)" → "XI". */
export function usmlCategoryOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = USML_PATTERN.exec(normalizeUsml(value));
  return m ? m[1] : null;
}

/**
 * Controlled means a licence question exists before the item leaves the
 * country or is shown to a foreign person. EAR99 is EAR-jurisdiction but not
 * listed, so it is not treated as controlled here.
 */
export function isExportControlled(part: {
  exportJurisdiction: string;
  eccn?: string | null;
}): boolean {
  if (part.exportJurisdiction === "ITAR") return true;
  if (part.exportJurisdiction === "EAR") return (part.eccn || "") !== "EAR99";
  return false;
}

export type ClassifyInput = {
  partId: string;
  jurisdiction: string;
  usmlCategory?: string | null;
  eccn?: string | null;
  countryOfOrigin?: string | null;
  notes?: string | null;
  classifiedById?: string | null;
};

/**
 * Record an export determination. Validates that the classifier matches the
 * jurisdiction and clears the field belonging to the other regime, so a part
 * cannot carry a stale ECCN after being ruled ITAR.
 */
export async function classifyPart(input: ClassifyInput) {
  const jurisdiction = (input.jurisdiction || "").trim().toUpperCase();
  if (!(EXPORT_JURISDICTIONS as readonly string[]).includes(jurisdiction)) {
    throw new Error(`Unknown export jurisdiction: ${input.jurisdiction}`);
  }

  const part = await prisma.part.findUnique({
    where: { id: input.partId },
    select: { id: true, partNumber: true, exportJurisdiction: true },
  });
  if (!part) throw new Error("Part not found");

  let usmlCategory: string | null = null;
  let eccn: string | null = null;

  if (jurisdiction === "ITAR") {
    const raw = (input.usmlCategory || "").trim();
    if (!raw) throw new Error("A USML category is required for ITAR items");
    if (!isValidUsml(raw)) {
      throw new Error(
        `"${raw}" is not a USML category — expected a category I–XXI, optionally with a paragraph such as XI(c)`
      );
    }
    usmlCategory = normalizeUsml(raw);
  } else if (jurisdiction === "EAR") {
    const raw = (input.eccn || "").trim();
    if (!raw) {
      throw new Error("An ECCN is required for EAR items — use EAR99 if unlisted");
    }
    if (!isValidEccn(raw)) {
      throw new Error(
        `"${raw}" is not an ECCN — expected a form like 9A610 or 3A001.b.1, or EAR99`
      );
    }
    eccn = normalizeEccn(raw);
  }

  const country = (input.countryOfOrigin || "").trim().toUpperCase() || null;
  if (country && !/^[A-Z]{2}$/.test(country)) {
    throw new Error("Country of origin must be a 2-letter ISO-3166 code, e.g. US");
  }

  const updated = await prisma.part.update({
    where: { id: input.partId },
    data: {
      exportJurisdiction: jurisdiction,
      usmlCategory,
      eccn,
      countryOfOrigin: country,
      exportNotes: (input.notes || "").trim() || null,
      exportClassifiedById: input.classifiedById || null,
      exportClassifiedAt: jurisdiction === "UNDETERMINED" ? null : new Date(),
    },
  });

  await logAudit({
    entityType: "Part",
    entityId: part.id,
    action: "EXPORT_CLASSIFIED",
    userId: input.classifiedById || undefined,
    changes: {
      exportJurisdiction: { from: part.exportJurisdiction, to: jurisdiction },
    },
    metadata: {
      partNumber: part.partNumber,
      usmlCategory,
      eccn,
      countryOfOrigin: country,
    },
  }).catch(() => {});

  return updated;
}

export type ExportFilter = {
  jurisdiction?: string;
  search?: string;
  controlledOnly?: boolean;
};

export async function listClassifiedParts(filter: ExportFilter = {}) {
  const where: Record<string, unknown> = { isActive: true };
  if (filter.jurisdiction && filter.jurisdiction !== "ALL") {
    where.exportJurisdiction = filter.jurisdiction;
  }
  if (filter.search) {
    where.OR = [
      { partNumber: { contains: filter.search } },
      { description: { contains: filter.search } },
      { eccn: { contains: filter.search } },
      { usmlCategory: { contains: filter.search } },
    ];
  }

  const parts = await prisma.part.findMany({
    where,
    orderBy: [{ exportJurisdiction: "asc" }, { partNumber: "asc" }],
    take: 500,
    select: {
      id: true,
      partNumber: true,
      description: true,
      exportJurisdiction: true,
      usmlCategory: true,
      eccn: true,
      countryOfOrigin: true,
      exportClassifiedAt: true,
      exportNotes: true,
      exportClassifiedBy: { select: { id: true, name: true } },
    },
  });

  return filter.controlledOnly ? parts.filter(isExportControlled) : parts;
}

/**
 * Counts for the compliance header. `undetermined` is the number that matters
 * operationally — it is the backlog of parts nobody has ruled on yet.
 */
export async function getExportSummary() {
  const grouped = await prisma.part.groupBy({
    by: ["exportJurisdiction"],
    where: { isActive: true },
    _count: { _all: true },
  });

  const byJurisdiction: Record<string, number> = {};
  for (const j of EXPORT_JURISDICTIONS) byJurisdiction[j] = 0;
  for (const row of grouped) {
    byJurisdiction[row.exportJurisdiction] = row._count._all;
  }

  const itarListed = await prisma.part.count({
    where: { isActive: true, exportJurisdiction: "ITAR" },
  });
  const earListed = await prisma.part.count({
    where: {
      isActive: true,
      exportJurisdiction: "EAR",
      NOT: { eccn: "EAR99" },
    },
  });

  const total = Object.values(byJurisdiction).reduce((a, b) => a + b, 0);

  return {
    total,
    byJurisdiction,
    undetermined: byJurisdiction.UNDETERMINED,
    controlled: itarListed + earListed,
    /** Share of the active catalogue that has been ruled on, 0–1. */
    coverage: total === 0 ? 1 : (total - byJurisdiction.UNDETERMINED) / total,
  };
}

/** USML categories actually in use, for the breakdown table. */
export async function getUsmlBreakdown() {
  const parts = await prisma.part.findMany({
    where: { isActive: true, exportJurisdiction: "ITAR" },
    select: { usmlCategory: true },
  });
  const counts = new Map<string, number>();
  for (const p of parts) {
    const cat = usmlCategoryOf(p.usmlCategory);
    if (!cat) continue;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({
      category,
      title: USML_CATEGORY_TITLES[category] || "",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}
