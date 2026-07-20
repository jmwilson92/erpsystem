/**
 * Federal payroll tax engine — IRS Pub 15-T percentage method for
 * automated payroll systems (Worksheet 1A, standard withholding), plus
 * statutory FICA with the Social Security wage-base cap and Additional
 * Medicare Tax.
 *
 * How the percentage method works: annualize the period's wages, take
 * the standard deduction for the W-4 filing status, run the result
 * through the income-tax brackets, subtract W-4 step-3 credits, divide
 * back to the pay period, and add any step-4c extra withholding.
 *
 * ⚠ ANNUAL MAINTENANCE: the figures below are per tax year. Each
 * December, add the next year's entry from the new Rev. Proc. /
 * Pub 15-T and SSA wage-base announcement. If a year is missing the
 * engine uses the latest year on file and flags it on the result.
 */

export type FilingStatus = "SINGLE" | "MARRIED" | "HEAD";

type Bracket = { upTo: number; rate: number }; // upper bound of taxable income for this rate

type TaxYear = {
  standardDeduction: Record<FilingStatus, number>;
  brackets: Record<FilingStatus, Bracket[]>;
  /** Social Security taxable wage base (per SSA annual announcement) */
  ssWageBase: number;
};

const INF = Number.POSITIVE_INFINITY;

export const TAX_YEARS: Record<number, TaxYear> = {
  // Rev. Proc. 2024-40 + Pub 15-T (2025); SSA 2025 wage base
  2025: {
    standardDeduction: { SINGLE: 15750, MARRIED: 31500, HEAD: 23625 },
    ssWageBase: 176100,
    brackets: {
      SINGLE: [
        { upTo: 11925, rate: 0.10 },
        { upTo: 48475, rate: 0.12 },
        { upTo: 103350, rate: 0.22 },
        { upTo: 197300, rate: 0.24 },
        { upTo: 250525, rate: 0.32 },
        { upTo: 626350, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
      MARRIED: [
        { upTo: 23850, rate: 0.10 },
        { upTo: 96950, rate: 0.12 },
        { upTo: 206700, rate: 0.22 },
        { upTo: 394600, rate: 0.24 },
        { upTo: 501050, rate: 0.32 },
        { upTo: 751600, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
      HEAD: [
        { upTo: 17000, rate: 0.10 },
        { upTo: 64850, rate: 0.12 },
        { upTo: 103350, rate: 0.22 },
        { upTo: 197300, rate: 0.24 },
        { upTo: 250500, rate: 0.32 },
        { upTo: 626350, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
    },
  },
  // Rev. Proc. 2025 inflation adjustments (post-OBBBA) + SSA 2026 wage
  // base. Verify against the final Pub 15-T (2026) before real filings.
  2026: {
    standardDeduction: { SINGLE: 16100, MARRIED: 32200, HEAD: 24150 },
    ssWageBase: 184500,
    brackets: {
      SINGLE: [
        { upTo: 12400, rate: 0.10 },
        { upTo: 50400, rate: 0.12 },
        { upTo: 105700, rate: 0.22 },
        { upTo: 201775, rate: 0.24 },
        { upTo: 256225, rate: 0.32 },
        { upTo: 640600, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
      MARRIED: [
        { upTo: 24800, rate: 0.10 },
        { upTo: 100800, rate: 0.12 },
        { upTo: 211400, rate: 0.22 },
        { upTo: 403550, rate: 0.24 },
        { upTo: 512450, rate: 0.32 },
        { upTo: 768700, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
      HEAD: [
        { upTo: 17700, rate: 0.10 },
        { upTo: 67450, rate: 0.12 },
        { upTo: 105700, rate: 0.22 },
        { upTo: 201775, rate: 0.24 },
        { upTo: 256225, rate: 0.32 },
        { upTo: 640600, rate: 0.35 },
        { upTo: INF, rate: 0.37 },
      ],
    },
  },
};

/** Statutory FICA components (rates are not indexed; wage base is per-year). */
export const SS_RATE = 0.062;
export const MEDICARE_RATE = 0.0145;
export const ADDL_MEDICARE_RATE = 0.009;
/** Additional Medicare Tax withholding threshold (not indexed) */
export const ADDL_MEDICARE_THRESHOLD = 200000;

export const PERIODS_PER_YEAR: Record<string, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function getTaxYear(year: number): { table: TaxYear; year: number; exact: boolean } {
  if (TAX_YEARS[year]) return { table: TAX_YEARS[year], year, exact: true };
  const latest = Math.max(...Object.keys(TAX_YEARS).map(Number));
  return { table: TAX_YEARS[latest], year: latest, exact: false };
}

/** Annual income tax on `taxable` via the year's brackets for the status. */
export function annualIncomeTax(
  taxable: number,
  status: FilingStatus,
  year: number
): number {
  if (taxable <= 0) return 0;
  const { table } = getTaxYear(year);
  const brackets = table.brackets[status] || table.brackets.SINGLE;
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    if (taxable <= lower) break;
    const slice = Math.min(taxable, b.upTo) - lower;
    tax += slice * b.rate;
    lower = b.upTo;
  }
  return tax;
}

/**
 * Federal income tax withholding for one pay period (Pub 15-T
 * percentage method, standard withholding — W-4 step 2 unchecked).
 */
export function computeFederalWithholding(params: {
  grossForPeriod: number;
  periodsPerYear: number;
  filingStatus: FilingStatus;
  /** W-4 step 3 — annual dependents/other credits ($) */
  dependentCredits?: number;
  /** W-4 step 4c — extra withholding per period ($) */
  extraPerPeriod?: number;
  year: number;
}): number {
  const { table } = getTaxYear(params.year);
  const status = table.brackets[params.filingStatus]
    ? params.filingStatus
    : "SINGLE";
  const annualWages = params.grossForPeriod * params.periodsPerYear;
  const taxable = Math.max(0, annualWages - table.standardDeduction[status]);
  const annualTax = Math.max(
    0,
    annualIncomeTax(taxable, status, params.year) - (params.dependentCredits || 0)
  );
  return r2(annualTax / params.periodsPerYear + (params.extraPerPeriod || 0));
}

export type FicaBreakdown = {
  /** Employee-withheld Social Security (capped at the wage base) */
  ssEmployee: number;
  /** Employee-withheld Medicare incl. Additional Medicare over $200k YTD */
  medicareEmployee: number;
  /** ssEmployee + medicareEmployee */
  employeeTotal: number;
  /** Employer match: SS (same cap) + 1.45% Medicare — no additional-tax match */
  employerTotal: number;
};

/**
 * FICA for one period given the employee's year-to-date gross BEFORE
 * this period — needed for the SS wage-base cap and the Additional
 * Medicare Tax threshold.
 */
export function computeFica(params: {
  grossForPeriod: number;
  ytdGrossBefore: number;
  year: number;
}): FicaBreakdown {
  const { table } = getTaxYear(params.year);
  const gross = params.grossForPeriod;
  const ytd = Math.max(0, params.ytdGrossBefore);

  const ssTaxable = Math.max(
    0,
    Math.min(ytd + gross, table.ssWageBase) - Math.min(ytd, table.ssWageBase)
  );
  const ss = r2(ssTaxable * SS_RATE);

  const medicareBase = r2(gross * MEDICARE_RATE);
  const overThreshold = Math.max(
    0,
    Math.min(gross, ytd + gross - ADDL_MEDICARE_THRESHOLD)
  );
  const medicareEmployee = r2(medicareBase + overThreshold * ADDL_MEDICARE_RATE);

  return {
    ssEmployee: ss,
    medicareEmployee,
    employeeTotal: r2(ss + medicareEmployee),
    employerTotal: r2(ss + medicareBase),
  };
}
