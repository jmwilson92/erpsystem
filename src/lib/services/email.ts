/**
 * Email integration — outbound composing/sending and inbound parsing.
 *
 * Transport: set RESEND_API_KEY (and EMAIL_FROM, e.g. "erp@yourdomain.com")
 * to deliver for real via the Resend HTTP API — no SDK needed. Without a
 * key, messages are logged to the Email Center and marked SENT so the
 * whole flow (compose → send → log → entity link) still works and invite
 * links can be copied from there.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { formatCurrency } from "@/lib/utils";

export async function sendEmail(params: {
  to: string;
  subject: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  userId?: string;
}) {
  if (!params.to?.trim()) throw new Error("Recipient e-mail required");
  if (!params.subject?.trim()) throw new Error("Subject required");

  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
  });
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr =
    process.env.EMAIL_FROM ||
    `${(company?.name || "ForgeRP").toLowerCase().replace(/[^a-z0-9]+/g, ".")}@erp.local`;

  const msg = await prisma.emailMessage.create({
    data: {
      direction: "OUTBOUND",
      status: apiKey ? "QUEUED" : "SENT",
      fromAddr,
      toAddr: params.to.trim(),
      subject: params.subject.trim(),
      body: params.body,
      entityType: params.entityType || null,
      entityId: params.entityId || null,
      entityLabel: params.entityLabel || null,
      sentAt: apiKey ? null : new Date(),
      createdById: params.userId || null,
    },
  });

  if (apiKey) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromAddr,
          to: [msg.toAddr],
          subject: msg.subject,
          text: msg.body,
        }),
      });
      if (!resp.ok) {
        throw new Error(`Resend ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } catch (err) {
      // Delivery failure never breaks the calling flow — the message stays
      // in the Email Center with the error, links can be shared manually.
      await prisma.emailMessage.update({
        where: { id: msg.id },
        data: {
          status: "FAILED",
          error: err instanceof Error ? err.message : "Delivery failed",
        },
      });
    }
  }

  await logAudit({
    entityType: "EmailMessage",
    entityId: msg.id,
    action: "EMAIL_SENT",
    userId: params.userId,
    metadata: {
      to: msg.toAddr,
      subject: msg.subject,
      entity: msg.entityLabel,
    },
  });
  return msg;
}

/** Prefilled outbound draft for a purchase order → supplier. */
export async function composePoEmail(poId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    include: {
      supplier: true,
      lines: { orderBy: { lineNumber: "asc" }, include: { part: true } },
    },
  });
  if (!po) throw new Error("PO not found");
  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
  });
  const lines = po.lines
    .map(
      (l) =>
        `  ${String(l.lineNumber).padStart(2)}  ${
          l.part?.partNumber || ""
        }  ${l.description}  x${l.quantity} ${l.uom} @ ${formatCurrency(l.unitCost)}`
    )
    .join("\n");
  return {
    to: po.supplier.contactEmail || "",
    subject: `Purchase Order ${po.number} — ${company?.name || "ForgeRP"}`,
    body: [
      `Hello ${po.supplier.contactName || po.supplier.name},`,
      "",
      `Please find our purchase order ${po.number}.`,
      "",
      lines,
      "",
      `Total: ${formatCurrency(po.totalAmount)}   Terms: ${po.paymentTerms}`,
      po.promisedDate
        ? `Requested delivery: ${po.promisedDate.toISOString().slice(0, 10)}`
        : "",
      "",
      "Please acknowledge receipt and confirm the delivery date by replying to this e-mail.",
      "",
      `${company?.name || "ForgeRP"} Purchasing`,
    ]
      .filter((l) => l !== null)
      .join("\n"),
    entityType: "PurchaseOrder",
    entityId: po.id,
    entityLabel: po.number,
  };
}

/** Prefilled outbound draft for a quote → customer. */
export async function composeQuoteEmail(quoteId: string) {
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      lines: { orderBy: { lineNumber: "asc" }, include: { part: true } },
    },
  });
  if (!q) throw new Error("Quote not found");
  const company = await prisma.companySettings.findUnique({
    where: { id: "default" },
  });
  const lines = q.lines
    .map(
      (l) =>
        `  ${String(l.lineNumber).padStart(2)}  ${
          l.part?.partNumber || ""
        }  ${l.description}  x${l.quantity} @ ${formatCurrency(l.unitPrice)}`
    )
    .join("\n");
  return {
    to: q.contactEmail || q.customer.contactEmail || "",
    subject: `Quotation ${q.number} — ${company?.name || "ForgeRP"}`,
    body: [
      `Hello ${q.contactName || q.customer.contactName || q.customer.name},`,
      "",
      `Thank you for the opportunity — quotation ${q.number} is below.`,
      "",
      lines,
      "",
      `Total: ${formatCurrency(q.totalAmount)}   Terms: ${q.paymentTerms}`,
      q.validUntil
        ? `Valid until: ${q.validUntil.toISOString().slice(0, 10)}`
        : "",
      "",
      "Reply to this e-mail to accept or with any questions.",
      "",
      `${company?.name || "ForgeRP"} Sales`,
    ].join("\n"),
    entityType: "Quote",
    entityId: q.id,
    entityLabel: q.number,
  };
}

// ─── Inbound ────────────────────────────────────────────────────

export type InboundResult = {
  messageId: string;
  outcome: string;
  entityType?: string;
  entityId?: string;
  entityLabel?: string;
};

/** Pull From:/Subject: headers out of pasted raw mail (best-effort). */
function parseRawEmail(raw: string) {
  const fromMatch = raw.match(/^From:\s*(?:.*<)?([^\s<>]+@[^\s<>]+?)>?\s*$/im);
  const subjectMatch = raw.match(/^Subject:\s*(.+)$/im);
  // Body = everything after the first blank line following headers, or all of it
  const blank = raw.search(/\r?\n\r?\n/);
  const body = blank > -1 ? raw.slice(blank).trim() : raw.trim();
  return {
    from: fromMatch?.[1]?.trim() || "",
    subject: subjectMatch?.[1]?.trim() || "",
    body,
  };
}

/**
 * Parse a pasted inbound e-mail into a draft record:
 * - RFQ    → draft Quote for the matched customer, lines from part
 *            numbers found in the body (qty patterns like "5x PN-123")
 * - PO_ACK → find PO-xxxxx in the mail, mark the PO acknowledged
 * - OTHER  → just log it on the email center
 */
export async function parseInboundEmail(params: {
  raw: string;
  kind: "RFQ" | "PO_ACK" | "OTHER";
  userId?: string;
}): Promise<InboundResult> {
  if (!params.raw?.trim()) throw new Error("Paste the e-mail first");
  const { from, subject, body } = parseRawEmail(params.raw);

  let outcome = "Logged";
  let entityType: string | undefined;
  let entityId: string | undefined;
  let entityLabel: string | undefined;

  if (params.kind === "RFQ") {
    // Match customer by exact contact e-mail, then by domain
    const domain = from.split("@")[1]?.toLowerCase() || "";
    const customers = await prisma.customer.findMany({
      select: { id: true, name: true, contactEmail: true },
    });
    const customer =
      customers.find(
        (c) => c.contactEmail?.toLowerCase() === from.toLowerCase()
      ) ||
      (domain
        ? customers.find((c) =>
            c.contactEmail?.toLowerCase().endsWith(`@${domain}`)
          )
        : undefined);
    if (!customer) {
      throw new Error(
        `No customer matches ${from || "the sender"} — add the customer (with contact e-mail) first`
      );
    }

    // Find known part numbers mentioned in the body with nearby quantities
    const parts = await prisma.part.findMany({
      where: { isActive: true },
      select: { id: true, partNumber: true, description: true, standardCost: true },
    });
    const found: { partId: string; description: string; quantity: number; unitPrice: number }[] = [];
    const haystack = `${subject}\n${body}`;
    for (const p of parts) {
      const idx = haystack.toUpperCase().indexOf(p.partNumber.toUpperCase());
      if (idx === -1) continue;
      // qty before ("5x PN", "qty 5 PN") or after ("PN x5", "PN qty 5", "PN — 5 ea")
      const before = haystack.slice(Math.max(0, idx - 24), idx);
      const after = haystack.slice(idx + p.partNumber.length, idx + p.partNumber.length + 24);
      const qtyMatch =
        before.match(/(\d+)\s*(?:x|ea|pcs|units|qty[:\s]*)\s*$/i) ||
        after.match(/^\s*(?:x|qty[:\s]*|—|-)?\s*(\d+)\s*(?:x|ea|pcs|units)?/i);
      const quantity = Math.max(1, parseInt(qtyMatch?.[1] || "1", 10) || 1);
      found.push({
        partId: p.id,
        description: p.description,
        quantity,
        unitPrice: p.standardCost,
      });
    }
    if (found.length === 0) {
      throw new Error(
        "No known part numbers found in the e-mail body — add lines manually via Quotes"
      );
    }

    const count = await prisma.quote.count();
    const number = `QT-${String(count + 1).padStart(5, "0")}`;
    const quote = await prisma.quote.create({
      data: {
        number,
        customerId: customer.id,
        status: "DRAFT",
        contactEmail: from || undefined,
        notes: `Drafted from inbound RFQ e-mail${subject ? ` — "${subject}"` : ""}`,
        totalAmount: found.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
        lines: {
          create: found.map((l, i) => ({
            partId: l.partId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineNumber: i + 1,
          })),
        },
      },
    });
    outcome = `Draft quote ${quote.number} created for ${customer.name} (${found.length} line(s))`;
    entityType = "Quote";
    entityId = quote.id;
    entityLabel = quote.number;
  } else if (params.kind === "PO_ACK") {
    const poNum = `${subject}\n${body}`.match(/PO-\d{5}/i)?.[0]?.toUpperCase();
    if (!poNum) throw new Error("No PO-xxxxx number found in the e-mail");
    const po = await prisma.purchaseOrder.findUnique({
      where: { number: poNum },
    });
    if (!po) throw new Error(`${poNum} not found`);
    await prisma.purchaseOrder.update({
      where: { id: po.id },
      data: {
        acknowledgedAt: po.acknowledgedAt || new Date(),
        status: ["ISSUED", "APPROVED"].includes(po.status)
          ? "ACKNOWLEDGED"
          : po.status,
      },
    });
    outcome = `${poNum} marked acknowledged by supplier`;
    entityType = "PurchaseOrder";
    entityId = po.id;
    entityLabel = poNum;
  }

  const msg = await prisma.emailMessage.create({
    data: {
      direction: "INBOUND",
      status: params.kind === "OTHER" ? "RECEIVED" : "PARSED",
      fromAddr: from || "unknown",
      toAddr: "inbound@erp.local",
      subject: subject || "(no subject)",
      body,
      entityType,
      entityId,
      entityLabel,
      createdById: params.userId || null,
    },
  });

  await logAudit({
    entityType: "EmailMessage",
    entityId: msg.id,
    action: "EMAIL_PARSED",
    userId: params.userId,
    metadata: { kind: params.kind, outcome, entity: entityLabel },
  });

  return { messageId: msg.id, outcome, entityType, entityId, entityLabel };
}

export async function listEmailMessages(limit = 50) {
  return prisma.emailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
