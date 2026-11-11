/** A date-picker value is a calendar day, not UTC midnight. */
export function parseCalendarDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Invalid calendar date");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("Invalid calendar date");
  }
  return date;
}

/** Calendar arithmetic must not add a fixed 24h across DST boundaries. */
export function addCalendarDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}
