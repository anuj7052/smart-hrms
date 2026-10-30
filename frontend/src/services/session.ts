import type { User } from '../types';

export function readAccessToken(data: unknown): string {
  const token = (data as { accessToken?: unknown } | null)?.accessToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('The server did not return a valid session. Please try again.');
  }
  return token;
}

export function readSession(data: unknown): { accessToken: string; user: User } {
  const accessToken = readAccessToken(data);
  const user = (data as { user?: User }).user;
  if (!user?.id || !user.email || !['Admin', 'HR', 'Manager', 'Employee'].includes(user.role)) {
    throw new Error('The server did not return a valid user session. Please try again.');
  }
  return { accessToken, user };
}
