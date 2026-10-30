/**
 * /api/reports — Local mode.
 * Generates reports from real ESSL punch data.
 *
 * GET /api/reports/monthly     → monthly report with summary + daily breakdown
 * GET /api/reports/export/csv  → CSV download
 * GET /api/reports/export/pdf  → stub (503)
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { fetchFromETimeTrackLite, fetchFromIClockServerDirect, EtlAttendanceRecord } from '../services/etlService';
import { getHolidayDates } from './settings-local';

const router = Router();
router.use(authenticateJWT);
router.use(requireRole(['Admin', 'HR']));

const EMPLOYEES_PATH = path.join(__dirname, '../config/local-employees.json');
const DEVICES_PATH = path.join(__dirname, '../config/local-devices.json');

const SHIFT_START_HOUR = 10;
const GRACE_MINUTES = 15;
const HALF_DAY_HOURS = 4;
const DEDUP_WINDOW_MS = 2 * 60 * 1000;

interface LocalEmployee {
  _id: string;
  userId: { _id: string; name: string; email: string };
  employeeId: string;
  department: string;
  isActive: boolean;
}
interface LocalDevice {
  id: string; name: string; ip: string; port: number;
  serialNumber: string; etlUsername: string; etlPassword: string; status: string;
}

function loadEmployees(): LocalEmployee[] {
  try { return JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8')); } catch { return []; }
}
function loadDevices(): LocalDevice[] {
  try { return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf-8')); } catch { return []; }
}

const pad = (n: number) => String(n).padStart(2, '0');
function datePart(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function hourDecimal(d: Date): number { return d.getHours() + d.getMinutes() / 60; }

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
      if (gap < DEDUP_WINDOW_MS) continue;
    }
    result.push(r);
  }
  return result;
}

async function fetchEsslPunches(fromDate: string, toDate: string): Promise<EtlAttendanceRecord[]> {
  const devices = loadDevices();
  if (!devices.length) return [];
  const d = devices[0];
  if (!d.etlUsername || !d.etlPassword) return [];
  const baseUrl = `http://${d.ip}:${d.port}`;
  try {
    const result = await fetchFromETimeTrackLite(baseUrl, d.etlUsername, d.etlPassword, fromDate, toDate);
    if (result.success) return result.records;
  } catch (e: any) { console.error('[reports] ESSL fetch error:', e.message); }
  try {
    const r2 = await fetchFromIClockServerDirect(baseUrl, d.serialNumber, undefined, d.etlUsername, d.etlPassword);
    if (r2.success) {
      const dateFrom = new Date(`${fromDate}T00:00:00`);
      const dateTo = new Date(`${toDate}T23:59:59`);
      return r2.records.filter(r => r.timestamp >= dateFrom && r.timestamp <= dateTo);
    }
  } catch (e: any) { console.error('[reports] iClock fetch error:', e.message); }
  return [];
}

type Status = 'Present' | 'Late' | 'Absent' | 'HalfDay' | 'Leave' | 'Holiday' | 'WeeklyOff';

function getDayStatusFromPunches(empCode: string, dateStr: string, allPunches: EtlAttendanceRecord[]): { status: Status; workHours: number } {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = date.getDay();
  if (day === 0 || day === 6) return { status: 'WeeklyOff', workHours: 0 };
  const holidayDates = getHolidayDates();
  if (holidayDates.has(dateStr)) return { status: 'Holiday', workHours: 0 };
  const today = new Date(); today.setHours(23, 59, 59, 999);
  if (date > today) return { status: 'WeeklyOff', workHours: 0 };

  const dayPunches = allPunches
    .filter(p => p.employeeDeviceId.toUpperCase() === empCode.toUpperCase() && datePart(p.timestamp) === dateStr)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (dayPunches.length === 0) return { status: 'Absent', workHours: 0 };

  const first = dayPunches[0];
  const last = dayPunches.length > 1 ? dayPunches[dayPunches.length - 1] : null;
  const workHours = last ? Math.round((last.timestamp.getTime() - first.timestamp.getTime()) / 3600000 * 10) / 10 : 0;
  const inHour = hourDecimal(first.timestamp);
  const lateThreshold = SHIFT_START_HOUR + GRACE_MINUTES / 60;

  let status: Status;
  if (workHours > 0 && workHours < HALF_DAY_HOURS) status = 'HalfDay';
  else if (inHour <= lateThreshold) status = 'Present';
  else status = 'Late';

  return { status, workHours };
}

// ─── GET /api/reports/monthly ─────────────────────────────────────────────────
router.get('/monthly', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const dept = (req.query.department as string) || '';

  let employees = loadEmployees().filter((e) => e.isActive);
  if (dept) employees = employees.filter((e) => e.department.toLowerCase() === dept.toLowerCase());

  const fromDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  const records = await fetchEsslPunches(fromDate, toDate);
  const deduped = deduplicatePunches(records);

  const dailyMap: Record<string, { present: number; late: number; absent: number }> = {};

  const summary = employees.map((emp) => {
    let present = 0, late = 0, absent = 0, leave = 0, totalHours = 0;

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const { status, workHours } = getDayStatusFromPunches(emp.employeeId, dateStr, deduped);
      totalHours += workHours;

      if (!dailyMap[dateStr]) dailyMap[dateStr] = { present: 0, late: 0, absent: 0 };
      if (status === 'Present') { present++; dailyMap[dateStr].present++; }
      else if (status === 'Late') { late++; dailyMap[dateStr].late++; }
      else if (status === 'Absent') { absent++; dailyMap[dateStr].absent++; }
      else if (status === 'Leave') { leave++; }
      else if (status === 'HalfDay') { present++; dailyMap[dateStr].present++; }
    }

    return {
      employeeId: emp.employeeId,
      name: emp.userId.name,
      department: emp.department,
      present, late, absent, leave,
      totalWorkHours: `${Math.round(totalHours)}h`,
    };
  });

  const dailyBreakdown = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  res.json({ summary, dailyBreakdown, month, year, source: 'essl' });
});

// ─── GET /api/reports/export/csv ──────────────────────────────────────────────
router.get('/export/csv', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const dept = (req.query.department as string) || '';

  let employees = loadEmployees().filter((e) => e.isActive);
  if (dept) employees = employees.filter((e) => e.department.toLowerCase() === dept.toLowerCase());

  const fromDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const toDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  const records = await fetchEsslPunches(fromDate, toDate);
  const deduped = deduplicatePunches(records);

  const rows: string[] = ['Employee ID,Name,Department,Present,Late,Absent,Leave,Total Work Hours'];

  employees.forEach((emp) => {
    let present = 0, late = 0, absent = 0, leave = 0, totalHours = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const { status, workHours } = getDayStatusFromPunches(emp.employeeId, dateStr, deduped);
      totalHours += workHours;
      if (status === 'Present' || status === 'HalfDay') present++;
      else if (status === 'Late') late++;
      else if (status === 'Absent') absent++;
      else if (status === 'Leave') leave++;
    }
    const name = emp.userId.name.includes(',') ? `"${emp.userId.name}"` : emp.userId.name;
    rows.push(`${emp.employeeId},${name},${emp.department},${present},${late},${absent},${leave},${Math.round(totalHours)}h`);
  });

  const csv = rows.join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${year}_${month}.csv"`);
  res.send(csv);
});

// ─── GET /api/reports/export/pdf ──────────────────────────────────────────────
router.get('/export/pdf', (_req: AuthRequest, res: Response): void => {
  res.status(503).json({ message: 'PDF export is not available in local mode.' });
});

export default router;
