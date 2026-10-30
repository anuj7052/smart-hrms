/**
 * Local auth route — no database, users stored in src/config/local-users.json
 * Supports: login, me, logout, refresh
 */
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── Load users from local config ─────────────────────────────────────────────
interface LocalUser {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'HR' | 'Manager' | 'Employee';
  department?: string;
  passwordHash: string;
}

function loadUsers(): LocalUser[] {
  const p = path.join(__dirname, '../config/local-users.json');
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// In-memory refresh token store (cleared on server restart — fine for local dev)
const refreshTokens = new Map<string, string>(); // token → userId

const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET + '-refresh';

function generateAccess(user: LocalUser): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: (process.env.JWT_ACCESS_EXPIRY || '15m') as any }
  );
}

function generateRefresh(userId: string): string {
  const token = jwt.sign({ id: userId }, JWT_REFRESH_SECRET, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRY || '7d') as any,
  });
  refreshTokens.set(token, userId);
  return token;
}

// ─── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ message: 'Email and password are required' });
    return;
  }

  const users = loadUsers();
  // Accept the trainee "t-" alias in either direction (e.g. anuj.singh@… ↔ t-anuj.singh@…)
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  const local = at > 0 ? lower.slice(0, at) : lower;
  const domain = at > 0 ? lower.slice(at) : '';
  const aliases = new Set<string>([lower]);
  if (domain) {
    if (local.startsWith('t-')) aliases.add(local.slice(2) + domain);
    else aliases.add('t-' + local + domain);
  }
  const user = users.find((u) => aliases.has(u.email.toLowerCase()));
  if (!user) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const accessToken  = generateAccess(user);
  const refreshToken = generateRefresh(user.id);

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({
    accessToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, department: user.department },
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticateJWT, (req: AuthRequest, res: Response): void => {
  const users = loadUsers();
  const user = users.find((u) => u.id === req.user!.id);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req: Request, res: Response): void => {
  const token = req.cookies?.refreshToken;
  if (token) refreshTokens.delete(token);
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
});

// ─── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    res.status(400).json({ message: 'currentPassword and newPassword are required' });
    return;
  }
  if (newPassword.length < 3) {
    res.status(400).json({ message: 'New password must be at least 3 characters' });
    return;
  }

  const usersPath = path.join(__dirname, '../config/local-users.json');
  const users = loadUsers();
  const user = users.find((u) => u.id === req.user!.id);
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ message: 'Current password is incorrect' });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  user.passwordHash = newHash;
  fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));

  res.json({ message: 'Password changed successfully' });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', (req: Request, res: Response): void => {
  const token = req.cookies?.refreshToken;
  if (!token || !refreshTokens.has(token)) {
    res.status(401).json({ message: 'Invalid refresh token' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_REFRESH_SECRET) as { id: string };
    const users = loadUsers();
    const user = users.find((u) => u.id === payload.id);
    if (!user) {
      res.status(401).json({ message: 'User not found' });
      return;
    }
    const newAccess  = generateAccess(user);
    const newRefresh = generateRefresh(user.id);
    refreshTokens.delete(token);

    res.cookie('refreshToken', newRefresh, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    res.json({ accessToken: newAccess });
  } catch {
    refreshTokens.delete(token);
    res.status(401).json({ message: 'Refresh token expired' });
  }
});

export default router;
