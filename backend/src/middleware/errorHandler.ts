import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('[Error]', err.message);
  const status = (err as { status?: number }).status || 500;
  res.status(status).json({
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}
