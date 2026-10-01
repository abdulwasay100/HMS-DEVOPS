/** Date helpers. "Today" follows the server's local time zone (set TZ to the hotel's zone). */

const pad = (n: number) => String(n).padStart(2, '0');

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayString(): string {
  return formatLocalDate(new Date());
}

/** Local midnight of a YYYY-MM-DD string. */
export function localStartOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function addDays(dateStr: string, days: number): string {
  const d = localStartOfDay(dateStr);
  d.setDate(d.getDate() + days);
  return formatLocalDate(d);
}

/** Whole nights between two YYYY-MM-DD strings. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const [y1, m1, d1] = checkIn.split('-').map(Number);
  const [y2, m2, d2] = checkOut.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Current offset of the server time zone from UTC, in minutes (e.g. +300 for UTC+5). */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** [from, to) instants covering the inclusive local date range. */
export function dateRangeToInstants(from: string, to: string): { start: Date; end: Date } {
  return { start: localStartOfDay(from), end: localStartOfDay(addDays(to, 1)) };
}
