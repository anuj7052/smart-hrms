import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

type UserRole = 'Admin' | 'HR' | 'Manager' | 'Employee';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
  };
}

export function authenticateJWT(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Access token required' });
    return;
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET || 'local-dev-secret';

  try {
    const payload = jwt.verify(token, secret) as { id: string; email: string; role: UserRole };
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired access token' });
  }
}

export function requireRole(roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
