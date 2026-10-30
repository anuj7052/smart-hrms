import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Fingerprint, RefreshCw, Search, Calendar, Download,
  LogIn, LogOut, Loader2, Wifi, WifiOff, ChevronDown,
  Activity, Users, Clock, TrendingUp, Filter, X, Monitor,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import DeviceOffBanner from '../components/DeviceOffBanner';

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

interface LiveDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string;
  etlUsername: string | null;
  status: string;
  lastEtlSync: string | null;
  hasCredentials: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  // Use IST (Asia/Kolkata) to avoid wrong date around midnight IST (which is prev day UTC)
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

function nDaysAgoStr(n: number) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}
// kept for future use
void nDaysAgoStr;

function formatTimestamp(ts: string) {
  try {
    // Timestamp comes as IST "YYYY-MM-DD HH:mm:ss" — parse and display in IST
    const d = new Date(ts.replace(' ', 'T') + '+05:30');
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  } catch {
    return ts;
  }
}

function formatDateDisplay(ts: string) {
  try {
    const d = new Date(ts.replace(' ', 'T') + '+05:30');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  } catch {
    return ts;
  }
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: number | string; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: color + '18' }}>
        <Icon className="w-6 h-6" style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-black text-gray-900">{value}</p>
        <p className="text-xs font-semibold text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-400">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function EsslAttendancePage() {
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [punches, setPunches] = useState<EsslPunch[]>([]);
  const [loading, setLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState<'all' | 'in' | 'out'>('all');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load devices ────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get<LiveDevice[]>('/essl/live-devices')
      .then((r) => {
        setDevices(r.data);
        const first = r.data.find((d) => d.hasCredentials) || r.data[0];
        if (first) setSelectedDevice(first.id);
      })
      .catch(() => toast.error('Failed to load devices'))
      .finally(() => setDevicesLoading(false));
  }, []);

  // ── Fetch punches ───────────────────────────────────────────────────────────
  const fetchPunches = useCallback(async (showToast = false) => {
    if (!selectedDevice) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await api.get<{ ok: boolean; punches: EsslPunch[]; source: string; deviceName: string; message?: string; error?: string }>(
        `/essl/live?deviceId=${selectedDevice}&fromDate=${fromDate}&toDate=${toDate}`
      );
      if (res.data.ok) {
        setPunches(res.data.punches);
        setSource(res.data.source || '');
        setLastFetched(new Date());
        if (showToast) toast.success(`Loaded ${res.data.punches.length} punches from ${res.data.deviceName}`);
      } else {
        setFetchError(res.data.error || 'Unknown error');
        if (showToast) toast.error(res.data.error || 'Failed to fetch');
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to connect to device';
      setFetchError(msg);
      if (showToast) toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedDevice, fromDate, toDate]);

  // Auto-fetch on device/date change
  useEffect(() => {
    if (selectedDevice) fetchPunches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice, fromDate, toDate]);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (autoRefresh && selectedDevice) {
      autoRefreshRef.current = setInterval(() => fetchPunches(), 30000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [autoRefresh, selectedDevice, fetchPunches]);

  // ── Filtered punches (newest first) ─────────────────────────────────────────
  const filtered = punches
    .filter((p) => {
      const matchDir = dirFilter === 'all' || p.direction === dirFilter;
      const q = search.toLowerCase();
      const matchSearch = !q || p.empCode.toLowerCase().includes(q) || p.empName.toLowerCase().includes(q);
      return matchDir && matchSearch;
    })
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalIn = punches.filter((p) => p.direction === 'in').length;
  const totalOut = punches.filter((p) => p.direction === 'out').length;
  const uniqueEmps = new Set(punches.map((p) => p.empCode)).size;
  const latestPunch = punches.length
    ? punches.reduce((latest, p) => (p.timestamp > latest.timestamp ? p : latest), punches[0])
    : null;

  // ── CSV Export ──────────────────────────────────────────────────────────────
  function exportCSV() {
    if (!filtered.length) return;
    const header = ['Emp Code', 'Name', 'Date', 'Time', 'Direction', 'Device'].join(',');
    const rows = filtered.map((p) => [
      p.empCode,
      `"${p.empName}"`,
      p.timestamp.slice(0, 10),
      formatTimestamp(p.timestamp),
      p.direction.toUpperCase(),
      p.deviceName || p.deviceSerial,
    ].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `essl-attendance-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedDeviceInfo = devices.find((d) => d.id === selectedDevice);

  return (
    <div className="space-y-6">
      <DeviceOffBanner />
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center">
              <Fingerprint className="w-5 h-5 text-white" />
            </div>
            <h1 className="page-title">ESSL Live Attendance</h1>
          </div>
          <p className="text-sm text-gray-500 ml-11">
            Real-time punch data fetched directly from the biometric device
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all ${
              autoRefresh
                ? 'bg-success-500 text-white border-success-500 shadow-md shadow-success-500/25'
                : 'btn-secondary'
            }`}
          >
            <Activity className={`w-4 h-4 ${autoRefresh ? 'animate-pulse' : ''}`} />
            {autoRefresh ? 'Auto' : 'Manual'}
          </button>

          {/* Refresh button */}
          <button
            onClick={() => fetchPunches(true)}
            disabled={loading || !selectedDevice}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>

          {/* Export */}
          <button onClick={exportCSV} disabled={!filtered.length} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* ── Device + Date Filters ── */}
      <div className="card p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Device selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Device</label>
            {devicesLoading ? (
              <div className="skeleton h-10 rounded-xl" />
            ) : (
              <div className="relative">
                <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="input pl-9 pr-8 appearance-none"
                >
                  {devices.length === 0 && <option value="">No devices configured</option>}
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {!d.hasCredentials ? '(no creds)' : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>

          {/* From date */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">From Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={fromDate}
                max={toDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="input pl-9"
              />
            </div>
          </div>

          {/* To date */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">To Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="date"
                value={toDate}
                min={fromDate}
                max={todayStr()}
                onChange={(e) => setToDate(e.target.value)}
                className="input pl-9"
              />
            </div>
          </div>

          {/* Direction filter */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5">Direction</label>
            <div className="flex rounded-xl overflow-hidden border border-gray-200 h-10">
              {(['all', 'in', 'out'] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDirFilter(d)}
                  className={`flex-1 text-xs font-semibold transition-all ${
                    dirFilter === d
                      ? d === 'in'
                        ? 'bg-success-500 text-white'
                        : d === 'out'
                        ? 'bg-danger-500 text-white'
                        : 'bg-primary-600 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50:bg-gray-700'
                  }`}
                >
                  {d === 'all' ? 'All' : d === 'in' ? '↓ IN' : '↑ OUT'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Device status bar */}
        {selectedDeviceInfo && (
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-3 text-xs flex-wrap">
            <span className={`flex items-center gap-1.5 font-semibold ${
              selectedDeviceInfo.status === 'Online' ? 'text-success-500' : 'text-gray-400'
            }`}>
              {selectedDeviceInfo.status === 'Online'
                ? <Wifi className="w-3.5 h-3.5" />
                : <WifiOff className="w-3.5 h-3.5" />
              }
              {selectedDeviceInfo.status}
            </span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500">{selectedDeviceInfo.ip}:{selectedDeviceInfo.port}</span>
            <span className="text-gray-400">•</span>
            <span className="text-gray-500">SN: {selectedDeviceInfo.serialNumber}</span>
            {!selectedDeviceInfo.hasCredentials && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-amber-500 font-semibold">⚠ No ETL credentials — configure in Devices page</span>
              </>
            )}
            {lastFetched && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-400">Last fetched: {lastFetched.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })}</span>
              </>
            )}
            {source && (
              <>
                <span className="text-gray-400">•</span>
                <span className="text-gray-400 capitalize">Source: {source}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Punches" value={punches.length} icon={Fingerprint} color="#1A3C6E" />
        <StatCard label="Check-Ins" value={totalIn} icon={LogIn} color="#16A34A" sub="IN punches" />
        <StatCard label="Check-Outs" value={totalOut} icon={LogOut} color="#DC2626" sub="OUT punches" />
        <StatCard label="Unique Employees" value={uniqueEmps} icon={Users} color="#F59E0B" sub="distinct cards" />
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search by employee code or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10 pr-10"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {fetchError && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-danger-50 border border-danger-200">
          <WifiOff className="w-5 h-5 text-danger-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-danger-600">Device connection failed</p>
            <p className="text-sm text-danger-500 mt-0.5">{fetchError}</p>
            <p className="text-xs text-danger-400 mt-1">Make sure the device is reachable and ETL credentials are configured in the Devices page.</p>
          </div>
        </div>
      )}

      {/* ── Punch Table ── */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-primary-600" style={{ width: 18, height: 18 }} />
            <h2 className="font-bold text-gray-900 text-sm">Punch Log</h2>
            <span className="ml-1 px-2 py-0.5 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
              {filtered.length}
            </span>
          </div>
          {filtered.length !== punches.length && (
            <span className="text-xs text-gray-400">Showing {filtered.length} of {punches.length}</span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
              <p className="text-sm text-gray-500">Fetching from device…</p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center">
              <Fingerprint className="w-7 h-7 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-600">
              {fetchError ? 'Could not load punches' : search || dirFilter !== 'all' ? 'No matching punches' : 'No punch data for this date range'}
            </p>
            <p className="text-xs text-gray-400 text-center max-w-xs">
              {!fetchError && !search && dirFilter === 'all' && 'Select a device with ETL credentials and a valid date range, then click Refresh.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Direction</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">Device</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((punch) => (
                  <tr key={punch.id} className="hover:bg-gray-50:bg-gray-900/40 transition-colors">
                    {/* Employee */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-primary-600/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-bold text-primary-600">
                            {punch.empName !== punch.empCode
                              ? punch.empName.charAt(0).toUpperCase()
                              : '#'}
                          </span>
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-sm leading-tight">
                            {punch.empName !== punch.empCode ? punch.empName : `Employee ${punch.empCode}`}
                          </p>
                          <p className="text-xs text-gray-400">Code: {punch.empCode}</p>
                        </div>
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-gray-700 text-sm">
                      {formatDateDisplay(punch.timestamp)}
                    </td>

                    {/* Time */}
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold text-gray-900">
                        {formatTimestamp(punch.timestamp)}
                      </span>
                    </td>

                    {/* Direction */}
                    <td className="px-4 py-3">
                      {punch.direction === 'in' ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-success-500/10 text-success-600 text-xs font-bold">
                          <LogIn className="w-3.5 h-3.5" />
                          IN
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-danger-500/10 text-danger-500 text-xs font-bold">
                          <LogOut className="w-3.5 h-3.5" />
                          OUT
                        </span>
                      )}
                    </td>

                    {/* Device */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-medium">
                        <Monitor className="w-3 h-3" />
                        {punch.deviceName || punch.deviceSerial}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Latest activity ── */}
      {latestPunch && !loading && (
        <div className="flex items-center gap-2 text-xs text-gray-400 justify-end">
          <TrendingUp className="w-3.5 h-3.5" />
          Latest punch: <span className="font-semibold text-gray-600">
            {latestPunch.empCode} — {formatTimestamp(latestPunch.timestamp)} ({latestPunch.direction.toUpperCase()})
          </span>
        </div>
      )}
    </div>
  );
}
