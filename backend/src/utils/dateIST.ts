/**
 * IST (Asia/Kolkata) timezone utilities.
 *
 * Convention: timestamps are stored as UTC in PostgreSQL (DateTime is tz-aware).
 * All ESSL device punches arrive as "local wall-clock" without tz info.
 * We treat those wall-clock readings as IST and convert to UTC for storage,
 * then convert back to IST for display.
 */

export const IST_OFFSET_MINUTES = 330; // +5:30

export function getUTCDateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDaysUTC(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export function isSameUTCDate(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return false;
  return a.getUTCFullYear() === b.getUTCFullYear()
    && a.getUTCMonth() === b.getUTCMonth()
    && a.getUTCDate() === b.getUTCDate();
}

/**
 * Parse a device datetime string ("YYYY-MM-DD HH:mm:ss" or ISO without tz)
 * as an IST wall-clock time and return the corresponding UTC Date.
 */
export function parseISTWallClockToUTC(input: string): Date {
  const normalized = input.replace(' ', 'T');
  // Strip any existing tz suffix to ensure we treat it as IST wall-clock
  const stripped = normalized.replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
  // Build a Date as if the wall-clock is UTC, then subtract IST offset
  const asIfUtc = new Date(stripped + 'Z');
  if (isNaN(asIfUtc.getTime())) return new Date(NaN);
  return new Date(asIfUtc.getTime() - IST_OFFSET_MINUTES * 60 * 1000);
}

/**
 * Convert a UTC Date to an IST ISO string ("YYYY-MM-DDTHH:mm:ss+05:30").
 */
export function toISTISOString(d: Date | null | undefined): string | null {
  if (!d) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  const ss = String(ist.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+05:30`;
}

/**
 * Get the IST calendar day for a UTC Date, returned as UTC midnight for that
 * day. PostgreSQL `DATE` columns should receive UTC midnight, not an IST-offset
 * timestamp, otherwise the day is truncated backward when persisted.
 */
export function getISTDateOnly(d: Date): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return getUTCDateOnly(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
}

export function getISTMonthRange(year: number, month: number): { start: Date; end: Date } {
  const start = getUTCDateOnly(year, month, 1);
  const end = month === 12
    ? getUTCDateOnly(year + 1, 1, 1)
    : getUTCDateOnly(year, month + 1, 1);
  return { start, end };
}

/**
 * IST "now" returned as the UTC Date that PostgreSQL stores.
 */
export function nowUTC(): Date {
  return new Date();
}

/**
 * Get today's IST date-only (00:00 IST stored as UTC).
 */
export function todayISTDateOnly(): Date {
  return getISTDateOnly(new Date());
}

/**
 * Format a Date as IST "HH:mm" (24h).
 */
export function formatISTTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  const ist = new Date(d.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
}
