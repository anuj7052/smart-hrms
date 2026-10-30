import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

// ─── Permission definitions per role ──────────────────────────────────────────
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  Admin: [
    'view:dashboard',
    'view:attendance',
    'view:attendance:all',
    'view:leaves',
    'view:leaves:all',
    'view:employees',
    'manage:employees',
    'view:devices',
    'manage:devices',
    'view:reports',
    'view:settings',
    'manage:settings',
    'view:approvals',
    'manage:approvals',
    'view:wfh',
    'manage:wfh',
    'view:essl:live',
    'manage:essl',
  ],
  HR: [
    'view:dashboard',
    'view:attendance',
    'view:attendance:all',
    'view:leaves',
    'view:leaves:all',
    'view:employees',
    'manage:employees',
    'view:devices',
    'view:reports',
    'view:approvals',
    'manage:approvals',
    'view:wfh',
    'manage:wfh',
    'view:essl:live',
  ],
  Manager: [
    'view:dashboard',
    'view:attendance',
    'view:attendance:team',
    'view:leaves',
    'view:leaves:team',
    'view:approvals',
    'manage:approvals:team',
    'view:wfh',
    'manage:wfh:team',
  ],
  Employee: [
    'view:dashboard',
    'view:attendance',
    'view:leaves',
    'view:wfh',
    'punch:attendance',
  ],
};

// ─── Role display config ───────────────────────────────────────────────────────
export const ROLE_CONFIG: Record<UserRole, { label: string; color: string; bg: string; border: string }> = {
  Admin:    { label: 'Admin',    color: '#F59E0B', bg: 'bg-amber-50',    border: 'border-amber-200' },
  HR:       { label: 'HR',      color: '#2E5A9E', bg: 'bg-blue-50',       border: 'border-blue-200' },
  Manager:  { label: 'Manager', color: '#16A34A', bg: 'bg-green-50',    border: 'border-green-200' },
  Employee: { label: 'Employee',color: '#64748B', bg: 'bg-slate-50',    border: 'border-slate-200' },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function usePermissions() {
  const { user } = useAuth();

  function can(permission: string): boolean {
    if (!user) return false;
    return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
  }

  function canAny(...permissions: string[]): boolean {
    return permissions.some((p) => can(p));
  }

  function canAll(...permissions: string[]): boolean {
    return permissions.every((p) => can(p));
  }

  function hasRole(...roles: UserRole[]): boolean {
    return !!(user && roles.includes(user.role));
  }

  const isAdmin    = hasRole('Admin');
  const isHR       = hasRole('HR');
  const isManager  = hasRole('Manager');
  const isEmployee = hasRole('Employee');
  const isAdminOrHR = hasRole('Admin', 'HR');

  return {
    can,
    canAny,
    canAll,
    hasRole,
    isAdmin,
    isHR,
    isManager,
    isEmployee,
    isAdminOrHR,
    role: user?.role,
    roleConfig: user ? ROLE_CONFIG[user.role] : null,
  };
}
