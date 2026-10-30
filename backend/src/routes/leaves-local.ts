/**
 * /api/leaves — Local mode with in-memory storage.
 * Leaves are stored in memory and reset on server restart.
 *
 * GET    /api/leaves              → list leaves
 * GET    /api/leaves/types        → leave types
 * GET    /api/leaves/balance      → current user's leave balance
 * GET    /api/leaves/balance/:id  → leave balance for specific employee
 * POST   /api/leaves              → apply for leave
 * PUT    /api/leaves/:id/review   → approve/reject (Admin/HR/Manager)
 * DELETE /api/leaves/:id          → cancel own leave
 * GET    /api/leaves/:id          → single leave
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const LEAVE_TYPES = [
  { _id: 'lt_cl', name: 'Casual Leave', days: 12, daysAllowed: 12, carryForward: false },
  { _id: 'lt_sl', name: 'Sick Leave', days: 7, daysAllowed: 7, carryForward: false },
  { _id: 'lt_el', name: 'Earned Leave', days: 15, daysAllowed: 15, carryForward: true },
  { _id: 'lt_ml', name: 'Maternity Leave', days: 90, daysAllowed: 90, carryForward: false },
  { _id: 'lt_lop', name: 'Loss of Pay', days: 365, daysAllowed: 365, carryForward: false },
  { _id: 'lt_event', name: 'Event Leave', days: 0, daysAllowed: 0, isUnlimited: true, carryForward: false },
  { _id: 'lt_client_visit', name: 'Client Visit Leave', days: 0, daysAllowed: 0, isUnlimited: true, carryForward: false },
];

// ─── In-memory leave store ────────────────────────────────────────────────────
interface StoredLeave {
  _id: string;
  employeeId: string;     // employee _id
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';
  reviewComment?: string;
  createdAt: string;
}
const leaveStore: StoredLeave[] = [];
let leaveSeq = 1;

const EMPLOYEES_PATH = path.join(__dirname, '../config/local-employees.json');
function loadEmployees() {
  try {
    return JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8')) as Array<{
      _id: string; userId: { _id: string; name: string; email: string }; employeeId: string;
    }>;
  } catch { return []; }
}

function findEmployeeByUser(userId: string, email: string) {
  const emps = loadEmployees();
  return emps.find((e) => e.userId._id === userId || e.userId.email === email);
}

function calcDays(from: string, to: string): number {
  const start = new Date(from);
  const end = new Date(to);
  let days = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) days++;
    d.setDate(d.getDate() + 1);
  }
  return Math.max(days, 1);
}

function formatLeave(leave: StoredLeave) {
  const lt = LEAVE_TYPES.find((t) => t._id === leave.leaveTypeId) || { _id: leave.leaveTypeId, name: 'Unknown' };
  return {
    _id: leave._id,
    employeeId: {
      _id: leave.employeeId,
      employeeId: leave.employeeCode,
      userId: { name: leave.employeeName, email: '' },
    },
    leaveTypeId: { _id: lt._id, name: lt.name },
    fromDate: leave.fromDate,
    toDate: leave.toDate,
    totalDays: leave.totalDays,
    reason: leave.reason,
    status: leave.status,
    reviewComment: leave.reviewComment,
    createdAt: leave.createdAt,
  };
}

function getBalances(empId: string) {
  const usable = LEAVE_TYPES.filter((lt) => !['lt_ml', 'lt_lop'].includes(lt._id));
  return usable.map((lt) => {
    const used = leaveStore.filter(
      (l) => l.employeeId === empId && l.leaveTypeId === lt._id && (l.status === 'Approved' || l.status === 'Pending'),
    ).reduce((sum, l) => sum + l.totalDays, 0);
    return {
      _id: `bal_${empId}_${lt._id}`,
      leaveTypeId: { _id: lt._id, name: lt.name, daysAllowed: lt.days, isUnlimited: lt.isUnlimited ?? false },
      allocated: lt.days,
      used,
      remaining: Math.max(lt.days - used, 0),
    };
  });
}

// ─── GET /api/leaves ──────────────────────────────────────────────────────────
router.get('/', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const { status } = req.query as { status?: string };
  const isAdminOrHR = req.user?.role === 'Admin' || req.user?.role === 'HR' || req.user?.role === 'Manager';

  let results = [...leaveStore];

  // Employees only see their own leaves
  if (!isAdminOrHR) {
    const emp = findEmployeeByUser(req.user!.id, req.user!.email);
    if (emp) {
      results = results.filter((l) => l.employeeId === emp._id);
    } else {
      results = [];
    }
  }

  if (status) {
    results = results.filter((l) => l.status === status);
  }

  // Sort by createdAt desc
  results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(results.map(formatLeave));
});

// ─── GET /api/leaves/types ────────────────────────────────────────────────────
router.get('/types', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  res.json(LEAVE_TYPES);
});

// ─── GET /api/leaves/balance ──────────────────────────────────────────────────
router.get('/balance', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const emp = findEmployeeByUser(req.user!.id, req.user!.email);
  res.json(getBalances(emp?._id || ''));
});

// ─── GET /api/leaves/balance/:employeeId ─────────────────────────────────────
router.get('/balance/:employeeId', authenticateJWT, (req: AuthRequest, res: Response): void => {
  res.json(getBalances(req.params.employeeId));
});

// ─── POST /api/leaves ─────────────────────────────────────────────────────────
router.post('/', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const { leaveTypeId, fromDate, toDate, reason } = req.body as {
    leaveTypeId?: string; fromDate?: string; toDate?: string; reason?: string;
  };

  if (!leaveTypeId || !fromDate || !toDate || !reason) {
    res.status(400).json({ message: 'leaveTypeId, fromDate, toDate, and reason are required' });
    return;
  }

  const lt = LEAVE_TYPES.find((t) => t._id === leaveTypeId);
  if (!lt) {
    res.status(400).json({ message: 'Invalid leave type' });
    return;
  }

  const emp = findEmployeeByUser(req.user!.id, req.user!.email);
  if (!emp) {
    res.status(404).json({ message: 'Employee profile not found. Cannot apply for leave.' });
    return;
  }

  const totalDays = calcDays(fromDate, toDate);

  const leave: StoredLeave = {
    _id: `leave_${leaveSeq++}`,
    employeeId: emp._id,
    employeeName: emp.userId.name,
    employeeCode: emp.employeeId,
    leaveTypeId,
    fromDate,
    toDate,
    totalDays,
    reason,
    status: 'Pending',
    createdAt: new Date().toISOString(),
  };

  leaveStore.push(leave);
  res.status(201).json(formatLeave(leave));
});

// ─── PUT /api/leaves/:id/review ───────────────────────────────────────────────
router.put('/:id/review', authenticateJWT, requireRole(['Admin', 'HR', 'Manager']), (req: AuthRequest, res: Response): void => {
  const leave = leaveStore.find((l) => l._id === req.params.id);
  if (!leave) {
    res.status(404).json({ message: 'Leave not found' });
    return;
  }

  const { status, comment } = req.body as { status?: string; comment?: string };
  if (!status || !['Approved', 'Rejected'].includes(status)) {
    res.status(400).json({ message: 'status must be Approved or Rejected' });
    return;
  }

  leave.status = status as 'Approved' | 'Rejected';
  if (comment) leave.reviewComment = comment;

  res.json(formatLeave(leave));
});

// ─── DELETE /api/leaves/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const idx = leaveStore.findIndex((l) => l._id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: 'Leave not found' });
    return;
  }

  const leave = leaveStore[idx];

  // Employees can only cancel their own pending leaves
  if (req.user?.role === 'Employee') {
    const emp = findEmployeeByUser(req.user.id, req.user.email);
    if (!emp || leave.employeeId !== emp._id) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    if (leave.status !== 'Pending') {
      res.status(400).json({ message: 'Can only cancel pending leaves' });
      return;
    }
  }

  leave.status = 'Cancelled';
  res.json({ message: 'Leave cancelled' });
});

// ─── GET /api/leaves/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const leave = leaveStore.find((l) => l._id === req.params.id);
  if (!leave) {
    res.status(404).json({ message: 'Leave not found' });
    return;
  }
  res.json(formatLeave(leave));
});

export default router;
