import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { prisma, getCached, setCache } from '../lib/prisma';

const router = Router();
router.use(authenticateJWT);

// ─── GET /api/employees ──────────────────────────────────────────────────────
router.get('/', requireRole(['Admin', 'HR']), [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 1000 }),
    query('search').optional().isString(),
    query('department').optional().isString(),
    query('status').optional().isIn(['active', 'inactive', 'all']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const page = parseInt((req.query.page as string) || '1');
    const limit = parseInt((req.query.limit as string) || '20');
    const search = (req.query.search as string) || '';
    const department = (req.query.department as string) || '';
    const statusFilter = (req.query.status as string) || 'active';

    const where: { isActive?: boolean; department?: string; OR?: any[] } = {};
    if (statusFilter === 'active') where.isActive = true;
    else if (statusFilter === 'inactive') where.isActive = false;
    if (department) where.department = department;
    if (search) {
      where.OR = [
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { employeeId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rawEmployees] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        include: { user: { select: { id: true, name: true, email: true, role: true, department: true } } },
        skip: (page - 1) * limit, take: limit, orderBy: { user: { name: 'asc' } },
      }),
    ]);
    // Map `user` → `userId` for frontend compatibility
    const employees = rawEmployees.map((emp) => ({ ...emp, _id: emp.id, userId: emp.user }));
    res.json({ data: employees, total, page, limit, pages: Math.ceil(total / limit) });
  }
);

// ─── GET /api/employees/departments ─────────────────────────────────────────
router.get('/departments', requireRole(['Admin', 'HR']), async (_req, res: Response): Promise<void> => {
  const cacheKey = 'employees:departments';
  const cached = getCached<string[]>(cacheKey);
  if (cached) { res.json(cached); return; }
  const rows = await prisma.employee.findMany({ select: { department: true }, distinct: ['department'], orderBy: { department: 'asc' } }) as Array<{ department: string }>;
  const result = rows.map((r) => r.department);
  setCache(cacheKey, result, 120_000); // 2 min
  res.json(result);
});

// ─── GET /api/employees/profile ──────────────────────────────────────────────
router.get('/profile', async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findFirst({
    where: { userId: req.user!.id },
    include: { user: { select: { id: true, name: true, email: true, role: true, department: true } } },
  });
  if (!employee) { res.status(404).json({ message: 'Employee profile not found' }); return; }
  res.json({ ...employee, _id: employee.id, userId: employee.user });
});

// ─── GET /api/employees/:id ──────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, name: true, email: true, role: true, department: true } } },
  });
  if (!employee) { res.status(404).json({ message: 'Employee not found' }); return; }
  if (req.user?.role === 'Employee') {
    const own = await prisma.employee.findFirst({ where: { userId: req.user.id } });
    if (own?.id !== req.params.id) { res.status(403).json({ message: 'Insufficient permissions' }); return; }
  }
  res.json({ ...employee, _id: employee.id, userId: employee.user });
});

// ─── POST /api/employees ─────────────────────────────────────────────────────
router.post('/', requireRole(['Admin', 'HR']), [
    body('name').trim().notEmpty(), body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }), body('employeeId').trim().notEmpty(),
    body('department').trim().notEmpty(), body('designation').trim().notEmpty(),
    body('joinDate').isISO8601(),
    body('role').optional().isIn(['Admin', 'HR', 'Manager', 'Employee']),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return; }

    const { name, email, password, role = 'Employee', employeeId, department, designation, joinDate, shiftId, phone, birthday } = req.body as {
      name: string; email: string; password: string; role?: string;
      employeeId: string; department: string; designation: string;
      joinDate: string; shiftId?: string; phone?: string; birthday?: string;
    };

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) { res.status(409).json({ message: 'Email already registered' }); return; }
    const existingEmp = await prisma.employee.findUnique({ where: { employeeId } });
    if (existingEmp) { res.status(409).json({ message: 'Employee ID already exists' }); return; }

    const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: role as 'Admin' | 'HR' | 'Manager' | 'Employee', department, isEmailVerified: true },
    });
    const employee = await prisma.employee.create({
      data: { userId: user.id, employeeId, department, designation, ...(shiftId && { shiftId }), joinDate: new Date(joinDate), phone, ...(birthday && { birthday: new Date(birthday) }) },
    });
    res.status(201).json({ user: { id: user.id, name, email, role }, employee });
  }
);

// ─── PUT /api/employees/:id ──────────────────────────────────────────────────
router.put('/:id', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true } } } });
  if (!employee) { res.status(404).json({ message: 'Employee not found' }); return; }

  const { name, email, employeeId, department, designation, shiftId, phone, address, emergencyContact, joinDate, role, isActive, birthday, lastWorkingDate } = req.body as {
    name?: string; email?: string; employeeId?: string; department?: string; designation?: string; shiftId?: string | null;
    phone?: string; address?: string; emergencyContact?: string; joinDate?: string; role?: string; isActive?: boolean; birthday?: string | null; lastWorkingDate?: string | null;
  };

  // Only check uniqueness if email is actually being changed
  const normalizedEmail = email?.toLowerCase().trim();
  const emailChanged = normalizedEmail && normalizedEmail !== (employee as any).user.email;

  if (emailChanged) {
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, include: { employee: true } });
    if (existing && existing.id !== employee.userId) {
      if (!existing.employee) {
        // The target email belongs to an SSO-created user with no employee record.
        // Delete that orphan user and proceed with the email change.
        await prisma.user.delete({ where: { id: existing.id } });
      } else {
        res.status(409).json({ message: 'Email already in use by another employee' });
        return;
      }
    }
  }

  // Only check uniqueness if employeeId is actually being changed
  const trimmedEmployeeId = employeeId?.trim();
  const employeeIdChanged = trimmedEmployeeId && trimmedEmployeeId !== employee.employeeId;

  if (employeeIdChanged) {
    const existingEmp = await prisma.employee.findUnique({ where: { employeeId: trimmedEmployeeId } });
    if (existingEmp && existingEmp.id !== employee.id) {
      res.status(409).json({ message: 'Employee ID already in use by another employee' });
      return;
    }
  }

  if (name || department || role || emailChanged) {
    await prisma.user.update({
      where: { id: employee.userId },
      data: { ...(name && { name }), ...(emailChanged && { email: normalizedEmail }), ...(department && { department }), ...(role && { role: role as 'Admin' | 'HR' | 'Manager' | 'Employee' }) },
    });
  }
  await prisma.employee.update({
    where: { id: req.params.id },
    data: {
      ...(employeeIdChanged && { employeeId: trimmedEmployeeId }),
      ...(department && { department }), ...(designation && { designation }),
      ...(shiftId !== undefined && { shiftId: shiftId || null }),
      ...(phone !== undefined && { phone }), ...(address !== undefined && { address }),
      ...(emergencyContact !== undefined && { emergencyContact }),
      ...(joinDate && { joinDate: new Date(joinDate) }),
      ...(isActive !== undefined && { isActive }),
      ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
      ...(lastWorkingDate !== undefined && { lastWorkingDate: lastWorkingDate ? new Date(lastWorkingDate) : null }),
    },
  });
  res.json({ message: 'Employee updated' });
});

// ─── DELETE /api/employees/:id — permanent hard delete (Admin only) ────────────────────────
router.delete('/:id', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
  if (!employee) { res.status(404).json({ message: 'Employee not found' }); return; }
  // Deleting the User cascades to Employee and all related records
  await prisma.user.delete({ where: { id: employee.userId } });
  res.json({ message: 'Employee permanently deleted' });
});

export default router;
