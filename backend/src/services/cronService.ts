import cron from 'node-cron';
import type { Device } from '@prisma/client';
import { syncAllActiveDevices, processAttendanceFromRaw } from './esslService';
import { fetchFromIClockServerDirect, decryptFromStorage } from './etlService';
import { prisma, invalidateCache } from '../lib/prisma';
import { io } from '../server';

// ── Circuit breaker: stop hammering unreachable devices ──────────────────────
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 10 * 60 * 1000;
const deviceFailures = new Map<string, { count: number; nextRetry: number }>();

function shouldSkipDevice(deviceId: string): boolean {
  const f = deviceFailures.get(deviceId);
  if (!f) return false;
  if (f.count < FAILURE_THRESHOLD) return false;
  return Date.now() < f.nextRetry;
}

function recordFailure(deviceId: string): void {
  const f = deviceFailures.get(deviceId) ?? { count: 0, nextRetry: 0 };
  f.count += 1;
  if (f.count >= FAILURE_THRESHOLD) {
    f.nextRetry = Date.now() + COOLDOWN_MS;
    console.warn(`[AutoSync] Circuit OPEN for device ${deviceId} for ${COOLDOWN_MS / 60000}min after ${f.count} failures`);
  }
  deviceFailures.set(deviceId, f);
}

function recordSuccess(deviceId: string): void {
  deviceFailures.delete(deviceId);
}

const inflight = new Set<string>();

/**
 * Pull punches for a single ETL/iClock device, store new raw logs, process
 * attendance and update the device status. Returns the number of new punch
 * rows inserted. Records success/failure with the circuit breaker.
 */
async function syncEtlDevice(device: Device): Promise<number> {
  try {
    let password: string | undefined;
    if (device.etlPassword) {
      try { password = decryptFromStorage(device.etlPassword); } catch { /* bad creds */ }
    }
    const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
    if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
    const baseUrl = `http://${device.ip}:${device.port}`;

    const result = await fetchFromIClockServerDirect(
      baseUrl,
      device.serialNumber,
      device.lastEtlSync ?? undefined,
      username,
      password,
    );

    const { count: newLogs } = await prisma.rawPunchLog.createMany({
      data: result.records.map((rec) => ({
        deviceId: device.id,
        employeeDeviceId: rec.employeeDeviceId,
        timestamp: rec.timestamp,
        punchType: rec.punchType,
        raw: rec.raw,
      })),
      skipDuplicates: true,
    });

    if (newLogs > 0) {
      await processAttendanceFromRaw(device.id);
      invalidateCache('attendance:');
      try {
        io?.emit('attendance:update', {
          deviceId: device.id,
          deviceName: device.name,
          newPunches: newLogs,
          syncedAt: new Date().toISOString(),
        });
      } catch { /* */ }
    } else if (result.success) {
      // Even with no NEW raw punches, there may be unprocessed punches from
      // a prior sync that failed to materialise attendance logs. Always
      // reprocess to close that gap.
      await processAttendanceFromRaw(device.id);
      invalidateCache('attendance:');
    }

    if (result.success) {
      recordSuccess(device.id);
      await prisma.device.update({
        where: { id: device.id },
        data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null },
      }).catch(() => {});
      if (newLogs > 0) console.log(`[AutoSync] ${device.name}: ${newLogs} new records`);
    } else {
      recordFailure(device.id);
      await prisma.device.update({
        where: { id: device.id },
        data: { status: 'Offline', lastError: result.message.slice(0, 500) },
      }).catch(() => {});
    }
    return newLogs;
  } catch (e) {
    recordFailure(device.id);
    const msg = (e as Error).message;
    console.error(`[AutoSync] ${device.name} failed: ${msg.split('\n')[0]}`);
    await prisma.device.update({
      where: { id: device.id },
      data: { status: 'Offline', lastError: msg.slice(0, 500) },
    }).catch(() => {});
    return 0;
  }
}

/**
 * Final end-of-day sync. The on-site devices/ETL server power off by ~9 PM IST,
 * so at 7 PM we pull the full day's punches one last time and reconcile so that
 * every employee's out-time is persisted and viewable at night from the DB.
 */
async function runEndOfDaySync(): Promise<void> {
  console.log('[Cron] Running 7 PM end-of-day eSSL sync (final fetch before devices power off)...');
  // iClock-pull devices
  try { await syncAllActiveDevices(); }
  catch (e) { console.error('[Cron] End-of-day pull sync error:', (e as Error).message); }

  // ETL auto-sync devices — force a fetch regardless of interval
  try {
    const devices = await prisma.device.findMany({ where: { autoSync: true, isActive: true } });
    for (const device of devices) {
      if (inflight.has(device.id)) continue;
      inflight.add(device.id);
      try { await syncEtlDevice(device); }
      finally { inflight.delete(device.id); }
    }
  } catch (e) {
    console.error('[Cron] End-of-day ETL sync error:', (e as Error).message);
  }

  // Reconcile so out-times / statuses are finalized in the DB
  try {
    const { reconcileAttendance } = await import('./attendanceReconciler');
    await reconcileAttendance();
    invalidateCache('attendance:');
    console.log('[Cron] End-of-day sync complete — out-times persisted.');
  } catch (e) {
    console.error('[Cron] End-of-day reconciliation error:', (e as Error).message);
  }
}

// Business hours: Mon–Sat, 09:00–18:59 IST (last tick at 18:59; first at 09:00).
// No punches expected outside these hours or on Sunday, so the sync crons stay
// idle then. Users still have the manual "Sync now" button if needed.
const BUSINESS_HOURS_CRON_15M = '*/15 9-18 * * 1-6';
const BUSINESS_HOURS_CRON_1M = '* 9-18 * * 1-6';
const CRON_TZ = 'Asia/Kolkata';

export function startCronJobs(): void {
  // Every 15 minutes (business hours only): sync all active eSSL devices (iClock pull)
  cron.schedule(BUSINESS_HOURS_CRON_15M, async () => {
    console.log('[Cron] Running eSSL device sync...');
    try { await syncAllActiveDevices(); }
    catch (e) { console.error('[Cron] eSSL sync error:', (e as Error).message); }
  }, { timezone: CRON_TZ });

  // Every minute (business hours only): check which devices need an auto-sync from the eTimeTrackLite server
  cron.schedule(BUSINESS_HOURS_CRON_1M, async () => {
    try {
      const devices = await prisma.device.findMany({ where: { autoSync: true, isActive: true } });
      const now = Date.now();

      for (const device of devices) {
        if (inflight.has(device.id)) continue;
        if (shouldSkipDevice(device.id)) continue;

        const intervalMs = (device.syncInterval ?? 5) * 60 * 1000;
        const lastSync = device.lastEtlSync ? device.lastEtlSync.getTime() : 0;
        if (now - lastSync < intervalMs) continue;

        inflight.add(device.id);
        void syncEtlDevice(device).finally(() => inflight.delete(device.id));
      }
    } catch (e) {
      console.error('[AutoSync] Cron tick error:', (e as Error).message);
    }
  }, { timezone: CRON_TZ });

  // 7 PM IST (Mon–Sat): final fetch before the on-site devices power off at ~9 PM,
  // so the day's out-times are persisted and remain viewable at night.
  cron.schedule('0 19 * * 1-6', () => {
    void runEndOfDaySync();
  }, { timezone: CRON_TZ });

  // Daily attendance reconciliation at 23:50 IST (runs every day, including Sunday,
  // so any Saturday late-night corrections still get processed).
  cron.schedule('50 23 * * *', async () => {
    try {
      console.log('[Cron] Running daily attendance reconciliation...');
      const { reconcileAttendance } = await import('./attendanceReconciler');
      await reconcileAttendance();
    } catch (e) {
      console.error('[Cron] Reconciliation error:', (e as Error).message);
    }
  }, { timezone: CRON_TZ });

  console.log('[Cron] Jobs scheduled (IST): eSSL sync every 15min Mon–Sat 09:00–18:59, ETL auto-sync every 1min Mon–Sat 09:00–18:59 (circuit breaker), end-of-day final sync 19:00 Mon–Sat, reconciliation daily 23:50');
}
