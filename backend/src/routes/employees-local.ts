/**
 * /api/employees — Local mode (no database).
 * Employee data stored in src/config/local-employees.json
 *
 * GET    /api/employees            → paginated list with search/filter
 * GET    /api/employees/departments → distinct department list
 * GET    /api/employees/:id        → single employee
 * POST   /api/employees            → create employee (Admin/HR only)
 * PUT    /api/employees/:id        → update employee (Admin/HR only)
 * DELETE /api/employees/:id        → delete employee (Admin only)
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();
const EMPLOYEES_PATH = path.join(__dirname, '../config/local-employees.json');

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

function loadEmployees(): LocalEmployee[] {
  try {
    return JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveEmployees(employees: LocalEmployee[]): void {
  fs.writeFileSync(EMPLOYEES_PATH, JSON.stringify(employees, null, 2));
}

function generateId(): string {
  return 'emp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── GET /api/employees ───────────────────────────────────────────────────────
router.get('/', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const { page = '1', limit = '15', search = '', status, department } = req.query as Record<string, string>;

  let employees = loadEmployees();

  // Regular employees can only see their own record
  if (req.user?.role === 'Employee') {
    employees = employees.filter((e) => e.userId._id === req.user!.id || e.userId.email === req.user!.email);
  }

  // Filter by status
  if (status === 'active') employees = employees.filter((e) => e.isActive);
  else if (status === 'inactive') employees = employees.filter((e) => !e.isActive);

  // Filter by department
  if (department) {
    employees = employees.filter((e) => e.department.toLowerCase() === department.toLowerCase());
  }

  // Search by name, email, employeeId, department
  if (search) {
    const q = search.toLowerCase();
    employees = employees.filter((e) =>
      e.userId.name.toLowerCase().includes(q) ||
      e.userId.email.toLowerCase().includes(q) ||
      e.employeeId.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q) ||
      e.designation.toLowerCase().includes(q),
    );
  }

  const total = employees.length;
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.max(1, parseInt(limit));
  const pages = Math.ceil(total / limitNum);
  const data = employees.slice((pageNum - 1) * limitNum, pageNum * limitNum);

  res.json({ data, total, page: pageNum, pages, limit: limitNum });
});

// ─── GET /api/employees/departments ──────────────────────────────────────────
router.get('/departments', authenticateJWT, (_req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const depts = [...new Set(employees.map((e) => e.department).filter(Boolean))].sort();
  res.json(depts);
});

// ─── GET /api/employees/profile ──────────────────────────────────────────────
router.get('/profile', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const emp = employees.find(
    (e) => e.userId._id === req.user!.id || e.userId.email === req.user!.email,
  );
  if (!emp) {
    res.status(404).json({ message: 'Employee profile not found' });
    return;
  }
  res.json(emp);
});

// ─── GET /api/employees/:id ───────────────────────────────────────────────────
router.get('/:id', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const emp = employees.find((e) => e._id === req.params.id);
  if (!emp) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }
  res.json(emp);
});

// ─── POST /api/employees ──────────────────────────────────────────────────────
router.post('/', authenticateJWT, requireRole(['Admin', 'HR']), (req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const { name, email, role, employeeId, department, designation, joinDate, shift, phone } = req.body as {
    name: string; email: string; role: string; employeeId: string;
    department: string; designation: string; joinDate: string; shift?: string; phone?: string;
  };

  if (!name || !email || !employeeId || !department) {
    res.status(400).json({ message: 'name, email, employeeId, and department are required' });
    return;
  }

  // Check for duplicate employeeId or email
  if (employees.some((e) => e.employeeId === employeeId)) {
    res.status(400).json({ message: `Employee ID '${employeeId}' already exists` });
    return;
  }
  if (employees.some((e) => e.userId.email.toLowerCase() === email.toLowerCase())) {
    res.status(400).json({ message: `Email '${email}' already registered` });
    return;
  }

  const id = generateId();
  const newEmployee: LocalEmployee = {
    _id: id,
    userId: { _id: 'usr_' + id, name, email, role: role || 'Employee' },
    employeeId,
    department,
    designation: designation || '',
    shift: shift || 'General',
    joinDate: joinDate ? new Date(joinDate).toISOString() : new Date().toISOString(),
    phone: phone || '',
    isActive: true,
  };

  employees.push(newEmployee);
  saveEmployees(employees);
  res.status(201).json(newEmployee);
});

// ─── PUT /api/employees/:id ───────────────────────────────────────────────────
router.put('/:id', authenticateJWT, requireRole(['Admin', 'HR']), (req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const idx = employees.findIndex((e) => e._id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }

  const { name, email, role, employeeId, department, designation, joinDate, shift, phone, isActive } = req.body as {
    name?: string; email?: string; role?: string; employeeId?: string;
    department?: string; designation?: string; joinDate?: string; shift?: string;
    phone?: string; isActive?: boolean;
  };

  const emp = employees[idx];
  if (name) emp.userId.name = name;
  if (email) emp.userId.email = email;
  if (role) emp.userId.role = role;
  if (employeeId) emp.employeeId = employeeId;
  if (department) emp.department = department;
  if (designation !== undefined) emp.designation = designation;
  if (shift) emp.shift = shift;
  if (joinDate) emp.joinDate = new Date(joinDate).toISOString();
  if (phone !== undefined) emp.phone = phone;
  if (isActive !== undefined) emp.isActive = isActive;

  employees[idx] = emp;
  saveEmployees(employees);
  res.json(emp);
});

// ─── DELETE /api/employees/:id ────────────────────────────────────────────────
router.delete('/:id', authenticateJWT, requireRole(['Admin']), (req: AuthRequest, res: Response): void => {
  const employees = loadEmployees();
  const idx = employees.findIndex((e) => e._id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: 'Employee not found' });
    return;
  }
  employees.splice(idx, 1);
  saveEmployees(employees);
  res.json({ message: 'Employee deleted' });
});

export default router;
