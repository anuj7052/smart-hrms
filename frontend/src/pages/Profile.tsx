import { useState, useEffect, useCallback } from 'react';
import { Mail, Building2, Phone, Calendar, Shield, Briefcase, Hash } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import type { Employee, LeaveBalance } from '../types';
import { SkeletonProfileHero, SkeletonInfoTile } from '../components/Skeletons';
import { formatDateIST } from '../lib/datetime';

export default function ProfilePage() {
  const { user } = useAuth();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loadingEmp, setLoadingEmp] = useState(true);

  const fetchProfile = useCallback(async () => {
    setLoadingEmp(true);
    try {
      const res = await api.get<Employee>('/employees/profile');
      setEmployee(res.data);
      try {
        const balRes = await api.get<LeaveBalance[]>(`/leaves/balance/${res.data._id}`);
        setBalances(balRes.data);
      } catch {
        // Employee may not have leave data set up yet
      }
    } catch {
      // Admin/HR may not have an employee profile
    } finally {
      setLoadingEmp(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const initials =
    user?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?';

  const roleClass =
    user?.role === 'Admin'
      ? 'role-admin'
      : user?.role === 'HR'
        ? 'role-hr'
        : user?.role === 'Manager'
          ? 'role-manager'
          : 'role-employee';

  if (loadingEmp && !employee) {
    return (
      <div className="pb-20 lg:pb-0">
        <SkeletonProfileHero />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
          <SkeletonInfoTile />
          <SkeletonInfoTile />
          <SkeletonInfoTile />
          <SkeletonInfoTile />
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 lg:pb-0">
      {/* Hero header — full width */}
      <div className="hero-header rounded-[28px] p-8 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9InAiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMS41IiBmaWxsPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMDUpIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCBmaWxsPSJ1cmwoI3ApIiB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIi8+PC9zdmc+')] opacity-50" />
        <div className="relative flex items-center gap-5">
          <div className="w-20 h-20 rounded-[22px] bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-lg">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white truncate">{user?.name}</h1>
            {loadingEmp ? (
              <div className="h-4 w-40 rounded-lg bg-white/10 animate-pulse mt-2" />
            ) : (
              employee && (
                <p className="text-white/70 text-sm mt-1">{employee.designation}</p>
              )
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className={roleClass}>{user?.role}</span>
              {employee && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-white/10 text-white/90 backdrop-blur-sm border border-white/20">
                  {employee.employeeId}
                </span>
              )}
              {employee && (
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold backdrop-blur-sm border ${
                    employee.isActive
                      ? 'bg-green-400/15 text-green-300 border-green-400/30'
                      : 'bg-red-400/15 text-red-300 border-red-400/30'
                  }`}
                >
                  {employee.isActive ? 'Active' : 'Inactive'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info tiles + leave balances */}
      <div className="space-y-6">
        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <InfoTile icon={Mail} label="Email" value={user?.email || '—'} />
            {employee?.phone && <InfoTile icon={Phone} label="Phone" value={employee.phone} />}
            {(employee?.department || user?.department) && (
              <InfoTile
                icon={Building2}
                label="Department"
                value={employee?.department || user?.department || '—'}
              />
            )}
            {employee?.designation && (
              <InfoTile icon={Briefcase} label="Designation" value={employee.designation} />
            )}
            {employee?.joinDate && (
              <InfoTile
                icon={Calendar}
                label="Joined"
                value={formatDateIST(employee.joinDate, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              />
            )}
            {employee?.shift && <InfoTile icon={Shield} label="Shift" value={employee.shift} />}
            {employee?.employeeId && (
              <InfoTile icon={Hash} label="Employee ID" value={employee.employeeId} />
            )}
          </div>

          {/* Leave balances */}
          {balances.length > 0 && (
            <div className="card p-6">
              <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-primary-100 flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-primary-600" />
                </div>
                Leave Balance
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {balances.map((b) => {
                  const pct = b.allocated > 0 ? ((b.remaining / b.allocated) * 100) : 0;
                  return (
                    <div key={b._id} className="relative rounded-2xl border border-primary/5 bg-gray-50/80 p-4 overflow-hidden group hover:border-primary/15 transition-colors">
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-200 rounded-b-2xl">
                        <div
                          className="h-full bg-primary-500 rounded-b-2xl transition-all duration-500"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs font-medium text-gray-500 mb-2 truncate">
                        {b.leaveTypeId.name}
                      </p>
                      <p className="text-2xl font-black text-gray-900 leading-none">
                        {b.remaining}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-1">
                        of {b.allocated} days
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────────── */

function InfoTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="card p-4 flex items-center gap-4 group hover:border-primary/20 transition-colors">
      <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0 group-hover:bg-primary-100:bg-primary-900/50 transition-colors">
        <Icon className="w-[18px] h-[18px] text-primary-600" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-gray-400">{label}</p>
        <p className="text-sm font-semibold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}


