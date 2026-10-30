import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { SkeletonKpiCard, SkeletonPunchFeed, SkeletonActionTile } from '../components/Skeletons';
import { formatTimeIST, formatDateIST, todayISTDateString } from '../lib/datetime';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EsslPunch {
  id: string; empCode: string; empName: string;
  timestamp: string; direction: 'in' | 'out';
  deviceSerial: string; deviceName?: string;
}
interface LiveDevice {
  id: string; name: string; ip: string; port: number;
  serialNumber: string; hasCredentials: boolean; status: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() { return todayISTDateString(); }
function formatTs(ts: string) { return formatTimeIST(ts); }

export default function DashboardPage() {
  const { user } = useAuth();
  const { isAdminOrHR, roleConfig } = usePermissions();
  const navigate = useNavigate();

  // ESSL live punches (today)
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [punches, setPunches] = useState<EsslPunch[]>([]);
  const [loadingPunches, setLoadingPunches] = useState(false);
  const [lastFetched, setLastFetched] = useState('');
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Employee (non-admin) own punches ───────────────────────────────────────
  const [myEmpCode, setMyEmpCode] = useState('');
  useEffect(() => {
    if (isAdminOrHR) return;
    setLoadingPunches(true);
    api.get<{ employeeId: string }>('/employees/profile')
      .then((res) => {
        const code = res.data.employeeId;
        setMyEmpCode(code);
      })
      .catch(() => { setLoadingPunches(false); });
  }, [isAdminOrHR]);

  // Fetch own punches once we know the empCode (last 10 days for recent history)
  const fetchMyPunches = (showLoader = false) => {
    if (!myEmpCode) return;
    if (showLoader) setLoadingPunches(true);
    const today = todayStr();
    // Fetch last 10 days so we can show recent punch history
    const tenDaysAgo = (() => {
      const d = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
      d.setDate(d.getDate() - 10);
      return d.toISOString().slice(0, 10);
    })();
    api.get<{ ok: boolean; punches: EsslPunch[] }>(
      `/essl/employee-punches/${myEmpCode}?fromDate=${tenDaysAgo}&toDate=${today}`
    ).then((r) => {
      if (r.data.ok) {
        setPunches(r.data.punches);
        setLastFetched(formatTimeIST(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }));
      }
    }).catch(() => {}).finally(() => setLoadingPunches(false));
  };

  useEffect(() => { if (myEmpCode) fetchMyPunches(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [myEmpCode]);
  useEffect(() => {
    if (!isAdminOrHR && myEmpCode) {
      if (autoRef.current) clearInterval(autoRef.current);
      autoRef.current = setInterval(() => fetchMyPunches(), 60000);
      return () => { if (autoRef.current) clearInterval(autoRef.current); };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminOrHR, myEmpCode]);

  // ─── Admin/HR device-based punch feed ───────────────────────────────────────

  useEffect(() => {
    if (!isAdminOrHR) return;
    setLoadingPunches(true);
    api.get<LiveDevice[]>('/essl/live-devices').then((r) => {
      setDevices(r.data);
      const first = r.data.find((d) => d.hasCredentials) || r.data[0];
      if (first) setSelectedDevice(first.id);
      else setLoadingPunches(false); // no devices → stop spinner
    }).catch(() => { setLoadingPunches(false); });
  }, [isAdminOrHR]);

  // Postgres-backed feed (fast, always cheap). Used for initial load and auto-refresh.
  const fetchPunchesFromDb = (showLoader = false) => {
    if (!selectedDevice) return;
    if (showLoader) setLoadingPunches(true);
    api.get<{ ok: boolean; punches: EsslPunch[] }>(
      `/essl/db-punches?deviceId=${selectedDevice}&fromDate=${todayStr()}&toDate=${todayStr()}`
    ).then((r) => {
      if (r.data.ok) { setPunches(r.data.punches); setLastFetched(formatTimeIST(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })); }
    }).catch(() => {}).finally(() => setLoadingPunches(false));
  };

  // Live device read (slow, hits ESSL hardware). Only used on explicit user refresh,
  // and falls back to the Postgres feed if the device is offline / times out.
  const fetchPunches = (showLoader = false) => {
    if (!selectedDevice) return;
    if (showLoader) setLoadingPunches(true);
    api.get<{ ok: boolean; punches: EsslPunch[] }>(
      `/essl/live?deviceId=${selectedDevice}&fromDate=${todayStr()}&toDate=${todayStr()}`
    ).then((r) => {
      if (r.data.ok) { setPunches(r.data.punches); setLastFetched(formatTimeIST(new Date(), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })); }
    }).catch(() => {
      fetchPunchesFromDb(false);
    }).finally(() => setLoadingPunches(false));
  };

  useEffect(() => { if (selectedDevice) fetchPunchesFromDb(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [selectedDevice]);
  useEffect(() => {
    if (autoRef.current) clearInterval(autoRef.current);
    // Auto-refresh from Postgres (cheap), every 60s. ETL job keeps Postgres in sync.
    if (selectedDevice) autoRef.current = setInterval(() => fetchPunchesFromDb(), 60000);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDevice]);

  // Derived KPIs from live punches
  const stats = useMemo(() => {
    if (isAdminOrHR) {
      const uniqueEmployees = new Set(punches.map((p) => p.empCode));
      const ins  = punches.filter((p) => p.direction === 'in').length;
      const outs = punches.filter((p) => p.direction === 'out').length;
      return { present: uniqueEmployees.size, ins, outs, total: punches.length };
    }
    // For regular employees: show today's punches only in KPIs
    const todayDate = todayStr();
    const todayPunches = punches.filter((p) => p.timestamp.startsWith(todayDate));
    const ins  = todayPunches.filter((p) => p.direction === 'in').length;
    const outs = todayPunches.filter((p) => p.direction === 'out').length;
    return { present: todayPunches.length > 0 ? 1 : 0, ins, outs, total: todayPunches.length };
  }, [punches, isAdminOrHR]);

  const recentPunches = [...punches]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, isAdminOrHR ? 6 : 10);

  const today = formatDateIST(new Date(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="page-title">Overview</h2>
          <p className="text-body-md text-on-surface-variant mt-1.5 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-tertiary-container animate-pulse" />
            {today}
          </p>
        </div>

      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-6 auto-rows-min">
        {/* KPI Row */}
        <div className="col-span-1 md:col-span-4 lg:col-span-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {loadingPunches && punches.length === 0 ? (
            <>
              <SkeletonKpiCard />
              <SkeletonKpiCard />
              <SkeletonKpiCard />
              <SkeletonKpiCard />
            </>
          ) : (
            <>
          <KpiCard
            label="Greeting"
            value={user?.name?.split(' ')[0] || '—'}
            subtitle={roleConfig?.label || user?.role || ''}
            icon="waving_hand"
            color="primary"
          />
          <KpiCard
            label="Present Today"
            value={isAdminOrHR ? String(stats.present) : (stats.present > 0 ? 'Yes' : 'No')}
            subtitle={isAdminOrHR ? (stats.present > 0 ? `${stats.present} unique employees` : 'No punches yet') : (stats.present > 0 ? 'You have punched in today' : 'No punch recorded yet')}
            icon="how_to_reg"
            color="tertiary-container"
            progressPct={Math.min(100, stats.present * 2)}
          />
          <KpiCard
            label="Check-Ins"
            value={String(stats.ins)}
            subtitle={`${stats.outs} check-outs`}
            icon="login"
            color="primary"
          />
          <KpiCard
            label="Total Punches"
            value={String(stats.total)}
            subtitle={isAdminOrHR ? "Today's biometric activity" : "Your punches today"}
            icon="fingerprint"
            color="secondary-container"
          />
            </>
          )}
        </div>

        {/* Live Feed (main, 8 cols) */}
        <div className="col-span-1 md:col-span-4 lg:col-span-8 bg-white border border-primary/10 rounded-card shadow-soft-low p-6 flex flex-col min-h-[400px]">
          <div className="flex justify-between items-start mb-6 gap-3 flex-wrap">
            <div>
              <h3 className="text-headline-sm text-on-background flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-secondary-container animate-pulse" />
                {isAdminOrHR ? 'ESSL Live Feed' : 'My Recent Punches'}
              </h3>
              <p className="text-body-sm text-outline mt-0.5">
                {lastFetched ? `Last updated · ${lastFetched}` : (isAdminOrHR ? "Today's punches from biometric devices" : 'Your last 10 check-in / check-out records')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {devices.length > 1 && (
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="bg-surface border border-primary/10 rounded-lg px-3 py-1.5 text-body-sm text-on-surface focus:ring-primary/20"
                >
                  {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <button
                onClick={() => isAdminOrHR ? fetchPunches(true) : fetchMyPunches(true)}
                disabled={loadingPunches}
                className="p-2 rounded-lg hover:bg-primary/5 text-on-surface-variant transition-colors disabled:opacity-50"
                aria-label="Refresh"
              >
                <span className={`material-symbols-outlined text-[20px] ${loadingPunches ? 'animate-spin' : ''}`}>refresh</span>
              </button>
            </div>
          </div>

          {!isAdminOrHR ? (
            recentPunches.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{ backgroundColor: (roleConfig?.color || '#006591') + '20' }}
                >
                  <span className="material-symbols-outlined text-[28px]" style={{ color: roleConfig?.color || '#006591' }}>
                    fingerprint
                  </span>
                </div>
                <div>
                  <p className="text-headline-sm text-on-surface">No Punches Found</p>
                  <p className="text-body-sm text-on-surface-variant mt-1 max-w-sm">
                    No biometric activity recorded in the last 10 days.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 divide-y divide-primary/5 overflow-y-auto">
                {recentPunches.map((p) => (
                  <div key={p.id} className="py-3 flex items-center gap-4 hover:bg-surface-container-low/50 transition-colors px-2 -mx-2 rounded-lg">
                    <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                      <span className="material-symbols-outlined text-[20px]">
                        {p.direction === 'in' ? 'login' : 'logout'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body-md text-on-surface truncate">
                        <span className="font-bold">{p.timestamp.slice(0, 10)}</span>
                      </p>
                      <p className="text-body-sm text-outline mt-0.5">{p.deviceName || p.deviceSerial}</p>
                    </div>
                    <span className="font-mono text-body-sm text-on-surface-variant">{formatTs(p.timestamp)}</span>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-md border ${
                        p.direction === 'in'
                          ? 'bg-tertiary-container/15 text-tertiary border-tertiary-container/30'
                          : 'bg-secondary-container/15 text-secondary-container border-secondary-container/30'
                      }`}
                    >
                      {p.direction === 'in' ? 'IN' : 'OUT'}
                    </span>
                  </div>
                ))}
              </div>
            )
          ) : devices.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <span className="material-symbols-outlined text-[32px] text-outline-variant">monitor</span>
              <p className="text-body-md text-on-surface-variant">No devices configured</p>
              <button onClick={() => navigate('/devices')} className="text-label-md text-primary hover:underline mt-1">
                + Add a device
              </button>
            </div>
          ) : recentPunches.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center">
              <span className="material-symbols-outlined text-[32px] text-outline-variant">history</span>
              <p className="text-body-md text-on-surface-variant">
                No punches yet today
              </p>
            </div>
          ) : loadingPunches && punches.length === 0 ? (
            <SkeletonPunchFeed rows={6} />
          ) : (
            <div className="flex-1 divide-y divide-primary/5">
              {recentPunches.map((p) => (
                <div key={p.id} className="py-3 flex items-center gap-4 hover:bg-surface-container-low/50 transition-colors px-2 -mx-2 rounded-lg">
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-[20px]">
                      {p.direction === 'in' ? 'login' : 'logout'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-md text-on-surface truncate">
                      <span className="font-bold">
                        {p.empName !== p.empCode ? p.empName : `Employee ${p.empCode}`}
                      </span>
                    </p>
                    <p className="text-body-sm text-outline mt-0.5">Code: {p.empCode}</p>
                  </div>
                  <span className="font-mono text-body-sm text-on-surface-variant">{formatTs(p.timestamp)}</span>
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-md border ${
                      p.direction === 'in'
                        ? 'bg-tertiary-container/15 text-tertiary border-tertiary-container/30'
                        : 'bg-secondary-container/15 text-secondary-container border-secondary-container/30'
                    }`}
                  >
                    {p.direction === 'in' ? 'IN' : 'OUT'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column (4 cols): Quick actions card + Activity summary */}
        <div className="col-span-1 md:col-span-4 lg:col-span-4 flex flex-col gap-6">
          <div className="bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
            <h3 className="text-headline-sm text-on-background mb-1">Quick Actions</h3>
            <p className="text-body-sm text-outline mb-6">Frequently used features</p>
            {loadingPunches && punches.length === 0 ? (
              <div className="grid grid-cols-2 gap-3">
                <SkeletonActionTile />
                <SkeletonActionTile />
                <SkeletonActionTile />
                <SkeletonActionTile />
                <SkeletonActionTile />
                <SkeletonActionTile />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { to: '/attendance', label: 'Attendance', icon: 'schedule',     color: '#006591' },
                  { to: '/leaves',     label: 'Leaves',     icon: 'event_busy',   color: '#0ea5e9' },
                  { to: '/employees',  label: 'Employees',  icon: 'groups',       color: '#58a1dc', roles: ['Admin', 'HR'] },
                  { to: '/essl-live',  label: 'ESSL Live',  icon: 'fingerprint',  color: '#fd761a', roles: ['Admin', 'HR'] },
                  { to: '/reports',    label: 'Reports',    icon: 'bar_chart',    color: '#006399', roles: ['Admin', 'HR'] },
                  { to: '/profile',    label: 'Profile',    icon: 'person',       color: '#9d4300' },
                ]
                  .filter((a) => !a.roles || (user && a.roles.includes(user.role)))
                  .slice(0, 6)
                  .map((a) => (
                    <button
                      key={a.to}
                      onClick={() => navigate(a.to)}
                      className="flex flex-col items-start gap-2 p-3 rounded-xl border border-primary/10 hover:border-primary/30 hover:bg-primary/5 transition-all text-left"
                    >
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: a.color + '18', color: a.color }}
                      >
                        <span className="material-symbols-outlined text-[20px]">{a.icon}</span>
                      </div>
                      <span className="text-label-md text-on-surface">{a.label}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
            <h3 className="text-headline-sm text-on-background mb-1">{isAdminOrHR ? 'Today at a glance' : 'My Today'}</h3>
            <p className="text-body-sm text-outline mb-4">{isAdminOrHR ? 'Live biometric activity' : 'Your attendance today'}</p>
            <div className="space-y-3">
              {[
                { label: 'Check-ins',  value: stats.ins,    color: '#006591' },
                { label: 'Check-outs', value: stats.outs,   color: '#fd761a' },
                { label: 'Unique employees', value: stats.present, color: '#58a1dc' },
              ].map((s) => (
                <div key={s.label} className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-body-sm text-on-surface">{s.label}</span>
                  </div>
                  <span className="text-label-md text-on-background">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ──────────────────────────────────────────────────────────────
function KpiCard({
  label, value, subtitle, icon, color, progressPct,
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: string;
  color: 'primary' | 'tertiary-container' | 'secondary-container';
  progressPct?: number;
}) {
  const accent: Record<typeof color, { bg: string; text: string; ring: string }> = {
    'primary':              { bg: 'bg-primary/10',             text: 'text-primary',             ring: 'bg-primary/5' },
    'tertiary-container':   { bg: 'bg-tertiary-container/10',  text: 'text-tertiary-container',  ring: 'bg-tertiary-container/5' },
    'secondary-container':  { bg: 'bg-secondary-container/10', text: 'text-secondary-container', ring: 'bg-secondary-container/5' },
  };
  const a = accent[color];
  return (
    <div className="bg-white border border-primary/10 rounded-2xl shadow-premium-card p-6 relative overflow-hidden group hover:shadow-soft-high hover:-translate-y-0.5 transition-all duration-300">
      <div className={`absolute -right-8 -top-8 w-28 h-28 ${a.ring} rounded-full blur-2xl group-hover:opacity-100 opacity-70 transition-opacity`} />
      <div className="flex justify-between items-start mb-4 relative z-10">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.18em] text-on-surface-variant uppercase">{label}</p>
          <h3 className="text-[32px] leading-[1.1] tracking-tight font-bold text-on-background mt-1 truncate max-w-[200px]">{value}</h3>
        </div>
        <div className={`w-11 h-11 rounded-xl ${a.bg} flex items-center justify-center ${a.text} shrink-0 shadow-inset-highlight`}>
          <span className="material-symbols-outlined fill">{icon}</span>
        </div>
      </div>
      {progressPct !== undefined && (
        <div className="w-full bg-surface-container-high rounded-full h-1.5 mb-2 relative z-10 overflow-hidden">
          <div
            className={`h-1.5 rounded-full ${color === 'tertiary-container' ? 'bg-tertiary-container' : color === 'secondary-container' ? 'bg-secondary-container' : 'bg-primary'} relative`}
            style={{ width: `${progressPct}%` }}
          >
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent bg-[length:200%_100%] animate-shimmer" />
          </div>
        </div>
      )}
      <p className="text-body-sm text-outline relative z-10">{subtitle}</p>
    </div>
  );
}
