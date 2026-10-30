import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Download, ChevronLeft, ChevronRight, Loader2,
  CalendarDays, X, LogIn, LogOut, ChevronDown,
  Users, CheckCircle, Clock, Search, FileSpreadsheet,
  LayoutGrid, Table2, Pencil, Save,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { AttendanceStatus } from '../types';
import { useAuth } from '../context/AuthContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const STATUS_META: Record<AttendanceStatus, { bg: string; text: string; dot: string; label: string; code: string; cell: string }> = {
  Present:   { bg: 'bg-emerald-500/15', text: 'text-emerald-600', dot: 'bg-emerald-500', label: 'Present',    code: 'P',   cell: 'bg-emerald-50 text-emerald-700 font-bold' },
  Late:      { bg: 'bg-amber-500/15',   text: 'text-amber-600',   dot: 'bg-amber-500',   label: 'Late',       code: 'L',   cell: 'bg-amber-50 text-amber-700 font-bold'   },
  Absent:    { bg: 'bg-red-500/15',     text: 'text-red-500',     dot: 'bg-red-500',     label: 'Absent',     code: 'A',   cell: 'bg-red-50 text-red-600 font-bold'       },
  HalfDay:   { bg: 'bg-yellow-500/15',  text: 'text-yellow-600',  dot: 'bg-yellow-400',  label: 'Half Day',   code: '½',   cell: 'bg-yellow-50 text-yellow-700 font-bold' },
  Leave:     { bg: 'bg-blue-500/15',    text: 'text-blue-600',    dot: 'bg-blue-500',    label: 'Leave',      code: 'Lv',  cell: 'bg-blue-50 text-blue-700 font-bold'     },
  Holiday:   { bg: 'bg-gray-200/80',    text: 'text-gray-500',    dot: 'bg-gray-400',    label: 'Holiday',    code: 'H',   cell: 'bg-gray-100 text-gray-500'              },
  WeeklyOff: { bg: 'bg-purple-500/15',  text: 'text-purple-600',  dot: 'bg-purple-400',  label: 'Weekly Off', code: 'W',   cell: 'bg-purple-50 text-purple-600'           },
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  employeeId: string;
  name: string;
  department: string;
  present: number;
  late: number;
  absent: number;
  leave: number;
  totalWorkHours: string;
}

interface SheetDayCell {
  status: string;
  logId: string;
  punchIn: string | null;
  punchOut: string | null;
}

interface SheetRow {
  employeeId: string;
  name: string;
  department: string;
  days: Record<number, SheetDayCell>;
  presentCount: number;
  lateCount: number;
  absentCount: number;
  leaveCount: number;
  totalWorkHours: string;
}

interface EditTarget {
  logId: string;
  employeeId: string;
  name: string;
  day: number;
  status: string;
  punchIn: string;
  punchOut: string;
}

interface DayRosterEntry {
  employeeId: string;
  name: string;
  department?: string;
  status: AttendanceStatus;
  punchIn?: string | null;
  punchOut?: string | null;
  workHours?: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getFirstDayOfWeek(y: number, m: number) { return new Date(y, m - 1, 1).getDay(); }

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function makeUTCDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin' || user?.role === 'HR';
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('');
  const [summary, setSummary] = useState<Summary[]>([]);
  const [dayStats, setDayStats] = useState<Map<number, { present: number; late: number; absent: number }>>(new Map());
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);
  const [sheetDaysInMonth, setSheetDaysInMonth] = useState(0);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | 'excel' | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'calendar' | 'sheet'>('sheet');
  const monthPickerRef = useRef<HTMLDivElement>(null);

  // Day detail panel state
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());
  const [dayRoster, setDayRoster] = useState<DayRosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);

  // Edit attendance modal state
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editPunchIn, setEditPunchIn] = useState('');
  const [editPunchOut, setEditPunchOut] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayOffset = getFirstDayOfWeek(year, month);
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  const todayIsCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  // ── Data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    api.get<string[]>('/employees/departments').then((r: { data: string[] }) => setDepartments(r.data)).catch(() => {});
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/monthly', { params: { month, year, department: department || undefined } });
      setSummary(res.data.summary);
      const map = new Map<number, { present: number; late: number; absent: number }>();
      (res.data.dailyBreakdown || []).forEach((d: { date: string; present: number; late: number; absent: number }) => {
        const day = parseInt(d.date.split('-')[2], 10);
        if (day) map.set(day, { present: d.present, late: d.late, absent: d.absent });
      });
      setDayStats(map);
    } catch {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [month, year, department]);

  const fetchSheet = useCallback(async () => {
    setSheetLoading(true);
    try {
      const res = await api.get('/reports/sheet', { params: { month, year, department: department || undefined } });
      setSheetRows(res.data.rows);
      setSheetDaysInMonth(res.data.daysInMonth);
    } catch {
      toast.error('Failed to load sheet data');
    } finally {
      setSheetLoading(false);
    }
  }, [month, year, department]);

  useEffect(() => { fetchReport(); }, [fetchReport]);
  useEffect(() => { if (viewMode === 'sheet') fetchSheet(); }, [fetchSheet, viewMode]);

  const fetchDayRoster = useCallback(async (day: number) => {
    setRosterLoading(true);
    try {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const res = await api.get<{ feed: { empCode: string; name: string; department?: string; status: string; punchIn?: string | null; punchOut?: string | null; workHours?: number | null }[] }>(
        '/attendance/by-date',
        { params: { date: dateStr } }
      );
      setDayRoster((res.data.feed || []).map(f => ({
        employeeId: f.empCode,
        name: f.name,
        department: f.department,
        status: f.status as AttendanceStatus,
        punchIn: f.punchIn,
        punchOut: f.punchOut,
        workHours: f.workHours,
      })));
    } catch {
      setDayRoster([]);
    } finally {
      setRosterLoading(false); }
  }, [year, month]);

  useEffect(() => {
    if (selectedDay !== null) fetchDayRoster(selectedDay);
  }, [selectedDay, fetchDayRoster]);

  // Close month picker on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) setMonthPickerOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Filtered data ──────────────────────────────────────────────────────────

  const filteredSummary = summary.filter(row => {
    const matchSearch = !employeeSearch || row.name.toLowerCase().includes(employeeSearch.toLowerCase()) || row.employeeId.toLowerCase().includes(employeeSearch.toLowerCase());
    return matchSearch;
  });

  const filteredRoster = dayRoster.filter(emp => {
    const matchDept = !department || emp.department === department;
    const matchSearch = !employeeSearch || emp.name.toLowerCase().includes(employeeSearch.toLowerCase()) || emp.employeeId.toLowerCase().includes(employeeSearch.toLowerCase());
    const matchStatus = !statusFilter || emp.status === statusFilter;
    return matchDept && matchSearch && matchStatus;
  });

  // ── Export ─────────────────────────────────────────────────────────────────

  async function exportFile(type: 'csv' | 'pdf' | 'excel') {
    setExporting(type);
    try {
      const endpoint = type === 'excel' ? '/reports/export/excel' : `/reports/export/${type}`;
      const ext = type === 'excel' ? 'xlsx' : type;
      const res = await api.get(endpoint, {
        params: { month, year, department: department || undefined },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `attendance_sheet_${year}_${String(month).padStart(2, '0')}${department ? `_${department.replace(/\s+/g, '_')}` : ''}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(null);
    }
  }

  // ── Edit attendance ─────────────────────────────────────────────────────────

  function openEdit(row: SheetRow, day: number, cell: SheetDayCell) {
    // Convert UTC ISO → IST HH:MM for the time <input type="time">
    // IST = UTC + 5h 30m
    const toISTTime = (iso: string | null): string => {
      if (!iso) return '';
      const utcMs = new Date(iso).getTime();
      const istMs = utcMs + 330 * 60 * 1000; // +5:30
      const ist = new Date(istMs);
      return `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}`;
    };
    setEditTarget({ logId: cell.logId, employeeId: row.employeeId, name: row.name, day, status: cell.status, punchIn: cell.punchIn || '', punchOut: cell.punchOut || '' });
    setEditStatus(cell.status);
    setEditPunchIn(toISTTime(cell.punchIn));
    setEditPunchOut(toISTTime(cell.punchOut));
    setEditReason('');
  }

  async function saveEdit() {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      // User enters times in IST; convert to UTC before storing (IST - 5:30)
      const istTimeToUTCIso = (timeStr: string): string | null => {
        if (!timeStr) return null;
        const [h, min] = timeStr.split(':').map(Number);
        // Treat the time as on the attendance date in IST, then shift to UTC
        const istMs = Date.UTC(year, month - 1, editTarget!.day, h, min, 0);
        const utcMs = istMs - 330 * 60 * 1000; // subtract 5:30
        return new Date(utcMs).toISOString();
      };
      await api.patch(`/reports/attendance/${editTarget.logId}`, {
        status: editStatus,
        punchIn: editPunchIn ? istTimeToUTCIso(editPunchIn) : null,
        punchOut: editPunchOut ? istTimeToUTCIso(editPunchOut) : null,
        reason: editReason || undefined,
      });
      toast.success('Attendance updated');
      setEditTarget(null);
      fetchSheet();
    } catch {
      toast.error('Failed to update attendance');
    } finally {
      setEditSaving(false);
    }
  }

  // ── Derived stats ──────────────────────────────────────────────────────────

  const totalEmployees = summary.length;
  const avgPresent = totalEmployees > 0
    ? Math.round(Array.from(dayStats.values()).reduce((s, d) => s + d.present + d.late, 0) / Math.max(1, dayStats.size))
    : 0;

  const filteredSheetRows = sheetRows.filter(row => {
    const matchSearch = !employeeSearch || row.name.toLowerCase().includes(employeeSearch.toLowerCase()) || row.employeeId.toLowerCase().includes(employeeSearch.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="text-xs text-gray-500 mt-0.5">Attendance sheet & monthly summary — {monthName} {year}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Toggle */}
          <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
            <button onClick={() => setViewMode('sheet')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'sheet' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Table2 className="w-3.5 h-3.5" /> Sheet
            </button>
            <button onClick={() => setViewMode('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <LayoutGrid className="w-3.5 h-3.5" /> Calendar
            </button>
          </div>
          <div className="w-px h-6 bg-gray-200" />
          {/* Export buttons */}
          <button onClick={() => exportFile('excel')} disabled={!!exporting} className="btn-secondary flex items-center gap-2 text-sm">
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4 text-emerald-600" />}
            Excel
          </button>
          <button onClick={() => exportFile('csv')} disabled={!!exporting} className="btn-secondary flex items-center gap-2 text-sm">
            {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            CSV
          </button>
          <button onClick={() => exportFile('pdf')} disabled={!!exporting} className="btn-secondary flex items-center gap-2 text-sm">
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            PDF
          </button>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────────────── */}
      <div className="card p-4 flex flex-wrap items-center gap-3">
        {/* Month navigation with picker */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => { if (month === 1) { setYear(y => y - 1); setMonth(12); } else setMonth(m => m - 1); setSelectedDay(null); }}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div className="relative" ref={monthPickerRef}>
            <button
              onClick={() => setMonthPickerOpen(!monthPickerOpen)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border bg-white border-gray-200 text-sm font-bold text-gray-700 hover:border-primary-600/50 transition-colors min-w-[130px] justify-center"
            >
              <CalendarDays className="w-4 h-4 text-gray-400" />
              {monthName} {year}
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
            {monthPickerOpen && (
              <div className="absolute left-0 top-full mt-2 z-50 w-64 rounded-2xl border border-gray-200 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.15)] p-3">
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
                          active ? 'bg-primary-600 text-white shadow-sm' :
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
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200 hidden sm:block" />

        {/* Department filter */}
        <select
          className="input text-sm py-2 min-w-[160px]"
          value={department}
          onChange={(e) => { setDepartment(e.target.value); setSelectedDay(null); }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Status filter */}
        <select
          className="input text-sm py-2 min-w-[140px]"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AttendanceStatus | '')}
        >
          <option value="">All Statuses</option>
          {(Object.keys(STATUS_META) as AttendanceStatus[]).map(s => (
            <option key={s} value={s}>{STATUS_META[s].label}</option>
          ))}
        </select>

        {/* Employee search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search employee…"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            className="input text-sm py-2 pl-8 w-full"
          />
          {employeeSearch && (
            <button onClick={() => setEmployeeSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-gray-100">
              <X className="w-3 h-3 text-gray-400" />
            </button>
          )}
        </div>

        {/* Quick stats */}
        <div className="ml-auto hidden lg:flex items-center gap-4 text-xs text-gray-500 shrink-0">
          <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5 text-primary-500" /><b className="text-gray-700">{totalEmployees}</b> employees</span>
          <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /><b className="text-gray-700">~{avgPresent}</b>/day avg</span>
        </div>
      </div>

      {/* ── Calendar + Day Detail ───────────────────────────────────────────── */}
      {viewMode === 'calendar' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 card overflow-hidden">
          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 px-2 pt-3 pb-1 border-b border-gray-100">
            {WEEKDAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-bold text-gray-400 uppercase tracking-wider py-1">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 p-2 gap-1">
              {Array.from({ length: 35 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 p-2 gap-1">
              {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const isToday = day === today.getDate() && todayIsCurrentMonth;
                const isFuture = new Date(year, month - 1, day) > today;
                const isSelected = day === selectedDay;
                const dayOfWeek = new Date(year, month - 1, day).getDay();
                const isSunday = dayOfWeek === 0;
                const isSaturday = dayOfWeek === 6;
                const stat = dayStats.get(day);
                const total = stat ? stat.present + stat.late + stat.absent : 0;
                // Color intensity based on presence
                const presenceRatio = totalEmployees > 0 && stat ? (stat.present + stat.late) / totalEmployees : 0;
                const bgIntensity = !isFuture && !isSunday && stat && total > 0
                  ? presenceRatio > 0.8 ? 'bg-emerald-50' : presenceRatio > 0.5 ? 'bg-amber-50/60' : 'bg-red-50/40'
                  : '';

                return (
                  <button
                    key={day}
                    disabled={isFuture}
                    onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                    className={`relative flex flex-col items-center justify-start pt-2 pb-1.5 px-1 min-h-[76px] rounded-xl text-sm transition-all ${
                      isSelected ? 'ring-2 ring-primary-500 bg-primary-50' :
                      isToday ? 'ring-2 ring-primary-500 ring-offset-1' :
                      bgIntensity
                    } ${
                      isFuture ? 'opacity-25 cursor-default' :
                      isSunday ? 'bg-red-50/50' :
                      !bgIntensity ? 'hover:bg-gray-50' : 'hover:opacity-80'
                    } cursor-pointer`}
                  >
                    <span className={`text-sm font-black mb-1 ${
                      isToday ? 'w-6 h-6 rounded-full bg-primary-600 text-white flex items-center justify-center text-xs' :
                      isSunday ? 'text-red-400' :
                      isSaturday ? 'text-orange-500' :
                      'text-gray-800'
                    }`}>
                      {day}
                    </span>
                    {isSunday && !isFuture ? (
                      <span className="text-[9px] font-semibold text-red-300">Off</span>
                    ) : !isFuture && stat && total > 0 ? (
                      <div className="flex flex-col items-center gap-0.5 w-full">
                        {stat.present > 0 && (
                          <div className="flex items-center gap-0.5 w-full justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                            <span className="text-[9px] font-bold text-emerald-700">{stat.present}P</span>
                          </div>
                        )}
                        {stat.late > 0 && (
                          <div className="flex items-center gap-0.5 w-full justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                            <span className="text-[9px] font-bold text-amber-700">{stat.late}L</span>
                          </div>
                        )}
                        {stat.absent > 0 && (
                          <div className="flex items-center gap-0.5 w-full justify-center">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                            <span className="text-[9px] font-bold text-red-600">{stat.absent}A</span>
                          </div>
                        )}
                      </div>
                    ) : !isFuture && !isSunday ? (
                      <span className="text-[9px] text-gray-300">—</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="text-[10px] text-gray-500">P = Present</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /><span className="text-[10px] text-gray-500">L = Late</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-[10px] text-gray-500">A = Absent</span></div>
            <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-200" /><span className="text-[10px] text-gray-500">Sunday = Off</span></div>
            <div className="ml-auto flex items-center gap-3 text-[10px] text-gray-400">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> High attendance</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200" /> Medium</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-200" /> Low</span>
            </div>
          </div>
        </div>

        {/* ── Day Detail Panel ───────────────────────────────────────────────── */}
        <div className="card overflow-hidden flex flex-col lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)]">
          {selectedDay === null ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center flex-1">
              <CalendarDays className="w-10 h-10 text-gray-200 mb-3" />
              <p className="text-sm font-semibold text-gray-500">Select a day</p>
              <p className="text-xs text-gray-400 mt-1">Click any date to see employee attendance</p>
            </div>
          ) : (
            <>
              <div className="p-4 border-b border-gray-100 shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-gray-900 text-sm">
                      {makeUTCDate(year, month, selectedDay).toLocaleDateString('en-IN', {
                        weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC',
                      })}
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {rosterLoading ? 'Loading…' : `${filteredRoster.filter(r => r.status === 'Present' || r.status === 'Late').length} present · ${filteredRoster.length} total`}
                    </p>
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                </div>
                {/* Status counts for selected day */}
                {!rosterLoading && filteredRoster.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(['Present', 'Late', 'Absent', 'Leave', 'HalfDay'] as AttendanceStatus[]).map(s => {
                      const count = filteredRoster.filter(r => r.status === s).length;
                      if (!count) return null;
                      const m = STATUS_META[s];
                      return (
                        <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${m.bg} ${m.text}`}>
                          {count} {m.label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {rosterLoading ? (
                <div className="flex-1 flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                </div>
              ) : filteredRoster.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12 text-center px-4">
                  <CalendarDays className="w-8 h-8 text-gray-200 mb-2" />
                  <p className="text-sm text-gray-400">No records for this day</p>
                  {(department || employeeSearch || statusFilter) && (
                    <p className="text-xs text-gray-400/70 mt-1">Try clearing filters</p>
                  )}
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
                  {filteredRoster
                    .sort((a, b) => {
                      const order: Record<string, number> = { Present: 0, Late: 1, HalfDay: 2, Absent: 3, Leave: 4, WeeklyOff: 5, Holiday: 6 };
                      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
                    })
                    .map((emp) => (
                      <div key={emp.employeeId} className="px-4 py-3 flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-primary-700">{emp.name[0]?.toUpperCase()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-bold text-gray-900 truncate">{emp.name}</p>
                          <p className="text-[10px] text-gray-400">{emp.employeeId}{emp.department ? ` · ${emp.department}` : ''}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <StatusBadge status={emp.status} />
                          </div>
                          {(emp.punchIn || emp.punchOut) && (
                            <div className="flex items-center gap-3 mt-1">
                              {emp.punchIn && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <LogIn className="w-2.5 h-2.5 text-emerald-500" />{formatTime(emp.punchIn)}
                                </span>
                              )}
                              {emp.punchOut && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <LogOut className="w-2.5 h-2.5 text-red-400" />{formatTime(emp.punchOut)}
                                </span>
                              )}
                              {emp.workHours != null && emp.workHours > 0 && (
                                <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                                  <Clock className="w-2.5 h-2.5 text-gray-400" />{emp.workHours}h
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
        </div>
      )} {/* end viewMode === 'calendar' */}

      {/* ── Sheet View ─────────────────────────────────────────────────────── */}
      {viewMode === 'sheet' && (
        <div className="card overflow-hidden">
          {/* Sheet header */}
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-bold text-gray-900 text-base">Attendance Sheet — {monthName} {year}{department ? ` · ${department}` : ''}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{filteredSheetRows.length} employee{filteredSheetRows.length !== 1 ? 's' : ''} · {sheetDaysInMonth} days</p>
          </div>

          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-max w-full">
              <thead>
                {/* Day-of-week row */}
                <tr className="bg-gray-700 text-white">
                  <th className="sticky left-0 z-10 bg-gray-700 px-3 py-2 text-left font-semibold min-w-[80px] border-r border-gray-600">Emp ID</th>
                  <th className="sticky left-[80px] z-10 bg-gray-700 px-3 py-2 text-left font-semibold min-w-[140px] border-r border-gray-600">Name</th>
                  <th className="px-2 py-2 text-center font-semibold min-w-[44px] border-r border-gray-600">Dept</th>
                  {Array.from({ length: sheetDaysInMonth }, (_, i) => {
                    const d = new Date(year, month - 1, i + 1);
                    const dow = d.getDay();
                    return (
                      <th key={i} className={`px-1 py-2 text-center font-semibold min-w-[34px] border-r border-gray-600 ${dow === 0 ? 'bg-red-700' : dow === 6 ? 'bg-orange-700' : ''}`}>
                        <div>{i + 1}</div>
                        <div className="text-[9px] font-normal opacity-75">{['Su','Mo','Tu','We','Th','Fr','Sa'][dow]}</div>
                      </th>
                    );
                  })}
                  <th className="px-2 py-2 text-center font-bold min-w-[40px] border-r border-gray-600 bg-emerald-800">P</th>
                  <th className="px-2 py-2 text-center font-bold min-w-[40px] border-r border-gray-600 bg-amber-800">L</th>
                  <th className="px-2 py-2 text-center font-bold min-w-[40px] border-r border-gray-600 bg-red-800">A</th>
                  <th className="px-2 py-2 text-center font-bold min-w-[40px] border-gray-600 bg-blue-800">Lv</th>
                </tr>
              </thead>
              <tbody>
                {sheetLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="sticky left-0 bg-white px-3 py-2 border-r border-gray-100"><div className="skeleton h-3 w-16 rounded" /></td>
                      <td className="sticky left-[80px] bg-white px-3 py-2 border-r border-gray-100"><div className="skeleton h-3 w-28 rounded" /></td>
                      <td className="px-2 py-2 border-r border-gray-100"><div className="skeleton h-3 w-10 rounded" /></td>
                      {Array.from({ length: 12 }).map((_, j) => <td key={j} className="px-1 py-2 border-r border-gray-100"><div className="skeleton h-3 w-6 rounded mx-auto" /></td>)}
                      <td colSpan={4} />
                    </tr>
                  ))
                ) : filteredSheetRows.length === 0 ? (
                  <tr><td colSpan={sheetDaysInMonth + 7} className="px-4 py-12 text-center text-gray-400">No data for this period</td></tr>
                ) : filteredSheetRows.map((row, idx) => (
                  <tr key={row.employeeId} className={`border-b border-gray-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-primary-50/30 transition-colors`}>
                    <td className={`sticky left-0 z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} px-3 py-2 border-r border-gray-200 font-mono text-gray-600 text-[11px]`}>{row.employeeId}</td>
                    <td className={`sticky left-[80px] z-10 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} px-3 py-2 border-r border-gray-200 font-semibold text-gray-900 whitespace-nowrap`}>{row.name}</td>
                    <td className="px-2 py-2 border-r border-gray-100 text-gray-500 text-[10px] whitespace-nowrap max-w-[80px] truncate">{row.department}</td>
                    {Array.from({ length: sheetDaysInMonth }, (_, i) => {
                      const day = i + 1;
                      const cell = row.days[day] as SheetDayCell | undefined;
                      const status = cell?.status as AttendanceStatus | undefined;
                      const dow = new Date(year, month - 1, day).getDay();
                      const isSunday = dow === 0;
                      if (!cell || !status) {
                        return (
                          <td key={i} className={`border-r border-gray-100 text-center ${isSunday ? 'bg-red-50' : ''}`}>
                            <span className="text-gray-300 text-[10px]">—</span>
                          </td>
                        );
                      }
                      const m = STATUS_META[status];
                      return (
                        <td key={i} className="border-r border-gray-100 text-center p-0">
                          {isAdmin ? (
                            <button
                              onClick={() => openEdit(row, day, cell)}
                              className={`group relative inline-flex items-center justify-center w-full h-full min-h-[28px] px-1 py-1 text-[11px] font-bold ${m.cell} hover:ring-2 hover:ring-primary-400 hover:ring-inset transition-all`}
                              title={`${m.label} — click to edit`}
                            >
                              {m.code}
                              <Pencil className="absolute top-0.5 right-0.5 w-2 h-2 opacity-0 group-hover:opacity-60" />
                            </button>
                          ) : (
                            <span className={`inline-flex items-center justify-center w-full h-full min-h-[28px] px-1 py-1 text-[11px] font-bold ${m.cell}`} title={m.label}>
                              {m.code}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {/* Summary counts */}
                    <td className="px-2 py-2 text-center border-r border-gray-100">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-5 rounded bg-emerald-100 text-emerald-700 text-[11px] font-bold px-1">{row.presentCount}</span>
                    </td>
                    <td className="px-2 py-2 text-center border-r border-gray-100">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-5 rounded bg-amber-100 text-amber-700 text-[11px] font-bold px-1">{row.lateCount}</span>
                    </td>
                    <td className="px-2 py-2 text-center border-r border-gray-100">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-5 rounded bg-red-100 text-red-600 text-[11px] font-bold px-1">{row.absentCount}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span className="inline-flex items-center justify-center min-w-[24px] h-5 rounded bg-blue-100 text-blue-700 text-[11px] font-bold px-1">{row.leaveCount}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Legend ── */}
          <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/50">
            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Legend</p>
            <div className="flex flex-wrap gap-3">
              {(Object.entries(STATUS_META) as [AttendanceStatus, typeof STATUS_META[AttendanceStatus]][]).map(([_key, m]) => (
                <div key={m.code} className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded text-[11px] font-bold ${m.cell}`}>{m.code}</span>
                  <span className="text-[11px] text-gray-600">= {m.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-gray-200">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded text-[11px] text-gray-300 bg-white border border-gray-200">—</span>
                <span className="text-[11px] text-gray-600">= No record</span>
              </div>
            </div>
          </div>
        </div>
      )} {/* end viewMode === 'sheet' */}

      {/* ── Monthly Summary Table (calendar mode only) ──────────────────────── */}
      {viewMode === 'calendar' && (
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Employee Summary — {monthName} {year}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {filteredSummary.length} employee{filteredSummary.length !== 1 ? 's' : ''}
              {department ? ` · ${department}` : ''}
              {employeeSearch ? ` · "${employeeSearch}"` : ''}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Department</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-center">Present</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-center">Late</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-center">Absent</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-center hidden md:table-cell">Leave</th>
                <th className="px-4 py-3 font-medium text-gray-600 text-right hidden lg:table-cell">Work Hrs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>)}</tr>
                ))
              ) : filteredSummary.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No data for this period</td></tr>
              ) : filteredSummary.map((row) => (
                <tr key={row.employeeId} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{row.name}</p>
                    <p className="text-xs text-gray-400">{row.employeeId}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 hidden sm:table-cell">{row.department}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold px-2">{row.present}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold px-2">{row.late}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold px-2">{row.absent}</span>
                  </td>
                  <td className="px-4 py-3 text-center hidden md:table-cell">
                    <span className="inline-flex items-center justify-center min-w-[28px] h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2">{row.leave}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600 hidden lg:table-cell font-medium">{row.totalWorkHours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      )} {/* end viewMode === 'calendar' summary */}

      {/* ── Edit Attendance Modal ─────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-black text-gray-900 text-sm">Edit Attendance</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {editTarget.name} · {new Date(year, month - 1, editTarget.day).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })}
                </p>
              </div>
              <button onClick={() => setEditTarget(null)} className="p-1.5 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Form */}
            <div className="px-5 py-4 space-y-4">
              {/* Status */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Status</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['Present', 'Late', 'Absent', 'HalfDay', 'Leave', 'Holiday', 'WeeklyOff'] as AttendanceStatus[]).map(s => {
                    const m = STATUS_META[s];
                    return (
                      <button key={s} onClick={() => setEditStatus(s)}
                        className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg border-2 text-[10px] font-bold transition-all ${editStatus === s ? `${m.bg} ${m.text} border-current` : 'border-gray-100 text-gray-500 hover:border-gray-200'}`}>
                        <span className={`w-5 h-5 rounded flex items-center justify-center text-[11px] font-bold ${m.cell}`}>{m.code}</span>
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Punch In / Out */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Punch In <span className="text-[10px] font-normal text-gray-400">(IST)</span></label>
                  <input type="time" value={editPunchIn} onChange={e => setEditPunchIn(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Punch Out <span className="text-[10px] font-normal text-gray-400">(IST)</span></label>
                  <input type="time" value={editPunchOut} onChange={e => setEditPunchOut(e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400" />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reason (optional)</label>
                <input type="text" value={editReason} onChange={e => setEditReason(e.target.value)} placeholder="e.g. Device not synced"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-400" />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-2 border-t border-gray-100">
              <button onClick={() => setEditTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium">Cancel</button>
              <button onClick={saveEdit} disabled={editSaving || !editStatus}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors">
                {editSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
