/**
 * Supplier portal — PO acknowledgement, date confirmation, document upload.
 *
 * Suppliers are not users of the system, so access is a bearer token in the
 * URL rather than a login. That makes the token the entire access control, and
 * the module is built around three consequences of that.
 *
 * Only the hash is stored, so a leaked database yields no working links.
 *
 * Every read and write resolves the supplier from the token and then filters
 * by that supplier — the request never says which supplier it is. A portal
 * that trusted a supplierId from the page would let any holder of any token
 * read every other supplier's pricing.
 *
 * Tokens expire and can be revoked, and an expired token is refused the same
 * way an unknown one is, without saying which it was.
 *
 * The supplier's committed date is recorded beside the buyer's required date
 * rather than overwriting it. Collapsing the two destroys the evidence that a
 * date ever moved, which is the reason to ask for an acknowledgement at all.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const ACK_STATUSES = ["ACKNOWLEDGED", "DATE_PROPOSED", "REJECTED"] as const;
export const DOC_TYPES = [
  "COC",
  "MATERIAL_CERT",
  "TEST_REPORT",
  "RoHS",
  "OTHER",
] as const;

export const DOC_TYPE_LABELS: Record<string, string> = {
  COC: "Certificate of conformance",
  MATERIAL_CERT: "Material certification",
  TEST_REPORT: "Test report",
  RoHS: "RoHS / REACH declaration",
  OTHER: "Other",
};

export const DEFAULT_TOKEN_DAYS = 180;

/**
 * Mint a portal link. The raw token is returned exactly once — it is not
 * recoverable afterwards, so the caller has to deliver it now.
 */
export async function issueToken(input: {
  supplierId: string;
  label?: string | null;
  days?: number;
}) {
  const token = randomBytes(32).toString("hex");
  const days = input.days ?? DEFAULT_TOKEN_DAYS;
  const record = await prisma.supplierPortalToken.create({
    data: {
      tokenHash: sha256(token),
      supplierId: input.supplierId,
      label: (input.label || "").trim() || null,
      expiresAt: new Date(Date.now() + days * 86400000),
    },
  });
  return { token, record };
}

export async function revokeToken(id: string) {
  return prisma.supplierPortalToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export type TokenCheck =
  | { ok: true; supplierId: string; tokenId: string }
  | { ok: false; reason: "INVALID" | "EXPIRED" | "REVOKED" };

/**
 * Resolve a raw token to its supplier. Expiry and revocation are checked here
 * rather than at each call site, because a caller that forgets is a caller
 * that silently serves a revoked link.
 */
export async function resolveToken(raw: string): Promise<TokenCheck> {
  const token = (raw || "").trim();
  if (!token) return { ok: false, reason: "INVALID" };

  const row = await prisma.supplierPortalToken.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, supplierId: true, expiresAt: true, revokedAt: true },
  });
  if (!row) return { ok: false, reason: "INVALID" };
  if (row.revokedAt) return { ok: false, reason: "REVOKED" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "EXPIRED" };

  return { ok: true, supplierId: row.supplierId, tokenId: row.id };
}

async function touch(tokenId: string) {
  await prisma.supplierPortalToken
    .update({ where: { id: tokenId }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
}

/**
 * The supplier's own open orders. Scoped by the supplier resolved from the
 * token, never by anything the caller supplied.
 */
export async function portalOrders(raw: string) {
  const check = await resolveToken(raw);
  if (!check.ok) return null;
  await touch(check.tokenId);

  const [supplier, orders] = await Promise.all([
    prisma.supplier.findUnique({
      where: { id: check.supplierId },
      select: { id: true, name: true, code: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        supplierId: check.supplierId,
        status: { notIn: ["CLOSED", "CANCELLED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { acknowledgement: true, part: { select: { partNumber: true } } },
        },
      },
    }),
    ]);

  if (!supplier) return null;

  const documents = await prisma.supplierDocument.findMany({
    where: { supplierId: check.supplierId },
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });

  return { supplier, orders, documents, tokenId: check.tokenId };
}

/**
 * Verify a line belongs to the token's supplier before touching it. Every
 * portal write goes through this — a line id is guessable and must never be
 * trusted on its own.
 */
async function assertLineBelongs(raw: string, lineId: string) {
  const check = await resolveToken(raw);
  if (!check.ok) throw new Error("This link is no longer valid");

  const line = await prisma.purchaseOrderLine.findUnique({
    where: { id: lineId },
    select: { id: true, purchaseOrder: { select: { supplierId: true } } },
  });
  if (!line || line.purchaseOrder.supplierId !== check.supplierId) {
    // Deliberately the same message as an invalid token: a distinct "not
    // yours" reply would confirm that the line exists.
    throw new Error("This link is no longer valid");
  }
  return check;
}

export async function acknowledgeLine(input: {
  token: string;
  lineId: string;
  status: string;
  confirmedDate?: Date | null;
  quantityConfirmed?: number | null;
  note?: string | null;
}) {
  await assertLineBelongs(input.token, input.lineId);

  const status = (input.status || "ACKNOWLEDGED").toUpperCase();
  if (!(ACK_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Unknown acknowledgement status: ${input.status}`);
  }
  if (status === "DATE_PROPOSED" && !input.confirmedDate) {
    throw new Error("Proposing a date needs a date");
  }

  const data = {
    status,
    confirmedDate: input.confirmedDate ?? null,
    quantityConfirmed: input.quantityConfirmed ?? null,
    supplierNote: (input.note || "").trim() || null,
    acknowledgedAt: new Date(),
    // A fresh response reopens the buyer's decision.
    acceptedAt: null,
    acceptedById: null,
  };

  return prisma.poAcknowledgement.upsert({
    where: { lineId: input.lineId },
    create: { lineId: input.lineId, ...data },
    update: data,
  });
}

export async function uploadDocument(input: {
  token: string;
  purchaseOrderId?: string | null;
  docType: string;
  fileName: string;
  fileUrl: string;
  notes?: string | null;
}) {
  const check = await resolveToken(input.token);
  if (!check.ok) throw new Error("This link is no longer valid");
  if (!input.fileName.trim() || !input.fileUrl.trim()) {
    throw new Error("A file name and a link or upload are required");
  }

  // A PO id from the form is only honoured when it is this supplier's.
  let purchaseOrderId: string | null = null;
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { id: true, supplierId: true },
    });
    if (po && po.supplierId === check.supplierId) purchaseOrderId = po.id;
  }

  return prisma.supplierDocument.create({
    data: {
      supplierId: check.supplierId,
      purchaseOrderId,
      docType: (DOC_TYPES as readonly string[]).includes(input.docType)
        ? input.docType
        : "OTHER",
      fileName: input.fileName.trim(),
      fileUrl: input.fileUrl.trim(),
      notes: (input.notes || "").trim() || null,
    },
  });
}

// ------------------------------------------------------------- buyer side

/**
 * Accept a supplier's proposed date, moving it onto the line. This is the only
 * path by which a supplier's date becomes the promised date, so the change is
 * always a buyer's decision rather than a supplier's assertion.
 */
export async function acceptProposedDate(lineId: string, userId?: string | null) {
  const ack = await prisma.poAcknowledgement.findUnique({ where: { lineId } });
  if (!ack) throw new Error("No acknowledgement on this line");
  if (!ack.confirmedDate) throw new Error("No date was proposed");

  await prisma.purchaseOrderLine.update({
    where: { id: lineId },
    data: { promisedDate: ack.confirmedDate },
  });

  return prisma.poAcknowledgement.update({
    where: { lineId },
    data: { acceptedAt: new Date(), acceptedById: userId || null },
  });
}

export async function listTokens(supplierId?: string) {
  return prisma.supplierPortalToken.findMany({
    where: supplierId ? { supplierId } : {},
    orderBy: { createdAt: "desc" },
    include: { supplier: { select: { id: true, name: true, code: true } } },
  });
}

/** Lines where the supplier has pushed a date the buyer has not accepted. */
export async function pendingDateChanges() {
  return prisma.poAcknowledgement.findMany({
    where: { status: "DATE_PROPOSED", acceptedAt: null },
    orderBy: { acknowledgedAt: "desc" },
    take: 100,
    include: {
      line: {
        include: {
          part: { select: { partNumber: true } },
          purchaseOrder: {
            select: {
              id: true,
              number: true,
              supplier: { select: { name: true } },
            },
          },
        },
      },
    },
  });
}

// ------------------------------------------------------- scorecard and ASN

/**
 * Minimum receipts before a delivery score means anything. Below this the
 * portal reports "not enough data" rather than a percentage — two late
 * deliveries out of three is 33%, and showing that beside a supplier with two
 * hundred receipts invites a conversation neither side can win.
 */
export const MIN_SCORE_SAMPLE = 5;

export type Scorecard = {
  /** Null when there is not enough history to say anything. */
  onTimePct: number | null;
  receiptsScored: number;
  lateReceipts: number;
  /** Defective parts per million, null when nothing was received. */
  qualityPpm: number | null;
  unitsReceived: number;
  rejectedUnits: number;
  sufficientData: boolean;
};

export type ScoreInput = {
  receipts: { promisedDate: Date | null; receivedAt: Date; quantity: number }[];
  rejectedUnits: number;
  /** Days a delivery may slip and still count as on time. */
  graceDays?: number;
};

/**
 * Compute a supplier's numbers from what actually happened.
 *
 * Deliberately not read from Supplier.onTimeDeliveryPct: those columns default
 * to 100 and rating A, so a supplier nobody has ever measured would be shown —
 * in a portal they can see — a perfect score that no one computed. An unmeasured
 * supplier gets null here instead.
 *
 * A line with no promised date is excluded rather than counted as on time.
 * There is no commitment to be late against, and counting it as a pass would
 * quietly inflate every score for shops that do not fill the field in.
 */
export function computeScorecard(input: ScoreInput): Scorecard {
  const grace = input.graceDays ?? 0;
  const scored = input.receipts.filter((r) => r.promisedDate != null);
  const late = scored.filter((r) => {
    const promised = r.promisedDate!.getTime() + grace * 86400000;
    // Early is on time. A supplier is not penalised for beating the date.
    return r.receivedAt.getTime() > promised;
  });

  const unitsReceived = input.receipts.reduce((s, r) => s + Math.max(0, r.quantity), 0);
  const sufficient = scored.length >= MIN_SCORE_SAMPLE;

  return {
    onTimePct: sufficient
      ? ((scored.length - late.length) / scored.length) * 100
      : null,
    receiptsScored: scored.length,
    lateReceipts: late.length,
    qualityPpm: unitsReceived > 0 ? (input.rejectedUnits / unitsReceived) * 1e6 : null,
    unitsReceived,
    rejectedUnits: input.rejectedUnits,
    sufficientData: sufficient,
  };
}

/** The scorecard for the supplier a portal token resolves to. */
export async function portalScorecard(rawToken: string) {
  const check = await resolveToken(rawToken);
  if (!check.ok) return null;

  const receiptLines = await prisma.receiptLine.findMany({
    where: {
      receipt: { purchaseOrder: { supplierId: check.supplierId } },
    },
    select: {
      quantityReceived: true,
      poLineId: true,
      receipt: { select: { receivedAt: true } },
    },
    take: 1000,
  });

  const poLineIds = receiptLines
    .map((r) => r.poLineId)
    .filter((v): v is string => Boolean(v));
  const poLines = poLineIds.length
    ? await prisma.purchaseOrderLine.findMany({
        where: { id: { in: poLineIds } },
        select: { id: true, promisedDate: true },
      })
    : [];
  const promisedById = new Map(poLines.map((l) => [l.id, l.promisedDate]));

  const ncrs = await prisma.nonConformance.count({
    where: { supplierId: check.supplierId },
  });

  return computeScorecard({
    receipts: receiptLines.map((r) => ({
      promisedDate: r.poLineId ? (promisedById.get(r.poLineId) ?? null) : null,
      receivedAt: r.receipt.receivedAt,
      quantity: r.quantityReceived,
    })),
    // One NCR is one rejection event; the quantity on it is not modelled per
    // line, so this is a count and the label says so.
    rejectedUnits: ncrs,
  });
}

async function nextAsnNumber() {
  const year = new Date().getFullYear();
  const like = `ASN-${year}-`;
  const last = await prisma.supplierAsn.findFirst({
    where: { number: { startsWith: like } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(like.length), 10) + 1 : 1;
  return `${like}${String(seq).padStart(4, "0")}`;
}

/**
 * Record an advance ship notice. Quantities are the supplier's claim and never
 * touch inventory — receiving still counts what arrives.
 */
export async function submitAsn(input: {
  token: string;
  purchaseOrderId?: string | null;
  shipDate?: Date | null;
  expectedDate?: Date | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  packages?: number | null;
  notes?: string | null;
  lines: { poLineId?: string | null; description: string; quantity: number; lotNumber?: string | null }[];
}) {
  const check = await resolveToken(input.token);
  if (!check.ok) throw new Error("This link is no longer valid");

  const lines = input.lines.filter((l) => l.description.trim() && l.quantity > 0);
  if (lines.length === 0) {
    throw new Error("An advance ship notice needs at least one line with a quantity");
  }

  let purchaseOrderId: string | null = null;
  if (input.purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: input.purchaseOrderId },
      select: { id: true, supplierId: true },
    });
    if (po && po.supplierId === check.supplierId) purchaseOrderId = po.id;
  }

  return prisma.supplierAsn.create({
    data: {
      number: await nextAsnNumber(),
      supplierId: check.supplierId,
      purchaseOrderId,
      shipDate: input.shipDate ?? null,
      expectedDate: input.expectedDate ?? null,
      carrier: (input.carrier || "").trim() || null,
      trackingNumber: (input.trackingNumber || "").trim() || null,
      packages: input.packages ?? null,
      notes: (input.notes || "").trim() || null,
      lines: {
        create: lines.map((l) => ({
          poLineId: l.poLineId || null,
          description: l.description.trim(),
          quantity: l.quantity,
          lotNumber: (l.lotNumber || "").trim() || null,
        })),
      },
    },
    include: { lines: true },
  });
}

export async function portalAsns(rawToken: string) {
  const check = await resolveToken(rawToken);
  if (!check.ok) return [];
  return prisma.supplierAsn.findMany({
    where: { supplierId: check.supplierId },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: {
      lines: true,
      purchaseOrder: { select: { number: true } },
    },
  });
}

/** Inbound shipments for the buyer's receiving desk. */
export async function inboundAsns() {
  return prisma.supplierAsn.findMany({
    where: { status: { in: ["SUBMITTED", "IN_TRANSIT"] } },
    orderBy: { expectedDate: "asc" },
    take: 100,
    include: {
      lines: true,
      supplier: { select: { name: true } },
      purchaseOrder: { select: { id: true, number: true } },
    },
  });
}
