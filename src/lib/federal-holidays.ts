/**
 * US federal holidays with observed-date computation. Fixed-date
 * holidays observed on the nearest weekday when they fall on a weekend
 * (federal rule); floating holidays computed by nth weekday of month.
 */
export type FederalHolidayDef = {
  key: string;
  name: string;
  /** "fixed" = month/day; "float" = nth weekday of month */
  rule:
    | { type: "fixed"; month: number; day: number }
    | { type: "float"; month: number; weekday: number; nth: number };
};

// month is 1-12, weekday 0=Sun..6=Sat, nth: 1..4 or -1 for last
export const FEDERAL_HOLIDAYS: FederalHolidayDef[] = [
  { key: "new-years", name: "New Year's Day", rule: { type: "fixed", month: 1, day: 1 } },
  { key: "mlk", name: "Martin Luther King Jr. Day", rule: { type: "float", month: 1, weekday: 1, nth: 3 } },
  { key: "presidents", name: "Presidents' Day", rule: { type: "float", month: 2, weekday: 1, nth: 3 } },
  { key: "memorial", name: "Memorial Day", rule: { type: "float", month: 5, weekday: 1, nth: -1 } },
  { key: "juneteenth", name: "Juneteenth", rule: { type: "fixed", month: 6, day: 19 } },
  { key: "independence", name: "Independence Day", rule: { type: "fixed", month: 7, day: 4 } },
  { key: "labor", name: "Labor Day", rule: { type: "float", month: 9, weekday: 1, nth: 1 } },
  { key: "columbus", name: "Columbus Day", rule: { type: "float", month: 10, weekday: 1, nth: 2 } },
  { key: "veterans", name: "Veterans Day", rule: { type: "fixed", month: 11, day: 11 } },
  { key: "thanksgiving", name: "Thanksgiving Day", rule: { type: "float", month: 11, weekday: 4, nth: 4 } },
  { key: "christmas", name: "Christmas Day", rule: { type: "fixed", month: 12, day: 25 } },
];

/** The commonly-observed private-sector subset (10 of 11 — Columbus off). */
export const DEFAULT_OBSERVED = FEDERAL_HOLIDAYS.filter(
  (h) => h.key !== "columbus"
).map((h) => h.key);

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Shift a weekend fixed-date holiday to the observed weekday. */
function observedFixed(year: number, month: number, day: number): Date {
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1); // Sat → Fri
  else if (dow === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  return d;
}

function nthWeekday(year: number, month: number, weekday: number, nth: number): Date {
  if (nth === -1) {
    // last weekday of month
    const last = new Date(year, month, 0); // last day of month
    const back = (last.getDay() - weekday + 7) % 7;
    last.setDate(last.getDate() - back);
    return last;
  }
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (nth - 1) * 7);
}

/** Compute the observed ISO date for a holiday in a given year. */
export function holidayDate(def: FederalHolidayDef, year: number): string {
  if (def.rule.type === "fixed") {
    return iso(observedFixed(year, def.rule.month, def.rule.day));
  }
  return iso(nthWeekday(year, def.rule.month, def.rule.weekday, def.rule.nth));
}

/** Observed federal holidays for a set of keys across the given years. */
export function computeObservedHolidays(
  keys: string[],
  years: number[]
): { date: string; name: string }[] {
  const out: { date: string; name: string }[] = [];
  for (const year of years) {
    for (const def of FEDERAL_HOLIDAYS) {
      if (!keys.includes(def.key)) continue;
      out.push({ date: holidayDate(def, year), name: def.name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
