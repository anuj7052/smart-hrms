import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { LeaveRequest, LeaveType, LeaveBalance, WFHRequest } from '../types';
import { SkeletonBalanceCard } from '../components/Skeletons';
import { formatDateIST, todayISTDateString } from '../lib/datetime';
import { ApprovalsHub } from './Approvals';

function fmtDate(iso: string) {
  return formatDateIST(iso, { day: 'numeric', month: 'short', year: '2-digit' });
}

type Option = { value: string; label: string };

function CustomSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Option[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all flex items-center justify-between gap-2 text-left"
      >
        <span className="truncate">{selected ? selected.label : 'Select…'}</span>
        <span className={`material-symbols-outlined text-[20px] text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}>expand_more</span>
      </button>
      {open && (
        <ul className="absolute z-[80] left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-outline-variant bg-white shadow-soft-high py-1 animate-fade-in">
          {options.map((o) => (
            <li key={o.value}>
              <button
                type="button"
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-body-md transition-colors flex items-center justify-between gap-2 ${
                  o.value === value ? 'bg-primary/10 text-primary font-semibold' : 'text-on-surface hover:bg-surface-container-low'
                }`}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <span className="material-symbols-outlined text-[18px]">check</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TYPE_ACCENT: Record<string, { bg: string; text: string; icon: string }> = {
  annual:    { bg: 'bg-primary/10',             text: 'text-primary',             icon: 'beach_access' },
  sick:      { bg: 'bg-error-container',        text: 'text-error',               icon: 'local_hospital' },
  casual:    { bg: 'bg-tertiary-container/15',  text: 'text-tertiary',            icon: 'wb_sunny' },
  default:   { bg: 'bg-secondary-container/15', text: 'text-secondary-container', icon: 'event_busy' },
};
function accentFor(name: string) {
  const k = name.toLowerCase();
  if (k.includes('annual') || k.includes('vacation')) return TYPE_ACCENT.annual;
  if (k.includes('sick') || k.includes('medical'))    return TYPE_ACCENT.sick;
  if (k.includes('casual') || k.includes('personal')) return TYPE_ACCENT.casual;
  return TYPE_ACCENT.default;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending:   'bg-secondary-container/15 text-secondary-container border-secondary-container/30',
    Approved:  'bg-tertiary-container/15 text-tertiary border-tertiary-container/30',
    Rejected:  'bg-error-container text-error border-error/20',
    Cancelled: 'bg-surface-container-high text-on-surface-variant border-outline-variant/40',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-md border ${map[status] || map.Cancelled}`}>
      {status}
    </span>
  );
}

export default function LeavesPage() {
  const { user } = useAuth();
  const isAdminOrHR = user?.role === 'Admin' || user?.role === 'HR' || user?.role === 'Manager';

  const [searchParams, setSearchParams] = useSearchParams();
  const adminView: 'requests' | 'approvals' =
    isAdminOrHR && searchParams.get('tab') === 'approvals' ? 'approvals' : 'requests';
  const setAdminView = (v: 'requests' | 'approvals') => {
    const next = new URLSearchParams(searchParams);
    if (v === 'approvals') next.set('tab', 'approvals');
    else next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showModal, setShowModal] = useState(false);

  const [form, setForm] = useState({
    requestType: 'leave' as 'leave' | 'wfh',
    leaveTypeId: '',
    fromDate: '',
    toDate: '',
    reason: '',
    halfDay: false,
    halfDayPeriod: 'First Half' as 'First Half' | 'Second Half',
    wfhMode: 'WFH' as 'WFH' | 'Field' | 'ClientVisit',
    wfhDate: '',
  });

  const [wfhRequests, setWfhRequests] = useState<WFHRequest[]>([]);
  const [wfhTab, setWfhTab] = useState<'leaves' | 'wfh'>('leaves');
  const [submitting, setSubmitting] = useState(false);

  // Fetch only leaves list (for use after mutations)
  const fetchLeaves = useCallback(async () => {
    try {
      const leavesRes = await api.get<LeaveRequest[] | { data: LeaveRequest[] }>('/leaves', { params: { status: statusFilter || undefined } });
      const leavesData = Array.isArray(leavesRes.data) ? leavesRes.data : (leavesRes.data as { data: LeaveRequest[] }).data || [];
      setLeaves(leavesData);
    } catch { /* handled by fetchAll */ }
  }, [statusFilter]);

  const fetchWfhRequests = useCallback(async () => {
    try {
      const res = await api.get<WFHRequest[]>('/attendance/wfh-requests');
      setWfhRequests(Array.isArray(res.data) ? res.data : []);
    } catch { /* ignore */ }
  }, []);

  // Fetch leaves + balance (after apply/cancel that affects balance)
  const fetchLeavesAndBalance = useCallback(async () => {
    void fetchWfhRequests();
    try {
      const [leavesRes, balRes] = await Promise.all([
        api.get<LeaveRequest[] | { data: LeaveRequest[] }>('/leaves', { params: { status: statusFilter || undefined } }),
        api.get<LeaveBalance[]>('/leaves/balance').catch(() => ({ data: [] as LeaveBalance[] })),
      ]);
      const leavesData = Array.isArray(leavesRes.data) ? leavesRes.data : (leavesRes.data as { data: LeaveRequest[] }).data || [];
      setLeaves(leavesData);
      const rawBalances = Array.isArray(balRes.data) ? balRes.data : [];
      const mapped = rawBalances.map((b: unknown) => {
        const rb = b as { leaveType?: { _id: string; name: string; days?: number }; allocated?: number; available?: number };
        if (rb.leaveType) return { _id: rb.leaveType._id, leaveTypeId: { _id: rb.leaveType._id, name: rb.leaveType.name }, allocated: rb.allocated || 0, used: (rb.allocated || 0) - (rb.available || 0), remaining: rb.available || 0 };
        return b;
      });
      setBalances(mapped as LeaveBalance[]);
    } catch { /* handled by fetchAll */ }
  }, [statusFilter]);

  const fetchAll = useCallback(async () => {
    void fetchWfhRequests();
    setLoading(true);
    try {
      const [leavesRes, typesRes, balRes] = await Promise.all([
        api.get<LeaveRequest[] | { data: LeaveRequest[] }>('/leaves', { params: { status: statusFilter || undefined } }),
        api.get<LeaveType[]>('/leaves/types'),
        api.get<LeaveBalance[]>('/leaves/balance').catch(() => ({ data: [] as LeaveBalance[] })),
      ]);
      const leavesData = Array.isArray(leavesRes.data) ? leavesRes.data : (leavesRes.data as { data: LeaveRequest[] }).data || [];
      setLeaves(leavesData);
      setLeaveTypes(typesRes.data);
      const rawBalances = Array.isArray(balRes.data) ? balRes.data : [];
      const mapped = rawBalances.map((b: unknown) => {
        const rb = b as { leaveType?: { _id: string; name: string; days?: number }; allocated?: number; available?: number };
        if (rb.leaveType) return { _id: rb.leaveType._id, leaveTypeId: { _id: rb.leaveType._id, name: rb.leaveType.name }, allocated: rb.allocated || 0, used: (rb.allocated || 0) - (rb.available || 0), remaining: rb.available || 0 };
        return b;
      });
      setBalances(mapped as LeaveBalance[]);
      if (form.leaveTypeId === '' && typesRes.data[0]) {
        setForm((f) => ({ ...f, leaveTypeId: typesRes.data[0]._id }));
      }
    } catch { toast.error('Failed to load leaves'); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, fetchWfhRequests]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Lock background scroll while the request modal is open
  useEffect(() => {
    if (showModal) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [showModal]);

  // Refresh WFH requests when a virtual punch / WFH request is submitted elsewhere
  useEffect(() => {
    const handler = () => { void fetchWfhRequests(); };
    window.addEventListener('attendance:refresh', handler);
    return () => window.removeEventListener('attendance:refresh', handler);
  }, [fetchWfhRequests]);

  // Open the modal pre-filled with today's date for the chosen request type
  function openModal(requestType: 'leave' | 'wfh' = 'leave') {
    const today = todayISTDateString();
    setForm((f) => ({
      ...f,
      requestType,
      fromDate: today,
      toDate: today,
      wfhDate: today,
    }));
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setForm((f) => ({ ...f, requestType: 'leave' }));
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (form.requestType === 'wfh') {
        await api.post('/attendance/wfh-request', {
          date: form.wfhDate || form.fromDate,
          mode: form.wfhMode,
          reason: form.reason,
        });
        toast.success('WFH request submitted');
        void fetchWfhRequests();
      } else {
        const submitData = {
          leaveTypeId: form.leaveTypeId,
          fromDate: form.fromDate,
          toDate: form.halfDay ? form.fromDate : form.toDate,
          reason: form.halfDay ? `[${form.halfDayPeriod}] ${form.reason}` : form.reason,
        };
        await api.post('/leaves', submitData);
        toast.success('Leave request submitted');
        fetchLeavesAndBalance();
      }
      setShowModal(false);
      setForm((f) => ({ ...f, fromDate: '', toDate: '', reason: '', halfDay: false, wfhDate: '' }));
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    } finally { setSubmitting(false); }
  }

  async function handleCancel(id: string) {
    try {
      await api.delete(`/leaves/${id}`);
      toast.success('Leave cancelled');
      fetchLeavesAndBalance();
    } catch { toast.error('Cancel failed'); }
  }

  const pendingLeaves = useMemo(() => leaves.filter((l) => l.status === 'Pending'), [leaves]);
  const approvedLeaves = useMemo(() => leaves.filter((l) => l.status === 'Approved'), [leaves]);

  const inputCls = 'w-full h-10 px-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all';

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="page-title">Leave Management</h2>
          <p className="text-body-md text-on-surface-variant mt-1.5">
            {pendingLeaves.length} pending · {approvedLeaves.length} approved
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openModal('leave')}
            className="group relative px-4 py-2 bg-cta-primary hover:bg-cta-primary-hover text-white rounded-xl text-label-md transition-all flex items-center gap-2 shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985] overflow-hidden"
          >
            <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/15 to-transparent opacity-60 pointer-events-none" />
            <span className="material-symbols-outlined text-[18px] relative">add</span>
            <span className="relative tracking-wide">Request Leave</span>
          </button>
        </div>
      </div>

      {isAdminOrHR && (
        <div className="flex items-center gap-1 bg-surface-container-low rounded-full p-1 mb-6 w-fit">
          {([
            { v: 'requests', l: 'My Requests', icon: 'event_busy' },
            { v: 'approvals', l: 'Approvals', icon: 'rule' },
          ] as const).map((t) => (
            <button
              key={t.v}
              onClick={() => setAdminView(t.v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-label-md transition-colors ${
                adminView === t.v ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-primary/10'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{t.icon}</span>
              {t.l}
              {t.v === 'approvals' && adminView !== 'approvals' && pendingLeaves.length > 0 && (
                <span className="bg-red-100 text-red-600 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                  {pendingLeaves.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {isAdminOrHR && adminView === 'approvals' ? (
        <ApprovalsHub embedded />
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Leave Balance Cards */}
        <div className="col-span-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          {loading ? (
            <>
              <SkeletonBalanceCard />
              <SkeletonBalanceCard />
              <SkeletonBalanceCard />
            </>
          ) : balances.length === 0
            ? <p className="col-span-3 text-body-md text-on-surface-variant">No leave balances configured.</p>
            : balances.map((b) => {
                const accent = accentFor(b.leaveTypeId.name);
                const total = b.allocated || (b.used + b.remaining);
                const usedPct = total > 0 ? (b.used / total) * 100 : 0;
                return (
                  <div key={b._id} className="bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-12 h-12 rounded-xl ${accent.bg} flex items-center justify-center ${accent.text}`}>
                        <span className="material-symbols-outlined fill text-[24px]">{accent.icon}</span>
                      </div>
                      <span className="text-label-md text-on-surface-variant uppercase tracking-wider">{b.leaveTypeId.name}</span>
                    </div>
                    <div className="mb-3">
                      <p className="text-headline-xl text-on-background leading-none">{b.leaveTypeId.isUnlimited ? 'No limit' : b.remaining}</p>
                      <p className="text-body-sm text-outline mt-1">{b.leaveTypeId.isUnlimited ? 'subject to approval' : 'days available'}</p>
                    </div>
                    {!b.leaveTypeId.isUnlimited && <div className="w-full bg-surface-container-high rounded-full h-1.5 mb-2">
                      <div
                        className={`h-1.5 rounded-full ${accent.text.replace('text-', 'bg-')}`}
                        style={{ width: `${usedPct}%` }}
                      />
                    </div>}
                    <p className="text-body-sm text-on-surface-variant">
                      {b.leaveTypeId.isUnlimited ? `${b.used} days used · No annual limit` : `${b.used} of ${total} days used`}
                    </p>
                  </div>
                );
              })
          }
        </div>

        {/* Leave / WFH Requests List (8 cols) */}
        <div className="col-span-12 lg:col-span-8 bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
          <div className="flex justify-between items-start mb-4 flex-wrap gap-3">
            <h3 className="text-headline-sm text-on-background">
              {isAdminOrHR ? 'Team Requests' : 'My Requests'}
            </h3>
            {/* Tab: Leaves / WFH */}
            <div className="flex items-center gap-1 bg-surface-container-low rounded-full p-1">
              {(['leaves', 'wfh'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setWfhTab(t)}
                  className={`px-3 py-1.5 rounded-full text-label-md transition-colors ${
                    wfhTab === t ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-primary/10'
                  }`}
                >
                  {t === 'leaves' ? 'Leaves' : 'Work From Home'}
                </button>
              ))}
            </div>
          </div>

          {/* Status filter chips — only for leaves tab */}
          {wfhTab === 'leaves' && (
            <div className="flex gap-2 flex-wrap mb-5">
              {[
                { v: '', l: 'All' },
                { v: 'Pending',  l: 'Pending' },
                { v: 'Approved', l: 'Approved' },
                { v: 'Rejected', l: 'Rejected' },
              ].map((s) => (
                <button
                  key={s.v}
                  onClick={() => setStatusFilter(s.v)}
                  className={`px-3 py-1.5 rounded-full text-label-md transition-colors ${
                    statusFilter === s.v
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-on-surface-variant hover:bg-primary/10'
                  }`}
                >
                  {s.l}
                </button>
              ))}
            </div>
          )}

          {wfhTab === 'leaves' ? (
            loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="skeleton h-16 rounded-xl" />
                ))}
              </div>
            ) : leaves.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <span className="material-symbols-outlined text-[40px] text-outline-variant">event_available</span>
                <p className="text-body-md text-on-surface-variant">No leave requests found</p>
                <button
                  onClick={() => openModal('leave')}
                  className="mt-1 px-4 py-2 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md transition-all shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985]"
                >
                  Request Leave
                </button>
              </div>
            ) : (
              <div className="divide-y divide-primary/5">
                {leaves.map((leave) => {
                  const accent = accentFor(leave.leaveTypeId.name);
                  const employeeName = leave.employeeId?.userId?.name || 'You';
                  return (
                    <div key={leave._id} className="py-4 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                        {employeeName[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-body-md text-on-background font-bold">{employeeName}</p>
                          <StatusBadge status={leave.status} />
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-body-sm text-on-surface-variant">
                          <span className={`material-symbols-outlined text-[16px] ${accent.text}`}>{accent.icon}</span>
                          <span>{leave.leaveTypeId.name} · {fmtDate(leave.fromDate)}{leave.fromDate !== leave.toDate ? ` — ${fmtDate(leave.toDate)}` : ''}</span>
                          <span className="text-outline">·</span>
                          <span className="font-medium">{leave.totalDays} day{leave.totalDays !== 1 ? 's' : ''}</span>
                        </div>
                        {leave.reason && (
                          <p className="text-body-sm text-outline mt-1 line-clamp-1">{leave.reason}</p>
                        )}
                        {leave.reviewComment && (
                          <p className="text-body-sm text-outline italic mt-1">&ldquo;{leave.reviewComment}&rdquo;</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {!isAdminOrHR && leave.status === 'Pending' && (
                          <button
                            onClick={() => handleCancel(leave._id)}
                            className="px-3 py-1.5 rounded-lg text-error text-label-md hover:bg-error/10 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* WFH Requests tab */
            wfhRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <span className="material-symbols-outlined text-[40px] text-outline-variant">home_work</span>
                <p className="text-body-md text-on-surface-variant">No WFH requests yet</p>
                <button
                  onClick={() => openModal('wfh')}
                  className="mt-1 px-4 py-2 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md transition-all shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985]"
                >
                  Request WFH
                </button>
              </div>
            ) : (
              <div className="divide-y divide-primary/5">
                {wfhRequests.map((req) => {
                  const wfhR = req as unknown as { id?: string; _id?: string; date: string; mode: string; reason: string; status: string; reviewComment?: string; employeeName?: string };
                  const reqId = wfhR.id || wfhR._id || '';
                  const modeColors: Record<string, string> = {
                    WFH: 'bg-green-100 text-green-700',
                    Field: 'bg-orange-100 text-orange-700',
                    ClientVisit: 'bg-purple-100 text-purple-700',
                  };
                  return (
                    <div key={reqId} className="py-4 flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-[20px]">home_work</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {isAdminOrHR && wfhR.employeeName && (
                            <p className="text-body-md text-on-background font-bold">{wfhR.employeeName}</p>
                          )}
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-md font-semibold ${modeColors[wfhR.mode] || 'bg-gray-100 text-gray-600'}`}>
                            {wfhR.mode === 'WFH' ? 'Work From Home' : wfhR.mode}
                          </span>
                          <StatusBadge status={wfhR.status} />
                        </div>
                        <p className="text-body-sm text-on-surface-variant mt-1">
                          {fmtDate(wfhR.date)}
                        </p>
                        {wfhR.reason && (
                          <p className="text-body-sm text-outline mt-1 line-clamp-1">{wfhR.reason}</p>
                        )}
                        {wfhR.reviewComment && (
                          <p className="text-body-sm text-outline italic mt-1">&ldquo;{wfhR.reviewComment}&rdquo;</p>
                        )}
                      </div>
                      {isAdminOrHR && wfhR.status === 'Pending' && (
                        <button
                          onClick={() => setAdminView('approvals')}
                          className="px-3 py-1.5 rounded-lg text-primary text-label-md hover:bg-primary/10 transition-colors shrink-0"
                        >
                          Review
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>

        {/* Who's Away (4 cols) */}
        <div className="col-span-12 lg:col-span-4 bg-white border border-primary/10 rounded-card shadow-soft-low p-6">
          <h3 className="text-headline-sm text-on-background mb-1">Who&apos;s Away</h3>
          <p className="text-body-sm text-outline mb-5">Currently approved leaves</p>
          {approvedLeaves.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <span className="material-symbols-outlined text-[28px] text-outline-variant">groups</span>
              <p className="text-body-sm text-on-surface-variant">Everyone&apos;s here today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {approvedLeaves.slice(0, 6).map((leave) => {
                const accent = accentFor(leave.leaveTypeId.name);
                const name = leave.employeeId?.userId?.name || 'Employee';
                return (
                  <div key={leave._id} className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl ${accent.bg} ${accent.text} flex items-center justify-center shrink-0`}>
                      <span className="material-symbols-outlined fill text-[20px]">{accent.icon}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-body-md text-on-surface font-bold truncate">{name}</p>
                      <p className="text-body-sm text-outline truncate">
                        {leave.leaveTypeId.name} · {fmtDate(leave.fromDate)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Apply Leave / WFH Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm animate-fade-in"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md bg-white border border-primary/10 rounded-card shadow-soft-high p-6 animate-slide-in max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-headline-sm text-on-background">New Request</h2>
              <button onClick={closeModal} className="text-outline hover:text-on-surface transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Request type toggle */}
            <div className="flex items-center gap-1 bg-surface-container-low rounded-full p-1 mb-5">
              {(['leave', 'wfh'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, requestType: t }))}
                  className={`flex-1 py-1.5 rounded-full text-label-md transition-colors ${
                    form.requestType === t ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-primary/10'
                  }`}
                >
                  {t === 'leave' ? 'Leave' : 'Work From Home'}
                </button>
              ))}
            </div>

            <form onSubmit={handleApply} className="space-y-4">
              {form.requestType === 'wfh' ? (
                <>
                  <div>
                    <label className="block text-label-md text-on-surface mb-1">Date</label>
                    <input
                      type="date"
                      className={inputCls}
                      value={form.wfhDate}
                      onChange={(e) => setForm((f) => ({ ...f, wfhDate: e.target.value }))}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-label-md text-on-surface mb-1">Work Mode</label>
                    <CustomSelect
                      value={form.wfhMode}
                      onChange={(v) => setForm((f) => ({ ...f, wfhMode: v as 'WFH' | 'Field' | 'ClientVisit' }))}
                      options={[
                        { value: 'WFH', label: 'Work From Home' },
                        { value: 'Field', label: 'Field Work' },
                        { value: 'ClientVisit', label: 'Client Visit' },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="block text-label-md text-on-surface mb-1">Reason <span className="text-outline font-normal">(optional)</span></label>
                    <textarea
                      className="w-full p-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none h-24"
                      value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                      placeholder="Reason for working remotely…"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-label-md text-on-surface mb-1">Leave Type</label>
                    <CustomSelect
                      value={form.leaveTypeId}
                      onChange={(v) => setForm((f) => ({ ...f, leaveTypeId: v }))}
                      options={leaveTypes.map((lt) => ({ value: lt._id, label: `${lt.name} (${lt.isUnlimited ? 'No annual limit' : `${lt.daysAllowed} days/year`})` }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-label-md text-on-surface mb-1">From</label>
                      <input
                        type="date"
                        className={inputCls}
                        value={form.fromDate}
                        onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value, toDate: f.halfDay ? e.target.value : f.toDate }))}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-label-md text-on-surface mb-1">To</label>
                      <input
                        type="date"
                        className={inputCls}
                        value={form.halfDay ? form.fromDate : form.toDate}
                        min={form.fromDate}
                        onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                        disabled={form.halfDay}
                        required
                      />
                    </div>
                  </div>
                  {/* Half day — checkbox linked to period dropdown */}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        id="halfDay"
                        type="checkbox"
                        className="w-4 h-4 rounded accent-primary cursor-pointer"
                        checked={form.halfDay}
                        onChange={(e) => setForm((f) => ({
                          ...f,
                          halfDay: e.target.checked,
                          toDate: e.target.checked ? f.fromDate : f.toDate,
                        }))}
                      />
                      <span className="text-label-md text-on-surface">Half Day</span>
                    </label>
                    {form.halfDay && (
                      <div className="w-36">
                        <CustomSelect
                          value={form.halfDayPeriod}
                          onChange={(v) => setForm((f) => ({ ...f, halfDayPeriod: v as 'First Half' | 'Second Half' }))}
                          options={[
                            { value: 'First Half', label: 'First Half' },
                            { value: 'Second Half', label: 'Second Half' },
                          ]}
                        />
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-label-md text-on-surface mb-1">Reason</label>
                    <textarea
                      className="w-full p-3 rounded-lg border border-outline-variant bg-white text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all resize-none h-24"
                      value={form.reason}
                      onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                      required
                      placeholder="Brief reason for the leave…"
                    />
                  </div>
                </>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={closeModal} className="flex-1 h-11 rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="flex-1 h-11 rounded-xl bg-cta-primary hover:bg-cta-primary-hover text-white text-label-md transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985]">
                  {submitting && (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal removed — HR/Admin/Manager review leave requests on the Approvals page */}
    </div>
  );
}
