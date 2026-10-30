/**
 * /api/attendance — Local mode.
 * Derives attendance from REAL ESSL biometric punch data.
 *
 * GET  /api/attendance/employee/:id     → attendance logs for an employee (from ESSL)
 * GET  /api/attendance/monthly-summary  → monthly summary for all employees (Admin/HR)
 * GET  /api/attendance/today            → today's overview (Admin/HR)
 * POST /api/attendance/sync-live        → force refresh ESSL cache
 * POST /api/attendance/regularize       → stub
 * GET  /api/attendance/wfh-requests     → stub
 * POST /api/attendance/wfh-requests     → stub
 * GET  /api/attendance/regularizations  → stub
 * POST /api/attendance/regularizations  → stub
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { fetchFromETimeTrackLite, fetchFromIClockServerDirect, EtlAttendanceRecord } from '../services/etlService';
import { getHolidayDates } from './settings-local';

const router = Router();
const EMPLOYEES_PATH = path.join(__dirname, '../config/local-employees.json');
const DEVICES_PATH = path.join(__dirname, '../config/local-devices.json');

// ─── Configuration ─────────────────────────────────────────────────────────
const SHIFT_START_HOUR = 10;   // 10:00 AM
const GRACE_MINUTES = 15;      // Late after 10:15
const HALF_DAY_HOURS = 4;      // Less than 4h worked = HalfDay
const DEDUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes — punches within this gap are duplicates

// ─── Types ─────────────────────────────────────────────────────────────────
interface LocalEmployee {
  _id: string;
  userId: { _id: string; name: string; email: string; role: string };
  employeeId: string;
  department: string;
  designation: string;
  shift: string;
  joinDate: string;
  phone?: string;
  isActive: boolean;
}

interface LocalDevice {
  id: string; name: string; ip: string; port: number;
  serialNumber: string; etlUsername: string; etlPassword: string; status: string;
}

type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'HalfDay' | 'Leave' | 'Holiday' | 'WeeklyOff';

interface PunchLog {
  time: string;
  direction: 'IN' | 'OUT';
  deviceName: string;
  deviceSN: string;
}

// ─── Data Loading ──────────────────────────────────────────────────────────
function loadEmployees(): LocalEmployee[] {
  try { return JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8')); } catch { return []; }
}
function loadDevices(): LocalDevice[] {
  try { return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf-8')); } catch { return []; }
}

// ─── ESSL Data Cache ───────────────────────────────────────────────────────
interface CachedEsslData {
  records: EtlAttendanceRecord[];
  fetchedAt: number;
}
const esslCache = new Map<string, CachedEsslData>();
const CACHE_TTL_CURRENT = 3 * 60 * 1000;    // 3 min for current month
const CACHE_TTL_HISTORY = 30 * 60 * 1000;   // 30 min for past months

async function fetchEsslPunches(fromDate: string, toDate: string): Promise<{ records: EtlAttendanceRecord[]; cached: boolean }> {
  const key = `${fromDate}~${toDate}`;
  const cached = esslCache.get(key);
  const now = Date.now();

  // Check cache TTL based on whether it's current month or historical
  const todayMonth = new Date().toISOString().slice(0, 7);
  const queryMonth = fromDate.slice(0, 7);
  const ttl = queryMonth === todayMonth ? CACHE_TTL_CURRENT : CACHE_TTL_HISTORY;

  if (cached && now - cached.fetchedAt < ttl) {
    return { records: cached.records, cached: true };
  }

  const devices = loadDevices();
  if (!devices.length) return { records: [], cached: false };
  const d = devices[0];
  if (!d.etlUsername || !d.etlPassword) return { records: [], cached: false };
  const baseUrl = `http://${d.ip}:${d.port}`;

  // Strategy 1: eTimeTrackLite Excel report
  try {
    const result = await fetchFromETimeTrackLite(baseUrl, d.etlUsername, d.etlPassword, fromDate, toDate);
    if (result.success) {
      console.log(`[attendance] ESSL fetch OK: ${result.records.length} punches for ${fromDate}→${toDate}`);
      esslCache.set(key, { records: result.records, fetchedAt: now });
      return { records: result.records, cached: false };
    }
    console.warn(`[attendance] ESSL ETL failed: ${result.message}`);
  } catch (e: any) {
    console.error(`[attendance] ESSL fetch error:`, e.message);
  }

  // Strategy 2: iClock direct
  try {
    const r2 = await fetchFromIClockServerDirect(baseUrl, d.serialNumber, undefined, d.etlUsername || undefined, d.etlPassword || undefined);
    if (r2.success) {
      const dateFrom = new Date(`${fromDate}T00:00:00`);
      const dateTo = new Date(`${toDate}T23:59:59`);
      const filtered = r2.records.filter(r => r.timestamp >= dateFrom && r.timestamp <= dateTo);
      esslCache.set(key, { records: filtered, fetchedAt: now });
      return { records: filtered, cached: false };
    }
  } catch (e: any) {
    console.error(`[attendance] iClock fetch error:`, e.message);
  }

  // Return stale cache if available
  if (cached) {
    return { records: cached.records, cached: true };
  }

  return { records: [], cached: false };
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

/** Format a Date as IST ISO string with +05:30 offset */
function toISTiso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000+05:30`;
}

/** Get YYYY-MM-DD from a Date in local timezone */
function datePart(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Hour as decimal (10:30 → 10.5) */
function hourDecimal(d: Date): number {
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * Deduplicate punches: if same employee has two punches within DEDUP_WINDOW_MS, keep only the first.
 * This removes accidental double-taps on the ESSL machine.
 */
function deduplicatePunches(records: EtlAttendanceRecord[]): EtlAttendanceRecord[] {
  const sorted = [...records].sort((a, b) => {
    const cmp = a.employeeDeviceId.localeCompare(b.employeeDeviceId);
    if (cmp !== 0) return cmp;
    return a.timestamp.getTime() - b.timestamp.getTime();
  });

  const result: EtlAttendanceRecord[] = [];
  for (const r of sorted) {
    const last = result[result.length - 1];
    if (last && last.employeeDeviceId === r.employeeDeviceId) {
      const gap = r.timestamp.getTime() - last.timestamp.getTime();
      if (gap < DEDUP_WINDOW_MS) continue; // Skip duplicate
    }
    result.push(r);
  }
  return result;
}

// ─── Build Attendance from ESSL Punches ────────────────────────────────────
function buildDayAttendance(
  empId: string,
  empCode: string,
  dateStr: string,
  allPunches: EtlAttendanceRecord[],
  deviceName: string,
  deviceSN: string,
) {
  const id = `att_${empId}_${dateStr}`;
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay();
  const holidayDates = getHolidayDates();

  // Weekends
  if (day === 0 || day === 6) {
    return {
      _id: id, id, employeeId: empId, date: `${dateStr}T00:00:00.000+05:30`,
      status: 'WeeklyOff' as AttendanceStatus, workHours: 0,
      punchLogs: [] as PunchLog[], isRegularized: false, source: 'essl',
    };
  }

  // Holidays
  if (holidayDates.has(dateStr)) {
    return {
      _id: id, id, employeeId: empId, date: `${dateStr}T00:00:00.000+05:30`,
      status: 'Holiday' as AttendanceStatus, workHours: 0,
      punchLogs: [] as PunchLog[], isRegularized: false, source: 'essl',
    };
  }

  // Don't show future dates
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (date > today) return null;

  // Filter punches for this employee + date
  const dayPunches = allPunches
    .filter(p => p.employeeDeviceId.toUpperCase() === empCode.toUpperCase())
    .filter(p => datePart(p.timestamp) === dateStr)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // No punches on a workday = Absent
  if (dayPunches.length === 0) {
    return {
      _id: id, id, employeeId: empId, date: `${dateStr}T00:00:00.000+05:30`,
      status: 'Absent' as AttendanceStatus, workHours: 0,
      punchLogs: [] as PunchLog[], isRegularized: false, source: 'essl',
    };
  }

  // Build punch logs with inferred direction (alternate: IN, OUT, IN, OUT, ...)
  const punchLogs: PunchLog[] = dayPunches.map((p, i) => ({
    time: toISTiso(p.timestamp),
    direction: (i % 2 === 0 ? 'IN' : 'OUT') as 'IN' | 'OUT',
    deviceName,
    deviceSN,
  }));

  const firstPunch = dayPunches[0];
  const lastPunch = dayPunches.length > 1 ? dayPunches[dayPunches.length - 1] : null;

  const punchIn = toISTiso(firstPunch.timestamp);
  const punchOut = lastPunch ? toISTiso(lastPunch.timestamp) : undefined;

  // Work hours = last punch - first punch
  let workHours = 0;
  if (lastPunch) {
    workHours = Math.round((lastPunch.timestamp.getTime() - firstPunch.timestamp.getTime()) / 3600000 * 10) / 10;
  }

  // Determine status based on first check-in time
  const inHour = hourDecimal(firstPunch.timestamp);
  const lateThreshold = SHIFT_START_HOUR + GRACE_MINUTES / 60; // 10.25 = 10:15 AM

  let status: AttendanceStatus;
  if (workHours > 0 && workHours < HALF_DAY_HOURS) {
    status = 'HalfDay';
  } else if (inHour <= lateThreshold) {
    status = 'Present';
  } else {
    status = 'Late';
  }

  return {
    _id: id, id, employeeId: empId, date: `${dateStr}T00:00:00.000+05:30`,
    punchIn, punchOut, workHours, status, punchLogs,
    attendanceMode: 'Office' as const, isRegularized: false, source: 'essl',
  };
}

function generateMonthAttendance(
  empId: string,
  empCode: string,
  year: number,
  month: number,
  allPunches: EtlAttendanceRecord[],
  deviceName: string,
  deviceSN: string,
) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const logs = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad(month)}-${pad(d)}`;
    const log = buildDayAttendance(empId, empCode, dateStr, allPunches, deviceName, deviceSN);
    if (log) logs.push(log);
  }
  return logs;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /api/attendance/employee/:id ───────────────────────────────────────
router.get('/employee/:id', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  const employees = loadEmployees();
  const emp = employees.find((e) => e._id === req.params.id);
  if (!emp) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }

  // Employees can only view their own data
  if (req.user?.role === 'Employee') {
    if (emp.userId._id !== req.user.id && emp.userId.email !== req.user.email) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
  }

  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

  const fromDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  // Get device info
  const devices = loadDevices();
  const device = devices[0];
  const deviceName = device?.name || 'ESSL Device';
  const deviceSN = device?.serialNumber || 'Unknown';

  try {
    const { records, cached } = await fetchEsslPunches(fromDate, toDate);
    const deduped = deduplicatePunches(records);
    const logs = generateMonthAttendance(emp._id, emp.employeeId, year, month, deduped, deviceName, deviceSN);
    res.json({
      logs, month, year,
      source: records.length > 0 ? 'essl' : 'none',
      esslTotal: records.length,
      esslCached: cached,
    });
  } catch (e: any) {
    console.error('[attendance] Error:', e.message);
    res.status(500).json({ message: 'Failed to fetch attendance data', error: e.message });
  }
});

// ─── GET /api/attendance/monthly-summary ────────────────────────────────────
router.get('/monthly-summary', authenticateJWT, requireRole(['Admin', 'HR', 'Manager']), async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));

  const fromDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  const employees = loadEmployees().filter((e) => e.isActive);
  const devices = loadDevices();
  const device = devices[0];
  const deviceName = device?.name || 'ESSL Device';
  const deviceSN = device?.serialNumber || 'Unknown';

  try {
    const { records } = await fetchEsslPunches(fromDate, toDate);
    const deduped = deduplicatePunches(records);

    const summary = employees.map((emp) => {
      const logs = generateMonthAttendance(emp._id, emp.employeeId, year, month, deduped, deviceName, deviceSN);
      const counts = { Present: 0, Late: 0, Absent: 0, Leave: 0, WeeklyOff: 0, Holiday: 0, HalfDay: 0 };
      logs.forEach((l) => { if (l.status in counts) counts[l.status as keyof typeof counts]++; });
      return {
        _id: emp._id,
        employeeId: emp.employeeId,
        name: emp.userId.name,
        department: emp.department,
        ...counts,
        total: logs.length,
      };
    });

    res.json({ summary, month, year, source: 'essl', esslTotal: records.length });
  } catch (e: any) {
    console.error('[attendance] Summary error:', e.message);
    res.status(500).json({ message: 'Failed to load summary', error: e.message });
  }
});

// ─── GET /api/attendance/today ──────────────────────────────────────────────
router.get('/today', authenticateJWT, requireRole(['Admin', 'HR', 'Manager']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const employees = loadEmployees().filter((e) => e.isActive);
  const todayStr = datePart(new Date());
  const devices = loadDevices();
  const device = devices[0];
  const deviceName = device?.name || 'ESSL Device';
  const deviceSN = device?.serialNumber || 'Unknown';

  try {
    const { records } = await fetchEsslPunches(todayStr, todayStr);
    const deduped = deduplicatePunches(records);

    let present = 0, absent = 0, late = 0, onLeave = 0;
    const recent: Array<{ employeeId: string; name: string; status: string; punchIn?: string }> = [];

    employees.forEach((emp) => {
      const log = buildDayAttendance(emp._id, emp.employeeId, todayStr, deduped, deviceName, deviceSN);
      if (!log) return;
      if (log.status === 'Present') present++;
      else if (log.status === 'Absent') absent++;
      else if (log.status === 'Late') late++;
      else if (log.status === 'Leave') onLeave++;

      recent.push({
        employeeId: emp.employeeId,
        name: emp.userId.name,
        status: log.status,
        punchIn: log.punchIn,
      });
    });

    res.json({ present, absent, late, onLeave, totalEmployees: employees.length, recent: recent.slice(0, 10) });
  } catch (e: any) {
    console.error('[attendance] Today error:', e.message);
    res.json({ present: 0, absent: 0, late: 0, onLeave: 0, totalEmployees: employees.length, recent: [] });
  }
});

// ─── POST /api/attendance/sync-live — Force ESSL cache refresh ──────────────
router.post('/sync-live', authenticateJWT, requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  // Clear all cache entries to force fresh fetch
  esslCache.clear();

  const todayStr = datePart(new Date());
  try {
    const { records } = await fetchEsslPunches(todayStr, todayStr);
    res.json({
      success: true,
      message: `Synced ${records.length} ESSL punches for today`,
      totalLogsImported: records.length,
    });
  } catch (e: any) {
    res.json({ success: false, message: `ESSL sync failed: ${e.message}`, totalLogsImported: 0 });
  }
});

// ─── Stubs ─────────────────────────────────────────────────────────────────
router.post('/regularize', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'Regularization requires database integration. Coming soon.' });
});

router.get('/wfh-requests', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json([]);
});

router.post('/wfh-requests', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'WFH requests require database integration. Coming soon.' });
});

router.get('/regularizations', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json([]);
});

router.post('/regularizations', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'Regularization requires database integration. Coming soon.' });
});

router.put('/wfh-requests/:id/review', authenticateJWT, requireRole(['Admin', 'HR', 'Manager']), (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'WFH review requires database integration. Coming soon.' });
});

router.put('/regularizations/:id/review', authenticateJWT, requireRole(['Admin', 'HR', 'Manager']), (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'Regularization review requires database integration. Coming soon.' });
});

router.get('/', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json({ data: [], total: 0 });
});

export default router;
