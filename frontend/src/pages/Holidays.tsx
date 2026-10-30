import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { Holiday, HolidayType } from '../types';
import { formatDateIST, formatWeekdayIST } from '../lib/datetime';

function fmtDate(iso: string) {
  return formatDateIST(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function getDayName(iso: string) {
  return formatWeekdayIST(iso, true);
}

const TYPE_CONFIG: Record<HolidayType, { bg: string; text: string; icon: string; label: string }> = {
  National:       { bg: 'bg-primary/10',             text: 'text-primary',   icon: 'flag',          label: 'National' },
  Festival:       { bg: 'bg-tertiary-container/15',  text: 'text-tertiary',  icon: 'celebration',   label: 'Festival' },
  CompanyHoliday: { bg: 'bg-secondary-container/15', text: 'text-secondary-container', icon: 'apartment', label: 'Company' },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n: number): string { return String(n).padStart(2, '0'); }

interface CalendarAndUpcomingProps {
  holidays: Holiday[];
  loading: boolean;
  year: number;
  month: number;
  setYear: (y: number) => void;
  setMonth: (m: number) => void;
  isAdmin: boolean;
  upcoming: Holiday[];
  onEdit: (h: Holiday) => void;
  onDelete: (id: string) => void;
  onSeed: () => void;
  seeding: boolean;
}

function CalendarAndUpcoming({
  holidays, loading, year, month, setYear, setMonth,
  isAdmin, upcoming, onEdit, onDelete, onSeed, seeding,
}: CalendarAndUpcomingProps) {
  // Map of "YYYY-MM-DD" → Holiday (for current year filtered list)
  const holidayByDate = useMemo(() => {
    const map = new Map<string, Holiday>();
    for (const h of holidays) map.set(h.date.split('T')[0], h);
    return map;
  }, [holidays]);

  // Build the 6-week grid for the given year+month
  const grid = useMemo(() => {
    const first = new Date(year, month, 1);
    const firstWeekday = first.getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { date: Date; inMonth: boolean }[] = [];

    // Previous month overflow
    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      cells.push({ date: d, inMonth: false });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year, month, d), inMonth: true });
    // Trailing fill to 42 cells (6 weeks)
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false });
    }
    return cells;
  }, [year, month]);

  const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(year - 1); } else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(year + 1); } else setMonth(month + 1);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      {/* ── Month calendar ── */}
      <div className="lg:col-span-2 bg-white border border-primary/10 rounded-card shadow-soft-low overflow-hidden">
        <div className="px-4 py-3 border-b border-primary/5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={prevMonth}
              className="w-9 h-9 rounded-lg hover:bg-surface-container-low text-on-surface-variant transition-colors flex items-center justify-center"
              aria-label="Previous month"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_left</span>
            </button>
            <h3 className="text-headline-sm text-on-background min-w-[150px] text-center">
              {MONTHS[month]} {year}
            </h3>
            <button
              onClick={nextMonth}
              className="w-9 h-9 rounded-lg hover:bg-surface-container-low text-on-surface-variant transition-colors flex items-center justify-center"
              aria-label="Next month"
            >
              <span className="material-symbols-outlined text-[20px]">chevron_right</span>
            </button>
          </div>
          <button
            onClick={() => { const now = new Date(); setMonth(now.getMonth()); setYear(now.getFullYear()); }}
            className="px-3 py-1.5 rounded-lg border border-outline-variant text-label-md text-on-surface-variant hover:bg-surface-container-low transition-colors"
          >
            Today
          </button>
        </div>

        <div className="p-3">
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((d, i) => (
              <div
                key={d}
                className={`text-center text-[11px] font-bold uppercase tracking-wider py-1.5 ${
                  i === 0 ? 'text-red-500' : 'text-on-surface-variant'
                }`}
              >
                {d}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 42 }).map((_, i) => <div key={i} className="skeleton h-11 rounded-lg" />)}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {grid.map(({ date, inMonth }, idx) => {
                const iso = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
                const h = holidayByDate.get(iso);
                const isToday = iso === todayStr;
                const isSunday = date.getDay() === 0;
                const cfg = h ? TYPE_CONFIG[h.holidayType] : null;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => { if (h && isAdmin) onEdit(h); }}
                    disabled={!h || !isAdmin}
                    title={h ? `${h.name}${h.festivalName ? ` (${h.festivalName})` : ''}` : isSunday ? 'Sunday (Weekly Off)' : undefined}
                    className={`relative min-h-[44px] rounded-lg text-left p-1 transition-all border ${
                      !inMonth ? 'opacity-30' : ''
                    } ${
                      h
                        ? `${cfg!.bg} border-current/0 ${cfg!.text} hover:shadow-md ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`
                        : isSunday && inMonth
                        ? 'bg-red-50 border-red-100 cursor-default'
                        : 'bg-surface-container-low/40 border-transparent cursor-default'
                    } ${isToday ? 'ring-2 ring-primary ring-offset-1' : ''}`}
                  >
                    <div className="flex items-start justify-between">
                      <span className={`text-xs font-bold ${
                        isToday ? 'text-primary' :
                        h ? cfg!.text :
                        isSunday ? 'text-red-500' :
                        inMonth ? 'text-on-background' : 'text-on-surface-variant'
                      }`}>
                        {date.getDate()}
                      </span>
                      {h && (
                        <span className={`material-symbols-outlined fill text-[14px] ${cfg!.text}`}>
                          {cfg!.icon}
                        </span>
                      )}
                    </div>
                    {h && (
                      <p className={`mt-1 text-[10px] leading-tight font-semibold line-clamp-2 ${cfg!.text}`}>
                        {h.name}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="mt-2 pt-2 border-t border-primary/5 flex flex-wrap items-center gap-2.5 text-[11px] text-on-surface-variant">
            {(['National', 'Festival', 'CompanyHoliday'] as HolidayType[]).map(t => (
              <span key={t} className="inline-flex items-center gap-1.5">
                <span className={`w-3 h-3 rounded ${TYPE_CONFIG[t].bg}`} />
                {TYPE_CONFIG[t].label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-red-50 border border-red-100" />
              Sunday
            </span>
          </div>
        </div>
      </div>

      {/* ── Upcoming Holidays side panel ── */}
      <aside className="bg-white border border-primary/10 rounded-card shadow-soft-low overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-primary/5 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[20px]">upcoming</span>
          <h3 className="text-body-lg font-bold text-on-background">Upcoming Holidays</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
            </div>
          ) : upcoming.length === 0 ? (
            <div className="p-8 text-center">
              <span className="material-symbols-outlined text-[40px] text-outline-variant block mb-2">event_busy</span>
              <p className="text-body-md text-on-surface-variant">No upcoming holidays in {year}</p>
              {isAdmin && holidays.length === 0 && (
                <button
                  onClick={onSeed}
                  disabled={seeding}
                  className="mt-3 px-4 py-2 rounded-xl bg-cta-primary text-white text-label-md disabled:opacity-60"
                >
                  {seeding ? 'Loading…' : 'Load Default Holidays'}
                </button>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-primary/5">
              {upcoming.map(h => {
                const cfg = TYPE_CONFIG[h.holidayType];
                return (
                  <li key={h.id} className="p-4 hover:bg-surface-container-low/40 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl ${cfg.bg} ${cfg.text} flex flex-col items-center justify-center shrink-0`}>
                        <span className="text-[10px] font-bold uppercase leading-none">
                          {formatDateIST(h.date, { month: 'short' })}
                        </span>
                        <span className="text-[18px] font-bold leading-tight">
                          {new Date(h.date).getUTCDate()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-body-md text-on-background font-bold truncate">{h.name}</p>
                        <p className="text-body-sm text-outline truncate">
                          {getDayName(h.date)} · {cfg.label}
                          {h.isOptional && ' · Optional'}
                        </p>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => onEdit(h)}
                            className="p-1.5 rounded-lg hover:bg-primary/10 text-outline hover:text-primary transition-colors"
                            title="Edit"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            onClick={() => onDelete(h.id)}
                            className="p-1.5 rounded-lg hover:bg-error/10 text-outline hover:text-error transition-colors"
                            title="Delete"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function HolidaysPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin' || user?.role === 'HR';
  const currentYear = new Date().getFullYear();

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState<number>(new Date().getMonth()); // 0-11, used by calendar grid
  const [showModal, setShowModal] = useState(false);
  const [editModal, setEditModal] = useState<Holiday | null>(null);
  const [form, setForm] = useState({ name: '', date: '', festivalName: '', description: '', holidayType: 'CompanyHoliday' as HolidayType, isOptional: false });
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<'' | HolidayType>('');
  const [seeding, setSeeding] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<Holiday[]>('/holidays', { params: { year } });
      setHolidays(res.data);
    } catch {
      toast.error('Failed to load holidays');
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => { fetchHolidays(); }, [fetchHolidays]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/holidays', form);
      toast.success('Holiday added');
      setShowModal(false);
      setForm({ name: '', date: '', festivalName: '', description: '', holidayType: 'CompanyHoliday', isOptional: false });
      fetchHolidays();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to add');
    } finally { setSubmitting(false); }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editModal) return;
    setSubmitting(true);
    try {
      await api.put(`/holidays/${editModal.id}`, form);
      toast.success('Holiday updated');
      setEditModal(null);
      fetchHolidays();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update');
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this holiday?')) return;
    try {
      await api.delete(`/holidays/${id}`);
      toast.success('Holiday deleted');
      fetchHolidays();
    } catch { toast.error('Failed to delete'); }
  }

  async function handleSeedDefaults() {
    setSeeding(true);
    try {
      const res = await api.post<{ message: string }>('/holidays/seed-defaults', { year });
      toast.success(res.data.message);
      fetchHolidays();
    } catch { toast.error('Failed to seed holidays'); }
    finally { setSeeding(false); }
  }

  function openEditModal(h: Holiday) {
    setForm({
      name: h.name,
      date: h.date.split('T')[0],
      festivalName: h.festivalName || '',
      description: h.description || '',
      holidayType: h.holidayType,
      isOptional: h.isOptional,
    });
    setEditModal(h);
  }

  const filtered = filter ? holidays.filter(h => h.holidayType === filter) : holidays;
  const upcoming = holidays.filter(h => new Date(h.date) >= new Date(new Date().toDateString()));
  const past = holidays.filter(h => new Date(h.date) < new Date(new Date().toDateString()));

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all';

  return (
    <div className="space-y-2 pb-2 lg:pb-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold text-on-background leading-tight">
            Holidays
          </h2>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            {holidays.length} holidays in {year} · {upcoming.length} upcoming
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Year selector */}
          <select
            className="h-10 px-3 rounded-lg border border-outline-variant bg-white text-body-md"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {[currentYear - 1, currentYear, currentYear + 1].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {isAdmin && holidays.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              disabled={seeding}
              className="px-4 py-2 rounded-xl bg-secondary-container text-on-secondary-container text-label-md transition-all hover:opacity-90 disabled:opacity-60 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">auto_fix_high</span>
              {seeding ? 'Seeding…' : 'Load Defaults'}
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => { setForm({ name: '', date: '', festivalName: '', description: '', holidayType: 'CompanyHoliday', isOptional: false }); setShowModal(true); }}
              className="px-4 py-2 bg-cta-primary hover:bg-cta-primary-hover text-white rounded-xl text-label-md transition-all flex items-center gap-2 shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985]"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add Holiday
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total', count: holidays.length, icon: 'event', color: 'text-primary bg-primary/10' },
          { label: 'National', count: holidays.filter(h => h.holidayType === 'National').length, icon: 'flag', color: 'text-primary bg-primary/10' },
          { label: 'Festival', count: holidays.filter(h => h.holidayType === 'Festival').length, icon: 'celebration', color: 'text-tertiary bg-tertiary-container/15' },
          { label: 'Company', count: holidays.filter(h => h.holidayType === 'CompanyHoliday').length, icon: 'apartment', color: 'text-secondary-container bg-secondary-container/15' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-primary/10 rounded-card shadow-soft-low px-3 py-2.5 flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg ${s.color} flex items-center justify-center shrink-0`}>
              <span className="material-symbols-outlined fill text-[16px]">{s.icon}</span>
            </div>
            <div>
              <p className="text-lg font-bold text-on-background leading-none">{s.count}</p>
              <p className="text-[11px] text-outline">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {[
          { v: '' as const, l: 'All' },
          { v: 'National' as const, l: 'National' },
          { v: 'Festival' as const, l: 'Festival' },
          { v: 'CompanyHoliday' as const, l: 'Company' },
        ].map(f => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`px-3 py-1.5 rounded-full text-label-md transition-colors ${
              filter === f.v
                ? 'bg-primary text-white'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-primary/10'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {/* Calendar + Upcoming side panel */}
      <CalendarAndUpcoming
        holidays={filtered}
        loading={loading}
        year={year}
        month={month}
        setYear={setYear}
        setMonth={setMonth}
        isAdmin={isAdmin}
        upcoming={upcoming}
        onEdit={openEditModal}
        onDelete={handleDelete}
        onSeed={handleSeedDefaults}
        seeding={seeding}
      />


      {/* Add Holiday Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white border border-primary/10 rounded-card shadow-soft-high p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-headline-sm text-on-background">Add Holiday</h2>
              <button onClick={() => setShowModal(false)} className="text-outline hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4">
              <div>
                <label className="block text-label-md text-on-surface mb-1">Holiday Name *</label>
                <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required placeholder="e.g. Diwali" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-label-md text-on-surface mb-1">Date *</label>
                  <input type="date" className={inputCls} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-1">Type</label>
                  <select className={inputCls} value={form.holidayType} onChange={e => setForm(f => ({ ...f, holidayType: e.target.value as HolidayType }))}>
                    <option value="National">National</option>
                    <option value="Festival">Festival</option>
                    <option value="CompanyHoliday">Company Holiday</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Festival Name</label>
                <input className={inputCls} value={form.festivalName} onChange={e => setForm(f => ({ ...f, festivalName: e.target.value }))} placeholder="e.g. Deepavali" />
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Description</label>
                <input className={inputCls} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary/30" checked={form.isOptional} onChange={e => setForm(f => ({ ...f, isOptional: e.target.checked }))} />
                <span className="text-body-md text-on-surface">Optional holiday</span>
              </label>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 h-11 rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 h-11 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow-primary active:scale-[0.985]">
                  {submitting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                  Add Holiday
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Holiday Modal */}
      {editModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md bg-white border border-primary/10 rounded-card shadow-soft-high p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-headline-sm text-on-background">Edit Holiday</h2>
              <button onClick={() => setEditModal(null)} className="text-outline hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4">
              <div>
                <label className="block text-label-md text-on-surface mb-1">Holiday Name *</label>
                <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-label-md text-on-surface mb-1">Date *</label>
                  <input type="date" className={inputCls} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-label-md text-on-surface mb-1">Type</label>
                  <select className={inputCls} value={form.holidayType} onChange={e => setForm(f => ({ ...f, holidayType: e.target.value as HolidayType }))}>
                    <option value="National">National</option>
                    <option value="Festival">Festival</option>
                    <option value="CompanyHoliday">Company Holiday</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Festival Name</label>
                <input className={inputCls} value={form.festivalName} onChange={e => setForm(f => ({ ...f, festivalName: e.target.value }))} />
              </div>
              <div>
                <label className="block text-label-md text-on-surface mb-1">Description</label>
                <input className={inputCls} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary/30" checked={form.isOptional} onChange={e => setForm(f => ({ ...f, isOptional: e.target.checked }))} />
                <span className="text-body-md text-on-surface">Optional holiday</span>
              </label>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditModal(null)} className="flex-1 h-11 rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 h-11 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow-primary active:scale-[0.985]">
                  {submitting && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
