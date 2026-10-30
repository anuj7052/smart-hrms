import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle2, Clock3, LogIn, LogOut, Loader2, Lock, Monitor, Wifi, Send, XCircle, MapPin } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { reverseGeocode } from '../utils/geocode';

interface VirtualLoginStatus {
  virtualLoginEnabled: boolean;
  saturdayMode?: boolean;
  effectiveEnabled?: boolean;
  isPunchedIn: boolean;
  isPunchedOut: boolean;
  source?: string | null;
  log: { punchIn?: string; punchOut?: string; status?: string; workHours?: number } | null;
}

interface TodayWfhRequest {
  id?: string;
  _id?: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  mode: string;
  reason: string;
}

function formatTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
}

/**
 * Self-service virtual punch widget shown to employees with virtualLoginEnabled.
 * Placed on the Attendance page for quick access.
 */
export default function VirtualPunchWidget() {
  const [status, setStatus] = useState<VirtualLoginStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [punching, setPunching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [todayWfh, setTodayWfh] = useState<TodayWfhRequest | null>(null);
  const [approvalReason, setApprovalReason] = useState('');
  const [submittingApproval, setSubmittingApproval] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, wfhRes] = await Promise.allSettled([
        api.get<VirtualLoginStatus>('/attendance/virtual-login-status'),
        api.get<TodayWfhRequest[]>('/attendance/wfh-requests'),
      ]);
      if (statusRes.status === 'fulfilled') setStatus(statusRes.value.data);
      else setStatus(null);
      if (wfhRes.status === 'fulfilled') {
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayReq = (wfhRes.value.data as TodayWfhRequest[]).find((r) => {
          const raw = r as unknown as { date?: string };
          return typeof raw.date === 'string' && raw.date.startsWith(todayStr);
        }) || null;
        setTodayWfh(todayReq);
      }
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gray-100 animate-pulse" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-32 rounded bg-gray-100 animate-pulse" />
            <div className="h-2.5 w-44 rounded bg-gray-100 animate-pulse" />
          </div>
        </div>
        <div className="h-20 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  if (!status) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
            <AlertCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-amber-900">Virtual punch unavailable</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700">
              We could not load your virtual attendance status. Try again after a refresh.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const effectiveEnabled = status.effectiveEnabled ?? status.virtualLoginEnabled;
  const isPunchedIn = status.isPunchedIn;
  const isPunchedOut = status.isPunchedOut;
  const statusLabel = isPunchedOut ? 'Complete' : isPunchedIn ? 'Live' : 'Ready';
  const statusClass = isPunchedOut
    ? 'bg-success-500/15 text-success-700'
    : isPunchedIn
      ? 'bg-primary-600/10 text-primary-700'
      : 'bg-gray-100 text-gray-600';

  if (!effectiveEnabled) {
    const statusColors = {
      Pending:  { wrap: 'border-amber-200 bg-amber-50',  text: 'text-amber-800',  sub: 'text-amber-700',  icon: <Clock3 className="h-5 w-5 text-amber-600" /> },
      Approved: { wrap: 'border-green-200 bg-green-50',  text: 'text-green-800',  sub: 'text-green-700',  icon: <CheckCircle2 className="h-5 w-5 text-green-600" /> },
      Rejected: { wrap: 'border-red-200 bg-red-50',      text: 'text-red-900',    sub: 'text-red-700',    icon: <XCircle className="h-5 w-5 text-red-500" /> },
    };

    async function handleSendForApproval() {
      setSubmittingApproval(true);
      try {
        const todayStr = new Date().toISOString().slice(0, 10);
        await api.post('/attendance/wfh-request', { date: todayStr, mode: 'WFH', reason: approvalReason });
        toast.success('Approval request sent');
        setApprovalReason('');
        await fetchStatus();
        window.dispatchEvent(new CustomEvent('attendance:refresh'));
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to send request';
        toast.error(msg);
      } finally {
        setSubmittingApproval(false);
      }
    }

    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gray-100 text-gray-500">
            <Lock className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-black text-gray-900">Virtual punch</p>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-gray-500">
                Not enabled
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Remote attendance isn&apos;t enabled for this account. Send a request for admin approval.
            </p>
          </div>
        </div>

        {/* Today's existing request */}
        {todayWfh ? (
          <div className={`rounded-2xl border p-3 ${statusColors[todayWfh.status]?.wrap ?? 'border-gray-200 bg-gray-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              {statusColors[todayWfh.status]?.icon}
              <p className={`text-sm font-black ${statusColors[todayWfh.status]?.text ?? 'text-gray-800'}`}>
                Request {todayWfh.status}
              </p>
            </div>
            <p className={`text-xs leading-relaxed ${statusColors[todayWfh.status]?.sub ?? 'text-gray-600'}`}>
              {todayWfh.status === 'Pending'
                ? 'Waiting for admin approval. You\'ll be notified once reviewed.'
                : todayWfh.status === 'Approved'
                  ? 'Your virtual attendance for today has been approved.'
                  : 'Your request was rejected. Contact your manager for assistance.'}
            </p>
            {todayWfh.reason && (
              <p className="mt-1.5 text-[11px] text-gray-500 italic line-clamp-1">&ldquo;{todayWfh.reason}&rdquo;</p>
            )}
          </div>
        ) : (
          /* Send for approval form */
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wide mb-1.5">
                Reason for remote work today <span className="text-gray-400 font-semibold normal-case">(optional)</span>
              </label>
              <textarea
                value={approvalReason}
                onChange={(e) => setApprovalReason(e.target.value)}
                placeholder="Working from home because…"
                rows={3}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-primary-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-400/20 transition-all"
              />
            </div>
            <button
              onClick={handleSendForApproval}
              disabled={submittingApproval}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 px-4 py-3 text-sm font-black text-white shadow-[0_8px_20px_rgba(2,76,128,0.20)] transition-all hover:-translate-y-0.5 hover:bg-primary-700 disabled:translate-y-0 disabled:opacity-50"
            >
              {submittingApproval ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send for Approval
            </button>
            <p className="text-center text-[11px] font-semibold text-gray-400">
              Track this request on the Leaves page → Work From Home tab.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ── GPS + punch helpers ─────────────────────────────────────────────────
  const captureLocation = (): Promise<{ lat: number; lng: number; accuracy: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          resolve({
            lat: parseFloat(pos.coords.latitude.toFixed(6)),
            lng: parseFloat(pos.coords.longitude.toFixed(6)),
            accuracy: Math.round(pos.coords.accuracy),
          });
        },
        () => { setLocating(false); resolve(null); },
        { timeout: 15000, maximumAge: 0, enableHighAccuracy: true }
      );
    });

  const handlePunchIn = async () => {
    setPunching(true);
    setLocationLabel(null);
    try {
      const loc = await captureLocation();
      if (!loc) {
        toast.error('Location is required to punch in. Please allow location access and try again.');
        return;
      }
      const address = await reverseGeocode(loc.lat, loc.lng);
      setLocationLabel(address || `${loc.lat}, ${loc.lng}`);
      const res = await api.post<{ message: string }>('/attendance/virtual-punch-in', {
        attendanceMode: 'WFH',
        lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy,
        ...(address ? { address } : {}),
      });
      toast.success(res.data.message);
      await fetchStatus();
      window.dispatchEvent(new CustomEvent('attendance:refresh'));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Virtual punch-in failed';
      toast.error(msg);
    } finally {
      setPunching(false);
    }
  };

  const handlePunchOut = async () => {
    setPunching(true);
    setLocationLabel(null);
    try {
      const loc = await captureLocation();
      if (!loc) {
        toast.error('Location is required to punch out. Please allow location access and try again.');
        return;
      }
      const address = await reverseGeocode(loc.lat, loc.lng);
      setLocationLabel(address || `${loc.lat}, ${loc.lng}`);
      const res = await api.post<{ message: string }>('/attendance/virtual-punch-out', {
        lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy,
        ...(address ? { address } : {}),
      });
      toast.success(res.data.message);
      await fetchStatus();
      window.dispatchEvent(new CustomEvent('attendance:refresh'));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Virtual punch-out failed';
      toast.error(msg);
    } finally {
      setPunching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
          isPunchedOut ? 'bg-success-500/15 text-success-700' : isPunchedIn ? 'bg-primary-600/10 text-primary-700' : 'bg-sky-500/15 text-sky-700'
        }`}>
          {isPunchedOut ? <CheckCircle2 className="h-5 w-5" /> : isPunchedIn ? <Clock3 className="h-5 w-5" /> : <Wifi className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-black text-gray-900">Virtual punch</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusClass}`}>
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            {isPunchedOut
              ? 'Your attendance is complete for today.'
              : isPunchedIn
                ? `You're clocked in${status.source === 'device' ? ' (via device)' : ''}. Punch out when done.`
                : 'Tap punch in to start your virtual attendance.'}
          </p>
        </div>
        <Monitor className="mt-1 h-4 w-4 shrink-0 text-gray-300" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">In</p>
          <p className="mt-1 text-sm font-black tabular-nums text-gray-900">{formatTime(status.log?.punchIn)}</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Out</p>
          <p className="mt-1 text-sm font-black tabular-nums text-gray-900">{formatTime(status.log?.punchOut)}</p>
        </div>
      </div>

      {status.saturdayMode && (
        <div className="rounded-2xl border border-purple-200 bg-purple-50 px-3 py-2 text-[11px] font-bold text-purple-700">
          Saturday mode: virtual punch is open for all staff.
        </div>
      )}

      {isPunchedOut ? (
        <div className="rounded-2xl border border-success-500/20 bg-success-500/10 px-3 py-3 text-center">
          <p className="text-sm font-black text-success-700">Done for today</p>
          <p className="mt-1 text-xs font-semibold text-success-700/80">
            {status.log?.workHours != null ? `${status.log.workHours.toFixed(1)} hours recorded` : 'Your punch-out has been recorded'}
          </p>
        </div>
      ) : isPunchedIn ? (
        <button
          onClick={handlePunchOut}
          disabled={punching || locating}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-danger-500 px-4 py-3 text-sm font-black text-white shadow-[0_12px_24px_rgba(220,38,38,0.22)] transition-all hover:-translate-y-0.5 hover:bg-danger-600 disabled:translate-y-0 disabled:opacity-60"
        >
          {locating ? <MapPin className="h-4 w-4 animate-pulse" /> : punching ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          {locating ? 'Getting location…' : punching ? 'Punching out…' : 'Punch out'}
        </button>
      ) : (
        <button
          onClick={handlePunchIn}
          disabled={punching || locating}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-success-600 px-4 py-3 text-sm font-black text-white shadow-[0_12px_24px_rgba(22,163,74,0.22)] transition-all hover:-translate-y-0.5 hover:bg-success-700 disabled:translate-y-0 disabled:opacity-60"
        >
          {locating ? <MapPin className="h-4 w-4 animate-pulse" /> : punching ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          {locating ? 'Getting location…' : punching ? 'Punching in…' : 'Punch in'}
        </button>
      )}

      {/* Location pill — shows captured address after punch, hidden once day is complete */}
      {locationLabel && !isPunchedOut && (
        <div className="flex items-center gap-1.5 rounded-xl bg-blue-50 border border-blue-100 px-3 py-2">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-500" />
          <p className="text-[11px] font-semibold text-blue-700 truncate">{locationLabel}</p>
        </div>
      )}
    </div>
  );
}
