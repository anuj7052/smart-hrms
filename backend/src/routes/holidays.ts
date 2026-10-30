import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { todayISTDateOnly } from '../utils/dateIST';

const router = Router();
router.use(authenticateJWT);

// ─── GET /api/holidays ───────────────────────────────────────────────────────
// Returns holidays for a given year (defaults to current year)
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  const holidays = await prisma.holiday.findMany({
    where: { year },
    orderBy: { date: 'asc' },
  });
  res.json(holidays);
});

// ─── GET /api/holidays/upcoming ──────────────────────────────────────────────
// Returns next N upcoming holidays
router.get('/upcoming', async (req: AuthRequest, res: Response): Promise<void> => {
  const limit = parseInt(req.query.limit as string) || 5;
  const today = todayISTDateOnly();

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: today } },
    orderBy: { date: 'asc' },
    take: limit,
  });
  res.json(holidays);
});

// ─── POST /api/holidays ──────────────────────────────────────────────────────
// Admin: Add a new holiday
router.post(
  '/',
  requireRole(['Admin', 'HR']),
  [
    body('name').trim().notEmpty().withMessage('Holiday name is required'),
    body('date').isISO8601().withMessage('Valid date is required'),
    body('festivalName').optional().trim(),
    body('description').optional().trim(),
    body('holidayType').optional().isIn(['National', 'Festival', 'CompanyHoliday']),
    body('isOptional').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, date, festivalName, description, holidayType, isOptional } = req.body as {
      name: string; date: string; festivalName?: string; description?: string;
      holidayType?: string; isOptional?: boolean;
    };

    const holidayDate = new Date(date);
    holidayDate.setUTCHours(0, 0, 0, 0);
    const year = holidayDate.getFullYear();

    // Check for duplicate
    const existing = await prisma.holiday.findFirst({
      where: { name, date: holidayDate },
    });
    if (existing) {
      res.status(409).json({ message: 'A holiday with this name and date already exists' });
      return;
    }

    const holiday = await prisma.holiday.create({
      data: {
        name,
        date: holidayDate,
        festivalName: festivalName || null,
        description: description || null,
        holidayType: (holidayType as 'National' | 'Festival' | 'CompanyHoliday') || 'CompanyHoliday',
        isOptional: isOptional || false,
        year,
      },
    });

    res.status(201).json({ message: 'Holiday added successfully', holiday });
  }
);

// ─── PUT /api/holidays/:id ───────────────────────────────────────────────────
// Admin: Edit a holiday
router.put(
  '/:id',
  requireRole(['Admin', 'HR']),
  [
    body('name').optional().trim().notEmpty(),
    body('date').optional().isISO8601(),
    body('festivalName').optional().trim(),
    body('description').optional().trim(),
    body('holidayType').optional().isIn(['National', 'Festival', 'CompanyHoliday']),
    body('isOptional').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const existing = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ message: 'Holiday not found' });
      return;
    }

    const { name, date, festivalName, description, holidayType, isOptional } = req.body as {
      name?: string; date?: string; festivalName?: string; description?: string;
      holidayType?: string; isOptional?: boolean;
    };

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (date !== undefined) {
      const d = new Date(date);
      d.setUTCHours(0, 0, 0, 0);
      data.date = d;
      data.year = d.getFullYear();
    }
    if (festivalName !== undefined) data.festivalName = festivalName || null;
    if (description !== undefined) data.description = description || null;
    if (holidayType !== undefined) data.holidayType = holidayType;
    if (isOptional !== undefined) data.isOptional = isOptional;

    const holiday = await prisma.holiday.update({
      where: { id: req.params.id },
      data: data as any,
    });

    res.json({ message: 'Holiday updated', holiday });
  }
);

// ─── DELETE /api/holidays/:id ────────────────────────────────────────────────
// Admin: Delete a holiday
router.delete(
  '/:id',
  requireRole(['Admin', 'HR']),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const existing = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ message: 'Holiday not found' });
      return;
    }

    await prisma.holiday.delete({ where: { id: req.params.id } });
    res.json({ message: 'Holiday deleted' });
  }
);

// ─── POST /api/holidays/seed-defaults ────────────────────────────────────────
// Admin: Seed default holidays for a year
router.post(
  '/seed-defaults',
  requireRole(['Admin']),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const year = parseInt(req.body.year as string) || new Date().getFullYear();

    const DEFAULT_HOLIDAYS = [
      { name: 'New Year', date: `${year}-01-01`, holidayType: 'National' as const, festivalName: "New Year's Day" },
      { name: 'Republic Day', date: `${year}-01-26`, holidayType: 'National' as const, festivalName: 'Republic Day' },
      { name: 'Holi', date: `${year}-03-04`, holidayType: 'Festival' as const, festivalName: 'Holi' },
      { name: 'Ram Navmi', date: `${year}-03-27`, holidayType: 'Festival' as const, festivalName: 'Ram Navmi' },
      { name: 'Good Friday', date: `${year}-04-03`, holidayType: 'Festival' as const, festivalName: 'Good Friday' },
      { name: 'Independence Day', date: `${year}-08-15`, holidayType: 'National' as const, festivalName: 'Independence Day' },
      { name: 'Raksha Bandhan', date: `${year}-08-28`, holidayType: 'Festival' as const, festivalName: 'Raksha Bandhan' },
      { name: 'Janmashtami', date: `${year}-09-04`, holidayType: 'Festival' as const, festivalName: 'Janmashtami' },
      { name: 'Gandhi Jayanti', date: `${year}-10-02`, holidayType: 'National' as const, festivalName: 'Gandhi Jayanti' },
      { name: 'Vijaya Dashami (Dussehra)', date: `${year}-10-20`, holidayType: 'Festival' as const, festivalName: 'Dussehra' },
      { name: 'Diwali', date: `${year}-11-09`, holidayType: 'Festival' as const, festivalName: 'Diwali' },
      { name: 'Govardhan Puja', date: `${year}-11-10`, holidayType: 'Festival' as const, festivalName: 'Govardhan Puja' },
      { name: 'Christmas Day', date: `${year}-12-25`, holidayType: 'Festival' as const, festivalName: 'Christmas' },
    ];

    let created = 0;
    let skipped = 0;

    for (const h of DEFAULT_HOLIDAYS) {
      const d = new Date(h.date);
      d.setUTCHours(0, 0, 0, 0);
      const exists = await prisma.holiday.findFirst({ where: { name: h.name, date: d } });
      if (exists) { skipped++; continue; }
      await prisma.holiday.create({
        data: {
          name: h.name,
          date: d,
          festivalName: h.festivalName,
          holidayType: h.holidayType,
          year,
          isOptional: false,
        },
      });
      created++;
    }

    res.json({ message: `Seeded holidays for ${year}: ${created} created, ${skipped} already existed`, created, skipped });
  }
);

export default router;
