/**
 * /api/settings — Local mode.
 * Provides shift list, company settings, holidays.
 *
 * GET  /api/settings/shifts  → shift list
 * GET  /api/settings         → company settings (incl. holidays)
 * PUT  /api/settings         → update settings (holidays, etc.)
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Holidays (persisted to JSON file) ─────────────────────────────────────
const HOLIDAYS_PATH = path.join(__dirname, '../config/local-holidays.json');

interface Holiday { name: string; date: string }

const DEFAULT_HOLIDAYS: Holiday[] = [
  { name: 'New Year',                          date: '2026-01-01' },
  { name: 'Republic Day',                      date: '2026-01-26' },
  { name: 'Holi',                              date: '2026-03-04' },
  { name: 'Ram Navmi',                         date: '2026-03-27' },
  { name: 'Good Friday',                       date: '2026-04-03' },
  { name: 'Raksha Bandhan',                    date: '2026-08-28' },
  { name: 'Janmashtami',                       date: '2026-09-04' },
  { name: 'Gandhi Jayanti',                    date: '2026-10-02' },
  { name: 'Vijaya Dashami (Dussehra)',         date: '2026-10-20' },
  { name: 'Diwali',                            date: '2026-11-09' },
  { name: 'Govardhan Puja',                    date: '2026-11-10' },
  { name: 'Christmas Day',                     date: '2026-12-25' },
];

function loadHolidays(): Holiday[] {
  try {
    return JSON.parse(fs.readFileSync(HOLIDAYS_PATH, 'utf-8'));
  } catch {
    return DEFAULT_HOLIDAYS;
  }
}

function saveHolidays(holidays: Holiday[]): void {
  fs.writeFileSync(HOLIDAYS_PATH, JSON.stringify(holidays, null, 2));
}

// Exported so attendance-local can import it
export function getHolidayDates(): Set<string> {
  return new Set(loadHolidays().map(h => h.date));
}

// ─── Shifts ────────────────────────────────────────────────────────────────
const SHIFTS = [
  {
    _id: 'shift_general',
    name: 'General',
    startTime: '09:00',
    endTime: '18:00',
    gracePeriodMinutes: 15,
    halfDayThresholdHours: 4,
    isActive: true,
  },
  {
    _id: 'shift_morning',
    name: 'Morning',
    startTime: '07:00',
    endTime: '15:00',
    gracePeriodMinutes: 10,
    halfDayThresholdHours: 4,
    isActive: true,
  },
  {
    _id: 'shift_evening',
    name: 'Evening',
    startTime: '14:00',
    endTime: '22:00',
    gracePeriodMinutes: 10,
    halfDayThresholdHours: 4,
    isActive: true,
  },
];

// GET /api/settings/shifts
router.get('/shifts', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json(SHIFTS);
});

// GET /api/settings
router.get('/', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json({
    companyName: 'Foetron',
    workWeekDays: [1, 2, 3, 4, 5],
    timezone: 'Asia/Kolkata',
    attendanceSource: 'ESSL',
    mode: 'local',
    holidays: loadHolidays(),
  });
});

// PUT /api/settings — update settings (holidays, etc.)
router.put('/', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const { holidays } = req.body;
  if (holidays && Array.isArray(holidays)) {
    saveHolidays(holidays);
  }
  res.json({
    companyName: 'Foetron',
    workWeekDays: [1, 2, 3, 4, 5],
    timezone: 'Asia/Kolkata',
    attendanceSource: 'ESSL',
    mode: 'local',
    holidays: loadHolidays(),
  });
});

export default router;
