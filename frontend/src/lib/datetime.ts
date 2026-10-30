/**
 * Date/time helpers — ALL output is rendered in IST (Asia/Kolkata).
 *
 * Rule for this project: every timestamp shown to the user must be in IST.
 * Do not bypass these helpers with raw `toLocaleString` / `toLocaleDateString`
 * / `toLocaleTimeString` calls — those follow the browser's local timezone
 * unless explicitly configured.
 */

export const IST_TZ = 'Asia/Kolkata';
export const IST_LOCALE = 'en-IN';

/** Parse a value to a Date. Accepts ISO strings, "YYYY-MM-DD HH:mm:ss" (treated as IST), Date, or number. */
export function toDate(input: string | number | Date): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const s = String(input).trim();
  // "YYYY-MM-DD HH:mm:ss" with no TZ → assume IST
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
    return new Date(s.replace(' ', 'T') + '+05:30');
  }
  return new Date(s);
}

function fmt(input: string | number | Date, options: Intl.DateTimeFormatOptions): string {
  try {
    return toDate(input).toLocaleString(IST_LOCALE, { ...options, timeZone: IST_TZ });
  } catch {
    return String(input ?? '');
  }
}

/** "23 May 2026" style — short month, numeric year (IST) */
export function formatDateIST(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' },
): string {
  return fmt(input, options);
}

/** "10:42 AM" style time (IST). Pass options to customise. */
export function formatTimeIST(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true },
): string {
  return fmt(input, options);
}

/** "23 May 2026, 10:42 AM" (IST) */
export function formatDateTimeIST(
  input: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  },
): string {
  return fmt(input, options);
}

/** Weekday short name in IST, e.g. "Mon" */
export function formatWeekdayIST(input: string | number | Date, long = false): string {
  return fmt(input, { weekday: long ? 'long' : 'short' });
}

/** Today's date in IST as "YYYY-MM-DD" — safe for <input type="date"> defaults. */
export function todayISTDateString(): string {
  // sv-SE locale gives ISO-like YYYY-MM-DD output
  return new Date().toLocaleDateString('sv-SE', { timeZone: IST_TZ });
}

/** Returns true when the given date is a Sunday in IST (treated as a holiday). */
export function isSundayIST(input: string | number | Date): boolean {
  // 'en-US' weekday short → "Sun", "Mon", …
  return toDate(input).toLocaleDateString('en-US', { weekday: 'short', timeZone: IST_TZ }) === 'Sun';
}
