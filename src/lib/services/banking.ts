/**
 * Bank & credit-card feeds. Real institutions connect via an
 * aggregator in production; here transactions import from pasted
 * CSV/OFX-style rows (offline-friendly, same shape the aggregator
 * would deliver). Imported rows are matched or categorized into
 * journal entries, then reconciled against the linked GL account.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { postJournal } from "@/lib/services/gaap";
import { parseDelimited } from "@/lib/services/data-import";

const money = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export async function connectBankAccount(params: {
  name: string;
  institution?: string;
  kind?: string;
  last4?: string;
  glAccountId?: string;
  userId?: string | null;
}) {
  const acct = await prisma.bankAccount.create({
    data: {
      name: params.name,
      institution: params.institution || null,
      kind: ["CHECKING", "SAVINGS", "CREDIT_CARD"].includes(params.kind || "")
        ? params.kind!
        : "CHECKING",
      last4: params.last4 || null,
      glAccountId: params.glAccountId || null,
    },
  });
  await logAudit({
    entityType: "BankAccount",
    entityId: acct.id,
    action: "BANK_CONNECTED",
    userId: params.userId,
    metadata: { name: acct.name },
  });
  return acct;
}

export type BankImportResult = {
  imported: number;
  duplicates: number;
  errors: { row: number; message: string }[];
};

/* ── OFX / QFX (bank download format) ──────────────────────────── */

type OfxTxn = {
  date: Date;
  amount: number;
  description: string;
  fitId: string | null;
};

/**
 * Parse OFX/QFX content (SGML 1.x or XML 2.x — banks export both) into
 * transactions. Reads STMTTRN blocks: DTPOSTED, TRNAMT, NAME/MEMO/PAYEE,
 * FITID (the bank's own unique id, used for exact dedupe).
 */
export function parseOfx(text: string): OfxTxn[] {
  const txns: OfxTxn[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    // SGML OFX has no closing tags — value runs to next '<' or newline.
    const tag = (name: string) => {
      const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
      return m ? m[1].trim() : "";
    };
    const rawDate = tag("DTPOSTED");
    const m = rawDate.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) continue;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const amount = Number(tag("TRNAMT").replace(/[+$,\s]/g, ""));
    if (Number.isNaN(amount)) continue;
    const description =
      tag("NAME") || tag("PAYEE") || tag("MEMO") || "(no description)";
    const memo = tag("MEMO");
    txns.push({
      date,
      amount,
      description:
        memo && memo !== description
          ? `${description} — ${memo}`
          : description,
      fitId: tag("FITID") || null,
    });
  }
  return txns;
}

export function looksLikeOfx(text: string) {
  return /<OFX>|OFXHEADER|<STMTTRN>/i.test(text);
}

/**
 * Import a bank download in whatever format the bank gave the user:
 * OFX/QFX files route to the OFX parser, everything else through the
 * CSV/TSV column matcher. One entry point for the upload + paste UI.
 */
export async function importBankData(params: {
  bankAccountId: string;
  text: string;
  userId?: string | null;
}): Promise<BankImportResult> {
  if (!looksLikeOfx(params.text)) {
    return importBankTransactions(params);
  }
  const result: BankImportResult = { imported: 0, duplicates: 0, errors: [] };
  const txns = parseOfx(params.text);
  if (txns.length === 0) {
    result.errors.push({
      row: 0,
      message: "No transactions found in the OFX/QFX file.",
    });
    return result;
  }
  let balanceDelta = 0;
  for (const t of txns) {
    const externalId = t.fitId
      ? `${params.bankAccountId}:fitid:${t.fitId}`
      : `${params.bankAccountId}:${t.date.toISOString().slice(0, 10)}:${norm(t.description)}:${t.amount}`;
    const dupe = await prisma.bankTransaction.findFirst({ where: { externalId } });
    if (dupe) {
      result.duplicates++;
      continue;
    }
    await prisma.bankTransaction.create({
      data: {
        bankAccountId: params.bankAccountId,
        date: t.date,
        description: t.description,
        amount: money(t.amount),
        externalId,
      },
    });
    balanceDelta += t.amount;
    result.imported++;
  }
  if (balanceDelta !== 0) {
    await prisma.bankAccount.update({
      where: { id: params.bankAccountId },
      data: { currentBalance: { increment: money(balanceDelta) } },
    });
  }
  await logAudit({
    entityType: "BankAccount",
    entityId: params.bankAccountId,
    action: "BANK_IMPORT",
    userId: params.userId,
    metadata: {
      format: "OFX",
      imported: result.imported,
      duplicates: result.duplicates,
    },
  });
  return result;
}

/**
 * Import transactions from pasted rows. Columns matched loosely:
 * date, description, amount (signed; or separate debit/credit).
 */
export async function importBankTransactions(params: {
  bankAccountId: string;
  text: string;
  userId?: string | null;
}): Promise<BankImportResult> {
  const rows = parseDelimited(params.text);
  const result: BankImportResult = { imported: 0, duplicates: 0, errors: [] };
  if (rows.length < 2) {
    result.errors.push({ row: 0, message: "Need a header row + at least one row." });
    return result;
  }
  const header = rows[0].map(norm);
  const col = (...names: string[]) =>
    header.findIndex((h) => names.includes(h));
  const iDate = col("date", "posteddate", "transactiondate");
  const iDesc = col("description", "desc", "memo", "payee", "name");
  const iAmt = col("amount", "amt");
  const iDebit = col("debit", "withdrawal", "moneyout");
  const iCredit = col("credit", "deposit", "moneyin");

  if (iDate < 0 || iDesc < 0 || (iAmt < 0 && iDebit < 0 && iCredit < 0)) {
    result.errors.push({
      row: 1,
      message: "Need date, description, and amount (or debit/credit) columns.",
    });
    return result;
  }

  let balanceDelta = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    try {
      const rawDate = (cells[iDate] || "").trim();
      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) throw new Error(`Bad date "${rawDate}"`);
      const description = (cells[iDesc] || "").trim() || "(no description)";
      let amount: number;
      if (iAmt >= 0) {
        amount = Number((cells[iAmt] || "0").replace(/[$,\s]/g, "")) || 0;
      } else {
        const debit = Number((cells[iDebit] || "0").replace(/[$,()\s]/g, "")) || 0;
        const credit = Number((cells[iCredit] || "0").replace(/[$,()\s]/g, "")) || 0;
        amount = credit - debit;
      }
      const externalId = `${params.bankAccountId}:${date.toISOString().slice(0, 10)}:${norm(description)}:${amount}`;
      const dupe = await prisma.bankTransaction.findFirst({ where: { externalId } });
      if (dupe) {
        result.duplicates++;
        continue;
      }
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: params.bankAccountId,
          date,
          description,
          amount: money(amount),
          externalId,
        },
      });
      balanceDelta += amount;
      result.imported++;
    } catch (e) {
      result.errors.push({
        row: r + 1,
        message: e instanceof Error ? e.message : "Row failed",
      });
    }
  }

  if (balanceDelta !== 0) {
    await prisma.bankAccount.update({
      where: { id: params.bankAccountId },
      data: { currentBalance: { increment: money(balanceDelta) } },
    });
  }
  await logAudit({
    entityType: "BankAccount",
    entityId: params.bankAccountId,
    action: "BANK_IMPORT",
    userId: params.userId,
    metadata: { imported: result.imported, duplicates: result.duplicates },
  });
  return result;
}

/**
 * Categorize a transaction to a GL account and post the balancing
 * journal against the bank's own GL account (cash or CC payable).
 */
export async function categorizeBankTransaction(params: {
  transactionId: string;
  categoryAccountId: string;
  userId?: string | null;
}) {
  const txn = await prisma.bankTransaction.findUniqueOrThrow({
    where: { id: params.transactionId },
    include: { bankAccount: { include: { glAccount: true } } },
  });
  if (txn.status === "RECONCILED") {
    throw new Error("Transaction is already reconciled");
  }
  const bankGl = txn.bankAccount.glAccount;
  const category = await prisma.account.findUnique({
    where: { id: params.categoryAccountId },
  });
  if (!bankGl || !category) throw new Error("Missing GL accounts for posting");

  // Money out (negative): Dr category / Cr bank GL. Money in: reverse.
  const abs = Math.abs(txn.amount);
  const lines =
    txn.amount < 0
      ? [
          { accountId: category.id, debit: abs },
          { accountId: bankGl.id, credit: abs },
        ]
      : [
          { accountId: bankGl.id, debit: abs },
          { accountId: category.id, credit: abs },
        ];

  const je = await postJournal({
    description: `Bank: ${txn.description}`,
    source: "BANK",
    sourceId: txn.id,
    createdById: params.userId || undefined,
    lines,
  });

  return prisma.bankTransaction.update({
    where: { id: txn.id },
    data: {
      status: "MATCHED",
      categoryAccountId: category.id,
      journalEntryId: je.id,
    },
  });
}

/** Mark a matched transaction reconciled (bank statement agrees). */
export async function reconcileBankTransaction(transactionId: string) {
  const txn = await prisma.bankTransaction.findUniqueOrThrow({
    where: { id: transactionId },
  });
  if (txn.status !== "MATCHED") {
    throw new Error("Only a matched transaction can be reconciled");
  }
  return prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { status: "RECONCILED" },
  });
}

export async function getBankingOverview() {
  const accounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    include: {
      glAccount: { select: { code: true, name: true } },
      transactions: { select: { status: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    institution: a.institution,
    kind: a.kind,
    last4: a.last4,
    glCode: a.glAccount?.code || null,
    currentBalance: a.currentBalance,
    unmatched: a.transactions.filter((t) => t.status === "UNMATCHED").length,
    total: a.transactions.length,
  }));
}

/* ── Auto-categorization suggestions ───────────────────────────── */

/** Tokenize a bank description into meaningful words for matching. */
function descTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["the", "and", "inc", "llc", "corp", "com", "pos", "ach", "card", "debit", "credit", "purchase", "payment"].includes(w));
}

export type CategorySuggestion = {
  transactionId: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  /** 0–1: fraction of the new description's tokens seen in prior categorizations */
  confidence: number;
  basedOn: string;
};

/**
 * Suggest GL categories for unmatched transactions by learning from the
 * user's history: every previously categorized transaction votes its
 * category onto new descriptions that share tokens ("STAPLES #1071" learns
 * from "STAPLES #0442 PORTLAND"). Amount sign must agree — money-out
 * history never suggests categories for deposits.
 */
export async function suggestBankCategories(
  bankAccountId?: string
): Promise<CategorySuggestion[]> {
  const [unmatched, history] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: {
        status: "UNMATCHED",
        ...(bankAccountId ? { bankAccountId } : {}),
      },
      select: { id: true, description: true, amount: true },
    }),
    prisma.bankTransaction.findMany({
      where: {
        status: { in: ["MATCHED", "RECONCILED"] },
        categoryAccountId: { not: null },
      },
      orderBy: { date: "desc" },
      take: 500,
      select: {
        description: true,
        amount: true,
        categoryAccountId: true,
        categoryAccount: { select: { id: true, code: true, name: true } },
      },
    }),
  ]);
  if (unmatched.length === 0 || history.length === 0) return [];

  const suggestions: CategorySuggestion[] = [];
  for (const txn of unmatched) {
    const tokens = descTokens(txn.description);
    if (tokens.length === 0) continue;
    let best: CategorySuggestion | null = null;
    for (const h of history) {
      if (!h.categoryAccount) continue;
      if (Math.sign(h.amount) !== Math.sign(txn.amount)) continue;
      const hTokens = new Set(descTokens(h.description));
      if (hTokens.size === 0) continue;
      const hits = tokens.filter((t) => hTokens.has(t)).length;
      const confidence = hits / tokens.length;
      if (confidence >= 0.5 && (!best || confidence > best.confidence)) {
        best = {
          transactionId: txn.id,
          accountId: h.categoryAccount.id,
          accountCode: h.categoryAccount.code,
          accountName: h.categoryAccount.name,
          confidence,
          basedOn: h.description,
        };
        if (confidence >= 0.999) break;
      }
    }
    if (best) suggestions.push(best);
  }
  return suggestions;
}
