/**
 * Plaid live bank feeds. Activates when PLAID_CLIENT_ID and PLAID_SECRET
 * are set (free keys from dashboard.plaid.com); PLAID_ENV picks
 * sandbox | development | production. Without keys the Banking tab falls
 * back to file/paste import only.
 *
 * Flow: createLinkToken → Plaid Link in the browser walks the user
 * through their bank's own login → exchangePublicToken stores the access
 * token per linked account → syncPlaidTransactions pulls the feed through
 * /transactions/sync (cursor-based, incremental) into BankTransaction,
 * where the existing categorize → post-JE → reconcile flow takes over.
 *
 * Uses raw fetch instead of the plaid SDK — the three endpoints we need
 * are plain JSON POSTs and this keeps the dependency surface flat.
 */
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

export function plaidEnabled() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

function plaidHost() {
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  return PLAID_HOSTS[env] || PLAID_HOSTS.sandbox;
}

class PlaidError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
  }
}

async function plaidRequest<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  if (!plaidEnabled()) {
    throw new PlaidError(
      "NOT_CONFIGURED",
      "Plaid keys are not configured (set PLAID_CLIENT_ID and PLAID_SECRET)"
    );
  }
  const res = await fetch(`${plaidHost()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json.error_code) {
    throw new PlaidError(
      String(json.error_code || res.status),
      String(json.error_message || `Plaid ${path} failed (${res.status})`)
    );
  }
  return json as T;
}

/** Short-lived token that opens Plaid Link in the browser. */
export async function createLinkToken(userId: string) {
  const json = await plaidRequest<{ link_token: string }>(
    "/link/token/create",
    {
      user: { client_user_id: userId },
      client_name: "ForgeRP",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    }
  );
  return json.link_token;
}

type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  mask?: string | null;
  type: string; // depository | credit | loan | investment
  subtype?: string | null;
};

/**
 * Exchange Link's public_token for a permanent access token and register
 * each account on the linked item as a BankAccount. Re-linking an account
 * that already exists refreshes its token instead of duplicating it.
 * GL mapping is left for the accountant (same as manual accounts).
 */
export async function exchangePublicToken(params: {
  publicToken: string;
  institution?: string | null;
  userId?: string | null;
}) {
  const exchanged = await plaidRequest<{
    access_token: string;
    item_id: string;
  }>("/item/public_token/exchange", { public_token: params.publicToken });

  const accounts = await plaidRequest<{ accounts: PlaidAccount[] }>(
    "/accounts/get",
    { access_token: exchanged.access_token }
  );

  const linked: string[] = [];
  for (const a of accounts.accounts) {
    if (!["depository", "credit"].includes(a.type)) continue;
    const kind =
      a.type === "credit"
        ? "CREDIT_CARD"
        : a.subtype === "savings"
          ? "SAVINGS"
          : "CHECKING";
    const existing = await prisma.bankAccount.findFirst({
      where: { plaidAccountId: a.account_id },
    });
    const data = {
      name: a.official_name || a.name,
      institution: params.institution || null,
      kind,
      last4: a.mask || null,
      plaidItemId: exchanged.item_id,
      plaidAccountId: a.account_id,
      plaidAccessToken: exchanged.access_token,
      plaidCursor: null, // full re-sync from the start of history
      isActive: true,
    };
    const acct = existing
      ? await prisma.bankAccount.update({ where: { id: existing.id }, data })
      : await prisma.bankAccount.create({ data });
    linked.push(acct.id);
    await logAudit({
      entityType: "BankAccount",
      entityId: acct.id,
      action: existing ? "PLAID_RELINKED" : "PLAID_LINKED",
      userId: params.userId,
      metadata: { institution: params.institution, mask: a.mask },
    });
  }
  return { linked: linked.length, accountIds: linked };
}

type PlaidTxn = {
  transaction_id: string;
  account_id: string;
  date: string; // YYYY-MM-DD (posted date)
  name: string;
  merchant_name?: string | null;
  amount: number; // Plaid: positive = money OUT
  pending: boolean;
};

export type PlaidSyncResult = {
  added: number;
  modified: number;
  removed: number;
  skippedPending: number;
};

/**
 * Pull new activity for every account on the token's item via
 * /transactions/sync. Cursor-based: each call resumes exactly where the
 * last one stopped, so this is safe to run on every Banking tab view.
 * Pending transactions are skipped (they re-arrive as posted); removed
 * ones are deleted unless already categorized into the GL.
 *
 * Sign convention: Plaid reports outflows as positive — flipped here to
 * match the feed (negative = money out).
 */
export async function syncPlaidTransactions(bankAccountId: string): Promise<PlaidSyncResult> {
  const account = await prisma.bankAccount.findUniqueOrThrow({
    where: { id: bankAccountId },
  });
  if (!account.plaidAccessToken) {
    throw new Error(`${account.name} is not linked through Plaid`);
  }

  // One item can back several BankAccounts (checking + savings + card);
  // sync returns the whole item, so route rows by plaidAccountId.
  const siblings = await prisma.bankAccount.findMany({
    where: { plaidItemId: account.plaidItemId, plaidAccountId: { not: null } },
  });
  const byPlaidId = new Map(siblings.map((s) => [s.plaidAccountId!, s]));

  const result: PlaidSyncResult = { added: 0, modified: 0, removed: 0, skippedPending: 0 };
  const balanceDelta = new Map<string, number>();
  let cursor = account.plaidCursor || undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await plaidRequest<{
      added: PlaidTxn[];
      modified: PlaidTxn[];
      removed: { transaction_id: string }[];
      next_cursor: string;
      has_more: boolean;
    }>("/transactions/sync", {
      access_token: account.plaidAccessToken,
      ...(cursor ? { cursor } : {}),
      count: 200,
    });

    for (const t of [...page.added, ...page.modified]) {
      if (t.pending) {
        result.skippedPending++;
        continue;
      }
      const target = byPlaidId.get(t.account_id);
      if (!target) continue;
      const externalId = `plaid:${t.transaction_id}`;
      const amount = Math.round(-t.amount * 100) / 100;
      const description = t.merchant_name || t.name || "(no description)";
      const existing = await prisma.bankTransaction.findFirst({
        where: { externalId },
      });
      if (existing) {
        // Modified: refresh details only while still uncategorized
        if (existing.status === "UNMATCHED") {
          const drift = amount - existing.amount;
          if (drift !== 0) {
            balanceDelta.set(
              target.id,
              (balanceDelta.get(target.id) || 0) + drift
            );
          }
          await prisma.bankTransaction.update({
            where: { id: existing.id },
            data: { date: new Date(t.date), description, amount },
          });
          result.modified++;
        }
        continue;
      }
      await prisma.bankTransaction.create({
        data: {
          bankAccountId: target.id,
          date: new Date(t.date),
          description,
          amount,
          externalId,
        },
      });
      balanceDelta.set(target.id, (balanceDelta.get(target.id) || 0) + amount);
      result.added++;
    }

    for (const r of page.removed) {
      const existing = await prisma.bankTransaction.findFirst({
        where: { externalId: `plaid:${r.transaction_id}` },
      });
      // Never silently unwind something already posted to the GL
      if (existing && existing.status === "UNMATCHED") {
        balanceDelta.set(
          existing.bankAccountId,
          (balanceDelta.get(existing.bankAccountId) || 0) - existing.amount
        );
        await prisma.bankTransaction.delete({ where: { id: existing.id } });
        result.removed++;
      }
    }

    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  const now = new Date();
  for (const s of siblings) {
    await prisma.bankAccount.update({
      where: { id: s.id },
      data: {
        plaidCursor: cursor,
        lastPlaidSyncAt: now,
        ...(balanceDelta.has(s.id)
          ? { currentBalance: { increment: Math.round(balanceDelta.get(s.id)! * 100) / 100 } }
          : {}),
      },
    });
  }
  return result;
}

/** Sync every Plaid-linked account (one call per item). */
export async function syncAllPlaid() {
  const linked = await prisma.bankAccount.findMany({
    where: { isActive: true, plaidAccessToken: { not: null } },
    select: { id: true, plaidItemId: true },
  });
  const doneItems = new Set<string>();
  const totals: PlaidSyncResult = { added: 0, modified: 0, removed: 0, skippedPending: 0 };
  for (const a of linked) {
    if (a.plaidItemId && doneItems.has(a.plaidItemId)) continue;
    if (a.plaidItemId) doneItems.add(a.plaidItemId);
    const r = await syncPlaidTransactions(a.id);
    totals.added += r.added;
    totals.modified += r.modified;
    totals.removed += r.removed;
    totals.skippedPending += r.skippedPending;
  }
  return totals;
}
