import { redirect } from "next/navigation";

// Banking now lives as a tab inside Accounting.
export default async function BankingRedirect({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : {};
  const acct = (Array.isArray(sp.acct) ? sp.acct[0] : sp.acct) || "";
  redirect(`/accounting?tab=banking${acct ? `&acct=${acct}` : ""}`);
}
