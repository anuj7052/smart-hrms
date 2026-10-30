import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, Save, CalendarCheck, Pencil, X, Wifi, WifiOff, CircleDot, RefreshCw } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { AppSettings, Shift } from '../types';
import { formatDateIST } from '../lib/datetime';

const TABS = ['Company', 'Shifts', 'Holidays', 'Email', 'Devices'] as const;
type Tab = typeof TABS[number];

interface ConnDevice {
  id: string; name: string; ip: string; port: number;
  serialNumber: string; etlUsername: string | null;
  status: string; hasCredentials: boolean;
}
interface TestResult { ok: boolean; reachable?: boolean; message: string; }

interface ShiftForm {
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  halfDayThresholdHours: number;
}

const defaultShiftForm: ShiftForm = {
  name: '', startTime: '09:00', endTime: '18:00', gracePeriodMinutes: 15, halfDayThresholdHours: 4,
};

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Company');
  const [settings, setSettings] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingHolidays, setApplyingHolidays] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [newHoliday, setNewHoliday] = useState({ name: '', date: '' });

  // Shifts state
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftForm, setShiftForm] = useState<ShiftForm>(defaultShiftForm);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [shiftSubmitting, setShiftSubmitting] = useState(false);
  const [showShiftModal, setShowShiftModal] = useState(false);

  // Devices (connection test) state
  const [connDevices, setConnDevices] = useState<ConnDevice[]>([]);
  const [connLoading, setConnLoading] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<AppSettings>('/settings');
      setSettings(res.data);
    } catch {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchShifts = useCallback(async () => {
    setShiftsLoading(true);
    try {
      const res = await api.get<Shift[]>('/settings/shifts');
      setShifts(res.data);
    } catch {
      toast.error('Failed to load shifts');
    } finally {
      setShiftsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);
  useEffect(() => { if (tab === 'Shifts') fetchShifts(); }, [tab, fetchShifts]);

  const fetchConnDevices = useCallback(async () => {
    setConnLoading(true);
    try {
      const res = await api.get<ConnDevice[]>('/essl/live-devices');
      setConnDevices(res.data);
    } catch {
      toast.error('Failed to load devices');
    } finally {
      setConnLoading(false);
    }
  }, []);

  useEffect(() => { if (tab === 'Devices') fetchConnDevices(); }, [tab, fetchConnDevices]);

  async function testConnection(device: ConnDevice) {
    setTestingId(device.id);
    setTestResults((r) => ({ ...r, [device.id]: { ok: false, message: 'Testing…' } }));
    try {
      const res = await api.post<TestResult>(`/essl/devices/${device.id}/test`);
      setTestResults((r) => ({ ...r, [device.id]: res.data }));
      if (res.data.ok) toast.success(res.data.message); else toast.error(res.data.message);
      setConnDevices((list) => list.map((d) => d.id === device.id ? { ...d, status: res.data.ok ? 'Online' : 'Offline' } : d));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string; error?: string } } })?.response?.data?.message
        || (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        || 'Connection test failed';
      setTestResults((r) => ({ ...r, [device.id]: { ok: false, message: msg } }));
      toast.error(msg);
    } finally {
      setTestingId(null);
    }
  }

  async function saveSettings(updates: Partial<AppSettings>) {
    setSaving(true);
    try {
      await api.put('/settings', updates);
      setSettings((s) => ({ ...s, ...updates }));
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  function addDomain() {
    const d = newDomain.trim().replace('@', '').toLowerCase();
    if (!d) return;
    if ((settings.allowedEmailDomains || []).includes(d)) { toast.error('Domain already added'); return; }
    const updated = [...(settings.allowedEmailDomains || []), d];
    saveSettings({ allowedEmailDomains: updated });
    setNewDomain('');
  }

  function removeDomain(d: string) {
    const updated = (settings.allowedEmailDomains || []).filter((x) => x !== d);
    saveSettings({ allowedEmailDomains: updated });
  }

  function addHoliday() {
    if (!newHoliday.name || !newHoliday.date) return;
    const updated = [...(settings.holidays || []), { name: newHoliday.name, date: newHoliday.date }];
    saveSettings({ holidays: updated });
    setNewHoliday({ name: '', date: '' });
  }

  function removeHoliday(i: number) {
    const updated = [...(settings.holidays || [])];
    updated.splice(i, 1);
    saveSettings({ holidays: updated });
  }

  function openAddShift() {
    setEditingShift(null);
    setShiftForm(defaultShiftForm);
    setShowShiftModal(true);
  }

  function openEditShift(s: Shift) {
    setEditingShift(s);
    setShiftForm({ name: s.name, startTime: s.startTime, endTime: s.endTime, gracePeriodMinutes: s.gracePeriodMinutes, halfDayThresholdHours: s.halfDayThresholdHours });
    setShowShiftModal(true);
  }

  async function handleShiftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setShiftSubmitting(true);
    try {
      if (editingShift) {
        await api.put(`/settings/shifts/${editingShift._id}`, shiftForm);
        toast.success('Shift updated');
      } else {
        await api.post('/settings/shifts', shiftForm);
        toast.success('Shift created');
      }
      setShowShiftModal(false);
      fetchShifts();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to save shift');
    } finally {
      setShiftSubmitting(false);
    }
  }

  async function deleteShift(shift: Shift) {
    try {
      await api.delete(`/settings/shifts/${shift._id}`);
      toast.success('Shift deleted');
      fetchShifts();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Cannot delete shift');
    }
  }

  if (loading) return (
    <div className="space-y-5">
      <div className="skeleton h-8 w-48 rounded" />
      <div className="card p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-10 rounded-lg" />)}
      </div>
    </div>
  );

  return (
    <div className="space-y-5 pb-20 lg:pb-0 max-w-2xl">
      <h1 className="page-title">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Company Tab */}
      {tab === 'Company' && (
        <div className="card p-6 space-y-5">
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">Allowed Email Domains</h2>
            <p className="text-sm text-gray-500 mb-3">Only users with these email domains can register.</p>
            <div className="flex gap-2 mb-3">
              <input
                className="input flex-1"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="yourcompany.com"
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addDomain())}
              />
              <button onClick={addDomain} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(settings.allowedEmailDomains || []).map((d) => (
                <div key={d} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-50 text-primary-700 rounded-full text-sm">
                  @{d}
                  <button onClick={() => removeDomain(d)} className="hover:text-red-500 ml-0.5">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!(settings.allowedEmailDomains?.length) && (
                <p className="text-sm text-amber-600">⚠ No domain restriction — any email can register</p>
              )}
            </div>
          </div>

          {/* Late Arrival Time */}
          <div className="border-t border-gray-100 pt-5">
            <h2 className="font-semibold text-gray-900 mb-1">Late Arrival Time</h2>
            <p className="text-sm text-gray-500 mb-3">
              Employees who check in after this time will be marked as <strong>Late</strong>. Default is 10:00 AM.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="time"
                className="input w-40"
                value={settings.lateArrivalTime || '10:00'}
                onChange={(e) => setSettings((s) => ({ ...s, lateArrivalTime: e.target.value }))}
              />
              <button
                onClick={() => saveSettings({ lateArrivalTime: settings.lateArrivalTime || '10:00' })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              This time is shown in the attendance dashboard KPI. The per-shift grace period in the Shifts tab controls the actual late classification logic.
            </p>
          </div>
        </div>
      )}

      {/* Shifts Tab */}
      {tab === 'Shifts' && (
        <div className="space-y-5">
          {/* Global fallback shift settings */}
          <div className="card p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Default Shift (Global Fallback)</h2>
            <p className="text-xs text-gray-500">Applied when an employee has no named shift assigned.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift Start</label>
                <input type="time" className="input" value={settings.shiftStart || '09:00'} onChange={(e) => setSettings((s) => ({ ...s, shiftStart: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift End</label>
                <input type="time" className="input" value={settings.shiftEnd || '18:00'} onChange={(e) => setSettings((s) => ({ ...s, shiftEnd: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Late Threshold (min)</label>
                <input type="number" className="input" min={0} max={120} value={settings.lateThresholdMinutes ?? 15} onChange={(e) => setSettings((s) => ({ ...s, lateThresholdMinutes: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Half Day Threshold (hrs)</label>
                <input type="number" className="input" min={1} max={8} value={settings.halfDayThresholdHours ?? 4} onChange={(e) => setSettings((s) => ({ ...s, halfDayThresholdHours: Number(e.target.value) }))} />
              </div>
            </div>
            <button
              onClick={() => saveSettings({ shiftStart: settings.shiftStart, shiftEnd: settings.shiftEnd, lateThresholdMinutes: settings.lateThresholdMinutes, halfDayThresholdHours: settings.halfDayThresholdHours })}
              disabled={saving}
              className="btn-primary flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save Default Shift
            </button>
          </div>

          {/* Named shifts */}
          <div className="card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900">Named Shifts</h2>
                <p className="text-xs text-gray-500 mt-0.5">Create shifts and assign them to individual employees.</p>
              </div>
              <button onClick={openAddShift} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add Shift
              </button>
            </div>

            {shiftsLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-14 rounded-lg" />)}</div>
            ) : shifts.length === 0 ? (
              <p className="text-sm text-gray-400">No named shifts configured yet. Create one and assign it to employees.</p>
            ) : (
              <div className="space-y-2">
                {shifts.map((s) => (
                  <div key={s._id} className={`flex items-center justify-between py-3 px-4 rounded-lg border ${s.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.name} {!s.isActive && <span className="text-xs text-gray-400">(inactive)</span>}</p>
                      <p className="text-xs text-gray-500">{s.startTime} – {s.endTime} · Late after {s.gracePeriodMinutes}min · Half day &lt; {s.halfDayThresholdHours}h</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEditShift(s)} className="p-1.5 text-gray-400 hover:text-primary-600:text-primary-400">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteShift(s)} className="p-1.5 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Shift modal */}
      {showShiftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="card w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg text-gray-900">{editingShift ? 'Edit Shift' : 'Add Shift'}</h2>
              <button onClick={() => setShowShiftModal(false)} className="text-gray-400 hover:text-gray-600:text-gray-200"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleShiftSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Shift Name</label>
                <input className="input" placeholder="e.g. Morning, Night, General" value={shiftForm.name} onChange={(e) => setShiftForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input type="time" className="input" value={shiftForm.startTime} onChange={(e) => setShiftForm((f) => ({ ...f, startTime: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input type="time" className="input" value={shiftForm.endTime} onChange={(e) => setShiftForm((f) => ({ ...f, endTime: e.target.value }))} required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Late after (min)</label>
                  <input type="number" className="input" min={0} max={120} value={shiftForm.gracePeriodMinutes} onChange={(e) => setShiftForm((f) => ({ ...f, gracePeriodMinutes: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Half day (&lt; hrs)</label>
                  <input type="number" className="input" min={1} max={8} step={0.5} value={shiftForm.halfDayThresholdHours} onChange={(e) => setShiftForm((f) => ({ ...f, halfDayThresholdHours: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setShowShiftModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={shiftSubmitting} className="btn-primary flex items-center gap-2">
                  {shiftSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingShift ? 'Save Changes' : 'Create Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Holidays Tab */}
      {tab === 'Holidays' && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Holiday Calendar</h2>
            <button
              onClick={async () => {
                setApplyingHolidays(true);
                try {
                  const res = await api.post<{ message: string }>('/settings/apply-holidays');
                  toast.success(res.data.message);
                } catch (err: unknown) {
                  toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to apply holidays');
                } finally {
                  setApplyingHolidays(false);
                }
              }}
              disabled={applyingHolidays || !(settings.holidays?.length)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {applyingHolidays ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
              {applyingHolidays ? 'Applying…' : 'Apply to Attendance'}
            </button>
          </div>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Holiday Name</label>
              <input className="input" value={newHoliday.name} onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))} placeholder="New Year" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" className="input" value={newHoliday.date} onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))} />
            </div>
            <button onClick={addHoliday} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {(settings.holidays || []).sort((a, b) => a.date.localeCompare(b.date)).map((h, i) => (
              <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-900">{h.name}</p>
                  <p className="text-xs text-gray-500">{formatDateIST(h.date, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}</p>
                </div>
                <button onClick={() => removeHoliday(i)} className="text-gray-400 hover:text-red-500">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {!(settings.holidays?.length) && <p className="text-sm text-gray-400">No holidays configured yet.</p>}
          </div>
        </div>
      )}

      {/* Email Tab */}
      {tab === 'Email' && (
        <div className="card p-6 space-y-5">
          <h2 className="font-semibold text-gray-900">Email / SMTP Configuration</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label>
              <input className="input" value={settings.smtpHost || ''} onChange={(e) => setSettings((s) => ({ ...s, smtpHost: e.target.value }))} placeholder="smtp.yourprovider.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label>
              <input type="number" className="input" value={settings.smtpPort || 587} onChange={(e) => setSettings((s) => ({ ...s, smtpPort: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">From Address</label>
              <input className="input" value={settings.smtpFrom || ''} onChange={(e) => setSettings((s) => ({ ...s, smtpFrom: e.target.value }))} placeholder="no-reply@yourcompany.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Username</label>
              <input className="input" value={settings.smtpUser || ''} onChange={(e) => setSettings((s) => ({ ...s, smtpUser: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMTP Password</label>
              <input type="password" className="input" placeholder="Leave blank to keep current" onChange={() => {}} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="emailEnabled"
              checked={settings.emailNotificationsEnabled || false}
              onChange={(e) => setSettings((s) => ({ ...s, emailNotificationsEnabled: e.target.checked }))}
              className="w-4 h-4 text-primary-600 rounded"
            />
            <label htmlFor="emailEnabled" className="text-sm text-gray-700">Enable email notifications</label>
          </div>
          <button
            onClick={() => saveSettings({ smtpHost: settings.smtpHost, smtpPort: settings.smtpPort, smtpUser: settings.smtpUser, smtpFrom: settings.smtpFrom, emailNotificationsEnabled: settings.emailNotificationsEnabled })}
            disabled={saving}
            className="btn-primary flex items-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Email Settings
          </button>
        </div>
      )}

      {/* Devices Tab — ESSL connection test */}
      {tab === 'Devices' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">ESSL Device Connection</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Test connectivity to each biometric device's eTimeTrackLite portal. A successful
                test means the device is reachable and the stored credentials are valid.
              </p>
            </div>
            <button onClick={fetchConnDevices} className="btn-secondary flex items-center gap-2 shrink-0">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>

          {connLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
            </div>
          ) : connDevices.length === 0 ? (
            <p className="text-sm text-gray-400">No devices configured. Add devices from the Devices page.</p>
          ) : (
            <div className="space-y-3">
              {connDevices.map((d) => {
                const result = testResults[d.id];
                const isTesting = testingId === d.id;
                return (
                  <div key={d.id} className="border border-gray-200 rounded-xl p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-gray-900">{d.name}</p>
                          {d.status === 'Online' ? (
                            <span className="badge-green flex items-center gap-1"><Wifi className="w-3 h-3" /> Online</span>
                          ) : d.status === 'Offline' ? (
                            <span className="badge-red flex items-center gap-1"><WifiOff className="w-3 h-3" /> Offline</span>
                          ) : (
                            <span className="badge-gray flex items-center gap-1"><CircleDot className="w-3 h-3" /> Unknown</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 font-mono mt-1">{d.ip}:{d.port}</p>
                        <p className={'text-xs font-medium mt-0.5 ' + (d.hasCredentials ? 'text-green-600' : 'text-amber-500')}>
                          {d.hasCredentials ? '✓ Credentials configured' : '⚠ No ETL credentials — set them in the Devices page'}
                        </p>
                      </div>
                      <button
                        onClick={() => testConnection(d)}
                        disabled={isTesting || !d.hasCredentials}
                        className="btn-secondary flex items-center gap-2 text-sm disabled:opacity-50 shrink-0"
                      >
                        {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                        {isTesting ? 'Testing…' : 'Test Connection'}
                      </button>
                    </div>
                    {result && result.message !== 'Testing…' && (
                      <div className={'mt-3 text-xs rounded-lg px-3 py-2 ' + (result.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>
                        {result.ok ? '✓ ' : '✕ '}{result.message}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-gray-400 border-t border-gray-100 pt-3">
            Note: Devices are powered off after 9 PM IST and come back around 9 AM IST. Connection
            tests will fail outside those hours even if credentials are correct.
          </p>
        </div>
      )}
    </div>
  );
}
