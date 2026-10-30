/**
 * ESSL device operating-hours helper (mirrors backend src/utils/deviceHours.ts).
 *
 * Physical biometric devices power off by ~9 PM IST and come back ~9 AM IST.
 * Live device features (live punch fetch, connectivity test, machine control)
 * are unavailable outside that window. Cached/DB-backed attendance stays
 * viewable at all times.
 */
export const DEVICE_ON_HOUR = 9;
export const DEVICE_OFF_HOUR = 21;

/** Current hour (0–23) in Asia/Kolkata, regardless of the browser timezone. */
export function getISTHour(d: Date = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d);
  return parseInt(h, 10) % 24;
}

/** True when devices are expected to be powered on (09:00–20:59 IST). */
export function isDeviceOnlineHours(d: Date = new Date()): boolean {
  const h = getISTHour(d);
  return h >= DEVICE_ON_HOUR && h < DEVICE_OFF_HOUR;
}

function fmtHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${period}`;
}

/** Friendly off-hours message shown in the UI. */
export const DEVICE_OFF_MESSAGE =
  `ESSL devices are switched off for the day (after ${fmtHour(DEVICE_OFF_HOUR)}). ` +
  `Live device access will be available tomorrow after ${fmtHour(DEVICE_ON_HOUR)}.`;
