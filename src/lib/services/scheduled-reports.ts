/**
 * Memorized report delivery — email a financial report on a cadence.
 * Due schedules are materialized when the accounting page loads (same
 * pattern as recurring journals), computing the report's headline figures
 * and sending them through the email center. Delivery is best-effort: if
 * the mailer is not configured the message is still logged as SENT.
 */
import { prisma } from "@/lib/db";
import { computeNextRun } from "@/lib/services/recurring-journals";
import { formatCurrency } from "@/lib/utils";

const REPORTS: Record<string, string> = {
  pl: "Income Statement",
  bs: "Balance Sheet",
  cf: "Statement of Cash Flows",
  tb: "Trial Balance",
  budget: "Budget vs. Actual",
  "1099": "1099 Vendor Summary",
};
const FREQS = ["WEEKLY", "MONTHLY", "QUARTERLY"] as const;

export function reportLabel(key: string) {
  return REPORTS[key] || key;
}

function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /.+@.+\..+/.test(s));
}

export async function createScheduledReport(params: {
  name: string;
  report: string;
  frequency: string;
  dayOfMonth: number;
  recipients: string;
  createdById?: string | null;
}) {
  if (!REPORTS[params.report]) throw new Error("Unknown report");
  if (!FREQS.includes(params.frequency as (typeof FREQS)[number])) {
    throw new Error(`Frequency must be one of ${FREQS.join(", ")}`);
  }
  const emails = parseRecipients(params.recipients);
  if (emails.length === 0) throw new Error("At least one valid recipient email is required");
  return prisma.scheduledReport.create({
    data: {
      name: params.name.trim() || reportLabel(params.report),
      report: params.report,
      frequency: params.frequency,
      dayOfMonth: params.dayOfMonth,
      recipients: emails.join(", "),
      createdById: params.createdById || null,
      nextRunAt: computeNextRun(params.frequency, params.dayOfMonth, new Date()),
    },
  });
}

export async function setScheduledReportActive(id: string, isActive: boolean) {
  const rep = await prisma.scheduledReport.update({
    where: { id },
    data: { isActive },
  });
  if (isActive) {
    return prisma.scheduledReport.update({
      where: { id },
      data: { nextRunAt: computeNextRun(rep.frequency, rep.dayOfMonth, new Date()) },
    });
  }
  return rep;
}

export async function deleteScheduledReport(id: string) {
  return prisma.scheduledReport.delete({ where: { id } });
}

export async function listScheduledReports() {
  const rows = await prisma.scheduledReport.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ ...r, reportLabel: reportLabel(r.report) }));
}

/** Compute a short set of headline figures + an HTML body for a report. */
async function buildReportEmail(report: string): Promise<{ subject: string; body: string }> {
  const { getGaapReportPack, getCashFlowStatement } = await import("@/lib/services/gaap");
  const { getBudgetVsActual, get1099Report } = await import(
    "@/lib/services/accounting-reports"
  );
  const label = reportLabel(report);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const line = (k: string, v: number) =>
    `<tr><td style="padding:4px 16px 4px 0">${k}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${formatCurrency(v)}</td></tr>`;

  let rows = "";
  if (report === "pl") {
    const { incomeStatement: pl } = await getGaapReportPack();
    rows = line("Revenue", pl.revenue) + line("Gross profit", pl.grossProfit) + line("Net income", pl.netIncome);
  } else if (report === "bs") {
    const { balanceSheet: bs } = await getGaapReportPack();
    rows = line("Total assets", bs.assets) + line("Total liabilities", bs.liabilities) + line("Total equity", bs.equity);
  } else if (report === "cf") {
    const cf = await getCashFlowStatement({});
    rows =
      line("Operating", cf.operatingTotal) +
      line("Investing", cf.investingTotal) +
      line("Financing", cf.financingTotal) +
      line("Net change in cash", cf.netChange);
  } else if (report === "tb") {
    const { trialBalance: tb } = await getGaapReportPack();
    rows = line("Total debits", tb.debit) + line("Total credits", tb.credit);
  } else if (report === "budget") {
    const b = await getBudgetVsActual();
    rows =
      line("Total budget", b.totalBudget) +
      line("Total actual", b.totalActual) +
      line("Variance", b.totalVariance) +
      `<tr><td colspan="2" style="padding-top:8px;color:#64748b">${b.overCount} budget(s) over</td></tr>`;
  } else if (report === "1099") {
    const r = await get1099Report({});
    rows =
      line("1099 vendors ≥ $600", r.reportableCount) +
      line("Total paid (1099 vendors)", r.totalPaid) +
      `<tr><td colspan="2" style="padding-top:8px;color:#64748b">${r.missingTaxIds} reportable vendor(s) missing a tax ID</td></tr>`;
  }

  const body = `
    <div style="font-family:system-ui,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 4px">${label}</h2>
      <p style="margin:0 0 12px;color:#64748b">As of ${new Date().toLocaleDateString()}</p>
      <table style="border-collapse:collapse;font-size:14px">${rows}</table>
      ${appUrl ? `<p style="margin-top:16px"><a href="${appUrl}/accounting">Open the full report in ForgeRP →</a></p>` : ""}
    </div>`;
  return { subject: `${label} — ${new Date().toLocaleDateString()}`, body };
}

/**
 * Send any scheduled reports that are due, then advance their schedules.
 * Catch-up safe (advances past missed periods without back-sending more
 * than the current one). Idempotent between due dates.
 */
export async function runDueScheduledReports(userId?: string | null) {
  const due = await prisma.scheduledReport.findMany({
    where: { isActive: true, nextRunAt: { lte: new Date() } },
  });
  const { sendEmail } = await import("@/lib/services/email");
  const sent: { id: string; report: string; recipients: number }[] = [];

  for (const s of due) {
    try {
      const { subject, body } = await buildReportEmail(s.report);
      const recipients = s.recipients
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      for (const to of recipients) {
        await sendEmail({
          to,
          subject,
          body,
          entityType: "ScheduledReport",
          entityId: s.id,
          entityLabel: s.name,
          userId: userId || s.createdById || undefined,
        });
      }
      sent.push({ id: s.id, report: s.report, recipients: recipients.length });
    } catch {
      // don't let one bad schedule block the rest
    }
    // Advance to the next future run (skip any missed periods)
    let next = computeNextRun(s.frequency, s.dayOfMonth, s.nextRunAt || new Date());
    let guard = 0;
    while (next <= new Date() && guard < 24) {
      next = computeNextRun(s.frequency, s.dayOfMonth, next);
      guard++;
    }
    await prisma.scheduledReport.update({
      where: { id: s.id },
      data: { lastRunAt: new Date(), nextRunAt: next },
    });
  }
  return sent;
}
