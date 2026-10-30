import { useState, useEffect, useCallback } from 'react';
import { Search, Monitor, UserCheck, UserX, Clock, Loader2, MapPin } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface VirtualEmployee {
  id: string;
  employeeId: string;
  department: string;
  virtualLoginEnabled: boolean;
  user: { name: string | null } | null;
}

interface VirtualPunchLogEntry {
  id: string;
  date: string;
  punchIn: string | null;
  punchOut: string | null;
  reason: string | null;
  source: string;
  punchInLat:  number | null;
  punchInLng:  number | null;
  punchInAddress:  string | null;
  punchOutLat: number | null;
  punchOutLng: number | null;
  punchOutAddress: string | null;
  employee: {
    employeeId: string;
    department: string;
    user: { name: string | null } | null;
  };
}

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function LocationCell({ lat, lng, address, label }: { lat: number | null; lng: number | null; address?: string | null; label: string }) {
  if (lat == null || lng == null) return <span className="text-gray-400">—</span>;
  const display = address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  return (
    <a
      href={mapsUrl(lat, lng)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline text-xs font-semibold"
      title={`${label}: ${lat.toFixed(5)}, ${lng.toFixed(5)}`}
    >
      <MapPin className="w-3.5 h-3.5 shrink-0" />
      {display}
    </a>
  );
}

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export default function VirtualLogin() {
  const [employees, setEmployees] = useState<VirtualEmployee[]>([]);
  const [logs, setLogs] = useState<VirtualPunchLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'manage' | 'logs'>('manage');
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await api.get<{ employees: VirtualEmployee[] }>('/attendance/virtual-login-employees');
      setEmployees(res.data.employees);
    } catch {
      toast.error('Failed to load employees');
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get<{ logs: VirtualPunchLogEntry[] }>('/attendance/virtual-punch-logs');
      setLogs(res.data.logs);
    } catch {
      toast.error('Failed to load virtual punch logs');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchEmployees(), fetchLogs()]).finally(() => setLoading(false));
  }, [fetchEmployees, fetchLogs]);

  const toggleVirtualLogin = async (emp: VirtualEmployee) => {
    setToggling(emp.id);
    try {
      await api.put(`/attendance/virtual-login-toggle/${emp.id}`, { enabled: !emp.virtualLoginEnabled });
      toast.success(`Virtual login ${!emp.virtualLoginEnabled ? 'enabled' : 'disabled'} for ${emp.user?.name || emp.employeeId}`);
      await fetchEmployees();
    } catch {
      toast.error('Failed to update');
    } finally {
      setToggling(null);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    const q = search.toLowerCase();
    return (emp.user?.name?.toLowerCase().includes(q) || emp.employeeId.toLowerCase().includes(q) || emp.department.toLowerCase().includes(q));
  }).sort((a, b) => {
    if (a.virtualLoginEnabled !== b.virtualLoginEnabled) return a.virtualLoginEnabled ? -1 : 1;
    return (a.user?.name || a.employeeId).localeCompare(b.user?.name || b.employeeId);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Virtual Login</h1>
          <p className="text-sm text-gray-500 mt-1">Manage remote attendance for employees who cannot use biometric devices</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['manage', 'logs'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === t ? 'bg-white shadow-sm text-primary-700' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t === 'manage' ? 'Manage Employees' : 'Audit Trail'}
          </button>
        ))}
      </div>

      {/* Manage Tab */}
      {tab === 'manage' && (
        <div className="bg-white rounded-2xl border shadow-sm">
          <div className="p-4 border-b flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search employees..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
              />
            </div>
            <div className="text-xs text-gray-500">
              <Monitor className="inline w-3.5 h-3.5 mr-1" />
              {employees.filter(e => e.virtualLoginEnabled).length} enabled
            </div>
          </div>

          <div className="divide-y max-h-[60vh] overflow-y-auto">
            {filteredEmployees.map(emp => (
              <div key={emp.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                  emp.virtualLoginEnabled ? 'bg-green-500' : 'bg-gray-300'
                }`}>
                  {emp.user?.name?.[0] || emp.employeeId[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{emp.user?.name || emp.employeeId}</p>
                  <p className="text-xs text-gray-500">{emp.employeeId} · {emp.department}</p>
                </div>
                <div className="flex items-center gap-3">
                  {emp.virtualLoginEnabled && (
                    <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded-full">
                      <UserCheck className="inline w-3 h-3 mr-1" />Virtual
                    </span>
                  )}
                  <button
                    onClick={() => toggleVirtualLogin(emp)}
                    disabled={toggling === emp.id}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      emp.virtualLoginEnabled ? 'bg-green-500' : 'bg-gray-200'
                    } ${toggling === emp.id ? 'opacity-50' : ''}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      emp.virtualLoginEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              </div>
            ))}
            {filteredEmployees.length === 0 && (
              <div className="py-12 text-center text-gray-400">
                <UserX className="w-8 h-8 mx-auto mb-2" />
                <p className="text-sm">No employees found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit Trail Tab */}
      {tab === 'logs' && (
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-gray-800 flex items-center gap-2">
              <Clock className="w-4 h-4" /> Virtual Punch Audit Trail
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Employee</th>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Punch In</th>
                  <th className="px-4 py-3 text-left font-semibold">In Location</th>
                  <th className="px-4 py-3 text-left font-semibold">Punch Out</th>
                  <th className="px-4 py-3 text-left font-semibold">Out Location</th>
                  <th className="px-4 py-3 text-left font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{log.employee.user?.name || log.employee.employeeId}</p>
                      <p className="text-xs text-gray-500">{log.employee.department}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDate(log.date)}</td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatTime(log.punchIn)}</td>
                    <td className="px-4 py-3">
                      <LocationCell lat={log.punchInLat} lng={log.punchInLng} address={log.punchInAddress} label="Check-in" />
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatTime(log.punchOut)}</td>
                    <td className="px-4 py-3">
                      <LocationCell lat={log.punchOutLat} lng={log.punchOutLng} address={log.punchOutAddress} label="Check-out" />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        log.source === 'admin-override' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {log.source === 'admin-override' ? 'Admin' : 'Self'}
                      </span>
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={7} className="py-12 text-center text-gray-400">No virtual punch logs yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </div>
  );
}
