import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Clock, Loader2, X,
  RefreshCw, Search, CalendarDays,
  CheckCircle, AlertCircle, XCircle, MinusCircle, CalendarCheck,
  ChevronDown, ChevronUp, Fingerprint, LogIn, LogOut, BarChart3,
  PlusCircle, MapPin
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { AttendanceLog, Employee, AttendanceStatus, PunchLog, AppSettings } from '../types';
import AttendanceSummaryModal from '../components/AttendanceSummaryModal';

// ─── Constants ──────────────────────────────────────────────────────────────

// ── Location helpers ─────────────────────────────────────────────────────────
function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
function LocationBadge({ lat, lng, address, label }: { lat?: number | null; lng?: number | null; address?: string | null; label: string }) {
  if (lat == null || lng == null) return null;
  const display = address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return (
    <a
      href={mapsUrl(lat, lng)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 hover:underline mt-1"
      title={`${label}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
    >
      <MapPin className="w-3 h-3 shrink-0" />
      {display}
    </a>
  );
}

const STATUS_DOT: Record<AttendanceStatus, string> = {
  Present: 'bg-success-500',  Late: 'bg-accent-500',
  Absent: 'bg-danger-500',    HalfDay: 'bg-yellow-400',
  Leave: 'bg-danger-500',     Holiday: 'bg-gray-400',  WeeklyOff: 'bg-purple-400',
};
const STATUS_TILE: Record<AttendanceStatus, string> = {
  Present: 'bg-success-500/15 text-success-600',
  Late: 'bg-accent-500/15 text-amber-600',
  Absent: 'bg-danger-500/15 text-danger-500',
  HalfDay: 'bg-yellow-500/15 text-yellow-600',
  Leave: 'bg-danger-500/15 text-danger-500',
  Holiday: 'bg-gray-200/80 text-gray-500',
  WeeklyOff: 'bg-purple-500/15 text-purple-600',
};
const MODE_COLORS: Record<string, string> = {
  Office: 'bg-blue-100 text-blue-700',
  WFH: 'bg-green-100 text-green-700',
  Field: 'bg-orange-100 text-orange-700',
  ClientVisit: 'bg-purple-100 text-purple-700',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(iso?: string | null) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
function formatTimeShort(iso?: string | null) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
function getDateOnlyDay(iso: string): number {
  return new Date(iso).getUTCDate();
}
function formatDateOnly(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleDateString('en-IN', { ...options, timeZone: 'UTC' });
}
function makeUTCDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}
function getISTMinutes(iso?: string | null): number | null {
  if (!iso) return null;
  const parts = new Date(iso).toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const [h, m] = parts.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
// Returns the genuine checkout time for a day:
//   • If the LAST punch overall is an OUT  → its timestamp
//   • If the last punch is an IN (employee returned from break and is still
//     working)                              → null
//   • If no punchLogs are available, fall back to the stored punchOut value
//     ONLY when there's no later IN in the stored data (it represents the
//     final checkout already validated by the backend).
function resolveLastOut(punchLogs: PunchLog[] | undefined, storedPunchOut?: string | null): string | null {
  if (punchLogs && punchLogs.length > 0) {
    const last = punchLogs[punchLogs.length - 1];
    return last.direction === 'OUT' ? last.time : null;
  }
  return storedPunchOut ?? null;
}

function isGoodDay(log: AttendanceLog): boolean {
  const punchLogs: PunchLog[] = (log as unknown as { punchLogs?: PunchLog[] }).punchLogs || [];
  const firstIn = punchLogs.find(p => p.direction === 'IN')?.time || log.punchIn;
  const lastOut = resolveLastOut(punchLogs, log.punchOut);
  const inMin = getISTMinutes(firstIn);
  const outMin = getISTMinutes(lastOut);
  if (inMin == null || outMin == null) return false;
  return inMin < 10 * 60 && outMin > 18 * 60;
}
function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getFirstDayOfWeek(y: number, m: number) { return new Date(y, m - 1, 1).getDay(); }

// ─── Types ──────────────────────────────────────────────────────────────────

interface MonthlySummaryRow {
  _id: string; id?: string;
  employeeId: string; name: string; department?: string;
  Present: number; Late: number; Absent: number;
  Leave: number; WeeklyOff: number; Holiday: number; HalfDay: number;
  total: number;
  todayStatus?: string | null;
  todayPunchIn?: string | null;
  todayPunchInLat?: number | null;
  todayPunchInLng?: number | null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const icons: Partial<Record<AttendanceStatus, React.ElementType>> = {
    Present: CheckCircle, Late: AlertCircle, Absent: XCircle, HalfDay: MinusCircle,
  };
  const Icon = icons[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_TILE[status]}`}>
      {Icon && <Icon className="w-3 h-3" />}{status}
    </span>
  );
}

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 flex flex-col items-center py-3 px-1 rounded-xl border"
         style={{ backgroundColor: color + '12', borderColor: color + '28' }}>
      <span className="text-xl font-black" style={{ color }}>{value}</span>
      <span className="text-[10px] font-semibold text-gray-500 mt-0.5 text-center leading-tight">{label}</span>
    </div>
  );
}

function DayRow({ log, onRegularize }: { log: AttendanceLog; onRegularize: (l: AttendanceLog) => void }) {
  const [expanded, setExpanded] = useState(false);
  const punchLogs: PunchLog[] = (log as unknown as { punchLogs?: PunchLog[] }).punchLogs || [];
  const hasPunches = punchLogs.length > 0;
  const firstIn = hasPunches ? punchLogs.find(p => p.direction === 'IN') : null;
  // A real checkout exists only if the LAST punch overall is an OUT.
  // If the last punch is an IN, the employee returned from a break and is still working.
  const lastPunch = hasPunches ? punchLogs[punchLogs.length - 1] : null;
  const lastOut = lastPunch && lastPunch.direction === 'OUT' ? lastPunch : null;
  // Only fall back to the stored punchOut when we have no punch trail at all.
  const effectiveOutTime = lastOut?.time || (hasPunches ? null : log.punchOut);
  const canRegularize = (log.status === 'Absent' || log.status === 'Late') && !log.isRegularized && log.regularizationStatus !== 'Pending';

  return (
    <div className="hover:bg-gray-50 transition-colors">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className={`w-11 h-11 rounded-xl flex flex-col items-center justify-center shrink-0 ${STATUS_TILE[log.status]}`}>
          <span className="text-sm font-black leading-none">{getDateOnlyDay(log.date)}</span>
          <span className="text-[9px] font-semibold uppercase leading-none mt-0.5">{formatDateOnly(log.date, { weekday: 'short' })}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <StatusBadge status={log.status} />
            {log.attendanceMode && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${MODE_COLORS[log.attendanceMode] || MODE_COLORS.Office}`}>{log.attendanceMode}</span>
            )}
            {log.regularizationStatus === 'Pending' && <span className="badge-yellow text-[10px]">Pending</span>}
          </div>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            {(firstIn || log.punchIn) && (
              <div className="flex items-center gap-1.5">
                <LogIn className="w-3.5 h-3.5 text-success-500" />
                <span className="text-[10px] font-bold text-success-600 uppercase">In</span>
                <span className="text-xs font-bold text-gray-700">{formatTime(firstIn?.time || log.punchIn)}</span>
                <LocationBadge lat={log.punchInLat} lng={log.punchInLng} address={log.punchInAddress} label="Check-in" />
              </div>
            )}
            {effectiveOutTime && (
              <div className="flex items-center gap-1.5">
                <LogOut className="w-3.5 h-3.5 text-danger-500" />
                <span className="text-[10px] font-bold text-danger-600 uppercase">Out</span>
                <span className="text-xs font-bold text-gray-700">{formatTime(effectiveOutTime)}</span>
                <LocationBadge lat={log.punchOutLat} lng={log.punchOutLng} address={log.punchOutAddress} label="Check-out" />
              </div>
            )}
            {log.workHours != null && log.workHours > 0 && (
              <span className="text-[11px] font-semibold text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />{log.workHours}h
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canRegularize && (
            <button onClick={() => onRegularize(log)} className="text-[11px] font-bold text-primary-600 hover:underline">Regularize</button>
          )}
          {hasPunches && (
            <button onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:bg-primary-50 px-2 py-1 rounded-lg transition-colors">
              <Fingerprint className="w-3.5 h-3.5" />
              <span>{punchLogs.length}</span>
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>
      {expanded && hasPunches && (
        <div className="mx-4 mb-3 rounded-xl border border-gray-100 bg-gray-50/50 overflow-hidden">
          <div className="divide-y divide-gray-100">
            {punchLogs.map((p, idx) => (
              <div key={idx} className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-[10px] font-bold text-gray-300 w-4 text-center">{idx + 1}</span>
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${p.direction === 'IN' ? 'bg-success-500/15 text-success-600' : 'bg-danger-500/15 text-danger-500'}`}>
                  {p.direction === 'IN' ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
                </div>
                <span className={`text-[11px] font-bold ${p.direction === 'IN' ? 'text-success-600' : 'text-danger-500'}`}>
                  {p.direction === 'IN' ? 'IN' : 'OUT'}
                </span>
                <span className="text-sm font-black text-gray-800 tabular-nums ml-auto">{formatTimeShort(p.time)}</span>
                <span className="text-[10px] text-gray-400 ml-2 truncate max-w-[80px]">{p.deviceName}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AttendancePage() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [regularizeModal, setRegularizeModal] = useState<AttendanceLog | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [summaryData, setSummaryData] = useState<MonthlySummaryRow[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summarySearch, setSummarySearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [detailEmployee, setDetailEmployee] = useState<string | null>(null);
  const [detailLogs, setDetailLogs] = useState<AttendanceLog[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailMonth, setDetailMonth] = useState(today.getMonth() + 1);
  const [detailYear, setDetailYear] = useState(today.getFullYear());
  const [overridePunchIn, setOverridePunchIn] = useState('09:00');
  const [overridePunchOut, setOverridePunchOut] = useState('18:00');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const liveRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const [lateArrivalTime, setLateArrivalTime] = useState('10:00');
  const [summaryEmployee, setSummaryEmployee] = useState<{ id: string; name: string } | null>(null);

  const canViewTeamAttendance = user?.role === 'Admin' || user?.role === 'HR';

  // Fetch late arrival time from settings once
  useEffect(() => {
    api.get<AppSettings>('/settings').then(res => {
      setLateArrivalTime(res.data.lateArrivalTime || '10:00');
    }).catch(() => {});
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (canViewTeamAttendance) {
      api.get<{ data: Employee[] }>('/employees', { params: { limit: 200 } }).then((res) => {
        setEmployees(res.data.data);
        if (res.data.data.length > 0 && !selectedEmployee)
          setSelectedEmployee(res.data.data[0]._id || res.data.data[0].id || '');
      });
    } else {
      api.get<Employee>('/employees/profile').then((res) => {
        setSelectedEmployee(res.data._id || res.data.id || '');
      });
    }
  }, [canViewTeamAttendance]);

  // `silent` skips the skeleton loading state so background polls (every 60s)
  // update the table in place instead of re-rendering loading skeletons.
  const fetchSummary = useCallback(async (silent = false) => {
    if (!canViewTeamAttendance) return;
    if (!silent) setSummaryLoading(true);
    try {
      const res = await api.get<{ summary: MonthlySummaryRow[] }>('/attendance/monthly-summary', { params: { month, year } });
      setSummaryData((prev) => {
        // Avoid re-rendering if data is identical (prevents row flicker).
        if (silent && prev.length === res.data.summary.length) {
          const same = prev.every((row, i) => {
            const next = res.data.summary[i];
            return next && row._id === next._id
              && row.Present === next.Present && row.Late === next.Late
              && row.Absent === next.Absent
              && row.todayStatus === next.todayStatus
              && row.todayPunchIn === next.todayPunchIn;
          });
          if (same) return prev;
        }
        return res.data.summary;
      });
    } catch { if (!silent) toast.error('Failed to load summary'); }
    finally { if (!silent) setSummaryLoading(false); }
  }, [canViewTeamAttendance, month, year]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const todayIsCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  useEffect(() => {
    if (!canViewTeamAttendance || !todayIsCurrentMonth) return;
    liveRefreshRef.current = setInterval(() => { fetchSummary(true); }, 60000);
    return () => { if (liveRefreshRef.current) clearInterval(liveRefreshRef.current); };
  }, [canViewTeamAttendance, todayIsCurrentMonth, fetchSummary]);

  const fetchLogs = useCallback(async () => {
    if (!selectedEmployee) return;
    setLoading(true);
    try {
      const res = await api.get<{ logs: AttendanceLog[] }>(`/attendance/employee/${selectedEmployee}`, { params: { month, year } });
      setLogs(res.data.logs);
    } catch { toast.error('Failed to load attendance'); }
    finally { setLoading(false); }
  }, [selectedEmployee, month, year]);

  useEffect(() => { if (!canViewTeamAttendance) fetchLogs(); }, [fetchLogs, canViewTeamAttendance]);

  // Listen for virtual-punch events from the widget so the calendar refreshes
  useEffect(() => {
    const handler = () => {
      if (!canViewTeamAttendance) fetchLogs();
      fetchSummary();
    };
    window.addEventListener('attendance:refresh', handler);
    return () => window.removeEventListener('attendance:refresh', handler);
  }, [canViewTeamAttendance, fetchLogs, fetchSummary]);

  const fetchDetailLogs = useCallback(async (empId: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get<{ logs: AttendanceLog[] }>(`/attendance/employee/${empId}`, { params: { month: detailMonth, year: detailYear } });
      setDetailLogs(res.data.logs);
    } catch { toast.error('Failed to load employee attendance'); }
    finally { setDetailLoading(false); }
  }, [detailMonth, detailYear]);

  useEffect(() => { if (detailEmployee) fetchDetailLogs(detailEmployee); }, [detailEmployee, fetchDetailLogs]);

  useEffect(() => {
    if (detailEmployee) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [detailEmployee]);

  // When an employee detail overlay opens (or month changes back to the
  // current month), default the selected day to today so the top of the
  // sidebar shows today's in/out instead of nothing.
  useEffect(() => {
    if (!detailEmployee) return;
    const isCurrentMonth = detailYear === today.getFullYear() && detailMonth === today.getMonth() + 1;
    setSelectedDay(isCurrentMonth ? today.getDate() : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailEmployee, detailMonth, detailYear]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleLiveSync() {
    setSyncing(true);
    try {
      const res = await api.post<{ message: string; totalLogsImported: number }>('/attendance/sync-live');
      toast.success(res.data.message);
      await fetchSummary();
      if (!canViewTeamAttendance) await fetchLogs();
      if (detailEmployee) await fetchDetailLogs(detailEmployee);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Sync failed';
      toast.error(msg);
    } finally { setSyncing(false); }
  }

  async function submitOverride(empId: string, empName: string, dateStr: string) {
    setOverrideSubmitting(true);
    try {
      await api.post('/attendance/virtual-login', {
        employeeId: empId,
        date: dateStr,
        punchIn: `${dateStr}T${overridePunchIn}:00+05:30`,
        punchOut: overridePunchOut ? `${dateStr}T${overridePunchOut}:00+05:30` : undefined,
        reason: 'Manual attendance entry by admin (biometric sync offline)',
      });
      toast.success(`Attendance added for ${empName}`);
      setSelectedDay(null);
      if (detailEmployee) fetchDetailLogs(detailEmployee);
      fetchSummary();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to add attendance');
    } finally {
      setOverrideSubmitting(false);
    }
  }

  async function submitRegularization() {
    if (!regularizeModal || reason.trim().length < 10) { toast.error('Provide reason (min 10 chars)'); return; }
    setSubmitting(true);
    try {
      const id = regularizeModal._id || regularizeModal.id;
      await api.post('/attendance/regularize', { attendanceId: id, reason });
      toast.success('Regularization request submitted');
      setRegularizeModal(null); setReason('');
      if (detailEmployee) fetchDetailLogs(detailEmployee); else fetchLogs();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    } finally { setSubmitting(false); }
  }

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setMonthPickerOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Derived ───────────────────────────────────────────────────────────────

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOffset = getFirstDayOfWeek(year, month);
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  const logMap = new Map<number, AttendanceLog>();
  logs.forEach((log) => { logMap.set(getDateOnlyDay(log.date), log); });
  const stats = {
    present: logs.filter((l) => l.status === 'Present').length,
    late: 0, // Late merged into Present
    absent: logs.filter((l) => l.status === 'Absent').length,
    leave: logs.filter((l) => l.status === 'Leave').length,
    weeklyOff: logs.filter((l) => l.status === 'WeeklyOff').length,
  };

  const detailDaysInMonth = getDaysInMonth(detailYear, detailMonth);
  const detailFirstDayOffset = getFirstDayOfWeek(detailYear, detailMonth);
  const detailMonthName = new Date(detailYear, detailMonth - 1).toLocaleString('default', { month: 'long' });
  const detailTodayIsCurrentMonth = detailYear === today.getFullYear() && detailMonth === today.getMonth() + 1;
  const detailLogMap = new Map<number, AttendanceLog>();
  detailLogs.forEach((log) => { detailLogMap.set(getDateOnlyDay(log.date), log); });
  const detailEmpName = employees.find(e => (e._id || e.id) === detailEmployee)?.userId?.name || '';

  // ── Render ────────────────────────────────────────────────────────────────

  if (canViewTeamAttendance) {
    return (
      <div className="flex flex-col gap-5 pb-20 lg:pb-0">

        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="page-title">Team attendance</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {todayIsCurrentMonth ? "Live snapshot for today \u00B7 updates every minute" : `${monthName} ${year} \u00B7 monthly totals`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className={`p-2.5 rounded-xl border transition-colors ${searchOpen ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-gray-200 text-gray-600 hover:border-primary-600/50'}`}
              title="Search employees"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Status filter chips — Late counts as Present, so only two real states */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
              {(['All', 'Present', 'Absent'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f === 'All' ? '' : f)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                    (f === 'All' && !statusFilter) || statusFilter === f
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >{f}</button>
              ))}
            </div>

            <div className="relative" ref={monthPickerRef}>
              <button
                onClick={() => setMonthPickerOpen(!monthPickerOpen)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border bg-white border-gray-200 text-sm font-bold text-gray-700 hover:border-primary-600/50 transition-colors"
              >
                <CalendarDays className="w-4 h-4 text-gray-400" />
                <span className="hidden sm:inline">{monthName.slice(0, 3)}</span> {year}
                <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              </button>
              {monthPickerOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)] p-3">
                  <div className="flex items-center justify-between mb-3">
                    <button onClick={() => setYear(y => y - 1)} className="p-1 rounded-lg hover:bg-gray-100"><ChevronLeft className="w-4 h-4" /></button>
                    <span className="text-sm font-black text-gray-900">{year}</span>
                    <button onClick={() => setYear(y => y + 1)} className="p-1 rounded-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => {
                      const active = month === i + 1;
                      const isCurrent = i + 1 === today.getMonth() + 1 && year === today.getFullYear();
                      return (
                        <button
                          key={m}
                          onClick={() => { setMonth(i + 1); setMonthPickerOpen(false); }}
                          className={`py-2 rounded-xl text-xs font-bold transition-all ${
                            active ? 'bg-primary-600 text-white shadow-[0_4px_12px_rgba(2,76,128,0.3)]' :
                            isCurrent ? 'bg-primary-600/10 text-primary-700' :
                            'text-gray-600 hover:bg-gray-100'
                          }`}
                        >{m}</button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleLiveSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold disabled:opacity-60 transition-colors shadow-[0_6px_16px_rgba(2,76,128,0.25)]"
              title="Force sync from eSSL device"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? 'Syncing\u2026' : 'Sync now'}</span>
            </button>
          </div>
        </div>

        {/* KPI strip — today snapshot */}
        {todayIsCurrentMonth && (() => {
          const presentToday = summaryData.filter(r => r.todayStatus === 'Present').length;
          const lateToday    = summaryData.filter(r => r.todayStatus === 'Late').length;
          const absentToday  = summaryData.filter(r => r.todayStatus === 'Absent').length;
          const leaveToday   = summaryData.filter(r => r.todayStatus === 'Leave').length;
          const total        = summaryData.length;
          const attended     = presentToday + lateToday;
          const pct          = total ? Math.round((attended / total) * 100) : 0;
          const cards: { label: string; value: number | string; sub?: string; tone: string; ring: string; }[] = [
            { label: 'Attendance', value: `${pct}%`,  sub: `${attended}/${total}`, tone: 'text-primary-700',  ring: 'bg-primary-600/[0.08]' },
            { label: 'Present',    value: presentToday, sub: 'On time',             tone: 'text-success-600',  ring: 'bg-success-500/[0.08]' },
            { label: 'Late',       value: lateToday,    sub: `After ${lateArrivalTime}`,  tone: 'text-amber-600',    ring: 'bg-amber-400/[0.12]' },
            { label: 'Absent',     value: absentToday,  sub: 'No punches',          tone: 'text-danger-500',   ring: 'bg-danger-500/[0.08]' },
            { label: 'On leave',   value: leaveToday,   sub: 'Approved',            tone: 'text-purple-600',   ring: 'bg-purple-500/[0.08]' },
          ];
          return (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {cards.map((c) => (
                <div
                  key={c.label}
                  className={`relative overflow-hidden rounded-2xl border border-gray-100 ${c.ring} px-4 py-3 shadow-[0_4px_14px_rgba(15,23,42,0.04)]`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-gray-500">{c.label}</p>
                  <p className={`mt-1 text-2xl font-black tracking-tight ${c.tone}`}>{c.value}</p>
                  {c.sub && <p className="text-[10px] font-semibold text-gray-400 mt-0.5">{c.sub}</p>}
                </div>
              ))}
            </div>
          );
        })()}

        {/* Search bar */}
        {searchOpen && (
          <div className="flex items-center gap-2 bg-white rounded-xl px-3 py-2.5 border border-gray-200 shadow-sm">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              autoFocus
              type="text"
              placeholder="Search by name, employee ID, or department\u2026"
              className="bg-transparent flex-1 text-sm outline-none placeholder-gray-400 text-gray-900"
              value={summarySearch}
              onChange={(e) => setSummarySearch(e.target.value)}
            />
            {summarySearch && (
              <button onClick={() => setSummarySearch('')}><X className="w-3.5 h-3.5 text-gray-400" /></button>
            )}
          </div>
        )}

        {/* Employee Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/70 text-left border-b border-gray-100">
                  <th className="px-4 py-3 font-bold text-gray-500 text-[11px] uppercase tracking-wider">Employee</th>
                  {todayIsCurrentMonth && <th className="px-4 py-3 font-bold text-gray-500 text-[11px] uppercase tracking-wider">Today</th>}
                  {todayIsCurrentMonth && <th className="px-4 py-3 font-bold text-gray-500 text-[11px] uppercase tracking-wider">In time</th>}
                  <th className="px-4 py-3 font-bold text-gray-500 text-[11px] uppercase tracking-wider text-center">
                    Present <span className="text-gray-300 font-semibold normal-case">/ mo</span>
                  </th>
                  <th className="px-4 py-3 font-bold text-gray-500 text-[11px] uppercase tracking-wider text-center">
                    Absent <span className="text-gray-300 font-semibold normal-case">/ mo</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summaryLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="shrink-0 w-9 h-9 rounded-full bg-gray-100 animate-pulse" />
                          <div className="skeleton h-4 w-32 rounded" />
                        </div>
                      </td>
                      {todayIsCurrentMonth && <td className="px-4 py-3.5"><div className="skeleton h-4 w-16 rounded" /></td>}
                      {todayIsCurrentMonth && <td className="px-4 py-3.5"><div className="skeleton h-4 w-16 rounded" /></td>}
                      <td className="px-4 py-3.5"><div className="skeleton h-4 w-10 rounded mx-auto" /></td>
                      <td className="px-4 py-3.5"><div className="skeleton h-4 w-10 rounded mx-auto" /></td>
                    </tr>
                  ))
                  : summaryData
                      .filter((r) => !summarySearch || [r.name, r.employeeId, r.department || ''].some((s) => s.toLowerCase().includes(summarySearch.toLowerCase())))
                      .filter((r) => {
                        if (!statusFilter) return true;
                        // Late counts as Present — both for today's live status and monthly totals.
                        if (todayIsCurrentMonth && r.todayStatus) {
                          if (statusFilter === 'Present') return r.todayStatus === 'Present' || r.todayStatus === 'Late';
                          return r.todayStatus === statusFilter;
                        }
                        if (statusFilter === 'Present') return (r.Present + (r.Late || 0)) > 0;
                        if (statusFilter === 'Absent') return r.Absent > 0;
                        return true;
                      })
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((row) => {
                          const inTime = row.todayPunchIn
                            ? new Date(row.todayPunchIn).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
                            : null;
                          const statusColors: Record<string, string> = {
                            Present: 'bg-success-500/15 text-success-600',
                            Late: 'bg-accent-500/15 text-amber-600',
                            Absent: 'bg-danger-500/15 text-danger-500',
                            HalfDay: 'bg-orange-100 text-orange-600',
                            Leave: 'bg-danger-500/15 text-danger-500',
                            WeeklyOff: 'bg-gray-100 text-gray-500',
                            Holiday: 'bg-purple-100 text-purple-600',
                          };
                          return (
                          <tr
                            key={row._id || row.id}
                            className="hover:bg-primary-600/[0.04] cursor-pointer transition-colors"
                            onClick={() => setDetailEmployee(row._id || row.id || '')}
                          >
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-3">
                                {(() => {
                                  const initials = row.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
                                  const palette = ['bg-primary-600/10 text-primary-700','bg-success-500/15 text-success-700','bg-amber-500/15 text-amber-700','bg-purple-500/15 text-purple-700','bg-rose-500/15 text-rose-600','bg-sky-500/15 text-sky-700'];
                                  let hash = 0; for (let i = 0; i < row.name.length; i++) hash = (hash * 31 + row.name.charCodeAt(i)) >>> 0;
                                  const cls = palette[hash % palette.length];
                                  return (
                                    <div className={`shrink-0 w-9 h-9 rounded-full grid place-items-center text-[11px] font-black ${cls}`}>
                                      {initials}
                                    </div>
                                  );
                                })()}
                                <div className="min-w-0">
                                  <p className="font-bold text-gray-900 text-[13px] truncate">{row.name}</p>
                                  <p className="text-[11px] text-gray-400 truncate">
                                    <span className="font-semibold text-gray-500">{row.employeeId}</span>
                                    {row.department && <span className="ml-1.5 text-gray-400">&middot; {row.department}</span>}
                                  </p>
                                </div>
                              </div>
                            </td>
                            {todayIsCurrentMonth && (
                              <td className="px-4 py-3.5">
                                {row.todayStatus && (
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${statusColors[row.todayStatus] || 'bg-gray-100 text-gray-500'}`}>
                                    {row.todayStatus}
                                  </span>
                                )}
                              </td>
                            )}
                            {todayIsCurrentMonth && (
                              <td className="px-4 py-3.5">
                                {inTime ? (
                                  <div className="flex flex-col">
                                    <span className="text-xs font-bold text-gray-800">{inTime}</span>
                                    {row.todayPunchInLat != null && row.todayPunchInLng != null && (
                                      <a
                                        href={mapsUrl(row.todayPunchInLat, row.todayPunchInLng)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-800 hover:underline mt-0.5"
                                        title={`Check-in: ${row.todayPunchInLat.toFixed(5)}, ${row.todayPunchInLng.toFixed(5)}`}
                                      >
                                        <MapPin className="w-2.5 h-2.5" />
                                        View location
                                      </a>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-400">&mdash;</span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-3.5 text-center">
                              <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md text-xs font-black bg-success-500/15 text-success-600">{row.Present + (row.Late || 0)}</span>
                            </td>
                            <td className="px-4 py-3.5 text-center">
                              <span className="inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md text-xs font-black bg-danger-500/15 text-danger-500">{row.Absent}</span>
                            </td>
                          </tr>
                          );
                      })
                }
              </tbody>
            </table>
          </div>
          {!summaryLoading && summaryData.length === 0 && (
            <div className="flex flex-col items-center py-12 gap-3">
              <CalendarCheck className="w-12 h-12 text-gray-300" />
              <p className="text-gray-400 text-sm">No attendance records for {monthName} {year}</p>
            </div>
          )}
        </div>

        {/* Individual Detail Overlay */}
        {detailEmployee && (
          <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => { setDetailEmployee(null); setDetailLogs([]); setSelectedDay(null); setDetailMonth(today.getMonth() + 1); setDetailYear(today.getFullYear()); }} />
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-white shadow-[0_30px_80px_rgba(0,0,0,0.25)] border-l border-gray-200 flex flex-col overflow-hidden animate-slide-in-right">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-black text-gray-900 truncate">{detailEmpName}</h3>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSummaryEmployee({ id: detailEmployee, name: detailEmpName })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600/10 text-primary-700 text-xs font-bold hover:bg-primary-600/15 transition-colors"
                  >
                    <BarChart3 className="w-3.5 h-3.5" /> Summary
                  </button>
                  <button onClick={() => { setDetailEmployee(null); setDetailLogs([]); setSelectedDay(null); setDetailMonth(today.getMonth() + 1); setDetailYear(today.getFullYear()); }}
                    className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
              </div>

              {detailLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto">
                  {/* Mini calendar */}
                  <div className="px-5 pt-4 pb-3">
                    {/* Month header — bold, above calendar */}
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={() => { if (detailMonth === 1) { setDetailYear(y => y - 1); setDetailMonth(12); } else setDetailMonth(m => m - 1); setSelectedDay(null); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        aria-label="Previous month"
                      >
                        <ChevronLeft className="w-4 h-4 text-gray-600" />
                      </button>
                      <h4 className="text-base font-black text-gray-900 tracking-tight">
                        {detailMonthName} {detailYear}
                      </h4>
                      <button
                        onClick={() => { if (detailMonth === 12) { setDetailYear(y => y + 1); setDetailMonth(1); } else setDetailMonth(m => m + 1); setSelectedDay(null); }}
                        disabled={detailTodayIsCurrentMonth}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Next month"
                      >
                        <ChevronRight className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 mb-1.5">
                      {['S','M','T','W','T','F','S'].map((d, i) => (
                        <div key={`${d}${i}`} className="text-center text-[11px] font-black text-gray-700 py-1">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: detailFirstDayOffset }).map((_, i) => <div key={`e${i}`} />)}
                      {Array.from({ length: detailDaysInMonth }, (_, i) => i + 1).map((day) => {
                        const log = detailLogMap.get(day);
                        const isToday = day === today.getDate() && detailTodayIsCurrentMonth;
                        const isFuture = new Date(detailYear, detailMonth - 1, day) > today;
                        const isSelected = day === selectedDay;
                        const isSunday = new Date(detailYear, detailMonth - 1, day).getDay() === 0;
                        const good = log ? isGoodDay(log) : false;
                        const isImplicitAbsent = !log && !isFuture && !isToday && !isSunday;
                        return (
                          <button
                            key={day}
                            onClick={() => { if (!isFuture) setSelectedDay(day === selectedDay ? null : day); }}
                            disabled={isFuture}
                            className={`relative flex items-center justify-center h-8 rounded-lg text-[11px] font-bold transition-all ${
                              isSelected ? 'ring-2 ring-primary-500 bg-primary-600 text-white' :
                              log ? (good ? 'bg-success-500/20 text-success-700' : STATUS_TILE[log.status]) :
                              isImplicitAbsent ? STATUS_TILE.Absent :
                              isSunday && !isFuture ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/15' :
                              isFuture ? 'text-gray-300' : 'text-gray-500 hover:bg-gray-100'
                            } ${isToday && !isSelected ? 'ring-1 ring-primary-400' : ''} ${isFuture ? 'cursor-default' : 'cursor-pointer'}`}
                            title={isImplicitAbsent ? 'Absent (no punches)' : undefined}
                          >
                            {log && !isFuture && !isSelected && (
                              <span className={`absolute top-0.5 right-1 w-1 h-1 rounded-full ${good ? 'bg-success-500' : STATUS_DOT[log.status]}`} />
                            )}
                            {!log && isSunday && !isFuture && !isSelected && (
                              <span className="absolute top-0.5 right-1 w-1 h-1 rounded-full bg-purple-400" />
                            )}
                            {isImplicitAbsent && !isSelected && (
                              <span className={`absolute top-0.5 right-1 w-1 h-1 rounded-full ${STATUS_DOT.Absent}`} />
                            )}
                            {day}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2 border-t border-gray-100">
                      {Object.entries(STATUS_DOT).map(([status, dot]) => (
                        <div key={status} className="flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                          <span className="text-[9px] text-gray-500">{status}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Selected day detail OR admin override OR day list */}
                  {selectedDay != null && detailLogMap.get(selectedDay) ? (() => {
                    const sel = detailLogMap.get(selectedDay)!;
                    const selPunchLogs: PunchLog[] = (sel as unknown as { punchLogs?: PunchLog[] }).punchLogs || [];
                    const selFirstIn = selPunchLogs.find(p => p.direction === 'IN')?.time || sel.punchIn || null;
                    const selLastOut = resolveLastOut(selPunchLogs, sel.punchOut);
                    return (
                      <div className="px-5 pb-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={sel.status} />
                            {isGoodDay(sel) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success-500/15 text-success-600">GOOD</span>}
                            <span className="text-xs font-bold text-gray-700">
                              {makeUTCDate(detailYear, detailMonth, selectedDay).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}
                            </span>
                          </div>
                          <button onClick={() => setSelectedDay(null)} className="text-[11px] font-bold text-primary-600 hover:underline">Show all days</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="p-3 rounded-xl bg-green-50">
                            <div className="flex items-center gap-1 mb-1"><LogIn className="w-3 h-3 text-green-600" /><span className="text-[9px] font-bold text-green-700 uppercase">In</span></div>
                            <p className="text-sm font-bold text-green-800">{selFirstIn ? formatTime(selFirstIn) : '\u2014'}</p>
                            <LocationBadge lat={sel.punchInLat} lng={sel.punchInLng} address={sel.punchInAddress} label="Check-in" />
                          </div>
                          <div className="p-3 rounded-xl bg-red-50">
                            <div className="flex items-center gap-1 mb-1"><LogOut className="w-3 h-3 text-red-600" /><span className="text-[9px] font-bold text-red-700 uppercase">Out</span></div>
                            <p className="text-sm font-bold text-red-800">{selLastOut ? formatTime(selLastOut) : '\u2014'}</p>
                            <LocationBadge lat={sel.punchOutLat} lng={sel.punchOutLng} address={sel.punchOutAddress} label="Check-out" />
                          </div>
                        </div>
                        {selPunchLogs.length > 0 && (
                          <div className="rounded-xl border border-gray-100 overflow-hidden">
                            <div className="px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 border-b border-gray-100">
                              <Fingerprint className="w-3 h-3 text-primary-500" /> {selPunchLogs.length} punches
                            </div>
                            <div className="divide-y divide-gray-50">
                              {selPunchLogs.map((p, i) => (
                                <div key={i} className="px-3 py-2 flex items-center gap-2">
                                  <div className={`w-6 h-6 rounded-md flex items-center justify-center ${p.direction === 'IN' ? 'bg-success-500/15 text-success-600' : 'bg-danger-500/15 text-danger-500'}`}>
                                    {p.direction === 'IN' ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                                  </div>
                                  <span className={`text-[11px] font-bold ${p.direction === 'IN' ? 'text-success-600' : 'text-danger-500'}`}>{p.direction}</span>
                                  <span className="ml-auto text-xs font-black text-gray-800 tabular-nums">{formatTimeShort(p.time)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {(sel.status === 'Absent' || sel.status === 'Late') && !sel.isRegularized && sel.regularizationStatus !== 'Pending' && (
                          <button onClick={() => setRegularizeModal(sel)} className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-black transition-colors">
                            Request Regularization
                          </button>
                        )}
                      </div>
                    );
                  })() : (() => {
                    // When admin selects an absent day (no log, not future, not Sunday) → show override form
                    const selDate = selectedDay != null ? new Date(detailYear, detailMonth - 1, selectedDay) : null;
                    const selIsFuture = selDate != null && selDate > today;
                    const selIsSunday = selDate != null && selDate.getDay() === 0;
                    const showOverride = canViewTeamAttendance && selectedDay != null && !selIsFuture && !selIsSunday;
                    if (showOverride && selectedDay != null) {
                      const dateStr = `${detailYear}-${String(detailMonth).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
                      return (
                        <div className="px-5 pb-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <StatusBadge status="Absent" />
                              <span className="text-xs font-bold text-gray-700">
                                {makeUTCDate(detailYear, detailMonth, selectedDay).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })}
                              </span>
                            </div>
                            <button onClick={() => setSelectedDay(null)} className="text-[11px] font-bold text-primary-600 hover:underline">Show all days</button>
                          </div>
                          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
                            <span className="text-amber-500 text-sm mt-0.5">⚠</span>
                            <p className="text-xs text-amber-800">No biometric punch recorded — ESSL device may be offline. Enter attendance manually below.</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">Punch In (IST)</label>
                              <input type="time" value={overridePunchIn} onChange={e => setOverridePunchIn(e.target.value)} className="input text-sm w-full" />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-gray-500 uppercase mb-1.5 block">Punch Out (IST)</label>
                              <input type="time" value={overridePunchOut} onChange={e => setOverridePunchOut(e.target.value)} className="input text-sm w-full" />
                            </div>
                          </div>
                          <button
                            onClick={() => submitOverride(detailEmployee!, detailEmpName, dateStr)}
                            disabled={overrideSubmitting}
                            className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-black transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                          >
                            {overrideSubmitting
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <PlusCircle className="w-4 h-4" />}
                            Add Attendance
                          </button>
                        </div>
                      );
                    }
                    return (
                    <div className="divide-y divide-gray-100">
                      {detailLogs.length === 0 ? (
                        <div className="flex flex-col items-center py-12 gap-3">
                          <CalendarCheck className="w-10 h-10 text-gray-300" />
                          <p className="text-gray-400 text-sm">No records for {detailMonthName} {detailYear}</p>
                        </div>
                      ) : (() => {
                        // Show all days for the visible month, ordered today-first then descending.
                        // For non-current months, just newest day first.
                        const sorted = [...detailLogs].sort((a, b) =>
                          new Date(b.date).getTime() - new Date(a.date).getTime()
                        );
                        return sorted.map((log) => (
                          <DayRow key={log._id || log.id} log={log} onRegularize={setRegularizeModal} />
                        ));
                      })()}
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Regularization Modal */}
        {regularizeModal && (
          <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="card w-full max-w-md p-6 rounded-t-2xl sm:rounded-2xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-black text-gray-900 text-base">Request Regularization</h2>
                  <p className="text-sm text-gray-500 mt-0.5">{formatDateOnly(regularizeModal.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                </div>
                <button onClick={() => setRegularizeModal(null)} className="p-1.5 rounded-xl bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
              </div>
              <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-gray-50">
                <StatusBadge status={regularizeModal.status} />
                <span className="text-sm text-gray-600">In: {formatTime(regularizeModal.punchIn)} {'\u00B7'} Out: {formatTime(regularizeModal.punchOut)}</span>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-bold text-gray-700 mb-1.5">Reason <span className="text-xs font-normal text-gray-400">(min 10 chars)</span></label>
                <textarea className="input resize-none h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why attendance needs to be regularized..." />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setRegularizeModal(null)} className="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-600">Cancel</button>
                <button onClick={submitRegularization} disabled={submitting} className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-black flex items-center justify-center gap-2 disabled:opacity-60">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Attendance Summary Modal */}
        {summaryEmployee && (
          <AttendanceSummaryModal
            employeeId={summaryEmployee.id}
            employeeName={summaryEmployee.name}
            onClose={() => setSummaryEmployee(null)}
          />
        )}
      </div>
    );
  }

  // ── EMPLOYEE VIEW ─────────────────────────────────────────────────────────

  const effectiveDay = selectedDay ?? (todayIsCurrentMonth ? today.getDate() : null);
  const selectedLog = effectiveDay != null ? logMap.get(effectiveDay) : null;
  const selPunches: PunchLog[] = (selectedLog as unknown as { punchLogs?: PunchLog[] } | null)?.punchLogs || [];
  const selFirstIn = selPunches.find(p => p.direction === 'IN')?.time || selectedLog?.punchIn || null;
  const selLastOut = resolveLastOut(selPunches, selectedLog?.punchOut);
  const selDate = effectiveDay != null ? makeUTCDate(year, month, effectiveDay) : null;

  return (
    <div className="pb-20 lg:pb-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 min-w-0">
          <h2 className="page-title">My Attendance</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{monthName} {year}</p>
        </div>
        <button
          onClick={() => setSummaryEmployee({ id: selectedEmployee, name: 'My Attendance' })}
          disabled={!selectedEmployee}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-primary-600/10 text-primary-700 text-sm font-bold hover:bg-primary-600/15 transition-colors disabled:opacity-50"
        >
          <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Summary</span>
        </button>
        <div className="relative" ref={monthPickerRef}>
          <button
            onClick={() => setMonthPickerOpen(!monthPickerOpen)}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border bg-white border-gray-200 text-sm font-bold text-gray-700 hover:border-primary-600/50 transition-colors"
          >
            <CalendarDays className="w-4 h-4 text-gray-400" />
            <span className="hidden sm:inline">{monthName.slice(0, 3)}</span> {year}
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          </button>
          {monthPickerOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-2xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)] p-3">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setYear(y => y - 1)} className="p-1 rounded-lg hover:bg-gray-100"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-black text-gray-900">{year}</span>
                <button onClick={() => setYear(y => y + 1)} className="p-1 rounded-lg hover:bg-gray-100"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => {
                  const active = month === i + 1;
                  return (
                    <button
                      key={m}
                      onClick={() => { setMonth(i + 1); setMonthPickerOpen(false); }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all ${active ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >{m}</button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="flex gap-2 mb-5">
        <StatChip label="Present" value={stats.present} color="#16A34A" />
        <StatChip label="Absent" value={stats.absent} color="#DC2626" />
        <StatChip label="Leave" value={stats.leave} color="#2563EB" />
        <StatChip label="W/Off" value={stats.weeklyOff} color="#9333EA" />
      </div>

      {/* Calendar + Day Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
        <div className="lg:col-span-3 card p-4">
          <div className="grid grid-cols-7 gap-1.5 mb-2">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
              <div key={d} className="text-center text-[11px] font-bold text-gray-500 py-1.5 uppercase tracking-wider">{d}</div>
            ))}
          </div>
          {loading
            ? <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 35 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
            : (
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const log = logMap.get(day);
                  const isToday = day === today.getDate() && todayIsCurrentMonth;
                  const isFuture = new Date(year, month - 1, day) > today;
                  const isSelected = day === effectiveDay;
                  const isSunday = new Date(year, month - 1, day).getDay() === 0;
                  const good = log ? isGoodDay(log) : false;
                  // A past working day with no AttendanceLog row is an implicit Absent —
                  // the backend only returns rows for days that have data, so we have to
                  // infer Absent here or the calendar shows it as a neutral grey tile.
                  const isImplicitAbsent = !log && !isFuture && !isToday && !isSunday;
                  const tileColor = log
                    ? good ? 'bg-success-500/20 text-success-700 hover:bg-success-500/30' : `${STATUS_TILE[log.status]} hover:opacity-80`
                    : isImplicitAbsent ? `${STATUS_TILE.Absent} hover:opacity-80`
                    : isSunday && !isFuture ? 'bg-purple-500/10 text-purple-400 hover:bg-purple-500/15'
                    : isToday ? 'bg-primary-50 text-primary-700 hover:bg-primary-100'
                    : isFuture ? 'bg-gray-50 text-gray-300'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100';
                  return (
                    <button
                      key={day}
                      onClick={() => { if (!isFuture) setSelectedDay(day === selectedDay ? null : day); }}
                      disabled={isFuture}
                      className={`relative flex flex-col items-center justify-center h-14 rounded-xl text-sm font-black transition-all ${tileColor} ${
                        isSelected ? 'ring-2 ring-primary-500 ring-offset-1' :
                        isToday ? 'ring-2 ring-primary-600 ring-offset-1' : ''
                      } ${isFuture ? 'cursor-default' : 'cursor-pointer'}`}
                      title={isSunday ? 'Sunday (Weekly Holiday)' : isImplicitAbsent ? 'Absent (no punches)' : undefined}
                    >
                      {log && !isFuture && (<span className={`absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full ${good ? 'bg-success-500' : STATUS_DOT[log.status]}`} />)}
                      {!log && isSunday && !isFuture && (<span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-purple-400" />)}
                      {isImplicitAbsent && (<span className={`absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full ${STATUS_DOT.Absent}`} />)}
                      {day}
                    </button>
                  );
                })}
              </div>
            )}
        </div>

        {/* Day detail panel */}
        <div className="lg:col-span-2 card overflow-hidden lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] flex flex-col">
          {!selectedLog || !selDate ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <CalendarDays className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-500">Pick a day</p>
              <p className="text-xs text-gray-400 mt-1">Click any date to view details</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={selectedLog.status} />
                  {isGoodDay(selectedLog) && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success-500/15 text-success-600">GOOD</span>}
                </div>
                <h3 className="font-black text-gray-900 text-sm">
                  {selDate.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC' })}
                </h3>
              </div>
              <div className="p-4 grid grid-cols-2 gap-2">
                <div className="p-3 rounded-xl bg-green-50">
                  <div className="flex items-center gap-1 mb-1"><LogIn className="w-3 h-3 text-green-600" /><span className="text-[9px] font-bold text-green-700 uppercase">In</span></div>
                  <p className="text-sm font-bold text-green-800">{selFirstIn ? formatTime(selFirstIn) : '\u2014'}</p>
                </div>
                <div className="p-3 rounded-xl bg-red-50">
                  <div className="flex items-center gap-1 mb-1"><LogOut className="w-3 h-3 text-red-600" /><span className="text-[9px] font-bold text-red-700 uppercase">Out</span></div>
                  <p className="text-sm font-bold text-red-800">{selLastOut ? formatTime(selLastOut) : '\u2014'}</p>
                </div>
              </div>
              {selectedLog.workHours != null && selectedLog.workHours > 0 && (
                <div className="px-4 pb-3 text-xs text-gray-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /><span className="font-semibold">{selectedLog.workHours}h</span> worked</div>
              )}
              {selPunches.length > 0 && (
                <div className="border-t border-gray-100 flex-1 overflow-hidden flex flex-col min-h-0">
                  <div className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1.5 shrink-0">
                    <Fingerprint className="w-3 h-3 text-primary-500" /> {selPunches.length} punches
                  </div>
                  <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
                    {selPunches.map((p, i) => (
                      <div key={i} className="px-4 py-2 flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${p.direction === 'IN' ? 'bg-success-500/15 text-success-600' : 'bg-danger-500/15 text-danger-500'}`}>
                          {p.direction === 'IN' ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                        </div>
                        <span className={`text-[11px] font-bold ${p.direction === 'IN' ? 'text-success-600' : 'text-danger-500'}`}>{p.direction}</span>
                        <span className="text-[10px] text-gray-400 truncate">{p.deviceName}</span>
                        <span className="ml-auto text-xs font-black text-gray-800 tabular-nums">{formatTimeShort(p.time)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(selectedLog.status === 'Absent' || selectedLog.status === 'Late') && !selectedLog.isRegularized && selectedLog.regularizationStatus !== 'Pending' && (
                <div className="p-3 border-t border-gray-100 shrink-0">
                  <button onClick={() => setRegularizeModal(selectedLog)} className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-black transition-colors">
                    Request Regularization
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Regularization Modal */}
      {regularizeModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6 rounded-t-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-black text-gray-900 text-base">Request Regularization</h2>
                <p className="text-sm text-gray-500 mt-0.5">{formatDateOnly(regularizeModal.date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              </div>
              <button onClick={() => setRegularizeModal(null)} className="p-1.5 rounded-xl bg-gray-100"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-1.5">Reason <span className="text-xs font-normal text-gray-400">(min 10 chars)</span></label>
              <textarea className="input resize-none h-24" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why attendance needs to be regularized..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setRegularizeModal(null)} className="flex-1 py-3 rounded-xl border border-gray-200 font-bold text-gray-600">Cancel</button>
              <button onClick={submitRegularization} disabled={submitting} className="flex-1 py-3 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-black flex items-center justify-center gap-2 disabled:opacity-60">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Summary Modal */}
      {summaryEmployee && (
        <AttendanceSummaryModal
          employeeId={summaryEmployee.id}
          employeeName={summaryEmployee.name}
          onClose={() => setSummaryEmployee(null)}
        />
      )}
    </div>
  );
}
