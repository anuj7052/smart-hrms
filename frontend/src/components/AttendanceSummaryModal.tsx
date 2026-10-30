import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Loader2, TrendingUp, Clock, CheckCircle2, XCircle, CalendarOff, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { AttendanceLog, AttendanceStatus } from '../types';

type Period = 'week' | 'month';

interface Props {
  /** DB employee id (`_id`/`id`) used by /attendance/employee/:id */
  employeeId: string;
  employeeName: string;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  Present: '#16A34A',
  Late: '#D97706',
  Absent: '#DC2626',
  Leave: '#7C3AED',
  HalfDay: '#EA580C',
};

function getDateOnlyDay(iso: string): number {
  return new Date(iso).getUTCDate();
}

export default function AttendanceSummaryModal({ employeeId, employeeName, onClose }: Props) {
  const today = new Date();
  const [period, setPeriod] = useState<Period>('week');
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);

  const month = today.getMonth() + 1;
  const year = today.getFullYear();

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ logs: AttendanceLog[] }>(`/attendance/employee/${employeeId}`, {
        params: { month, year },
      });
      setLogs(res.data.logs || []);
    } catch {
      toast.error('Failed to load attendance summary');
    } finally {
      setLoading(false);
    }
  }, [employeeId, month, year]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // ── Filter to current week or current month ───────────────────────────────
  const periodLogs = useMemo(() => {
    if (period === 'month') return logs;
    // Current week: Monday → today (IST agnostic; use calendar week)
    const start = new Date(today);
    const day = start.getDay(); // 0 = Sun
    const diff = (day === 0 ? 6 : day - 1); // days since Monday
    start.setDate(start.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return logs.filter((l) => {
      const d = new Date(l.date);
      return d >= start && d <= today;
    });
  }, [logs, period]);

  // ── Compute stats ─────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const counts: Record<string, number> = { Present: 0, Late: 0, Absent: 0, Leave: 0, HalfDay: 0, WeeklyOff: 0, Holiday: 0 };
    periodLogs.forEach((l) => { if (l.status in counts) counts[l.status]++; });
    const present = counts.Present;
    const late = counts.Late;
    const absent = counts.Absent;
    const leave = counts.Leave;
    const halfDay = counts.HalfDay;
    // Attended = on-time + late + half day (counts as partial)
    const attended = present + late;
    // Working days considered = attended + absent + halfDay (exclude weekly off / holiday / leave)
    const workingDays = attended + absent + halfDay;
    const pct = workingDays > 0 ? Math.round(((attended + halfDay * 0.5) / workingDays) * 100) : 0;
    // Punctuality = on-time / attended
    const punctualityPct = attended > 0 ? Math.round((present / attended) * 100) : 0;
    return { present, late, absent, leave, halfDay, attended, workingDays, pct, punctualityPct };
  }, [periodLogs]);

  const pieData = useMemo(() => ([
    { name: 'On time', value: stats.present, color: STATUS_COLORS.Present },
    { name: 'Late', value: stats.late, color: STATUS_COLORS.Late },
    { name: 'Absent', value: stats.absent, color: STATUS_COLORS.Absent },
    { name: 'Half Day', value: stats.halfDay, color: STATUS_COLORS.HalfDay },
    { name: 'Leave', value: stats.leave, color: STATUS_COLORS.Leave },
  ].filter((d) => d.value > 0)), [stats]);

  // Daily work-hours bar for the period
  const barData = useMemo(() => {
    return [...periodLogs]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((l) => ({
        day: getDateOnlyDay(l.date),
        hours: Number((l.workHours ?? 0).toFixed(1)),
        status: l.status as AttendanceStatus,
      }));
  }, [periodLogs]);

  const periodLabel = period === 'week' ? 'This Week' : `${today.toLocaleString('default', { month: 'long' })} ${year}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-3xl border border-gray-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.25)] max-h-[92vh] overflow-hidden flex flex-col animate-slide-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-gray-900 tracking-tight truncate">Attendance Summary</h2>
              <p className="text-xs text-gray-500 truncate">{employeeName}</p>
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period toggle */}
        <div className="px-6 pt-4 shrink-0">
          <div className="inline-flex rounded-xl bg-gray-100 p-1">
            {(['week', 'month'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-5 py-2 rounded-lg text-sm font-bold capitalize transition-all ${
                  period === p ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {p === 'week' ? 'This Week' : 'This Month'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top: donut % + headline stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {/* Attendance % donut */}
                <div className="card p-4 flex flex-col items-center justify-center">
                  <p className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-1">{periodLabel}</p>
                  <div className="relative w-44 h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData.length > 0 ? pieData : [{ name: 'No data', value: 1, color: '#E5E7EB' }]}
                          dataKey="value"
                          innerRadius={56}
                          outerRadius={78}
                          paddingAngle={pieData.length > 1 ? 2 : 0}
                          startAngle={90}
                          endAngle={-270}
                        >
                          {(pieData.length > 0 ? pieData : [{ color: '#E5E7EB' }]).map((entry, i) => (
                            <Cell key={i} fill={entry.color} stroke="none" />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-3xl font-black text-gray-900">{stats.pct}%</span>
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Attendance</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Present <strong className="text-gray-700">{stats.attended}</strong> of <strong className="text-gray-700">{stats.workingDays}</strong> working days
                  </p>
                </div>

                {/* Headline stats grid */}
                <div className="grid grid-cols-2 gap-3 content-center">
                  <StatTile icon={CheckCircle2} label="On time" value={stats.present} color="#16A34A" bg="bg-success-500/10" />
                  <StatTile icon={AlertTriangle} label="Days late" value={stats.late} color="#D97706" bg="bg-amber-400/10" />
                  <StatTile icon={XCircle} label="Absent" value={stats.absent} color="#DC2626" bg="bg-danger-500/10" />
                  <StatTile icon={CalendarOff} label="On leave" value={stats.leave} color="#7C3AED" bg="bg-purple-500/10" />
                </div>
              </div>

              {/* Punctuality bar */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-700 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-primary-600" /> Punctuality
                  </p>
                  <span className="text-sm font-black text-gray-900">{stats.punctualityPct}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-success-500 to-success-600 transition-all" style={{ width: `${stats.punctualityPct}%` }} />
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Arrived on time {stats.present} of {stats.attended} attended day{stats.attended !== 1 ? 's' : ''}
                  {stats.late > 0 && <> · late {stats.late} time{stats.late !== 1 ? 's' : ''}</>}
                </p>
              </div>

              {/* Daily work hours bar chart */}
              {barData.length > 0 && (
                <div className="card p-4">
                  <p className="text-sm font-bold text-gray-700 mb-3">Daily work hours</p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={barData} barSize={period === 'month' ? 8 : 22}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                      <Tooltip
                        formatter={(v) => [`${v} h`, 'Work hours']}
                        labelFormatter={(d) => `Day ${d}`}
                        cursor={{ fill: 'rgba(2,76,128,0.05)' }}
                      />
                      <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                        {barData.map((entry, i) => (
                          <Cell key={i} fill={STATUS_COLORS[entry.status] || '#94A3B8'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {pieData.length === 0 && (
                <div className="text-center py-6 text-sm text-gray-400">
                  No attendance records for {periodLabel.toLowerCase()}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, color, bg }: { icon: React.ElementType; label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-2xl p-3 flex flex-col gap-1`}>
      <div className="flex items-center gap-1.5">
        <Icon className="w-4 h-4" style={{ color }} />
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <span className="text-2xl font-black leading-none" style={{ color }}>{value}</span>
    </div>
  );
}
