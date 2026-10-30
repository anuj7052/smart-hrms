import { Router, Response } from 'express';
import { query, body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { fetchFromIClockServerDirect, decryptFromStorage } from '../services/etlService';
import { processAttendanceFromRaw } from '../services/esslService';
import { prisma, getCached, setCache, invalidateCache } from '../lib/prisma';
import { io } from '../server';
import { addDaysUTC, getISTDateOnly, getISTMonthRange, isSameUTCDate, todayISTDateOnly } from '../utils/dateIST';

const router = Router();
router.use(authenticateJWT);

// ─── Saturday = virtual day for everyone ────────────────────────────────────
// On Saturdays (IST), virtual login is implicitly enabled for ALL employees,
// regardless of the per-employee `virtualLoginEnabled` flag.
function isSaturdayIST(date: Date = new Date()): boolean {
  // Convert UTC -> IST then read day of week
  const istMs = date.getTime() + 330 * 60 * 1000;
  return new Date(istMs).getUTCDay() === 6; // 6 = Saturday
}

// ─── Virtual Device helper ──────────────────────────────────────────────────
// Gets or creates a placeholder "VIRTUAL" device used to store virtual punch logs
// in the RawPunchLog table, so they integrate with the ESSL sync pipeline.
let _virtualDeviceId: string | null = null;
async function getOrCreateVirtualDeviceId(): Promise<string> {
  if (_virtualDeviceId) return _virtualDeviceId;
  const existing = await prisma.device.findUnique({ where: { serialNumber: 'VIRTUAL-DEVICE' } });
  if (existing) { _virtualDeviceId = existing.id; return existing.id; }
  const device = await prisma.device.create({
    data: {
      name: 'Virtual Login Device',
      ip: '0.0.0.0',
      port: 0,
      serialNumber: 'VIRTUAL-DEVICE',
      username: 'system',
      passwordHash: 'n/a',
      autoSync: false,
      status: 'Online',
      isActive: false, // Not a real device — excluded from sync
    },
  });
  _virtualDeviceId = device.id;
  return device.id;
}

type MonthlySummaryEmployee = {
  id: string;
  employeeId: string;
  department: string;
  user: { name: string | null } | null;
};

type MonthlySummaryLog = {
  employeeId: string;
  status: string;
  date: Date;
  punchIn: Date | null;
  punchOut: Date | null;
  source: string | null;
  punchInLat: number | null;
  punchInLng: number | null;
  punchOutLat: number | null;
  punchOutLng: number | null;
};

type AttendanceFeedLog = {
  id: string;
  employee: {
    id: string;
    employeeId: string;
    department: string;
    user: { name: string | null } | null;
  };
  date: Date;
  punchIn: Date | null;
  punchOut: Date | null;
  workHours: number | null;
  status: string;
  source: string | null;
};

type RawPunchRecord = {
  id: string;
  timestamp: Date;
  punchType: number;
};

type AttendanceDateCarrier = {
  date: Date;
  punchIn: Date | null;
  punchOut: Date | null;
  source: string | null;
};

function normalizeAttendanceDate<T extends AttendanceDateCarrier>(log: T): T & { normalizedDate: Date } {
  const punchAnchor = log.source === 'device' ? (log.punchIn ?? log.punchOut) : null;
  let normalizedDate = punchAnchor ? getISTDateOnly(punchAnchor) : log.date;

  if (log.source === 'weekly-off-sunday' && normalizedDate.getUTCDay() !== 0) {
    const nextDate = addDaysUTC(normalizedDate, 1);
    if (nextDate.getUTCDay() === 0) normalizedDate = nextDate;
  }

  return { ...log, normalizedDate };
}

function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const time = date.getTime();
  return time >= start.getTime() && time < end.getTime();
}

// ─── POST /api/attendance/sync-live ─────────────────────────────────────────
// Admin/HR trigger: pulls live attendance from the eTimeTrackLite server for all autoSync devices
router.post('/sync-live', requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const devices = await prisma.device.findMany({ where: { isActive: true } });
  if (devices.length === 0) {
    res.status(404).json({ message: 'No active devices found' }); return;
  }

  let totalNew = 0;
  const results: { device: string; logsImported: number; message: string }[] = [];

  for (const device of devices) {
    let password: string | undefined;
    if (device.etlPassword) {
      try { password = decryptFromStorage(device.etlPassword); } catch { /* ignore */ }
    }
    const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
    if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
    const baseUrl = `http://${device.ip}:${device.port}`;
    try {
      const result = await fetchFromIClockServerDirect(
        baseUrl,
        device.serialNumber,
        device.lastEtlSync ?? undefined,
        username,
        password,
      );

      const cutoff = device.lastEtlSync
        ? new Date(device.lastEtlSync.getTime() - 2 * 60 * 60 * 1000)
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

      const filtered = result.records.filter((r) => r.timestamp >= cutoff);
      const { count: newLogs } = await prisma.rawPunchLog.createMany({
        data: filtered.map((record) => ({
          deviceId: device.id,
          employeeDeviceId: record.employeeDeviceId,
          timestamp: record.timestamp,
          punchType: record.punchType,
          raw: record.raw,
        })),
        skipDuplicates: true,
      });
      if (newLogs > 0) {
        // Pass cutoff so that all fetched punches (not just last 3 days) are
        // processed — this correctly updates punchIn/punchOut for check-in
        // and check-out events across the full synced date range.
        await processAttendanceFromRaw(device.id, cutoff);
        await prisma.device.update({ where: { id: device.id }, data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null } });
        try {
          io?.emit('attendance:update', {
            deviceId: device.id,
            deviceName: device.name,
            newPunches: newLogs,
            syncedAt: new Date().toISOString(),
          });
        } catch { /* */ }
      } else if (result.success) {
        // Even with no new punches, reprocess attendance to materialise any
        // previously imported raw punches that haven't been converted yet.
        await processAttendanceFromRaw(device.id, cutoff);
        await prisma.device.update({
          where: { id: device.id },
          data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null },
        }).catch(() => {});
      }
      totalNew += newLogs;
      results.push({ device: device.name, logsImported: newLogs, message: result.message });
    } catch (e) {
      const msg = (e as Error).message;
      await prisma.device.update({
        where: { id: device.id },
        data: { status: 'Offline', lastError: msg.slice(0, 500) },
      }).catch(() => {});
      results.push({ device: device.name, logsImported: 0, message: msg });
    }
  }

  // Bust cached monthly summary so the UI sees fresh data on the next fetch
  invalidateCache('attendance:');

  res.json({
    success: true,
    message: totalNew > 0
      ? `Live sync complete. ${totalNew} new punch log(s) imported.`
      : 'Live sync complete. No new punches since last sync.',
    totalLogsImported: totalNew,
    devices: results,
  });
});

// ─── POST /api/attendance/historical-import ─────────────────────────────────
// Pulls historical attendance from a given start date (default: Jan 1, current year)
// up to today and stores in DB permanently. Idempotent (skipDuplicates).
router.post('/historical-import', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const fromStr = (req.body?.fromDate as string) || `${new Date().getFullYear()}-01-01`;
  const fromDate = new Date(fromStr);
  if (isNaN(fromDate.getTime())) {
    res.status(400).json({ message: 'Invalid fromDate' }); return;
  }

  const devices = await prisma.device.findMany({ where: { isActive: true } });
  if (devices.length === 0) {
    res.status(404).json({ message: 'No active devices found' }); return;
  }

  const results: Array<{ device: string; logsImported: number; message: string }> = [];
  let totalNew = 0;

  for (const device of devices) {
    let password: string | undefined;
    if (device.etlPassword) {
      try { password = decryptFromStorage(device.etlPassword); } catch { /* */ }
    }
    const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
    if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
    const baseUrl = `http://${device.ip}:${device.port}`;

    try {
      const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, fromDate, username, password);
      const { count: newLogs } = await prisma.rawPunchLog.createMany({
        data: result.records.map((r) => ({
          deviceId: device.id,
          employeeDeviceId: r.employeeDeviceId,
          timestamp: r.timestamp,
          punchType: r.punchType,
          raw: r.raw,
        })),
        skipDuplicates: true,
      });
      if (newLogs > 0) {
        await processAttendanceFromRaw(device.id, fromDate);
      }
      await prisma.device.update({
        where: { id: device.id },
        data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null },
      }).catch(() => {});
      totalNew += newLogs;
      results.push({ device: device.name, logsImported: newLogs, message: result.message });
    } catch (e) {
      results.push({ device: device.name, logsImported: 0, message: (e as Error).message });
    }
  }

  res.json({
    success: true,
    message: `Historical import from ${fromStr}: ${totalNew} punches imported.`,
    fromDate: fromStr,
    totalLogsImported: totalNew,
    devices: results,
  });
});

// ─── POST /api/attendance/reprocess-month ───────────────────────────────────
// Re-processes existing rawPunchLog data into attendanceLog from a given date.
// Does NOT fetch from the device — works on already-stored raw punches.
// Use this to update punchIn/punchOut for a month when punches are in the
// database but have not been converted to attendance records yet.
// Body: { fromDate?: "YYYY-MM-DD" }  (defaults to start of current month)
router.post('/reprocess-month', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const defaultFrom = `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const fromStr = (req.body?.fromDate as string) || defaultFrom;
  const fromDate = new Date(`${fromStr}T00:00:00.000+05:30`);
  if (isNaN(fromDate.getTime())) {
    res.status(400).json({ success: false, message: 'Invalid fromDate' }); return;
  }

  const devices = await prisma.device.findMany({ where: { isActive: true } });
  if (devices.length === 0) {
    res.status(404).json({ success: false, message: 'No active devices found' }); return;
  }

  const results: { device: string; message: string }[] = [];
  let processed = 0;

  for (const device of devices) {
    try {
      await processAttendanceFromRaw(device.id, fromDate);
      processed++;
      results.push({ device: device.name, message: 'Reprocessed successfully' });
    } catch (e) {
      results.push({ device: device.name, message: (e as Error).message });
    }
  }

  invalidateCache('attendance:');

  res.json({
    success: true,
    message: `Reprocessed attendance for ${processed} device(s) from ${fromStr}. Check-in and check-out times updated.`,
    fromDate: fromStr,
    devices: results,
  });
});

// ─── POST /api/attendance/reimport-real-data ─────────────────────────────────
// Hard-resets attendance records for a date range by:
//   1. Deleting every device-sourced AttendanceLog in the range
//   2. Re-running processAttendanceFromRaw so records are rebuilt from
//      rawPunchLog with the corrected first=IN / last=OUT logic.
// This is the "replace with real data" action the user needs after the
// alternating-direction fix is deployed.
// Body: { fromDate?: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
router.post('/reimport-real-data', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const defaultFrom = `${nowIST.getUTCFullYear()}-07-01`; // default: July 1
  const fromStr = (req.body?.fromDate as string) || defaultFrom;
  const toStr   = (req.body?.toDate   as string) || `${nowIST.getUTCFullYear()}-${String(nowIST.getUTCMonth() + 1).padStart(2, '0')}-${String(nowIST.getUTCDate()).padStart(2, '0')}`;

  const fromDate = new Date(`${fromStr}T00:00:00.000+05:30`);
  const toDate   = new Date(`${toStr}T23:59:59.999+05:30`);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    res.status(400).json({ success: false, message: 'Invalid fromDate or toDate' }); return;
  }

  // Step 1: Delete device-sourced attendance logs in the range so they are
  // rebuilt cleanly (fixes wrong punchIn/punchOut from old alternating logic).
  const { count: deleted } = await prisma.attendanceLog.deleteMany({
    where: {
      source: 'device',
      date: { gte: fromDate, lte: toDate },
    },
  });

  // Step 2: Reprocess rawPunchLog → attendanceLog from the start date.
  const devices = await prisma.device.findMany({ where: { isActive: true } });
  let reprocessed = 0;
  const deviceResults: { device: string; message: string }[] = [];

  for (const device of devices) {
    try {
      await processAttendanceFromRaw(device.id, fromDate);
      reprocessed++;
      deviceResults.push({ device: device.name, message: 'OK' });
    } catch (e) {
      deviceResults.push({ device: device.name, message: (e as Error).message });
    }
  }

  invalidateCache('attendance:');

  res.json({
    success: true,
    message: `Deleted ${deleted} old device attendance record(s) between ${fromStr} and ${toStr}, then rebuilt from raw punch data across ${reprocessed} device(s). Check-in and check-out times now reflect real ESSL data.`,
    deletedRecords: deleted,
    fromDate: fromStr,
    toDate: toStr,
    devices: deviceResults,
  });
});

// ─── GET /api/attendance/monthly-summary ────────────────────────────────────
router.get('/monthly-summary', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

  const cacheKey = `attendance:monthly:${year}-${month}`;
  const cached = getCached<object>(cacheKey);
  if (cached) { res.json(cached); return; }

  const { start, end } = getISTMonthRange(year, month);

  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    include: { user: { select: { name: true } } },
  }) as MonthlySummaryEmployee[];

  const allLogs = await prisma.attendanceLog.findMany({
    where: { date: { gte: addDaysUTC(start, -1), lt: addDaysUTC(end, 1) } },
    select: { employeeId: true, status: true, date: true, punchIn: true, punchOut: true, source: true,
               punchInLat: true, punchInLng: true, punchOutLat: true, punchOutLng: true },
  }) as MonthlySummaryLog[];

  const filteredLogs = allLogs
    .map((log) => normalizeAttendanceDate(log))
    .filter((log) => isDateInRange(log.normalizedDate, start, end));

  const logsByEmployee = new Map<string, typeof filteredLogs>();
  filteredLogs.forEach((log) => {
    if (!logsByEmployee.has(log.employeeId)) logsByEmployee.set(log.employeeId, []);
    logsByEmployee.get(log.employeeId)!.push(log);
  });

  // Fetch today's log for each employee so the table can show Status + In Time
  const todayDate = todayISTDateOnly();
  const isCurrentMonth = todayDate.getUTCFullYear() === year && todayDate.getUTCMonth() + 1 === month;
  const todayMap = new Map<string, { status: string; punchIn: Date | null; punchInLat: number | null; punchInLng: number | null; punchOutLat: number | null; punchOutLng: number | null }>();
  if (isCurrentMonth) {
    filteredLogs
      .filter((log) => isSameUTCDate(log.normalizedDate, todayDate))
      .forEach((log) => todayMap.set(log.employeeId, { status: log.status, punchIn: log.punchIn,
        punchInLat: log.punchInLat ?? null, punchInLng: log.punchInLng ?? null,
        punchOutLat: log.punchOutLat ?? null, punchOutLng: log.punchOutLng ?? null }));
  }

  const summary = employees.map((emp) => {
    const eLogs = logsByEmployee.get(emp.id) || [];
    const counts = { Present: 0, Late: 0, Absent: 0, Leave: 0, WeeklyOff: 0, Holiday: 0, HalfDay: 0 };
    eLogs.forEach((l) => { if (l.status in counts) counts[l.status as keyof typeof counts]++; });
    const todayLog = todayMap.get(emp.id);
    // If current month and no log for today, they're absent
    const todayStatus = todayLog?.status ?? (isCurrentMonth ? 'Absent' : null);
    // Count today as absent in the monthly tally if no record exists
    if (isCurrentMonth && !todayLog) counts.Absent++;
    return {
      _id: emp.id,
      employeeId: emp.employeeId,
      name: emp.user?.name || 'Unknown',
      department: emp.department,
      ...counts,
      total: eLogs.length,
      todayStatus,
      todayPunchIn: todayLog?.punchIn?.toISOString() ?? null,
      todayPunchInLat: todayLog?.punchInLat ?? null,
      todayPunchInLng: todayLog?.punchInLng ?? null,
    };
  });

  const result = { summary, month, year };
  // Cache shorter for current month (today's data changes frequently), longer for past months
  setCache(cacheKey, result, isCurrentMonth ? 30_000 : 300_000);
  res.json(result);
});

// ─── GET /api/attendance/today ──────────────────────────────────────────────
router.get('/today', requireRole(['Admin', 'HR']), async (_req, res: Response): Promise<void> => {
  const today = todayISTDateOnly();
  const tomorrow = addDaysUTC(today, 1);

  const [present, absent, late, onLeave, totalEmployees] = await Promise.all([
    prisma.attendanceLog.count({ where: { date: { gte: today, lt: tomorrow }, status: 'Present' } }),
    prisma.attendanceLog.count({ where: { date: { gte: today, lt: tomorrow }, status: 'Absent' } }),
    prisma.attendanceLog.count({ where: { date: { gte: today, lt: tomorrow }, status: 'Late' } }),
    prisma.attendanceLog.count({ where: { date: { gte: today, lt: tomorrow }, status: 'Leave' } }),
    prisma.employee.count({ where: { isActive: true } }),
  ]);

  const recent = await prisma.attendanceLog.findMany({
    where: { date: { gte: today, lt: tomorrow } },
    include: {
      employee: {
        include: { user: { select: { name: true } } },
      },
    },
    orderBy: { punchIn: 'desc' },
    take: 10,
  });

  res.json({ present, absent, late, onLeave, totalEmployees, recent });
});

// ─── GET /api/attendance/employee/:id ───────────────────────────────────────
router.get('/employee/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  // Employees can only view their own data
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp || emp.id !== req.params.id) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
  }

  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

  const { start, end } = getISTMonthRange(year, month);

  const rawLogs = await prisma.attendanceLog.findMany({
    where: { employeeId: req.params.id, date: { gte: addDaysUTC(start, -1), lt: addDaysUTC(end, 1) } },
    orderBy: [{ date: 'asc' }, { punchIn: 'asc' }],
  });

  const normalized = rawLogs
    .map((log) => {
      const { normalizedDate, ...rest } = normalizeAttendanceDate(log);
      return isDateInRange(normalizedDate, start, end)
        ? { ...rest, date: normalizedDate }
        : null;
    })
    .filter((log): log is NonNullable<typeof log> => log !== null);

  // Deduplicate: multiple AttendanceLog rows can land on the same calendar day
  // (e.g. an early "Late" snapshot + a later "Present" full-day row, or device
  // + reconciler sources). Collapse them into one row per day so the UI doesn't
  // render duplicate entries.
  const STATUS_RANK: Record<string, number> = {
    Present: 5, Late: 4, Leave: 3, WeeklyOff: 2, Holiday: 1, Absent: 0,
  };
  const byDay = new Map<number, (typeof normalized)[number]>();
  for (const log of normalized) {
    const key = log.date.getTime();
    const existing = byDay.get(key);
    if (!existing) { byDay.set(key, log); continue; }

    const inA = existing.punchIn?.getTime() ?? null;
    const inB = log.punchIn?.getTime() ?? null;
    const outA = existing.punchOut?.getTime() ?? null;
    const outB = log.punchOut?.getTime() ?? null;

    const mergedPunchIn = inA != null && inB != null
      ? new Date(Math.min(inA, inB))
      : (existing.punchIn ?? log.punchIn);
    const mergedPunchOut = outA != null && outB != null
      ? new Date(Math.max(outA, outB))
      : (existing.punchOut ?? log.punchOut);

    const mergedWorkHours = mergedPunchIn && mergedPunchOut
      ? Math.round(((mergedPunchOut.getTime() - mergedPunchIn.getTime()) / 3_600_000) * 100) / 100
      : (existing.workHours ?? log.workHours ?? null);

    const rankA = STATUS_RANK[existing.status] ?? -1;
    const rankB = STATUS_RANK[log.status] ?? -1;
    const winner = rankB > rankA ? log : existing;

    byDay.set(key, {
      ...winner,
      punchIn: mergedPunchIn ?? null,
      punchOut: mergedPunchOut ?? null,
      workHours: mergedWorkHours ?? null,
      // Preserve any pending/approved regularization across the merge
      regularizationStatus:
        existing.regularizationStatus ?? log.regularizationStatus ?? winner.regularizationStatus,
      isRegularized: existing.isRegularized || log.isRegularized || winner.isRegularized,
    });
  }

  const logs = Array.from(byDay.values())
    .sort((a, b) => a.date.getTime() - b.date.getTime() || ((a.punchIn?.getTime() ?? 0) - (b.punchIn?.getTime() ?? 0)));

  // ── Enrich with punchLogs from RawPunchLog ──────────────────────────────
  // The frontend expects a `punchLogs` array on each log entry showing the
  // individual IN/OUT events throughout the day.
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    select: { employeeId: true, devicePin: true },
  });

  type PunchLogEntry = { time: string; direction: 'IN' | 'OUT'; deviceName: string; deviceSN: string };
  const punchLogsByDate = new Map<string, PunchLogEntry[]>();

  if (employee) {
    const empPins = [employee.employeeId, employee.devicePin].filter(Boolean) as string[];

    const rawPunches = await prisma.rawPunchLog.findMany({
      where: {
        employeeDeviceId: { in: empPins },
        timestamp: { gte: addDaysUTC(start, -1), lt: addDaysUTC(end, 1) },
      },
      include: { device: { select: { name: true, serialNumber: true } } },
      orderBy: { timestamp: 'asc' },
    });

    for (const punch of rawPunches) {
      const dateKey = getISTDateOnly(punch.timestamp).toISOString().split('T')[0];
      if (!punchLogsByDate.has(dateKey)) punchLogsByDate.set(dateKey, []);
      // Determine direction: punchType 1 = OUT, 0 = IN.
      // If device doesn't differentiate (all 0), infer by alternating position.
      const list = punchLogsByDate.get(dateKey)!;
      const direction: 'IN' | 'OUT' = punch.punchType === 1 ? 'OUT' : 'IN';
      list.push({
        time: punch.timestamp.toISOString(),
        direction,
        deviceName: punch.device?.name || 'Unknown',
        deviceSN: punch.device?.serialNumber || '',
      });
    }

    // When the device doesn't differentiate direction (all punchType=0):
    // Mark the LAST punch of the day as OUT and every other punch as IN.
    // This matches real-world behaviour: the last scan of the day is the
    // departure, everything before is an arrival or return from a break.
    // (Old alternating logic — first=IN,second=OUT,third=IN,... — was
    // incorrect and caused confusing IN-OUT-IN-OUT sequences in the UI.)
    for (const [, punches] of punchLogsByDate) {
      const allSameType = punches.every(p => p.direction === 'IN');
      if (allSameType && punches.length > 1) {
        punches.forEach((p, i) => {
          p.direction = i === punches.length - 1 ? 'OUT' : 'IN';
        });
      }
    }
  }

  const logsWithPunches = logs.map((log) => {
    const dateKey = log.date.toISOString().split('T')[0];
    return { ...log, punchLogs: punchLogsByDate.get(dateKey) || [] };
  });

  res.json({ logs: logsWithPunches, month, year });
});

// ─── GET /api/attendance/regularizations ────────────────────────────────────
router.get('/regularizations', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.query as { status?: string };
  const logs = await prisma.attendanceLog.findMany({
    where: {
      // Only rows that have actually requested regularization
      regularizationRequestedAt: { not: null },
      ...(status && status !== 'all'
        ? { regularizationStatus: status as 'Pending' | 'Approved' | 'Rejected' }
        : {}),
    },
    include: {
      employee: { include: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { regularizationRequestedAt: 'desc' },
  });
  res.json(logs);
});

// ─── POST /api/attendance/regularize ────────────────────────────────────────
router.post(
  '/regularize',
  [
    body('attendanceId').notEmpty(),
    body('reason').trim().isLength({ min: 10 }).withMessage('Reason must be at least 10 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { attendanceId, reason } = req.body as { attendanceId: string; reason: string };

    const log = await prisma.attendanceLog.findUnique({ where: { id: attendanceId } });
    if (!log) {
      res.status(404).json({ message: 'Attendance record not found' });
      return;
    }

    // Verify ownership if employee
    if (req.user?.role === 'Employee') {
      const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
      if (!emp || emp.id !== log.employeeId) {
        res.status(403).json({ message: 'Insufficient permissions' });
        return;
      }
    }

    await prisma.attendanceLog.update({
      where: { id: attendanceId },
      data: {
        regularizationReason: reason,
        regularizationStatus: 'Pending',
        regularizationRequestedAt: new Date(),
      },
    });

    res.json({ message: 'Regularization request submitted' });
  }
);

// ─── PUT /api/attendance/regularizations/:id/review ─────────────────────────
router.put(
  '/regularizations/:id/review',
  requireRole(['Admin', 'HR']),
  [
    body('status').isIn(['Approved', 'Rejected']),
    body('comment').optional().isString(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const log = await prisma.attendanceLog.findUnique({ where: { id: req.params.id } });
    if (!log) {
      res.status(404).json({ message: 'Record not found' });
      return;
    }

    const { status, comment } = req.body as { status: 'Approved' | 'Rejected'; comment?: string };
    await prisma.attendanceLog.update({
      where: { id: req.params.id },
      data: {
        regularizationStatus: status,
        ...(status === 'Approved' ? { isRegularized: true, status: 'Present' } : {}),
        ...(comment ? { regularizationReason: comment } : {}),
      },
    });

    res.json({ message: `Regularization ${status}` });
  }
);

// ─── GET /api/attendance/today-status ────────────────────────────────────────
// Returns the current punch state for the authenticated employee
router.get('/today-status', async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
  if (!employee) {
    res.status(404).json({ message: 'Employee record not found' });
    return;
  }

  const today = todayISTDateOnly();

  const log = await prisma.attendanceLog.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
  });

  let shiftStart = '09:00';
  if (employee.shiftId) {
    const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
    if (shift) shiftStart = shift.startTime;
  } else {
    const settings = await prisma.appSettings.findFirst();
    shiftStart = settings?.shiftStart || '09:00';
  }

  res.json({
    log: log || null,
    isPunchedIn: !!(log?.punchIn),
    isPunchedOut: !!(log?.punchOut),
    shiftStart,
    todayDate: today.toISOString(),
  });
});

// ─── POST /api/attendance/punch-in ────────────────────────────────────────────
router.post(
  '/punch-in',
  [
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('attendanceMode').optional().isIn(['Office', 'WFH', 'Field', 'ClientVisit']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
    if (!employee) {
      res.status(404).json({ message: 'Employee record not found' });
      return;
    }

    const now = new Date();
    const today = todayISTDateOnly();

    // Check if already punched in today
    const existing = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (existing?.punchIn && !existing.punchOut) {
      res.status(409).json({ message: 'Already punched in — punch out first' });
      return;
    }

    const { lat, lng, attendanceMode = 'Office' } = req.body as {
      lat?: number; lng?: number; attendanceMode?: string;
    };

    // Get employee's shift timings
    let shiftStart = '09:00';
    let lateThreshold = 15;
    if (employee.shiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
      if (shift) {
        shiftStart = shift.startTime;
        lateThreshold = shift.gracePeriodMinutes;
      }
    } else {
      const settings = await prisma.appSettings.findFirst();
      shiftStart = settings?.shiftStart || '09:00';
      lateThreshold = settings?.lateThresholdMinutes ?? 15;
    }

    // Compute shift start in IST for today, then convert to UTC for comparison
    const [sh, sm] = shiftStart.split(':').map(Number);
    const nowIstMs = now.getTime() + 330 * 60 * 1000;
    const nowIst = new Date(nowIstMs);
    const shiftStartUtc = new Date(Date.UTC(
      nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(),
      sh, sm, 0
    ) - 330 * 60 * 1000);
    const lateByMinutes = (now.getTime() - shiftStartUtc.getTime()) / (1000 * 60);
    const status: 'Present' | 'Late' = lateByMinutes > lateThreshold ? 'Late' : 'Present';

    const log = await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: {
        punchIn: now,
        status,
        attendanceMode: attendanceMode as 'Office' | 'WFH' | 'Field' | 'ClientVisit',
        source: 'app',
        appPunched: true,
        ...(lat !== undefined && lng !== undefined ? { punchInLat: lat, punchInLng: lng } : {}),
      },
      create: {
        employeeId: employee.id,
        date: today,
        punchIn: now,
        status,
        attendanceMode: attendanceMode as 'Office' | 'WFH' | 'Field' | 'ClientVisit',
        source: 'app',
        appPunched: true,
        ...(lat !== undefined && lng !== undefined ? { punchInLat: lat, punchInLng: lng } : {}),
      },
    });

    res.json({
      message: `Punched in at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })} — ${status}`,
      log,
      status,
      lateByMinutes: Math.max(0, Math.round(lateByMinutes)),
    });
  }
);

// ─── POST /api/attendance/punch-out ───────────────────────────────────────────
router.post(
  '/punch-out',
  [
    body('lat').optional().isFloat({ min: -90, max: 90 }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
    if (!employee) {
      res.status(404).json({ message: 'Employee record not found' });
      return;
    }

    const now = new Date();
    const today = todayISTDateOnly();

    const log = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });

    if (!log?.punchIn) {
      res.status(409).json({ message: 'No punch-in found for today — punch in first' });
      return;
    }
    if (log.punchOut) {
      res.status(409).json({ message: 'Already punched out today' });
      return;
    }

    const { lat, lng } = req.body as { lat?: number; lng?: number };

    const workHours = (now.getTime() - log.punchIn.getTime()) / (1000 * 60 * 60);

    // Recalculate status with actual work hours
    let halfDayThreshold = 4;
    let lateThreshold = 15;
    let shiftStart = '09:00';
    if (employee.shiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
      if (shift) {
        shiftStart = shift.startTime;
        lateThreshold = shift.gracePeriodMinutes;
        halfDayThreshold = shift.halfDayThresholdHours;
      }
    } else {
      const settings = await prisma.appSettings.findFirst();
      shiftStart = settings?.shiftStart || '09:00';
      lateThreshold = settings?.lateThresholdMinutes ?? 15;
      halfDayThreshold = settings?.halfDayThresholdHours ?? 4;
    }

    // Compute shift start in IST for the punch-in day, then convert to UTC
    const [sh, sm] = shiftStart.split(':').map(Number);
    const punchInIstMs = log.punchIn.getTime() + 330 * 60 * 1000;
    const punchInIst = new Date(punchInIstMs);
    const shiftStartUtc = new Date(Date.UTC(
      punchInIst.getUTCFullYear(), punchInIst.getUTCMonth(), punchInIst.getUTCDate(),
      sh, sm, 0
    ) - 330 * 60 * 1000);
    const lateByMinutes = (log.punchIn.getTime() - shiftStartUtc.getTime()) / (1000 * 60);

    // HalfDay must NEVER be auto-assigned — a short workday isn't proof of half-day intent
    // (employee may have stepped out for a meeting, lunch, doctor's visit, etc.).
    // HalfDay is now a manual HR-only label set via regularization / admin override.
    // halfDayThreshold remains in settings purely for reporting calculations.
    void halfDayThreshold;
    const status: 'Present' | 'Late' = lateByMinutes > lateThreshold ? 'Late' : 'Present';

    const updatedLog = await prisma.attendanceLog.update({
      where: { id: log.id },
      data: {
        punchOut: now,
        workHours: parseFloat(workHours.toFixed(2)),
        status,
        ...(lat !== undefined && lng !== undefined ? { punchOutLat: lat, punchOutLng: lng } : {}),
      },
    });

    res.json({
      message: `Punched out at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })} — ${workHours.toFixed(1)}h worked`,
      log: updatedLog,
      workHours: parseFloat(workHours.toFixed(2)),
      status,
    });
  }
);

// ─── POST /api/attendance/wfh-request ─────────────────────────────────────────
router.post(
  '/wfh-request',
  [
    body('date').isISO8601().withMessage('Valid date required'),
    body('mode').isIn(['WFH', 'Field', 'ClientVisit']).withMessage('Mode must be WFH, Field, or ClientVisit'),
    body('reason').optional().isString(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
    if (!employee) {
      res.status(404).json({ message: 'Employee record not found' });
      return;
    }

    const { date, mode, reason } = req.body as { date: string; mode: string; reason?: string };

    const requestDate = new Date(date + 'T00:00:00.000Z');

    // Check for duplicate on same date
    const existing = await prisma.wFHRequest.findFirst({
      where: { employeeId: employee.id, date: requestDate },
    });
    if (existing) {
      res.status(409).json({ message: 'A work arrangement request already exists for this date' });
      return;
    }

    const request = await prisma.wFHRequest.create({
      data: {
        employeeId: employee.id,
        date: requestDate,
        mode: mode as 'WFH' | 'Field' | 'ClientVisit',
        reason: reason?.trim() || '',
        status: 'Pending',
      },
    });

    res.status(201).json({ message: 'Work arrangement request submitted', request });
  }
);

// ─── GET /api/attendance/wfh-requests ─────────────────────────────────────────
router.get(
  '/wfh-requests',
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { status, employeeId } = req.query as { status?: string; employeeId?: string };

    // Employees can only view their own requests
    if (req.user?.role === 'Employee') {
      const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
      if (!emp) { res.status(404).json({ message: 'Employee not found' }); return; }
      const requests = await prisma.wFHRequest.findMany({
        where: { employeeId: emp.id, ...(status ? { status: status as 'Pending' | 'Approved' | 'Rejected' } : {}) },
        orderBy: { date: 'desc' },
      });
      res.json(requests);
      return;
    }

    // Admin/HR/Manager can see all
    const requests = await prisma.wFHRequest.findMany({
      where: {
        ...(status ? { status: status as 'Pending' | 'Approved' | 'Rejected' } : {}),
        ...(employeeId ? { employeeId } : {}),
      },
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            department: true,
            designation: true,
            user: { select: { name: true, email: true } },
          },
        },
        reviewedBy: { select: { name: true, email: true } },
      },
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
    });

    // Flatten for frontend convenience
    const flat = requests.map((r) => ({
      id: r.id,
      employeeId: r.employee.employeeId,
      employeeDbId: r.employee.id,
      employeeName: r.employee.user.name,
      employeeEmail: r.employee.user.email,
      department: r.employee.department,
      designation: r.employee.designation,
      date: r.date,
      mode: r.mode,
      reason: r.reason,
      status: r.status,
      reviewedBy: r.reviewedBy?.name ?? null,
      reviewedAt: r.reviewedAt,
      reviewComment: r.reviewComment,
      createdAt: r.createdAt,
      appliedAt: r.createdAt,
    }));
    res.json(flat);
  }
);

// ─── PUT /api/attendance/wfh-requests/:id/review ──────────────────────────────
router.put(
  '/wfh-requests/:id/review',
  requireRole(['Admin', 'HR']),
  [
    body('status').isIn(['Approved', 'Rejected']).withMessage('Status must be Approved or Rejected'),
    body('reviewComment').optional().isString(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const request = await prisma.wFHRequest.findUnique({ where: { id: req.params.id } });
    if (!request) {
      res.status(404).json({ message: 'WFH request not found' });
      return;
    }

    const { status, reviewComment } = req.body as { status: 'Approved' | 'Rejected'; reviewComment?: string };

    const updated = await prisma.wFHRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewedById: req.user!.id,
        reviewedAt: new Date(),
        ...(reviewComment ? { reviewComment } : {}),
      },
    });

    // If approved, create or update attendance log to mark Present + WFH mode
    if (status === 'Approved') {
      const requestDay = request.date;

      const existingLog = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId: request.employeeId, date: requestDay } },
      });

      if (existingLog) {
        // Update existing log to Present with WFH mode
        await prisma.attendanceLog.update({
          where: { id: existingLog.id },
          data: { status: 'Present', attendanceMode: request.mode, source: 'wfh-approved' },
        });
      } else {
        // Create new attendance log marked as Present + WFH
        await prisma.attendanceLog.create({
          data: {
            employeeId: request.employeeId,
            date: requestDay,
            status: 'Present',
            attendanceMode: request.mode,
            workHours: 8,
            source: 'wfh-approved',
          },
        });
      }
    }

    res.json({ message: `WFH request ${status}`, request: updated });
  }
);

// ─── POST /api/attendance/push-punches ──────────────────────────────────────
// Mobile → push raw eSSL punches → save to PostgreSQL AttendanceLog
// Called by the mobile app every 5s (live) and once for historical import (Jan 1 → today)
router.post(
  '/push-punches',
  requireRole(['Admin', 'HR']),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { punches } = req.body as {
      punches: Array<{ empCode: string; timestamp: string; direction: 'in' | 'out' }>;
    };

    if (!Array.isArray(punches) || punches.length === 0) {
      res.status(400).json({ message: 'punches array is required and must not be empty' });
      return;
    }

    // ── Group punches by employee+date ──────────────────────────────────────
    const grouped = new Map<string, { empCode: string; dateStr: string; entries: Array<{ ts: Date; dir: 'in' | 'out' }> }>();
    for (const p of punches) {
      const ts = new Date(p.timestamp.replace(' ', 'T'));
      if (isNaN(ts.getTime())) continue;
      const dateStr = ts.toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
      const key = `${p.empCode}__${dateStr}`;
      if (!grouped.has(key)) grouped.set(key, { empCode: p.empCode, dateStr, entries: [] });
      grouped.get(key)!.entries.push({ ts, dir: p.direction });
    }

    // ── Shared shift settings ───────────────────────────────────────────────
    const settings = await prisma.appSettings.findFirst();
    const globalShiftStart = settings?.shiftStart || '09:00';
    const globalLateMin = settings?.lateThresholdMinutes ?? 15;
    const globalHalfDayHrs = settings?.halfDayThresholdHours ?? 4;

    let saved = 0;
    let skipped = 0;

    for (const [, group] of grouped) {
      // ── Find or create employee ─────────────────────────────────────────
      let employee = await prisma.employee.findFirst({
        where: { OR: [{ employeeId: group.empCode }, { devicePin: group.empCode }] },
        select: { id: true, shiftId: true },
      });

      if (!employee) {
        try {
          const email = `device.pin.${group.empCode}@device.local`;
          let user = await prisma.user.findUnique({ where: { email } });
          if (!user) {
            const tempPw = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
            user = await prisma.user.create({
              data: {
                name: `Employee ${group.empCode}`,
                email,
                passwordHash: tempPw,
                role: 'Employee',
                isEmailVerified: false,
              },
            });
          }
          const existing = await prisma.employee.findUnique({ where: { userId: user.id } });
          employee = existing ?? await prisma.employee.create({
            data: {
              userId: user.id,
              employeeId: group.empCode,
              department: 'To Be Updated',
              designation: 'To Be Updated',
              joinDate: new Date(),
              isActive: true,
            },
          });
        } catch {
          skipped++;
          continue;
        }
      }

      // ── Compute punchIn / punchOut / workHours / status ─────────────────
      // Honor the caller-supplied direction ('in'/'out'). punchOut is only valid
      // if a later OUT exists than the last IN — otherwise the employee returned
      // from a break and is still working (so no checkout yet).
      const sorted = group.entries.sort((a, b) => a.ts.getTime() - b.ts.getTime());
      const firstIn = sorted.find(e => e.dir === 'in');
      const lastIn = [...sorted].reverse().find(e => e.dir === 'in');
      const lastOut = [...sorted].reverse().find(e => e.dir === 'out');
      const punchIn = (firstIn ?? sorted[0]).ts;
      const punchOut = lastOut && (!lastIn || lastOut.ts.getTime() > lastIn.ts.getTime())
        ? lastOut.ts
        : null;
      const workHours = punchOut ? (punchOut.getTime() - punchIn.getTime()) / (1000 * 60 * 60) : 0;

      let shiftStart = globalShiftStart;
      let lateMin = globalLateMin;
      let halfDayHrs = globalHalfDayHrs;
      if (employee.shiftId) {
        const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
        if (shift) {
          shiftStart = shift.startTime;
          lateMin = shift.gracePeriodMinutes;
          halfDayHrs = shift.halfDayThresholdHours;
        }
      }

      const [sh, sm] = shiftStart.split(':').map(Number);
      const shiftTime = new Date(punchIn);
      shiftTime.setHours(sh, sm, 0, 0);
      const lateBy = (punchIn.getTime() - shiftTime.getTime()) / (1000 * 60);

      // HalfDay is NEVER auto-assigned during bulk import — partial mid-day data
      // (e.g. only morning + lunch-out punches synced so far) would falsely mark
      // employees as HalfDay. Status is decided purely by punch-in time.
      void halfDayHrs;
      void workHours;
      const status: 'Present' | 'Late' = lateBy > lateMin ? 'Late' : 'Present';

      // ── Upsert AttendanceLog ────────────────────────────────────────────
      // date must be midnight UTC for @db.Date
      const date = new Date(`${group.dateStr}T00:00:00.000Z`);
      try {
        await prisma.attendanceLog.upsert({
          where: { employeeId_date: { employeeId: employee.id, date } },
          update: {
            punchIn,
            ...(punchOut ? { punchOut } : {}),
            workHours: parseFloat(workHours.toFixed(2)),
            status,
            source: 'essl',
          },
          create: {
            employeeId: employee.id,
            date,
            punchIn,
            punchOut: punchOut ?? undefined,
            workHours: parseFloat(workHours.toFixed(2)),
            status,
            source: 'essl',
          },
        });
        saved++;
      } catch {
        skipped++;
      }
    }

    res.json({ success: true, saved, skipped, total: punches.length });
  }
);

// ─── GET /api/attendance/by-date ─────────────────────────────────────────────
// ?date=YYYY-MM-DD  OR  ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/by-date', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { date, from, to } = req.query as { date?: string; from?: string; to?: string };

  let startDate: Date;
  let endDate: Date;

  if (date) {
    startDate = new Date(`${date}T00:00:00.000Z`);
    endDate = addDaysUTC(startDate, 1);
  } else if (from && to) {
    startDate = new Date(`${from}T00:00:00.000Z`);
    endDate = addDaysUTC(new Date(`${to}T00:00:00.000Z`), 1);
  } else {
    startDate = todayISTDateOnly();
    endDate = addDaysUTC(startDate, 1);
  }

  const logs = await prisma.attendanceLog.findMany({
    where: { date: { gte: addDaysUTC(startDate, -1), lt: addDaysUTC(endDate, 1) } },
    include: { employee: { include: { user: { select: { name: true } } } } },
    orderBy: [{ date: 'asc' }, { punchIn: 'asc' }],
  }) as AttendanceFeedLog[];

  const feed = logs
    .map((log) => {
      const { normalizedDate, ...rest } = normalizeAttendanceDate(log);
      return isDateInRange(normalizedDate, startDate, endDate)
        ? { ...rest, normalizedDate }
        : null;
    })
    .filter((log): log is NonNullable<typeof log> => log !== null)
    .sort((a, b) => a.normalizedDate.getTime() - b.normalizedDate.getTime() || ((a.punchIn?.getTime() ?? 0) - (b.punchIn?.getTime() ?? 0)))
    .map((l) => ({
      id: l.id,
      empCode: l.employee.employeeId,
      employeeDbId: l.employee.id,
      name: l.employee.user?.name || `Employee ${l.employee.employeeId}`,
      department: l.employee.department,
      date: l.normalizedDate.toISOString().split('T')[0],
      punchIn: l.punchIn?.toISOString() ?? null,
      punchOut: l.punchOut?.toISOString() ?? null,
      workHours: l.workHours,
      status: l.status,
      source: l.source,
    }));

  res.json({ feed, total: feed.length });
});

// ─── GET /api/attendance/live-feed ───────────────────────────────────────────
// Returns today's attendance with employee names for the live attendance board
router.get('/live-feed', requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const today = todayISTDateOnly();
  const tomorrow = addDaysUTC(today, 1);

  const logs = await prisma.attendanceLog.findMany({
    where: { date: { gte: addDaysUTC(today, -1), lt: addDaysUTC(tomorrow, 1) } },
    include: {
      employee: {
        include: { user: { select: { name: true } } },
      },
    },
    orderBy: { punchIn: 'desc' },
  }) as AttendanceFeedLog[];

  const feed = logs
    .map((log) => {
      const { normalizedDate, ...rest } = normalizeAttendanceDate(log);
      return isDateInRange(normalizedDate, today, tomorrow)
        ? { ...rest, normalizedDate }
        : null;
    })
    .filter((log): log is NonNullable<typeof log> => log !== null)
    .sort((a, b) => (b.punchIn?.getTime() ?? 0) - (a.punchIn?.getTime() ?? 0))
    .map((l) => ({
      id: l.id,
      empCode: l.employee.employeeId,
      name: l.employee.user?.name || `Employee ${l.employee.employeeId}`,
      department: l.employee.department,
      punchIn: l.punchIn?.toISOString() ?? null,
      punchOut: l.punchOut?.toISOString() ?? null,
      workHours: l.workHours,
      status: l.status,
      source: l.source,
    }));

  res.json({ feed, date: today.toISOString().split('T')[0], total: feed.length });
});

// ─── GET /api/attendance/raw-punches/:employeeDbId ───────────────────────────
// Returns all raw individual punch timestamps for an employee on a specific date
// ?date=YYYY-MM-DD (defaults to today)
router.get('/raw-punches/:employeeDbId', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { employeeDbId } = req.params;
  const { date } = req.query as { date?: string };

  const targetDate = date || todayISTDateOnly().toISOString().split('T')[0];
  const startUTC = new Date(`${targetDate}T00:00:00.000Z`);
  const endUTC   = new Date(`${targetDate}T23:59:59.999Z`);

  const employee = await prisma.employee.findUnique({
    where: { id: employeeDbId },
    select: { id: true, employeeId: true, devicePin: true, user: { select: { name: true } } },
  });

  if (!employee) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }

  // The device stores punches by biometric pin (devicePin takes priority, else employeeId)
  const empDeviceIds = [employee.employeeId, ...(employee.devicePin ? [employee.devicePin] : [])];

  const rawPunches = await prisma.rawPunchLog.findMany({
    where: {
      employeeDeviceId: { in: empDeviceIds },
      timestamp: { gte: startUTC, lte: endUTC },
    },
    orderBy: { timestamp: 'asc' },
  }) as RawPunchRecord[];

  let punches: { id: string; timestamp: string; punchType: number }[] = rawPunches.map((p) => ({
    id: p.id,
    timestamp: p.timestamp.toISOString(),
    punchType: p.punchType,
  }));

  // If no biometric raw punches found, synthesize events from AttendanceLog
  // (this is the case when eSSL data comes via mobile app push, not direct device push)
  if (punches.length === 0) {
    const attLogs = await prisma.attendanceLog.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: startUTC, lte: endUTC },
      },
      orderBy: { punchIn: 'asc' },
    });

    for (const log of attLogs) {
      if (log.punchIn) {
        punches.push({
          id: `${log.id}-in`,
          timestamp: log.punchIn.toISOString(),
          punchType: 0, // Check In
        });
      }
      if (log.punchOut) {
        punches.push({
          id: `${log.id}-out`,
          timestamp: log.punchOut.toISOString(),
          punchType: 1, // Check Out
        });
      }
    }
    punches.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  res.json({
    employeeDbId: employee.id,
    name: employee.user?.name ?? employeeDbId,
    date: targetDate,
    punches,
    total: punches.length,
  });
});

// ─── POST /api/attendance/virtual-login ─────────────────────────────────────
// Admin/HR creates a virtual punch for an employee who cannot physically attend
router.post(
  '/virtual-login',
  requireRole(['Admin', 'HR']),
  [
    body('employeeId').notEmpty().withMessage('Employee ID is required'),
    body('date').isISO8601().withMessage('Valid date required'),
    body('punchIn').optional().isISO8601(),
    body('punchOut').optional().isISO8601(),
    body('reason').optional().trim().isLength({ min: 3 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { employeeId, date, punchIn, punchOut, reason } = req.body as {
      employeeId: string; date: string; punchIn?: string; punchOut?: string; reason?: string;
    };

    // Find employee by internal ID or employeeId code
    const employee = await prisma.employee.findFirst({
      where: { OR: [{ id: employeeId }, { employeeId }] },
      include: { user: { select: { name: true } } },
    });
    if (!employee) {
      res.status(404).json({ message: 'Employee not found' });
      return;
    }

    const targetDate = new Date(date);
    targetDate.setUTCHours(0, 0, 0, 0);

    // Default punch times: now for punchIn, or shift start/end if not provided
    const now = new Date();
    let punchInTime: Date;
    let punchOutTime: Date | null = null;

    if (punchIn) {
      punchInTime = new Date(punchIn);
    } else {
      // Default to shift start time on the target date
      let shiftStart = '09:00';
      if (employee.shiftId) {
        const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
        if (shift) shiftStart = shift.startTime;
      } else {
        const settings = await prisma.appSettings.findFirst();
        shiftStart = settings?.shiftStart || '09:00';
      }
      const [sh, sm] = shiftStart.split(':').map(Number);
      // Create punch time in IST then store as UTC
      punchInTime = new Date(Date.UTC(
        targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(),
        sh, sm, 0
      ) - 330 * 60 * 1000); // IST to UTC
    }

    if (punchOut) {
      punchOutTime = new Date(punchOut);
    }

    const workHours = punchOutTime
      ? parseFloat(((punchOutTime.getTime() - punchInTime.getTime()) / (1000 * 60 * 60)).toFixed(2))
      : null;

    // Determine status based on shift
    let shiftStart = '09:00';
    let lateThreshold = 15;
    if (employee.shiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
      if (shift) { shiftStart = shift.startTime; lateThreshold = shift.gracePeriodMinutes; }
    } else {
      const settings = await prisma.appSettings.findFirst();
      shiftStart = settings?.shiftStart || '09:00';
      lateThreshold = settings?.lateThresholdMinutes ?? 15;
    }
    const [shiftH, shiftM] = shiftStart.split(':').map(Number);
    const shiftStartUtc = new Date(Date.UTC(
      targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate(),
      shiftH, shiftM, 0
    ) - 330 * 60 * 1000);
    const lateBy = (punchInTime.getTime() - shiftStartUtc.getTime()) / (1000 * 60);
    const status: 'Present' | 'Late' = lateBy > lateThreshold ? 'Late' : 'Present';

    // Upsert attendance log
    const attendanceLog = await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: targetDate } },
      update: {
        punchIn: punchInTime,
        punchOut: punchOutTime,
        workHours,
        status,
        source: 'virtual',
        attendanceMode: 'WFH',
      },
      create: {
        employeeId: employee.id,
        date: targetDate,
        punchIn: punchInTime,
        punchOut: punchOutTime,
        workHours,
        status,
        source: 'virtual',
        attendanceMode: 'WFH',
      },
    });

    // Create audit trail in VirtualPunchLog
    await prisma.virtualPunchLog.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: targetDate } },
      update: {
        punchIn: punchInTime,
        punchOut: punchOutTime,
        reason: reason || 'Virtual login by admin',
        approvedById: req.user!.id,
        source: 'admin-override',
      },
      create: {
        employeeId: employee.id,
        date: targetDate,
        punchIn: punchInTime,
        punchOut: punchOutTime,
        reason: reason || 'Virtual login by admin',
        approvedById: req.user!.id,
        source: 'admin-override',
      },
    });

    // Also push to RawPunchLog so it appears in ESSL sync history
    const virtualDeviceId = await getOrCreateVirtualDeviceId();
    const empPin = employee.devicePin || employee.employeeId;
    await prisma.rawPunchLog.createMany({
      data: [
        { deviceId: virtualDeviceId, employeeDeviceId: empPin, timestamp: punchInTime, punchType: 0, raw: `VIRTUAL_IN|${empPin}|${punchInTime.toISOString()}` },
        ...(punchOutTime ? [{ deviceId: virtualDeviceId, employeeDeviceId: empPin, timestamp: punchOutTime, punchType: 1, raw: `VIRTUAL_OUT|${empPin}|${punchOutTime.toISOString()}` }] : []),
      ],
      skipDuplicates: true,
    });

    // Invalidate cache & notify
    await invalidateCache('attendance:');
    if (io) io.emit('attendance:update', { employeeId: employee.id, date: targetDate });

    res.json({
      message: `Virtual login recorded for ${employee.user?.name || employee.employeeId} on ${targetDate.toISOString().split('T')[0]}`,
      log: attendanceLog,
    });
  }
);

// ─── POST /api/attendance/virtual-punch-in ──────────────────────────────────
// Self-service virtual punch-in for employees with virtualLoginEnabled
router.post(
  '/virtual-punch-in',
  [
    body('reason').optional().trim().isLength({ min: 3 }),
    body('attendanceMode').optional().isIn(['WFH', 'Field', 'ClientVisit']),
    body('lat').optional().isFloat({ min: -90,  max: 90  }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('accuracy').optional().isFloat({ min: 0 }),
    body('address').optional().trim().isLength({ max: 300 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
    if (!employee) {
      res.status(404).json({ message: 'Employee record not found' });
      return;
    }

    if (!employee.virtualLoginEnabled && !isSaturdayIST()) {
      res.status(403).json({ message: 'Virtual login is not enabled for your account. Contact HR.' });
      return;
    }

    const now = new Date();
    const today = todayISTDateOnly();

    // Check if already punched in
    const existing = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });
    if (existing?.punchIn && !existing.punchOut) {
      res.status(409).json({ message: 'Already punched in — punch out first' });
      return;
    }

    const { reason, attendanceMode = 'WFH', lat, lng, address } = req.body as {
      reason?: string; attendanceMode?: string;
      lat?: number; lng?: number; accuracy?: number; address?: string;
    };

    // Determine late status
    let shiftStart = '09:00';
    let lateThreshold = 15;
    if (employee.shiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: employee.shiftId } });
      if (shift) { shiftStart = shift.startTime; lateThreshold = shift.gracePeriodMinutes; }
    } else {
      const settings = await prisma.appSettings.findFirst();
      shiftStart = settings?.shiftStart || '09:00';
      lateThreshold = settings?.lateThresholdMinutes ?? 15;
    }
    const [sh, sm] = shiftStart.split(':').map(Number);
    const shiftStartTime = new Date(now);
    shiftStartTime.setHours(sh, sm, 0, 0);
    const lateByMinutes = (now.getTime() - shiftStartTime.getTime()) / (1000 * 60);
    const status: 'Present' | 'Late' = lateByMinutes > lateThreshold ? 'Late' : 'Present';

    const log = await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: {
        punchIn: now,
        status,
        attendanceMode: attendanceMode as 'WFH' | 'Field' | 'ClientVisit',
        source: 'virtual',
        appPunched: true,
        ...(lat != null && lng != null ? { punchInLat: lat, punchInLng: lng } : {}),
        ...(address ? { punchInAddress: address } : {}),
      },
      create: {
        employeeId: employee.id,
        date: today,
        punchIn: now,
        status,
        attendanceMode: attendanceMode as 'WFH' | 'Field' | 'ClientVisit',
        source: 'virtual',
        appPunched: true,
        ...(lat != null && lng != null ? { punchInLat: lat, punchInLng: lng } : {}),
        ...(address ? { punchInAddress: address } : {}),
      },
    });

    // Audit trail
    await prisma.virtualPunchLog.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: { punchIn: now, reason: reason || 'Self virtual punch-in' },
      create: {
        employeeId: employee.id,
        date: today,
        punchIn: now,
        reason: reason || 'Self virtual punch-in',
        source: 'virtual',
      },
    });

    // Push to RawPunchLog for ESSL compatibility
    const virtualDeviceId = await getOrCreateVirtualDeviceId();
    const empPin = employee.devicePin || employee.employeeId;
    await prisma.rawPunchLog.createMany({
      data: [{ deviceId: virtualDeviceId, employeeDeviceId: empPin, timestamp: now, punchType: 0, raw: `VIRTUAL_IN|${empPin}|${now.toISOString()}` }],
      skipDuplicates: true,
    });

    await invalidateCache('attendance:');
    if (io) io.emit('attendance:update', { employeeId: employee.id, date: today });

    res.json({
      message: `Virtual punch-in at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })} — ${status}`,
      log,
      status,
    });
  }
);

// ─── POST /api/attendance/virtual-punch-out ─────────────────────────────────
// Self-service virtual punch-out for employees with virtualLoginEnabled
router.post(
  '/virtual-punch-out',
  [
    body('reason').optional().trim().isLength({ min: 3 }),
    body('lat').optional().isFloat({ min: -90,  max: 90  }),
    body('lng').optional().isFloat({ min: -180, max: 180 }),
    body('accuracy').optional().isFloat({ min: 0 }),
    body('address').optional().trim().isLength({ max: 300 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
    if (!employee) {
      res.status(404).json({ message: 'Employee record not found' });
      return;
    }

    if (!employee.virtualLoginEnabled && !isSaturdayIST()) {
      res.status(403).json({ message: 'Virtual login is not enabled for your account. Contact HR.' });
      return;
    }

    const now = new Date();
    const today = todayISTDateOnly();

    const log = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
    });

    if (!log?.punchIn) {
      res.status(409).json({ message: 'No virtual punch-in found for today — punch in first' });
      return;
    }
    if (log.punchOut) {
      res.status(409).json({ message: 'Already punched out today' });
      return;
    }

    const workHours = parseFloat(((now.getTime() - log.punchIn.getTime()) / (1000 * 60 * 60)).toFixed(2));
    const { reason, lat, lng, address } = req.body as { reason?: string; lat?: number; lng?: number; accuracy?: number; address?: string };

    const updatedLog = await prisma.attendanceLog.update({
      where: { id: log.id },
      data: {
        punchOut: now,
        workHours,
        source: 'virtual',
        ...(lat != null && lng != null ? { punchOutLat: lat, punchOutLng: lng } : {}),
        ...(address ? { punchOutAddress: address } : {}),
      },
    });

    // Update audit trail
    await prisma.virtualPunchLog.update({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      data: { punchOut: now, reason: reason || log.id },
    }).catch(() => {
      // If no existing record, create one
      return prisma.virtualPunchLog.create({
        data: { employeeId: employee.id, date: today, punchIn: log.punchIn, punchOut: now, reason: reason || 'Self virtual punch-out', source: 'virtual' },
      });
    });

    // Push to RawPunchLog for ESSL compatibility
    const virtualDeviceId = await getOrCreateVirtualDeviceId();
    const empPin = employee.devicePin || employee.employeeId;
    await prisma.rawPunchLog.createMany({
      data: [{ deviceId: virtualDeviceId, employeeDeviceId: empPin, timestamp: now, punchType: 1, raw: `VIRTUAL_OUT|${empPin}|${now.toISOString()}` }],
      skipDuplicates: true,
    });

    await invalidateCache('attendance:');
    if (io) io.emit('attendance:update', { employeeId: employee.id, date: today });

    res.json({
      message: `Virtual punch-out at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })} — ${workHours.toFixed(1)}h worked`,
      log: updatedLog,
      workHours,
    });
  }
);

// ─── GET /api/attendance/virtual-login-status ───────────────────────────────
// Check if the current employee has virtual login enabled and today's status
router.get('/virtual-login-status', async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
  if (!employee) {
    res.status(404).json({ message: 'Employee record not found' });
    return;
  }

  const today = todayISTDateOnly();
  const log = await prisma.attendanceLog.findUnique({
    where: { employeeId_date: { employeeId: employee.id, date: today } },
  });

  const saturdayMode = isSaturdayIST();

  res.json({
    virtualLoginEnabled: employee.virtualLoginEnabled,
    saturdayMode,
    effectiveEnabled: employee.virtualLoginEnabled || saturdayMode,
    isPunchedIn: !!log?.punchIn,
    isPunchedOut: !!log?.punchOut,
    source: log?.source || null,
    log: log ? { punchIn: log.punchIn, punchOut: log.punchOut, status: log.status, workHours: log.workHours } : null,
  });
});

// ─── PUT /api/attendance/virtual-login-toggle/:employeeId ───────────────────
// Admin/HR enables or disables virtual login for a specific employee
router.put(
  '/virtual-login-toggle/:employeeId',
  requireRole(['Admin', 'HR']),
  [body('enabled').isBoolean()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { employeeId } = req.params;
    const { enabled } = req.body as { enabled: boolean };

    const employee = await prisma.employee.findFirst({
      where: { OR: [{ id: employeeId }, { employeeId }] },
    });
    if (!employee) {
      res.status(404).json({ message: 'Employee not found' });
      return;
    }

    await prisma.employee.update({
      where: { id: employee.id },
      data: { virtualLoginEnabled: enabled },
    });

    res.json({ message: `Virtual login ${enabled ? 'enabled' : 'disabled'} for ${employee.employeeId}` });
  }
);

// ─── GET /api/attendance/virtual-login-employees ────────────────────────────
// Admin/HR: list all employees with their virtual login status
router.get('/virtual-login-employees', requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const employees = await prisma.employee.findMany({
    where: { isActive: true },
    select: {
      id: true,
      employeeId: true,
      department: true,
      virtualLoginEnabled: true,
      user: { select: { name: true } },
    },
    orderBy: [{ virtualLoginEnabled: 'desc' }, { department: 'asc' }],
  });

  res.json({ employees });
});

// ─── GET /api/attendance/virtual-punch-logs ─────────────────────────────────
// Admin/HR: view virtual punch audit trail
router.get(
  '/virtual-punch-logs',
  requireRole(['Admin', 'HR']),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { from, to, employeeId } = req.query as { from?: string; to?: string; employeeId?: string };

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, unknown>).gte = new Date(from as string);
      if (to) (where.date as Record<string, unknown>).lte = new Date(to as string);
    }
    if (employeeId) {
      const emp = await prisma.employee.findFirst({ where: { OR: [{ id: employeeId }, { employeeId }] } });
      if (emp) where.employeeId = emp.id;
    }

    const logs = await prisma.virtualPunchLog.findMany({
      where,
      include: { employee: { select: { employeeId: true, department: true, user: { select: { name: true } } } } },
      orderBy: { date: 'desc' },
      take: 200,
    });

    // Enrich each log with location from AttendanceLog (stored there on punch)
    const enriched = await Promise.all(
      logs.map(async (log) => {
        const attLog = await prisma.attendanceLog.findUnique({
          where: { employeeId_date: { employeeId: log.employeeId, date: log.date } },
          select: { punchInLat: true, punchInLng: true, punchInAddress: true, punchOutLat: true, punchOutLng: true, punchOutAddress: true },
        });
        return {
          ...log,
          punchInLat:      attLog?.punchInLat      ?? null,
          punchInLng:      attLog?.punchInLng      ?? null,
          punchInAddress:  attLog?.punchInAddress  ?? null,
          punchOutLat:     attLog?.punchOutLat     ?? null,
          punchOutLng:     attLog?.punchOutLng     ?? null,
          punchOutAddress: attLog?.punchOutAddress ?? null,
        };
      })
    );

    res.json({ logs: enriched });
  }
);

// ─── DELETE /api/attendance/* — BLOCKED ─────────────────────────────────────
router.delete('*', (_req, res: Response): void => {
  res.status(405).json({ message: 'Attendance records cannot be deleted. Use regularize to correct data.' });
});

export default router;
