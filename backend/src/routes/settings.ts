import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticateJWT);

// ─── Default holidays for 2026 ───────────────────────────────────────────────
const DEFAULT_HOLIDAYS = [
  { name: 'New Year',                  date: '2026-01-01' },
  { name: 'Republic Day',              date: '2026-01-26' },
  { name: 'Holi',                      date: '2026-03-04' },
  { name: 'Ram Navmi',                 date: '2026-03-27' },
  { name: 'Good Friday',               date: '2026-04-03' },
  { name: 'Raksha Bandhan',            date: '2026-08-28' },
  { name: 'Janmashtami',               date: '2026-09-04' },
  { name: 'Gandhi Jayanti',            date: '2026-10-02' },
  { name: 'Vijaya Dashami (Dussehra)', date: '2026-10-20' },
  { name: 'Diwali',                    date: '2026-11-09' },
  { name: 'Govardhan Puja',            date: '2026-11-10' },
  { name: 'Christmas Day',             date: '2026-12-25' },
];

// ─── GET /api/settings ───────────────────────────────────────────────────────
router.get('/', async (_req, res: Response): Promise<void> => {
  let settings = await prisma.appSettings.findFirst();
  if (!settings) {
    settings = await prisma.appSettings.create({ data: { holidays: DEFAULT_HOLIDAYS } });
  } else if (!settings.holidays || (settings.holidays as unknown[]).length === 0) {
    settings = await prisma.appSettings.update({ where: { id: settings.id }, data: { holidays: DEFAULT_HOLIDAYS } });
  }
  const { smtpPass: _sp, ...safe } = settings as typeof settings & { smtpPass?: string }; void _sp;
  res.json(safe);
});

// ─── PUT /api/settings ───────────────────────────────────────────────────────
router.put('/', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const settings = await prisma.appSettings.findFirst();
  const allowed = ['allowedEmailDomains','shiftStart','shiftEnd','lateThresholdMinutes','lateArrivalTime','halfDayThresholdHours','workingDays','holidays','smtpHost','smtpPort','smtpUser','smtpPass','smtpFrom','emailNotificationsEnabled','appCheckInEnabled','appCheckInScope','appCheckInDepartments','appCheckInEmployeeIds','esslEnabled','esslMode','esslProxyUrl','esslServerUrl','esslUserName','esslPassword','esslPollMs'];
  const data: Record<string, unknown> = {};
  for (const key of allowed) { if ((req.body as Record<string,unknown>)[key] !== undefined) data[key] = (req.body as Record<string,unknown>)[key]; }
  if (settings) await prisma.appSettings.update({ where: { id: settings.id }, data: data as any });
  else await prisma.appSettings.create({ data: data as any });
  res.json({ message: 'Settings updated' });
});

// ─── POST /api/settings/apply-holidays ───────────────────────────────────────
router.post('/apply-holidays', requireRole(['Admin']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const settings = await prisma.appSettings.findFirst();
  const holidays = settings?.holidays as Array<{ date: string }> | null;
  if (!holidays || holidays.length === 0) { res.status(400).json({ message: 'No holidays configured in settings' }); return; }

  const employees = await prisma.employee.findMany({ select: { id: true } });
  let applied = 0; let skipped = 0;

  for (const holiday of holidays) {
    const d = new Date(holiday.date); d.setUTCHours(0, 0, 0, 0);
    for (const emp of employees) {
      const existing = await prisma.attendanceLog.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: d } } });
      if (existing) {
        if (['Absent', 'Holiday', 'WeeklyOff'].includes(existing.status)) {
          await prisma.attendanceLog.update({ where: { id: existing.id }, data: { status: 'Holiday', source: 'holiday-import', punchIn: null, punchOut: null, workHours: 0 } });
          applied++;
        } else { skipped++; }
      } else {
        await prisma.attendanceLog.create({ data: { employeeId: emp.id, date: d, status: 'Holiday', workHours: 0, source: 'holiday-import' } });
        applied++;
      }
    }
  }
  res.json({ message: `Applied ${holidays.length} holidays to ${employees.length} employees. ${applied} records created/updated, ${skipped} skipped.`, applied, skipped });
});

// ─── GET /api/settings/shifts ─────────────────────────────────────────────────
router.get('/shifts', async (_req, res: Response): Promise<void> => {
  const shifts = await prisma.shift.findMany({ orderBy: { name: 'asc' } });
  res.json(shifts);
});

// ─── POST /api/settings/shifts ────────────────────────────────────────────────
router.post(
  '/shifts',
  requireRole(['Admin']),
  [
    body('name').trim().notEmpty().withMessage('Shift name is required'),
    body('startTime').matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM'),
    body('endTime').matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM'),
    body('gracePeriodMinutes').optional().isInt({ min: 0 }),
    body('halfDayThresholdHours').optional().isFloat({ min: 1 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, startTime, endTime, gracePeriodMinutes, halfDayThresholdHours } = req.body as {
      name: string; startTime: string; endTime: string;
      gracePeriodMinutes?: number; halfDayThresholdHours?: number;
    };

    const existing = await prisma.shift.findUnique({ where: { name } });
    if (existing) {
      res.status(409).json({ message: 'A shift with this name already exists' });
      return;
    }
    const shift = await prisma.shift.create({
      data: { name, startTime, endTime, gracePeriodMinutes: gracePeriodMinutes ?? 15, halfDayThresholdHours: halfDayThresholdHours ?? 4 },
    });
    res.status(201).json(shift);
  }
);

// ─── PUT /api/settings/shifts/:id ─────────────────────────────────────────────
router.put(
  '/shifts/:id',
  requireRole(['Admin']),
  [
    body('startTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('Start time must be HH:MM'),
    body('endTime').optional().matches(/^\d{2}:\d{2}$/).withMessage('End time must be HH:MM'),
    body('gracePeriodMinutes').optional().isInt({ min: 0 }),
    body('halfDayThresholdHours').optional().isFloat({ min: 1 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!shift) {
      res.status(404).json({ message: 'Shift not found' });
      return;
    }

    const { name, startTime, endTime, gracePeriodMinutes, halfDayThresholdHours, isActive } = req.body as {
      name?: string; startTime?: string; endTime?: string;
      gracePeriodMinutes?: number; halfDayThresholdHours?: number; isActive?: boolean;
    };

    const updated = await prisma.shift.update({
      where: { id: req.params.id },
      data: { ...(name && { name }), ...(startTime && { startTime }), ...(endTime && { endTime }), ...(gracePeriodMinutes !== undefined && { gracePeriodMinutes }), ...(halfDayThresholdHours !== undefined && { halfDayThresholdHours }), ...(isActive !== undefined && { isActive }) },
    });
    res.json(updated);
  }
);

// ─── DELETE /api/settings/shifts/:id ──────────────────────────────────────────
router.delete('/shifts/:id', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const shift = await prisma.shift.findUnique({ where: { id: req.params.id } });
  if (!shift) { res.status(404).json({ message: 'Shift not found' }); return; }
  const count = await prisma.employee.count({ where: { shiftId: req.params.id } });
  if (count > 0) {
    res.status(409).json({ message: `Cannot delete — ${count} employee(s) are assigned to this shift. Reassign them first.` }); return;
  }
  await prisma.shift.delete({ where: { id: req.params.id } });
  res.json({ message: 'Shift deleted' });
});

export default router;
