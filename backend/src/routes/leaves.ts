import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticateJWT);

// ─── Policy constants ────────────────────────────────────────────────────────
const LEAVE_POLICY = {
  'Earned Leave':  { max: 12, carryForward: 7 },
  'Casual Leave':  { max: 5,  carryForward: 0 },
  'Sick Leave':    { max: 7,  carryForward: 0, requiresPrescriptionAfterDays: 2 },
};
const WORKING_DAYS_FOR_EL = 20; // Must have ≥20 working days in a month to earn 1 EL

// Helper: map Prisma LeaveType to frontend-compatible shape
function mapType(lt: { id: string; name: string; daysAllowed: number; isUnlimited: boolean; description?: string | null; isActive: boolean }) {
  return { _id: lt.id, id: lt.id, name: lt.name, daysAllowed: lt.daysAllowed, isUnlimited: lt.isUnlimited, description: lt.description, isActive: lt.isActive };
}

// Helper: map Prisma LeaveBalance to frontend-compatible shape
function mapBalance(b: { id: string; leaveTypeId: string; year: number; allocated: number; used: number; remaining: number; leaveType: { id: string; name: string; isUnlimited: boolean } }) {
  return {
    _id: b.id,
    id: b.id,
    leaveTypeId: { _id: b.leaveType.id, id: b.leaveType.id, name: b.leaveType.name, isUnlimited: b.leaveType.isUnlimited },
    year: b.year,
    allocated: b.allocated,
    used: b.used,
    remaining: b.remaining,
  };
}

// Helper: map Prisma LeaveRequest to frontend-compatible shape
function mapLeave(l: {
  id: string; status: string; fromDate: Date; toDate: Date; totalDays: number; reason: string;
  reviewComment?: string | null; createdAt: Date;
  leaveType: { id: string; name: string };
  employee: { id: string; employeeId: string; user: { id: string; name: string | null; email: string } };
}) {
  return {
    _id: l.id,
    id: l.id,
    status: l.status,
    fromDate: l.fromDate.toISOString(),
    toDate: l.toDate.toISOString(),
    totalDays: l.totalDays,
    reason: l.reason,
    reviewComment: l.reviewComment,
    createdAt: l.createdAt.toISOString(),
    leaveTypeId: { _id: l.leaveType.id, id: l.leaveType.id, name: l.leaveType.name },
    employeeId: {
      _id: l.employee.id,
      id: l.employee.id,
      employeeId: l.employee.employeeId,
      userId: { _id: l.employee.user.id, name: l.employee.user.name, email: l.employee.user.email },
    },
  };
}

// ─── Ensure leave balances exist for employee ────────────────────────────────
async function ensureBalances(employeeId: string, year: number) {
  const types = await prisma.leaveType.findMany({ where: { isActive: true } });
  for (const lt of types) {
    const existing = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: lt.id, year } },
    });
    if (!existing) {
      await prisma.leaveBalance.create({
        data: { employeeId, leaveTypeId: lt.id, year, allocated: lt.daysAllowed, used: 0, remaining: lt.daysAllowed },
      });
    }
  }
}

// ─── GET /api/leaves/types ───────────────────────────────────────────────────
router.get('/types', async (_req, res: Response): Promise<void> => {
  const types = await prisma.leaveType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  res.json(types.map(mapType));
});

// ─── POST /api/leaves/types ──────────────────────────────────────────────────
router.post('/types', requireRole(['Admin']),
  [body('name').trim().notEmpty(), body('daysAllowed').isInt({ min: 0 })],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }
    const { name, daysAllowed, description } = req.body as { name: string; daysAllowed: number; description?: string };
    const lt = await prisma.leaveType.create({ data: { name, daysAllowed, description } });
    res.status(201).json(mapType(lt));
  }
);

// ─── GET /api/leaves/balance (current user) ──────────────────────────────────
router.get('/balance', async (req: AuthRequest, res: Response): Promise<void> => {
  const emp = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
  if (!emp) { res.json([]); return; }
  const year = new Date().getFullYear();
  await ensureBalances(emp.id, year);
  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId: emp.id, year },
    include: { leaveType: true },
    orderBy: { leaveType: { name: 'asc' } },
  });
  res.json(balances.map(mapBalance));
});

// ─── GET /api/leaves/balance/:employeeId ────────────────────────────────────
router.get('/balance/:employeeId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp || emp.id !== req.params.employeeId) { res.status(403).json({ message: 'Insufficient permissions' }); return; }
  }
  const year = new Date().getFullYear();
  await ensureBalances(req.params.employeeId, year);
  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId: req.params.employeeId, year },
    include: { leaveType: true },
    orderBy: { leaveType: { name: 'asc' } },
  });
  res.json(balances.map(mapBalance));
});

// ─── GET /api/leaves ─────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.query as { status?: string };
  const where: Record<string, unknown> = {};
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp) { res.status(404).json({ message: 'Employee profile not found' }); return; }
    where.employeeId = emp.id;
  }
  if (status) where.status = status;
  const leaves = await prisma.leaveRequest.findMany({
    where,
    include: {
      leaveType: true,
      employee: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(leaves.map(mapLeave));
});

// ─── POST /api/leaves ────────────────────────────────────────────────────────
router.post('/',
  [
    body('leaveTypeId').notEmpty().withMessage('Leave type is required'),
    body('fromDate').isISO8601().withMessage('Valid fromDate required'),
    body('toDate').isISO8601().withMessage('Valid toDate required'),
    body('reason').trim().isLength({ min: 5 }).withMessage('Reason must be at least 5 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const emp = await prisma.employee.findFirst({ where: { userId: req.user?.id } });
    if (!emp) { res.status(404).json({ message: 'Employee profile not found' }); return; }

    const { leaveTypeId, fromDate, toDate, reason } = req.body as {
      leaveTypeId: string; fromDate: string; toDate: string; reason: string;
    };

    const from = new Date(fromDate + 'T00:00:00.000Z');
    const to = new Date(toDate + 'T00:00:00.000Z');
    if (from > to) { res.status(400).json({ message: 'fromDate must be before or equal to toDate' }); return; }

    const totalDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType || !leaveType.isActive) { res.status(404).json({ message: 'Leave type not found' }); return; }

    const year = from.getFullYear();

    // ── Policy: SL >2 continuous days warns about prescription ───────────────
    let prescriptionRequired = false;
    if (leaveType.name === 'Sick Leave' && totalDays > 2) {
      prescriptionRequired = true;
    }

    // ── Ensure balance exists ─────────────────────────────────────────────────
    await ensureBalances(emp.id, year);
    const balance = await prisma.leaveBalance.findUnique({
      where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId, year } },
    });
    if (!balance) { res.status(500).json({ message: 'Balance setup failed' }); return; }

    // ── Policy: Earned Leave — check monthly eligibility ──────────────────────
    if (leaveType.name === 'Earned Leave') {
      const applyMonth = from.getMonth();
      const applyYear = from.getFullYear();
      const monthStart = new Date(applyYear, applyMonth, 1);
      const monthEnd = new Date(applyYear, applyMonth + 1, 1);
      const workingDays = await prisma.attendanceLog.count({
        where: {
          employeeId: emp.id,
          date: { gte: monthStart, lt: monthEnd },
          status: { in: ['Present', 'Late', 'HalfDay'] },
        },
      });
      if (workingDays < WORKING_DAYS_FOR_EL) {
        res.status(400).json({
          message: `Earned Leave requires at least ${WORKING_DAYS_FOR_EL} working days in the month. You have ${workingDays} working days this month.`,
        });
        return;
      }
    }

    if (!leaveType.isUnlimited && balance.remaining < totalDays) {
      res.status(400).json({ message: `Insufficient ${leaveType.name} balance. Available: ${balance.remaining} day(s)` });
      return;
    }

    const request = await prisma.leaveRequest.create({
      data: { employeeId: emp.id, leaveTypeId, fromDate: from, toDate: to, totalDays, reason },
      include: {
        leaveType: true,
        employee: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    res.status(201).json({
      message: 'Leave request submitted',
      prescriptionRequired,
      prescriptionWarning: prescriptionRequired
        ? 'Sick Leave for more than 2 days requires a doctor\'s prescription. Please upload it to avoid these days being marked as Absent.'
        : undefined,
      request: mapLeave(request),
    });
  }
);

// ─── PUT /api/leaves/:id/review ──────────────────────────────────────────────
router.put('/:id/review', requireRole(['Admin', 'HR']),
  [body('status').isIn(['Approved', 'Rejected']), body('comment').optional().isString()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: { leaveType: true },
    });
    if (!leave) { res.status(404).json({ message: 'Leave request not found' }); return; }
    if (leave.status !== 'Pending') { res.status(400).json({ message: 'Request already reviewed' }); return; }

    const { status, comment } = req.body as { status: 'Approved' | 'Rejected'; comment?: string };

    await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status, reviewedById: req.user?.id, reviewedAt: new Date(), ...(comment && { reviewComment: comment }) },
    });

    if (status === 'Approved') {
      const year = leave.fromDate.getFullYear();

      // Track usage for all leave; only capped types consume an annual balance.
      await prisma.leaveBalance.updateMany({
        where: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year },
        data: {
          used: { increment: leave.totalDays },
          ...(!leave.leaveType.isUnlimited && { remaining: { decrement: leave.totalDays } }),
        },
      });

      // Mark attendance as Leave for each day
      const current = new Date(leave.fromDate);
      while (current <= leave.toDate) {
        const date = new Date(current);
        date.setUTCHours(0, 0, 0, 0);
        await prisma.attendanceLog.upsert({
          where: { employeeId_date: { employeeId: leave.employeeId, date } },
          update: { status: 'Leave', source: 'leave' },
          create: { employeeId: leave.employeeId, date, status: 'Leave', workHours: 0, source: 'leave' },
        });
        current.setDate(current.getDate() + 1);
      }

      // Policy: SL >2 continuous days without prescription → mark extra days Absent
      if (leave.leaveType.name === 'Sick Leave' && leave.totalDays > 2) {
        // Currently we trust admin's approval; in future prescription upload can trigger auto-marking
        // The attendance is already marked as Leave (admin approved), which is correct
      }
    }

    res.json({ message: `Leave ${status}` });
  }
);

// ─── PUT /api/leaves/:id/cancel ──────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!leave) { res.status(404).json({ message: 'Leave request not found' }); return; }
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp || emp.id !== leave.employeeId) { res.status(403).json({ message: 'Insufficient permissions' }); return; }
  }
  if (leave.status !== 'Pending') { res.status(400).json({ message: 'Can only cancel pending requests' }); return; }
  await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status: 'Cancelled' } });
  res.json({ message: 'Leave request cancelled' });
});

// ─── POST /api/leaves/accrue-el ─── (Admin: accrue 1 EL/month for eligible employees)
router.post('/accrue-el', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { month, year } = req.body as { month?: number; year?: number };
  const now = new Date();
  const targetMonth = month ?? now.getMonth() + 1;
  const targetYear = year ?? now.getFullYear();

  const monthStart = new Date(targetYear, targetMonth - 1, 1);
  const monthEnd = new Date(targetYear, targetMonth, 1);

  const elType = await prisma.leaveType.findFirst({ where: { name: 'Earned Leave' } });
  if (!elType) { res.status(400).json({ message: 'Earned Leave type not configured' }); return; }

  const employees = await prisma.employee.findMany({ where: { isActive: true } });
  let credited = 0;

  for (const emp of employees) {
    const workingDays = await prisma.attendanceLog.count({
      where: {
        employeeId: emp.id,
        date: { gte: monthStart, lt: monthEnd },
        status: { in: ['Present', 'Late', 'HalfDay'] },
      },
    });

    if (workingDays >= WORKING_DAYS_FOR_EL) {
      const policy = LEAVE_POLICY['Earned Leave'];
      let balance = await prisma.leaveBalance.findUnique({
        where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId: elType.id, year: targetYear } },
      });

      if (!balance) {
        balance = await prisma.leaveBalance.create({
          data: { employeeId: emp.id, leaveTypeId: elType.id, year: targetYear, allocated: 0, used: 0, remaining: 0 },
        });
      }

      // Only credit if not already at max
      if (balance.allocated < policy.max) {
        await prisma.leaveBalance.update({
          where: { id: balance.id },
          data: {
            allocated: { increment: 1 },
            remaining: { increment: 1 },
          },
        });
        credited++;
      }
    }
  }

  res.json({ message: `EL accrual complete. ${credited} employees credited 1 EL for ${targetYear}-${String(targetMonth).padStart(2, '0')}.`, credited });
});


// ─── GET /api/leaves/types ───────────────────────────────────────────────────
router.get('/types', async (_req, res: Response): Promise<void> => {
  const types = await prisma.leaveType.findMany({ where: { isActive: true } });
  res.json(types);
});

// ─── POST /api/leaves/types ──────────────────────────────────────────────────
router.post('/types', requireRole(['Admin']),
  [body('name').trim().notEmpty(), body('daysAllowed').isInt({ min: 0 })],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }
    const { name, daysAllowed, description } = req.body as { name: string; daysAllowed: number; description?: string };
    const lt = await prisma.leaveType.create({ data: { name, daysAllowed, description } });
    res.status(201).json(lt);
  }
);

// ─── GET /api/leaves/balance (current user) ─────────────────────────────────
router.get('/balance', async (req: AuthRequest, res: Response): Promise<void> => {
  const emp = await prisma.employee.findFirst({ where: { userId: req.user!.id } });
  if (!emp) { res.json([]); return; }
  const year = new Date().getFullYear();
  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId: emp.id, year },
    include: { leaveType: { select: { name: true } } },
  });
  res.json(balances);
});

// ─── GET /api/leaves/balance/:employeeId ────────────────────────────────────
router.get('/balance/:employeeId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp || emp.id !== req.params.employeeId) { res.status(403).json({ message: 'Insufficient permissions' }); return; }
  }
  const year = new Date().getFullYear();
  const balances = await prisma.leaveBalance.findMany({
    where: { employeeId: req.params.employeeId, year },
    include: { leaveType: { select: { name: true } } },
  });
  res.json(balances);
});

// ─── GET /api/leaves ─────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.query as { status?: string };
  const where: { employeeId?: string; status?: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled' } = {};
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp) { res.status(404).json({ message: 'Employee profile not found' }); return; }
    where.employeeId = emp.id;
  }
  if (status) where.status = status as 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  const leaves = await prisma.leaveRequest.findMany({
    where,
    include: {
      leaveType: { select: { name: true } },
      employee: { include: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(leaves);
});

// ─── POST /api/leaves ────────────────────────────────────────────────────────
router.post('/', [
    body('leaveTypeId').notEmpty(), body('fromDate').isISO8601(),
    body('toDate').isISO8601(), body('reason').trim().isLength({ min: 5 }),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const emp = await prisma.employee.findFirst({ where: { userId: req.user?.id } });
    if (!emp) { res.status(404).json({ message: 'Employee profile not found' }); return; }

    const { leaveTypeId, fromDate, toDate, reason } = req.body as {
      leaveTypeId: string; fromDate: string; toDate: string; reason: string;
    };
    const from = new Date(fromDate); const to = new Date(toDate);
    if (from > to) { res.status(400).json({ message: 'fromDate must be before toDate' }); return; }
    const totalDays = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } });
    if (!leaveType) { res.status(404).json({ message: 'Leave type not found' }); return; }

    const year = from.getFullYear();
    let balance = await prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: emp.id, leaveTypeId, year } } });
    if (!balance) {
      balance = await prisma.leaveBalance.create({
        data: { employeeId: emp.id, leaveTypeId, year, allocated: leaveType.daysAllowed, used: 0, remaining: leaveType.daysAllowed },
      });
    }
    if (balance.remaining < totalDays) {
      res.status(400).json({ message: `Insufficient leave balance. Available: ${balance.remaining} day(s)` }); return;
    }

    const request = await prisma.leaveRequest.create({
      data: { employeeId: emp.id, leaveTypeId, fromDate: from, toDate: to, totalDays, reason },
    });
    res.status(201).json({ message: 'Leave request submitted', request });
  }
);

// ─── PUT /api/leaves/:id/review ──────────────────────────────────────────────
router.put('/:id/review', requireRole(['Admin', 'HR']),
  [body('status').isIn(['Approved', 'Rejected']), body('comment').optional().isString()],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!leave) { res.status(404).json({ message: 'Leave request not found' }); return; }
    if (leave.status !== 'Pending') { res.status(400).json({ message: 'Request already reviewed' }); return; }

    const { status, comment } = req.body as { status: 'Approved' | 'Rejected'; comment?: string };

    await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status, reviewedById: req.user?.id, reviewedAt: new Date(), ...(comment && { reviewComment: comment }) },
    });

    if (status === 'Approved') {
      const year = leave.fromDate.getFullYear();
      await prisma.leaveBalance.updateMany({
        where: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year },
        data: { used: { increment: leave.totalDays }, remaining: { decrement: leave.totalDays } },
      });
      const current = new Date(leave.fromDate);
      while (current <= leave.toDate) {
        const date = new Date(current); date.setUTCHours(0, 0, 0, 0);
        await prisma.attendanceLog.upsert({
          where: { employeeId_date: { employeeId: leave.employeeId, date } },
          update: { status: 'Leave' },
          create: { employeeId: leave.employeeId, date, status: 'Leave', source: 'leave' },
        });
        current.setDate(current.getDate() + 1);
      }
    }
    res.json({ message: `Leave ${status}` });
  }
);

// ─── DELETE /api/leaves/:id — cancel pending leave ──────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const leave = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
  if (!leave) { res.status(404).json({ message: 'Leave request not found' }); return; }
  if (req.user?.role === 'Employee') {
    const emp = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (!emp || emp.id !== leave.employeeId) { res.status(403).json({ message: 'Insufficient permissions' }); return; }
  }
  if (leave.status !== 'Pending') { res.status(400).json({ message: 'Can only cancel pending requests' }); return; }
  await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status: 'Cancelled' } });
  res.json({ message: 'Leave request cancelled' });
});

export default router;
