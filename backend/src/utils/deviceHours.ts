/**
 * ESSL device operating-hours guard.
 *
 * The physical biometric devices (and the on-site eTimeTrackLite server) are
 * powered off by ~9 PM IST and come back on around 9 AM IST. Any feature that
 * talks to the device live (live punch fetch, connectivity test, machine /
 * portal management) is therefore unavailable outside those hours.
 *
 * A final automated sync runs at 7 PM (see cronService) so the day's out-times
 * are persisted to the DB and remain viewable at night from cached data.
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';

/** Hour (IST, 24h) the devices come back online. */
export const DEVICE_ON_HOUR = 9;
/** Hour (IST, 24h) the devices switch off. */
export const DEVICE_OFF_HOUR = 21;

/** Current hour (0–23) in Asia/Kolkata, regardless of server timezone. */
export function getISTHour(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d);
  return parseInt(h, 10) % 24;
}

/** True when the devices are expected to be powered on (09:00–20:59 IST). */
export function isWithinDeviceHours(d: Date = new Date()): boolean {
  const h = getISTHour(d);
  return h >= DEVICE_ON_HOUR && h < DEVICE_OFF_HOUR;
}

function fmtHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/** User-facing message shown when device access is attempted off-hours. */
export const DEVICE_OFF_MESSAGE =
  `ESSL devices are switched off for the day (after ${fmtHour(DEVICE_OFF_HOUR)}). ` +
  `Live device access will be available tomorrow after ${fmtHour(DEVICE_ON_HOUR)}.`;

/**
 * Express middleware that blocks live device access outside operating hours.
 * Returns 503 with a clear message so the UI can show a friendly banner.
 */
export function requireDeviceOnlineHours(
  _req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (isWithinDeviceHours()) {
    next();
    return;
  }
  res.status(503).json({
    ok: false,
    deviceOffline: true,
    error: DEVICE_OFF_MESSAGE,
    message: DEVICE_OFF_MESSAGE,
  });
}
