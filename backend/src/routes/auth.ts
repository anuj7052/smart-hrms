import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../lib/prisma';
import { sendEmail } from '../services/emailService';
import { authenticateJWT, AuthRequest } from '../middleware/auth';

const router = Router();

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

function generateAccessToken(id: string, email: string, role: string): string {
  return jwt.sign({ id, email, role }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m',
  } as jwt.SignOptions);
}

function generateRefreshToken(id: string): string {
  return jwt.sign({ id }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
  } as jwt.SignOptions);
}

// Refresh-token cookie options.
// In production the frontend (Vercel) and backend (Azure) live on different
// origins, so the cookie must be SameSite=None + Secure for the browser to
// send it on the cross-site POST /api/auth/refresh request. Without this the
// refresh fails with 401 and the user is force-logged-out the moment the
// 15-minute access token expires.
function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth',
  };
}

async function getAllowedDomains(): Promise<string[]> {
  // Read from env var; no DB dependency
  const envDomains = process.env.ALLOWED_EMAIL_DOMAINS || '';
  return envDomains.split(',').map((d) => d.trim()).filter(Boolean);
}

function isDomainAllowed(email: string, allowed: string[]): boolean {
  if (!allowed.length) return true; // no restriction configured
  const domain = email.split('@')[1]?.toLowerCase();
  return allowed.some((d) => d.toLowerCase() === domain);
}

// Trainee accounts are stored with a "t-" prefix on the local part
// (e.g. t-anuj.singh@foetron.com). Allow login with either the prefixed
// or unprefixed form so users don't have to remember the alias.
function emailAliases(email: string): string[] {
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at <= 0) return [lower];
  const local = lower.slice(0, at);
  const domain = lower.slice(at);
  const set = new Set<string>([lower]);
  if (local.startsWith('t-')) set.add(local.slice(2) + domain);
  else set.add('t-' + local + domain);
  return Array.from(set);
}

function readStringClaim(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ─── POST /api/auth/register ────────────────────────────────────────────────
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['Admin', 'HR', 'Employee']),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, email, password, role = 'Employee', department } = req.body as {
      name: string;
      email: string;
      password: string;
      role?: string;
      department?: string;
    };

    const allowedDomains = await getAllowedDomains();
    if (!isDomainAllowed(email, allowedDomains)) {
      res.status(400).json({ message: `Registration is restricted to company email domains: ${allowedDomains.join(', ')}` });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ message: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: (role as any) || 'Employee',
        department,
        emailVerificationToken: verificationToken,
        emailVerificationExpiry: verificationExpiry,
      },
    });

    const verifyUrl = `${process.env.CLIENT_URL}/verify-email?token=${verificationToken}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Verify your HRMS account',
        html: `<p>Hi ${name},</p><p>Please verify your email: <a href="${verifyUrl}">Click here</a></p><p>Link expires in 24 hours.</p>`,
      });
    } catch (emailErr) {
      console.warn('[Auth] Email send failed (non-fatal):', (emailErr as Error).message);
    }

    res.status(201).json({
      message: 'Registration successful. Please check your email to verify your account.',
      userId: user.id,
    });
  }
);

// ─── POST /api/auth/verify-email ─────────────────────────────────────────────
router.post(
  '/verify-email',
  [body('token').notEmpty().withMessage('Token required')],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { token } = req.body as { token: string };
    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        emailVerificationExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      res.status(400).json({ message: 'Invalid or expired verification token' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpiry: null,
      },
    });

    res.json({ message: 'Email verified successfully. You can now log in.' });
  }
);

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password } = req.body as { email: string; password: string };

    const candidates = emailAliases(email);
    const user = await prisma.user.findFirst({ where: { email: { in: candidates } } });
    if (!user) {
      console.warn(`[Auth] Login failed — user not found: ${email} (tried ${candidates.join(', ')})`);
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      console.warn(`[Auth] Login failed — wrong password for: ${email}`);
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    // Auto-verify on first successful login (no SMTP configured in dev)
    if (!user.isEmailVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isEmailVerified: true, emailVerificationToken: null, emailVerificationExpiry: null },
      });
    }

    const accessToken = generateAccessToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    res
      .cookie('refreshToken', refreshToken, refreshCookieOptions())
      .json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        },
      });
  }
);

// ─── POST /api/auth/microsoft ───────────────────────────────────────────────
// Verifies a Microsoft (Azure AD) ID token, links it to an existing Sphere user
// on first login, then signs in through that stable Entra object id afterwards.
const MS_TENANT = process.env.AZURE_AD_TENANT_ID || 'common';
const MS_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID || '';
const msJwks = MS_CLIENT_ID
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${MS_TENANT}/discovery/v2.0/keys`))
  : null;

router.post('/microsoft', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      res.status(400).json({ message: 'idToken required' });
      return;
    }
    if (!MS_CLIENT_ID || !msJwks) {
      res.status(500).json({ message: 'Microsoft login not configured on server (AZURE_AD_CLIENT_ID missing)' });
      return;
    }

    const issuers = [
      `https://login.microsoftonline.com/${MS_TENANT}/v2.0`,
      `https://sts.windows.net/${MS_TENANT}/`,
    ];

    const { payload } = await jwtVerify(idToken, msJwks, {
      audience: MS_CLIENT_ID,
      issuer: issuers,
    });

    const entraObjectId = readStringClaim(payload.oid);
    const entraTenantId = readStringClaim(payload.tid) ?? null;
    const email = readStringClaim(payload.email) || readStringClaim(payload.preferred_username) || readStringClaim(payload.upn);
    const name = (payload.name as string | undefined) || (email ? email.split('@')[0] : 'User');

    if (!entraObjectId) {
      res.status(400).json({ message: 'Microsoft token did not contain an Entra object id (oid)' });
      return;
    }

    if (!email) {
      res.status(400).json({ message: 'Microsoft token did not contain an email/UPN' });
      return;
    }

    const lowerEmail = email.toLowerCase().trim();
    const allowedDomains = await getAllowedDomains();
    if (!isDomainAllowed(lowerEmail, allowedDomains)) {
      res.status(403).json({ message: `Email domain not allowed. Allowed: ${allowedDomains.join(', ')}` });
      return;
    }

    let user = await prisma.user.findUnique({ where: { entraObjectId } });
    if (!user) {
      user = await prisma.user.findUnique({ where: { email: lowerEmail } });
    }

    if (!user) {
      res.status(403).json({
        message: 'This Microsoft account is not linked to a Sphere employee yet. Ask HR/Admin to add the employee with the same work email, then sign in again.',
      });
      return;
    }

    const updateData: {
      name: string;
      isEmailVerified: boolean;
      entraObjectId: string;
      entraTenantId: string | null;
      email?: string;
    } = {
      name,
      isEmailVerified: true,
      entraObjectId,
      entraTenantId,
    };

    if (user.email !== lowerEmail) {
      const existingEmailUser = await prisma.user.findUnique({ where: { email: lowerEmail } });
      if (!existingEmailUser || existingEmailUser.id === user.id) {
        updateData.email = lowerEmail;
      }
    }

    user = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    const accessToken = generateAccessToken(user.id, user.email, user.role);
    const refreshToken = generateRefreshToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });

    res
      .cookie('refreshToken', refreshToken, refreshCookieOptions())
      .json({
        accessToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        },
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Microsoft sign-in failed';
    res.status(401).json({ message: `Microsoft sign-in failed: ${msg}` });
  }
});
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) {
    res.status(401).json({ message: 'Refresh token missing' });
    return;
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { id: string };
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || user.refreshToken !== token) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    const accessToken = generateAccessToken(user.id, user.email, user.role);
    res.json({ accessToken });
  } catch {
    res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
router.post('/logout', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.id) {
    await prisma.user.update({ where: { id: req.user.id }, data: { refreshToken: null } }).catch(() => {});
  }
  const { maxAge: _maxAge, ...clearOpts } = refreshCookieOptions();
  void _maxAge;
  res
    .clearCookie('refreshToken', clearOpts)
    .json({ message: 'Logged out successfully' });
});

// ─── POST /api/auth/forgot-password ─────────────────────────────────────────
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body as { email: string };
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond success to prevent user enumeration
    if (!user) {
      res.json({ message: 'If that email exists, a reset link has been sent.' });
      return;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1h
      },
    });

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    try {
      await sendEmail({
        to: email,
        subject: 'HRMS Password Reset',
        html: `<p>Reset your password: <a href="${resetUrl}">Click here</a></p><p>Link expires in 1 hour.</p>`,
      });
    } catch (emailErr) {
      console.warn('[Auth] Reset email failed (non-fatal):', (emailErr as Error).message);
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  }
);

// ─── POST /api/auth/reset-password ──────────────────────────────────────────
router.post(
  '/reset-password',
  [
    body('token').notEmpty(),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req: Request, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { token, password } = req.body as { token: string; password: string };
    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken: token,
        passwordResetExpiry: { gt: new Date() },
      },
    });

    if (!user) {
      res.status(400).json({ message: 'Invalid or expired reset token' });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        passwordResetToken: null,
        passwordResetExpiry: null,
        refreshToken: null,
      },
    });

    res.json({ message: 'Password reset successful. Please log in.' });
  }
);

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    isEmailVerified: user.isEmailVerified,
  });
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post(
  '/change-password',
  authenticateJWT,
  [
    body('currentPassword').notEmpty().withMessage('Current password required'),
    body('newPassword')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters'),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }
    const { currentPassword, newPassword } = req.body as {
      currentPassword: string;
      newPassword: string;
    };
    const user = await prisma.user.findUnique({ where: { id: req.user?.id } });
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ message: 'Current password is incorrect' });
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
    });
    res.json({ message: 'Password updated successfully' });
  }
);

export default router;
