import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Mail, Building2, Phone, Calendar, Shield, Briefcase, Clock,
  LogIn, LogOut, Loader2, Pencil, Save, X, User, ChevronDown, Activity,
  Fingerprint, BarChart3,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { Employee } from '../types';
import AttendanceSummaryModal from '../components/AttendanceSummaryModal';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EsslPunch {
  id: string;
  empCode: string;
  empName: string;
  timestamp: string;
  direction: 'in' | 'out';
  deviceSerial: string;
  deviceName?: string;
}

type ViewMode = 'today' | 'weekly' | 'monthly';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nDaysAgoStr(n: number) {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function startOfMonthStr() {
  const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function formatTime(ts: string) {
  try {
    const d = new Date(ts.replace(' ', 'T') + '+05:30');
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    });
  } catch { return ts; }
}

function formatDate(ts: string) {
  try {
    const d = new Date(ts.replace(' ', 'T') + '+05:30');
    return d.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    });
  } catch { return ts; }
}

function formatDateTime(ts: string) {
  try {
    const d = new Date(ts.replace(' ', 'T') + '+05:30');
    return d.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: true, timeZone: 'Asia/Kolkata',
    });
  } catch { return ts; }
}

function getDateFromTs(ts: string) {
  return ts.split(' ')[0]; // "YYYY-MM-DD"
}

// Group punches by date (each day's array is sorted by timestamp ascending)
function groupByDate(punches: EsslPunch[]): Record<string, EsslPunch[]> {
  const groups: Record<string, EsslPunch[]> = {};
  for (const p of punches) {
    const date = getDateFromTs(p.timestamp);
    if (!groups[date]) groups[date] = [];
    groups[date].push(p);
  }
  for (const d of Object.keys(groups)) {
    groups[d].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }
  return groups;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [punches, setPunches] = useState<EsslPunch[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('today');

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', employeeId: '', phone: '', department: '', designation: '', birthday: '' });
  const [saving, setSaving] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const isAdmin = user?.role === 'Admin';
  const isHR = user?.role === 'HR';
  const canEdit = isAdmin || isHR;

  // ─── Fetch employee details ─────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get<Employee>(`/employees/${id}`)
      .then((res) => {
        setEmployee(res.data);
        setEditForm({
          name: res.data.userId.name,
          email: res.data.userId.email,
          employeeId: res.data.employeeId,
          phone: res.data.phone || '',
          department: res.data.department,
          designation: res.data.designation,
          birthday: res.data.birthday ? res.data.birthday.split('T')[0] : '',
        });
      })
      .catch(() => toast.error('Failed to load employee'))
      .finally(() => setLoading(false));
  }, [id]);

  // ─── Fetch punches based on view mode ───────────────────────────────────────
  const fetchPunches = useCallback(async () => {
    if (!employee) return;
    setPunchLoading(true);
    try {
      let from: string, to: string;
      if (viewMode === 'today') {
        from = todayStr();
        to = todayStr();
      } else if (viewMode === 'weekly') {
        from = nDaysAgoStr(6);
        to = todayStr();
      } else {
        from = startOfMonthStr();
        to = todayStr();
      }
      const res = await api.get(`/essl/employee-punches/${employee.employeeId}`, {
        params: { fromDate: from, toDate: to },
      });
      setPunches(res.data.punches || []);
    } catch {
      toast.error('Failed to fetch punch logs');
    } finally {
      setPunchLoading(false);
    }
  }, [employee, viewMode]);

  useEffect(() => { fetchPunches(); }, [fetchPunches]);

  // ─── Save edit ──────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!employee) return;
    setSaving(true);
    try {
      await api.put(`/employees/${employee._id}`, editForm);
      const res = await api.get<Employee>(`/employees/${employee._id}`);
      setEmployee(res.data);
      setEditForm({
        name: res.data.userId.name,
        email: res.data.userId.email,
        employeeId: res.data.employeeId,
        phone: res.data.phone || '',
        department: res.data.department,
        designation: res.data.designation,
        birthday: res.data.birthday ? res.data.birthday.split('T')[0] : '',
      });
      setEditing(false);
      toast.success('Employee updated');
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to update employee');
    } finally {
      setSaving(false);
    }
  }

  // ─── Derived data ──────────────────────────────────────────────────────────
  const grouped = groupByDate(punches);
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a)); // newest first

  // Today's first check-in and last check-out.
  // A real checkout only exists if the LAST punch of the day is an 'out'.
  // Otherwise the employee returned from a break and is still working.
  const todayPunches = grouped[todayStr()] || [];
  const todayIns = todayPunches.filter((p) => p.direction === 'in');
  const firstCheckIn = todayIns.length > 0 ? todayIns[0].timestamp : null;
  const todayLastPunch = todayPunches.length > 0 ? todayPunches[todayPunches.length - 1] : null;
  const lastCheckOut = todayLastPunch && todayLastPunch.direction === 'out' ? todayLastPunch.timestamp : null;

  // ─── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Employee not found</p>
        <button onClick={() => navigate('/employees')} className="btn-primary mt-4">Back to Employees</button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/employees')} className="p-2 rounded-lg hover:bg-gray-100:bg-gray-800 transition-colors">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Employee Profile</h1>
          <p className="text-sm text-gray-500">{employee.employeeId}</p>
        </div>
        <button
          onClick={() => setShowSummary(true)}
          className="btn-secondary flex items-center gap-2"
        >
          <BarChart3 className="w-4 h-4" /> View Summary
        </button>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="btn-primary flex items-center gap-2">
            <Pencil className="w-4 h-4" /> Edit
          </button>
        )}
      </div>

      {/* Profile Card + Today Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Profile Info */}
        <div className="lg:col-span-2 card p-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center text-primary-700 font-bold text-2xl shrink-0">
              {employee.userId.name[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              {editing ? (
                <input
                  className="input text-xl font-bold mb-1"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              ) : (
                <h2 className="text-xl font-bold text-gray-900 truncate">{employee.userId.name}</h2>
              )}
              <p className="text-sm text-gray-500">{employee.userId.email}</p>
              <span className={`inline-block mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                employee.userId.role === 'Admin' ? 'bg-blue-100 text-blue-700' :
                employee.userId.role === 'HR' ? 'bg-yellow-100 text-yellow-700' :
                employee.userId.role === 'Manager' ? 'bg-purple-100 text-purple-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {employee.userId.role}
              </span>
              {!employee.isActive && (
                <span className="inline-block ml-2 mt-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  Inactive
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {editing ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Briefcase className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Employee ID</p>
                    <input className="input text-sm" value={editForm.employeeId} onChange={(e) => setEditForm((f) => ({ ...f, employeeId: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Mail className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Email</p>
                    <input type="email" className="input text-sm" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <InfoRow icon={Briefcase} label="Employee ID" value={employee.employeeId} />
                <InfoRow icon={Mail} label="Email" value={employee.userId.email} />
              </>
            )}
            {editing ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Department</p>
                    <input className="input text-sm" value={editForm.department} onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Shield className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Designation</p>
                    <input className="input text-sm" value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Phone className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Phone</p>
                    <input className="input text-sm" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-gray-400 mb-0.5">Birthday</p>
                    <input type="date" className="input text-sm" value={editForm.birthday} onChange={(e) => setEditForm((f) => ({ ...f, birthday: e.target.value }))} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <InfoRow icon={Building2} label="Department" value={employee.department} />
                <InfoRow icon={Shield} label="Designation" value={employee.designation || '—'} />
                <InfoRow icon={Phone} label="Phone" value={employee.phone || '—'} />
                <InfoRow icon={Calendar} label="Birthday" value={employee.birthday ? formatDate(employee.birthday.split('T')[0] + ' 00:00:00') : '—'} />
              </>
            )}
            <InfoRow icon={Clock} label="Shift" value={employee.shift || 'General'} />
            <InfoRow icon={Calendar} label="Join Date" value={employee.joinDate ? formatDate(employee.joinDate.split('T')[0] + ' 00:00:00') : '—'} />
          </div>

          {editing && (
            <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => { setEditing(false); setEditForm({ name: employee.userId.name, email: employee.userId.email, employeeId: employee.employeeId, phone: employee.phone || '', department: employee.department, designation: employee.designation, birthday: employee.birthday ? employee.birthday.split('T')[0] : '' }); }} className="btn-secondary flex items-center gap-2">
                <X className="w-4 h-4" /> Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
            </div>
          )}
        </div>

        {/* Today Check-in/Check-out Summary */}
        <div className="card p-6 flex flex-col gap-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Fingerprint className="w-5 h-5 text-primary-600" />
            Today's Attendance
          </h3>
          <div className="flex-1 space-y-4">
            <div className="p-4 rounded-xl bg-green-50 border border-green-100">
              <div className="flex items-center gap-2 mb-1">
                <LogIn className="w-4 h-4 text-green-600" />
                <span className="text-xs font-semibold text-green-700">First Check-In</span>
              </div>
              <p className="text-lg font-bold text-green-800">
                {firstCheckIn ? formatTime(firstCheckIn) : '—'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-red-50 border border-red-100">
              <div className="flex items-center gap-2 mb-1">
                <LogOut className="w-4 h-4 text-red-600" />
                <span className="text-xs font-semibold text-red-700">Last Check-Out</span>
              </div>
              <p className="text-lg font-bold text-red-800">
                {lastCheckOut ? formatTime(lastCheckOut) : '—'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-semibold text-blue-700">Total Punches Today</span>
              </div>
              <p className="text-lg font-bold text-blue-800">{todayPunches.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Punch Log Section */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary-600" />
            Punch Log
          </h3>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['today', 'weekly', 'monthly'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                  viewMode === mode
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50:bg-gray-800'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {punchLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
          </div>
        ) : punches.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            No punch records found for this period
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sortedDates.map((date) => {
              const dayPunches = grouped[date];
              const ins = dayPunches.filter((p) => p.direction === 'in');
              const dayLast = dayPunches.length > 0 ? dayPunches[dayPunches.length - 1] : null;
              const dayFirstIn = ins.length > 0 ? ins[0].timestamp : null;
              // Only a true checkout if the LAST punch of the day is an OUT
              const dayLastOut = dayLast && dayLast.direction === 'out' ? dayLast.timestamp : null;

              return (
                <div key={date}>
                  {/* Date header with summary */}
                  <div className="px-4 py-3 bg-gray-50 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
                        {formatDate(date + ' 00:00:00')}
                      </span>
                      <span className="text-xs text-gray-500">
                        {dayPunches.length} punch{dayPunches.length !== 1 ? 'es' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="flex items-center gap-1 text-green-600">
                        <LogIn className="w-3.5 h-3.5" />
                        {dayFirstIn ? formatTime(dayFirstIn) : '—'}
                      </span>
                      <span className="flex items-center gap-1 text-red-600">
                        <LogOut className="w-3.5 h-3.5" />
                        {dayLastOut ? formatTime(dayLastOut) : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Individual punches */}
                  <div className="divide-y divide-gray-50">
                    {dayPunches.map((p, i) => (
                      <div key={p.id + '-' + i} className="px-4 py-2.5 flex items-center gap-3 hover:bg-gray-50:bg-gray-800/30 transition-colors">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          p.direction === 'in'
                            ? 'bg-green-100'
                            : 'bg-red-100'
                        }`}>
                          {p.direction === 'in'
                            ? <LogIn className="w-4 h-4 text-green-600" />
                            : <LogOut className="w-4 h-4 text-red-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs font-semibold uppercase ${
                            p.direction === 'in' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            Check-{p.direction}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-700">
                          {formatTime(p.timestamp)}
                        </span>
                        <span className="text-xs text-gray-400 hidden sm:block">
                          {p.deviceName || p.deviceSerial}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Attendance Summary Modal */}
      {showSummary && (
        <AttendanceSummaryModal
          employeeId={employee._id || employee.id || ''}
          employeeName={employee.userId.name}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}

// ─── Info Row helper ──────────────────────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-gray-500" />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-medium text-gray-700">{value}</p>
      </div>
    </div>
  );
}
