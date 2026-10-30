import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, CalendarDays, Loader2, X,
  Users, CheckCircle, AlertCircle, XCircle, MinusCircle,
  LogIn, LogOut, Clock, ChevronDown, TrendingUp,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { AttendanceLog, AttendanceStatus, Employee, PunchLog } from '../types';

// ─── Constants ──────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_COLORS: Record<AttendanceStatus, { bg: string; text: string; dot: string }> = {
  Present: { bg: 'bg-success-500/15', text: 'text-success-600', dot: 'bg-success-500' },
  Late: { bg: 'bg-amber-500/15', text: 'text-amber-600', dot: 'bg-amber-500' },
  Absent: { bg: 'bg-danger-500/15', text: 'text-danger-500', dot: 'bg-danger-500' },
  HalfDay: { bg: 'bg-yellow-500/15', text: 'text-yellow-600', dot: 'bg-yellow-400' },
  Leave: { bg: 'bg-danger-500/15', text: 'text-danger-500', dot: 'bg-danger-500' },
  Holiday: { bg: 'bg-gray-200/80', text: 'text-gray-500', dot: 'bg-gray-400' },
  WeeklyOff: { bg: 'bg-purple-500/15', text: 'text-purple-600', dot: 'bg-purple-400' },
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface MonthlySummaryRow {
  _id: string; id?: string;
  employeeId: string; name: string; department?: string;
  Present: number; Late: number; Absent: number;
  Leave: number; WeeklyOff: number; Holiday: number; HalfDay: number;
  total: number;
}

interface DayRoster {
  employeeId: string;
  name: string;
  status: AttendanceStatus;
  punchIn?: string | null;
  punchOut?: string | null;
  workHours?: number | null;
}

type CalendarMode = 'mine' | 'team';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getFirstDayOfWeek(y: number, m: number) { return new Date(y, m - 1, 1).getDay(); }

function formatTime(iso?: string | null) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}
function getDateOnlyDay(iso: string) {
  return new Date(iso).getUTCDate();
}
function makeUTCDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const icons: Partial<Record<AttendanceStatus, React.ElementType>> = {
    Present: CheckCircle, Late: AlertCircle, Absent: XCircle, HalfDay: MinusCircle,
  };
  const Icon = icons[status];
  const c = STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>
      {Icon && <Icon className="w-2.5 h-2.5" />}{status}
    </span>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function AttendanceCalendarPage() {
  const { user } = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [loading, setLoading] = useState(true);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // Admin state
  const [summaryData, setSummaryData] = useState<MonthlySummaryRow[]>([]);
  const [dayRoster, setDayRoster] = useState<DayRoster[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [calendarMode, setCalendarMode] = useState<CalendarMode>('mine');
  // Per-day stats for the month: day → { present, late, absent, total }
  const [dayStats, setDayStats] = useState<Map<number, { present: number; late: number; absent: number; total: number }>>(new Map());

  // Employee state
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');

  const canViewTeamAttendance = user?.role === 'Admin' || user?.role === 'HR';
  const showingTeamCalendar = canViewTeamAttendance && calendarMode === 'team';
  const todayIsCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOffset = getFirstDayOfWeek(year, month);
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  // ── Fetch data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    api.get<Employee>('/employees/profile')
      .then((res) => {
        if (!cancelled) setSelectedEmployee(res.data._id || res.data.id || '');
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedEmployee('');
        if (!canViewTeamAttendance) toast.error('Employee profile not found');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canViewTeamAttendance]);

  const fetchSummary = useCallback(async () => {
    if (!showingTeamCalendar) return;
    setLoading(true);
    try {
      const res = await api.get<{ summary: MonthlySummaryRow[] }>('/attendance/monthly-summary', { params: { month, year } });
      setSummaryData(res.data.summary);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [showingTeamCalendar, month, year]);

  const fetchEmployeeLogs = useCallback(async () => {
    if (showingTeamCalendar || !selectedEmployee) return;
    setLoading(true);
    try {
      const res = await api.get<{ logs: AttendanceLog[] }>(`/attendance/employee/${selectedEmployee}`, { params: { month, year } });
      setLogs(res.data.logs);
    } catch { toast.error('Failed to load attendance'); }
    finally { setLoading(false); }
  }, [showingTeamCalendar, selectedEmployee, month, year]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchEmployeeLogs(); }, [fetchEmployeeLogs]);

  // Fetch per-day stats for the whole month so calendar tiles can show real data
  const fetchMonthStats = useCallback(async () => {
    if (!showingTeamCalendar) return;
    try {
      const dim = getDaysInMonth(year, month);
      const from = `${year}-${String(month).padStart(2, '0')}-01`;
      const to = `${year}-${String(month).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
      const res = await api.get<{ feed: { date: string; status: string }[] }>('/attendance/by-date', { params: { from, to } });
      const map = new Map<number, { present: number; late: number; absent: number; total: number }>();
      (res.data.feed || []).forEach(f => {
        const d = parseInt(f.date.split('-')[2], 10);
        if (!d) return;
        const cur = map.get(d) || { present: 0, late: 0, absent: 0, total: 0 };
        if (f.status === 'Present') cur.present++;
        else if (f.status === 'Late') cur.late++;
        else if (f.status === 'Absent') cur.absent++;
        cur.total++;
        map.set(d, cur);
      });
      setDayStats(map);
    } catch { /* silent */ }
  }, [showingTeamCalendar, year, month]);

  useEffect(() => { fetchMonthStats(); }, [fetchMonthStats]);

  // Fetch day roster when admin clicks a day
  const fetchDayRoster = useCallback(async (day: number) => {
    setRosterLoading(true);
    try {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const res = await api.get<{ feed: { empCode: string; name: string; status: string; punchIn?: string | null; punchOut?: string | null; workHours?: number | null }[] }>('/attendance/by-date', { params: { date: dateStr } });
      setDayRoster((res.data.feed || []).map(f => ({
        employeeId: f.empCode,
        name: f.name,
        status: f.status as AttendanceStatus,
        punchIn: f.punchIn,
        punchOut: f.punchOut,
        workHours: f.workHours,
      })));
    } catch {
      setDayRoster([]);
    } finally { setRosterLoading(false); }
  }, [year, month]);

  useEffect(() => {
    if (showingTeamCalendar && selectedDay) fetchDayRoster(selectedDay);
  }, [showingTeamCalendar, selectedDay, fetchDayRoster]);

  // Close month picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setMonthPickerOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Derived (Admin) ───────────────────────────────────────────────────────

  // Total headcount and daily presence estimate
  const totalEmployees = summaryData.length;
  // Estimate daily present: average of Present + Late per employee across the month
  const avgPresent = totalEmployees > 0
    ? Math.round(summaryData.reduce((s, r) => s + r.Present + r.Late, 0) / Math.min(today.getDate(), daysInMonth))
    : 0;

  // Build day → estimated presence count from summary
  // Since we don't have per-day breakdown from monthly-summary, we show the team-level stats
  // The calendar tiles will show color intensity based on whether it's a weekday/weekend

  const calendarModeSwitch = canViewTeamAttendance ? (
    <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
      {([
        { key: 'mine', label: 'My calendar' },
        { key: 'team', label: 'Team' },
      ] as const).map((mode) => (
        <button
          key={mode.key}
          type="button"
          onClick={() => setCalendarMode(mode.key)}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
            calendarMode === mode.key
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {mode.label}
        </button>
      ))}
    </div>
  ) : null;

  // ── Derived (Employee) ────────────────────────────────────────────────────

  const logMap = new Map<number, AttendanceLog>();
  logs.forEach((log) => { logMap.set(getDateOnlyDay(log.date), log); });
  const empStats = {
    present: logs.filter((l) => l.status === 'Present').length,
    late: logs.filter((l) => l.status === 'Late').length,
    absent: logs.filter((l) => l.status === 'Absent').length,
    leave: logs.filter((l) => l.status === 'Leave').length,
    weeklyOff: logs.filter((l) => l.status === 'WeeklyOff').length,
    holiday: logs.filter((l) => l.status === 'Holiday').length,
  };

  // ── ADMIN VIEW ────────────────────────────────────────────────────────────

  if (showingTeamCalendar) {
    return (
      <div className="space-y-5 pb-20 lg:pb-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="page-title">Monthly Overview</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Team attendance for {monthName} {year}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {calendarModeSwitch}
            {/* Quick stats */}
            <div className="hidden sm:flex items-center gap-3 mr-2 text-xs text-gray-500">
              <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-primary-500" /><b className="text-gray-700">{totalEmployees}</b> team</span>
              <span className="flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-success-500" /><b className="text-gray-700">~{avgPresent}</b>/day</span>
            </div>

            {/* Month nav */}
            <button onClick={() => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); setSelectedDay(null); }}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>

            <div className="relative" ref={monthPickerRef}>
              <button
                onClick={() => setMonthPickerOpen(!monthPickerOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white border-gray-200 text-sm font-bold text-gray-700 hover:border-primary-600/50 transition-colors"
              >
                <CalendarDays className="w-4 h-4 text-gray-400" />
                {monthName.slice(0, 3)} {year}
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
                        <button key={m} onClick={() => { setMonth(i + 1); setMonthPickerOpen(false); setSelectedDay(null); }}
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
              onClick={() => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); setSelectedDay(null); }}
              disabled={todayIsCurrentMonth}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-30">
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Calendar + Day Detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Calendar Grid */}
          <div className="lg:col-span-2 card overflow-hidden">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1.5 px-2 pt-2 border-b border-gray-100">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">{d}</div>
              ))}
            </div>

            {loading ? (
              <div className="grid grid-cols-7 p-2 gap-1.5">
                {Array.from({ length: 35 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-7 p-2 gap-1.5">
                {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`e${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const isToday = day === today.getDate() && todayIsCurrentMonth;
                  const isFuture = new Date(year, month - 1, day) > today;
                  const isSelected = day === selectedDay;
                  const dayOfWeek = new Date(year, month - 1, day).getDay();
                  const isSunday = dayOfWeek === 0;
                  const isSaturday = dayOfWeek === 6;
                  const stat = dayStats.get(day);

                  return (
                    <button
                      key={day}
                      disabled={isFuture}
                      onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                      className={`relative flex flex-col items-center justify-center min-h-[72px] rounded-xl text-sm transition-all ${
                        isSelected ? 'ring-2 ring-primary-500 bg-primary-600/10' :
                        isToday ? 'ring-2 ring-primary-500 ring-offset-1' :
                        ''
                      } ${
                        isFuture ? 'opacity-30 cursor-default' :
                        isSunday ? 'bg-red-50/60 hover:bg-red-100/80' :
                        'hover:bg-gray-50'
                      } ${isFuture ? '' : 'cursor-pointer'}`}
                    >
                      <span className={`text-sm font-black ${
                        isToday ? 'w-7 h-7 rounded-full bg-primary-600 text-white flex items-center justify-center' :
                        isSunday ? 'text-red-500' :
                        isSaturday ? 'text-orange-500' :
                        'text-gray-800'
                      }`}>
                        {day}
                      </span>
                      {isSunday && !isFuture ? (
                        <span className="text-[9px] font-semibold text-red-400 mt-1">Off</span>
                      ) : !isFuture && stat && (stat.present + stat.late + stat.absent) > 0 ? (
                        <div className="flex items-center gap-1 mt-1">
                          {stat.present > 0 && <span className="text-[9px] font-bold text-success-600">{stat.present}P</span>}
                          {stat.late > 0 && <span className="text-[9px] font-bold text-amber-600">{stat.late}L</span>}
                          {stat.absent > 0 && <span className="text-[9px] font-bold text-danger-500">{stat.absent}A</span>}
                        </div>
                      ) : !isFuture && !isSunday ? (
                        <span className="text-[9px] font-semibold text-gray-300 mt-1">—</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Day Detail Panel */}
          <div className="card overflow-hidden flex flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
            {!selectedDay ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center flex-1">
                <CalendarDays className="w-10 h-10 text-gray-300 mb-3" />
                <p className="text-sm font-semibold text-gray-500">Select a day</p>
                <p className="text-xs text-gray-400 mt-1">Click any date to see who was present</p>
              </div>
            ) : (
              <>
                <div className="p-4 border-b border-gray-100 shrink-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-black text-gray-900 text-sm">
                        {makeUTCDate(year, month, selectedDay).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC' })}
                      </h3>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {dayRoster.length > 0 ? `${dayRoster.filter(r => r.status === 'Present' || r.status === 'Late').length} present` : 'Loading...'}
                      </p>
                    </div>
                    <button onClick={() => setSelectedDay(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                </div>

                {rosterLoading ? (
                  <div className="flex-1 flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                  </div>
                ) : dayRoster.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-4">
                    <CalendarDays className="w-8 h-8 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-400">No records for this day</p>
                    <p className="text-[11px] text-gray-400/70 mt-1">Might be a holiday or off day</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                    {dayRoster
                      .sort((a, b) => {
                        const order: Record<string, number> = { Present: 0, Late: 1, HalfDay: 2, Absent: 3, Leave: 4, WeeklyOff: 5, Holiday: 6 };
                        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                      })
                      .map((emp) => (
                      <div key={emp.employeeId} className="px-4 py-3 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary-700">
                            {emp.name[0]?.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-gray-900 truncate">{emp.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <StatusBadge status={emp.status} />
                            {emp.punchIn && (
                              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                <LogIn className="w-2.5 h-2.5 text-success-500" />{formatTime(emp.punchIn)}
                              </span>
                            )}
                          </div>
                        </div>
                        {emp.workHours != null && emp.workHours > 0 && (
                          <span className="text-[11px] font-semibold text-gray-400 shrink-0">{emp.workHours}h</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Monthly Stats Bar removed */}
      </div>
    );
  }

  // ── EMPLOYEE VIEW ─────────────────────────────────────────────────────────

  const effectiveDay = selectedDay ?? (todayIsCurrentMonth ? today.getDate() : null);
  const selectedLog = effectiveDay != null ? logMap.get(effectiveDay) : null;
  const selPunches: PunchLog[] = (selectedLog as unknown as { punchLogs?: PunchLog[] } | null)?.punchLogs || [];
  const selFirstIn = selPunches.find(p => p.direction === 'IN')?.time || selectedLog?.punchIn || null;
  // Real checkout exists only when the LAST punch overall is an OUT
  // (otherwise the employee returned from a break and is still working).
  const _lastPunch = selPunches.length > 0 ? selPunches[selPunches.length - 1] : null;
  const selLastOut = _lastPunch && _lastPunch.direction === 'OUT'
    ? _lastPunch.time
    : (selPunches.length === 0 ? (selectedLog?.punchOut || null) : null);
  const selDate = effectiveDay != null ? makeUTCDate(year, month, effectiveDay) : null;

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="page-title">Monthly Overview</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">{monthName} {year}</p>
        </div>
        <div className="flex items-center gap-2">
          {calendarModeSwitch}
          <button onClick={() => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); setSelectedDay(null); }}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div className="relative" ref={monthPickerRef}>
            <button onClick={() => setMonthPickerOpen(!monthPickerOpen)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white border-gray-200 text-sm font-bold text-gray-700 hover:border-primary-600/50 transition-colors">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              {monthName.slice(0, 3)} {year}
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
                      <button key={m} onClick={() => { setMonth(i + 1); setMonthPickerOpen(false); setSelectedDay(null); }}
                        className={`py-2 rounded-xl text-xs font-bold transition-all ${active ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                      >{m}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => { if (month === 12) { setYear(y => y + 1); setMonth(1); } else setMonth(m => m + 1); setSelectedDay(null); }}
            disabled={todayIsCurrentMonth}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-30">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>
      </div>

      {/* Full-width Calendar + Side Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        <div className="lg:col-span-3 card overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1.5 px-2 pt-2 border-b border-gray-100">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 p-2 gap-1.5">
              {Array.from({ length: 35 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 p-2 gap-1.5">
              {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const log = logMap.get(day);
                const isToday = day === today.getDate() && todayIsCurrentMonth;
                const isFuture = new Date(year, month - 1, day) > today;
                const isSelected = day === effectiveDay;
                const c = log ? STATUS_COLORS[log.status] : null;

                return (
                  <button
                    key={day}
                    disabled={isFuture}
                    onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                    className={`relative flex flex-col items-center justify-center h-16 rounded-xl transition-all ${
                      isSelected ? 'ring-2 ring-primary-500 ring-offset-1' :
                      isToday && !isSelected ? 'ring-2 ring-primary-600 ring-offset-1' : ''
                    } ${
                      log && c ? `${c.bg} hover:opacity-80` :
                      isToday ? 'bg-primary-50 text-primary-700 hover:bg-primary-100' :
                      isFuture ? 'bg-gray-50 text-gray-300' :
                      'bg-gray-50 text-gray-500 hover:bg-gray-100'
                    } ${isFuture ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {log && c && !isFuture && (
                      <span className={`absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full ${c.dot}`} />
                    )}
                    <span className={`text-sm font-black ${log && c ? c.text : ''}`}>{day}</span>
                    {log && !isFuture && (
                      <span className={`text-[8px] font-bold mt-0.5 ${c?.text || ''}`}>
                        {log.status === 'Present' ? 'P' : log.status === 'Late' ? 'L' : log.status === 'Absent' ? 'A' : log.status === 'Leave' ? 'Lv' : log.status === 'WeeklyOff' ? 'W' : log.status === 'Holiday' ? 'H' : '\u00BD'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-3">
            {Object.entries(STATUS_COLORS).map(([status, c]) => (
              <div key={status} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className="text-[10px] text-gray-500">{status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Day Detail Panel */}
        <div className="lg:col-span-2 card overflow-hidden lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] flex flex-col">
          {!selectedLog || !selDate ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center flex-1">
              <CalendarDays className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm font-semibold text-gray-500">Pick a day</p>
              <p className="text-xs text-gray-400 mt-1">Click any date to see details</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge status={selectedLog.status} />
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
                  <div className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wide shrink-0">
                    All Punches ({selPunches.length})
                  </div>
                  <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
                    {selPunches.map((p, i) => (
                      <div key={i} className="px-4 py-2 flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-md flex items-center justify-center ${p.direction === 'IN' ? 'bg-success-500/15 text-success-600' : 'bg-danger-500/15 text-danger-500'}`}>
                          {p.direction === 'IN' ? <LogIn className="w-3 h-3" /> : <LogOut className="w-3 h-3" />}
                        </div>
                        <span className={`text-[11px] font-bold ${p.direction === 'IN' ? 'text-success-600' : 'text-danger-500'}`}>{p.direction}</span>
                        <span className="text-[10px] text-gray-400 truncate">{p.deviceName}</span>
                        <span className="ml-auto text-xs font-black text-gray-800 tabular-nums">{formatTime(p.time)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
