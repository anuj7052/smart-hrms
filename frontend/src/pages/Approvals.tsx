import { useState, useEffect, useCallback, useMemo } from 'react';
import { CheckCircle, XCircle, Loader2, X, Download } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { LeaveRequest, WFHRequest, AttendanceLog } from '../types';
import { formatDateIST } from '../lib/datetime';

type Tab = 'all' | 'leaves' | 'wfh' | 'regularizations';

type UnifiedRow =
  | { kind: 'leave'; uid: string; date: string; data: LeaveRequest }
  | { kind: 'wfh';   uid: string; date: string; data: WFHRequest }
  | { kind: 'reg';   uid: string; date: string; data: AttendanceLog };

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const content = [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function TypeBadge({ kind }: { kind: 'leave' | 'wfh' | 'reg' }) {
  const cfg = {
    leave: { label: 'Leave',          cls: 'bg-blue-100 text-blue-700' },
    wfh:   { label: 'WFH',            cls: 'bg-purple-100 text-purple-700' },
    reg:   { label: 'Regularization', cls: 'bg-orange-100 text-orange-700' },
  }[kind];
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.cls}`}>{cfg.label}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending: 'badge-yellow',
    Approved: 'badge-green',
    Rejected: 'badge-red',
    Cancelled: 'badge-gray',
  };
  return <span className={map[status] || 'badge-gray'}>{status}</span>;
}

function ReviewModal({
  title,
  details,
  comment,
  onCommentChange,
  onClose,
  onApprove,
  onReject,
  submitting,
}: {
  title: string;
  details: { label: string; value: string }[];
  comment: string;
  onCommentChange: (v: string) => void;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
      <div className="card w-full max-w-md p-6 animate-slide-in">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg text-gray-900">{title}</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
          {details.map(({ label, value }) => (
            <div key={label} className="flex items-start gap-2">
              <span className="text-gray-500 shrink-0 w-16">{label}:</span>
              <span className="text-gray-700 break-words">{value}</span>
            </div>
          ))}
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Comment (optional)
          </label>
          <input
            type="text"
            className="input"
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Add a comment..."
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={onApprove}
            disabled={submitting}
            className="btn-primary flex-1 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            Approve
          </button>
          <button
            onClick={onReject}
            disabled={submitting}
            className="btn-danger flex-1 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

export function ApprovalsHub({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('all');
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [wfhRequests, setWfhRequests] = useState<WFHRequest[]>([]);
  const [regularizations, setRegularizations] = useState<AttendanceLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewLeave, setReviewLeave] = useState<LeaveRequest | null>(null);
  const [reviewWFH, setReviewWFH] = useState<WFHRequest | null>(null);
  const [reviewReg, setReviewReg] = useState<AttendanceLog | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'Pending' | 'Approved' | 'Rejected' | 'all'>('Pending');
  const [selLeaves, setSelLeaves] = useState<Set<string>>(new Set());
  const [selWFH,    setSelWFH]    = useState<Set<string>>(new Set());
  const [selRegs,   setSelRegs]   = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const params = statusFilter === 'all' ? {} : { status: statusFilter };
    try {
      const [leavesRes, wfhRes, regRes] = await Promise.all([
        api.get<LeaveRequest[]>('/leaves', { params }),
        api.get<WFHRequest[]>('/attendance/wfh-requests', { params }),
        api.get<AttendanceLog[]>('/attendance/regularizations', { params }),
      ]);
      setLeaves(leavesRes.data);
      setWfhRequests(wfhRes.data);
      setRegularizations(regRes.data);
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Reset selections when tab or status filter changes
  useEffect(() => {
    setSelLeaves(new Set()); setSelWFH(new Set()); setSelRegs(new Set());
  }, [tab, statusFilter]);

  const allRows = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [
      ...leaves.map(d => ({ kind: 'leave' as const, uid: d._id, date: d.fromDate, data: d })),
      ...wfhRequests.map(d => ({ kind: 'wfh' as const, uid: d._id || d.id || '', date: d.date, data: d })),
      ...regularizations.map(d => ({ kind: 'reg' as const, uid: (d._id || d.id) ?? '', date: d.date, data: d })),
    ];
    return rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [leaves, wfhRequests, regularizations]);

  async function handleLeaveReview(status: 'Approved' | 'Rejected') {
    if (!reviewLeave) return;
    setSubmitting(true);
    try {
      await api.put(`/leaves/${reviewLeave._id}/review`, { status, comment });
      toast.success(`Leave ${status}`);
      setReviewLeave(null);
      setComment('');
      await fetchAll();
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWFHReview(status: 'Approved' | 'Rejected') {
    if (!reviewWFH) return;
    setSubmitting(true);
    try {
      await api.put(`/attendance/wfh-requests/${reviewWFH._id || reviewWFH.id}/review`, {
        status,
        reviewComment: comment,
      });
      toast.success(`WFH request ${status}`);
      setReviewWFH(null);
      setComment('');
      await fetchAll();
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegReview(status: 'Approved' | 'Rejected') {
    if (!reviewReg) return;
    setSubmitting(true);
    try {
      await api.put(`/attendance/regularizations/${reviewReg._id || reviewReg.id}/review`, { status, comment });
      toast.success(`Regularization ${status}`);
      setReviewReg(null);
      setComment('');
      await fetchAll();
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed'
      );
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Bulk selection helpers ────────────────────────────────────────────────
  const pendingLeaveIds = leaves.filter(l => l.status === 'Pending').map(l => l._id);
  const pendingWFHIds   = wfhRequests.filter(r => r.status === 'Pending').map(r => r._id || r.id || '');
  const pendingRegIds   = regularizations.filter(r => r.regularizationStatus === 'Pending').map(r => (r._id || r.id) ?? '');

  function toggleLeaveSel(id: string) { setSelLeaves(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleWFHSel(id: string)   { setSelWFH(prev   => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleRegSel(id: string)   { setSelRegs(prev  => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }

  function toggleAllLeaves() {
    setSelLeaves(selLeaves.size === pendingLeaveIds.length && pendingLeaveIds.length > 0 ? new Set() : new Set(pendingLeaveIds));
  }
  function toggleAllWFH() {
    setSelWFH(selWFH.size === pendingWFHIds.length && pendingWFHIds.length > 0 ? new Set() : new Set(pendingWFHIds));
  }
  function toggleAllRegs() {
    setSelRegs(selRegs.size === pendingRegIds.length && pendingRegIds.length > 0 ? new Set() : new Set(pendingRegIds));
  }
  function toggleAllCombined() {
    const allPend = pendingLeaveIds.length + pendingWFHIds.length + pendingRegIds.length;
    const allSel  = selLeaves.size + selWFH.size + selRegs.size;
    if (allSel === allPend && allPend > 0) {
      setSelLeaves(new Set()); setSelWFH(new Set()); setSelRegs(new Set());
    } else {
      setSelLeaves(new Set(pendingLeaveIds)); setSelWFH(new Set(pendingWFHIds)); setSelRegs(new Set(pendingRegIds));
    }
  }

  async function bulkApprove(type: 'leaves' | 'wfh' | 'regs') {
    const ids = type === 'leaves' ? [...selLeaves] : type === 'wfh' ? [...selWFH] : [...selRegs];
    if (!ids.length) return;
    setBulkSubmitting(true);
    try {
      if (type === 'leaves')
        await Promise.all(ids.map(id => api.put(`/leaves/${id}/review`, { status: 'Approved' })));
      else if (type === 'wfh')
        await Promise.all(ids.map(id => api.put(`/attendance/wfh-requests/${id}/review`, { status: 'Approved', reviewComment: '' })));
      else
        await Promise.all(ids.map(id => api.put(`/attendance/regularizations/${id}/review`, { status: 'Approved' })));
      if (type === 'leaves') setSelLeaves(new Set());
      else if (type === 'wfh') setSelWFH(new Set());
      else setSelRegs(new Set());
      toast.success(`${ids.length} item${ids.length > 1 ? 's' : ''} approved`);
      await fetchAll();
    } catch {
      toast.error('Some approvals failed');
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function bulkApproveAll() {
    const count = selLeaves.size + selWFH.size + selRegs.size;
    if (!count) return;
    setBulkSubmitting(true);
    try {
      await Promise.all([
        ...[...selLeaves].map(id => api.put(`/leaves/${id}/review`, { status: 'Approved' })),
        ...[...selWFH].map(id => api.put(`/attendance/wfh-requests/${id}/review`, { status: 'Approved', reviewComment: '' })),
        ...[...selRegs].map(id => api.put(`/attendance/regularizations/${id}/review`, { status: 'Approved' })),
      ]);
      setSelLeaves(new Set()); setSelWFH(new Set()); setSelRegs(new Set());
      toast.success(`${count} item${count > 1 ? 's' : ''} approved`);
      await fetchAll();
    } catch {
      toast.error('Some approvals failed');
    } finally {
      setBulkSubmitting(false);
    }
  }

  // ─── Export helpers ────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);

  function doExportLeaves() {
    exportCSV(`leaves-${today}.csv`,
      ['Employee', 'Leave Type', 'From', 'To', 'Days', 'Reason', 'Status'],
      leaves.map(l => [l.employeeId?.userId?.name || '', l.leaveTypeId.name, formatDateIST(l.fromDate), formatDateIST(l.toDate), String(l.totalDays), l.reason, l.status])
    );
  }
  function doExportWFH() {
    exportCSV(`wfh-${today}.csv`,
      ['Employee', 'Date', 'Mode', 'Reason', 'Status'],
      wfhRequests.map(r => {
        const empObj = r.employeeId as { _id: string; userId?: { name: string } };
        const name = r.employeeName || (typeof r.employeeId === 'object' ? empObj?.userId?.name : '') || '';
        return [name, formatDateIST(r.date), r.mode, r.reason, r.status];
      })
    );
  }
  function doExportRegs() {
    exportCSV(`regularizations-${today}.csv`,
      ['Employee', 'Date', 'Att. Status', 'Reason', 'Reg. Status'],
      regularizations.map(r => [r.employee?.user?.name || '', formatDateIST(r.date), r.status, r.regularizationReason || '', r.regularizationStatus || ''])
    );
  }
  function doExportAll() {
    exportCSV(`all-requests-${today}.csv`,
      ['Type', 'Employee', 'Date / Period', 'Details', 'Reason', 'Status'],
      allRows.map(row => {
        if (row.kind === 'leave') return ['Leave', row.data.employeeId?.userId?.name || '', `${formatDateIST(row.data.fromDate)} – ${formatDateIST(row.data.toDate)}`, `${row.data.leaveTypeId.name} (${row.data.totalDays}d)`, row.data.reason, row.data.status];
        if (row.kind === 'wfh') {
          const empObj = row.data.employeeId as { _id: string; userId?: { name: string } };
          const name = row.data.employeeName || (typeof row.data.employeeId === 'object' ? empObj?.userId?.name : '') || '';
          return ['WFH', name, formatDateIST(row.data.date), row.data.mode, row.data.reason, row.data.status];
        }
        return ['Regularization', row.data.employee?.user?.name || '', formatDateIST(row.data.date), row.data.status, row.data.regularizationReason || '', row.data.regularizationStatus || ''];
      })
    );
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: leaves.length + wfhRequests.length + regularizations.length },
    { id: 'leaves', label: 'Leaves', count: leaves.length },
    { id: 'wfh', label: 'WFH', count: wfhRequests.length },
    { id: 'regularizations', label: 'Regularizations', count: regularizations.length },
  ];

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      {!embedded && <h1 className="text-2xl font-bold text-gray-900">Pending Approvals</h1>}

      {/* Tab bar */}
      <div className="card p-1 flex gap-1">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              tab === id
                ? 'bg-primary-600 text-white'
                : 'text-gray-600 hover:bg-gray-100:bg-gray-800'
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  tab === id
                    ? 'bg-white/20 text-white'
                    : 'bg-red-100 text-red-600'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Status filter — keeps approved/rejected history visible */}
      <div className="flex flex-wrap gap-2">
        {([
          { v: 'Pending', l: 'Pending' },
          { v: 'Approved', l: 'Approved' },
          { v: 'Rejected', l: 'Rejected' },
          { v: 'all', l: 'All' },
        ] as const).map((s) => (
          <button
            key={s.v}
            onClick={() => setStatusFilter(s.v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              statusFilter === s.v
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s.l}
          </button>
        ))}
      </div>

      {/* Bulk action + Export toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {(tab === 'all'
            ? selLeaves.size + selWFH.size + selRegs.size > 0
            : tab === 'leaves' ? selLeaves.size > 0
            : tab === 'wfh'    ? selWFH.size > 0
            :                    selRegs.size > 0) && (
            <button
              onClick={tab === 'all' ? bulkApproveAll : () => bulkApprove(tab === 'leaves' ? 'leaves' : tab === 'wfh' ? 'wfh' : 'regs')}
              disabled={bulkSubmitting}
              className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
            >
              {bulkSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Bulk Approve ({
                tab === 'all'   ? selLeaves.size + selWFH.size + selRegs.size
                : tab === 'leaves' ? selLeaves.size
                : tab === 'wfh'    ? selWFH.size
                :                   selRegs.size
              })
            </button>
          )}
        </div>
        <button
          onClick={tab === 'all' ? doExportAll : tab === 'leaves' ? doExportLeaves : tab === 'wfh' ? doExportWFH : doExportRegs}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* All tab */}
      {tab === 'all' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b border-gray-100">
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 cursor-pointer"
                      checked={(selLeaves.size + selWFH.size + selRegs.size) > 0 && (selLeaves.size + selWFH.size + selRegs.size) === (pendingLeaveIds.length + pendingWFHIds.length + pendingRegIds.length)}
                      ref={(el: HTMLInputElement | null) => {
                        if (el) {
                          const sel = selLeaves.size + selWFH.size + selRegs.size;
                          const pend = pendingLeaveIds.length + pendingWFHIds.length + pendingRegIds.length;
                          el.indeterminate = sel > 0 && sel < pend;
                        }
                      }}
                      onChange={toggleAllCombined}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Date / Period</th>
                  <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Details</th>
                  <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Reason</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="skeleton h-4 rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : allRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-gray-400">No requests found</td>
                  </tr>
                ) : (
                  allRows.map(row => {
                    let empName = '—';
                    let dateDisplay = '';
                    let details = '';
                    let reason = '';
                    let statusVal = '';
                    let isPending = false;
                    let isSelected = false;
                    let onToggle = () => {};

                    if (row.kind === 'leave') {
                      empName = row.data.employeeId?.userId?.name || '—';
                      dateDisplay = `${formatDateIST(row.data.fromDate)} – ${formatDateIST(row.data.toDate)}`;
                      details = `${row.data.leaveTypeId.name} (${row.data.totalDays}d)`;
                      reason = row.data.reason;
                      statusVal = row.data.status;
                      isPending = row.data.status === 'Pending';
                      isSelected = selLeaves.has(row.uid);
                      onToggle = () => toggleLeaveSel(row.uid);
                    } else if (row.kind === 'wfh') {
                      const empObj = row.data.employeeId as { _id: string; userId?: { name: string } };
                      empName = row.data.employeeName || (typeof row.data.employeeId === 'object' ? empObj?.userId?.name : '') || '—';
                      dateDisplay = formatDateIST(row.data.date);
                      details = row.data.mode;
                      reason = row.data.reason;
                      statusVal = row.data.status;
                      isPending = row.data.status === 'Pending';
                      isSelected = selWFH.has(row.uid);
                      onToggle = () => toggleWFHSel(row.uid);
                    } else {
                      empName = row.data.employee?.user?.name || '—';
                      dateDisplay = formatDateIST(row.data.date);
                      details = row.data.status;
                      reason = row.data.regularizationReason || '—';
                      statusVal = row.data.regularizationStatus || 'Pending';
                      isPending = row.data.regularizationStatus === 'Pending';
                      isSelected = selRegs.has(row.uid);
                      onToggle = () => toggleRegSel(row.uid);
                    }

                    return (
                      <tr
                        key={`${row.kind}-${row.uid}`}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => {
                          if (row.kind === 'leave') { setReviewLeave(row.data); setComment(''); }
                          else if (row.kind === 'wfh') { setReviewWFH(row.data); setComment(''); }
                          else { setReviewReg(row.data); setComment(''); }
                        }}
                      >
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {isPending && (
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 cursor-pointer"
                              checked={isSelected}
                              onChange={onToggle}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{empName}</td>
                        <td className="px-4 py-3"><TypeBadge kind={row.kind} /></td>
                        <td className="px-4 py-3 text-gray-600 text-xs">{dateDisplay}</td>
                        <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{details}</td>
                        <td className="px-4 py-3 text-gray-500 hidden sm:table-cell max-w-[140px] truncate">{reason}</td>
                        <td className="px-4 py-3"><StatusBadge status={statusVal} /></td>
                        <td className="px-4 py-3 text-right">
                          <button
                            className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
                            onClick={e => {
                              e.stopPropagation();
                              if (row.kind === 'leave') { setReviewLeave(row.data); setComment(''); }
                              else if (row.kind === 'wfh') { setReviewWFH(row.data); setComment(''); }
                              else { setReviewReg(row.data); setComment(''); }
                            }}
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Leaves tab */}
      {tab === 'leaves' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b border-gray-100">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                      checked={selLeaves.size > 0 && selLeaves.size === pendingLeaveIds.length}
                      ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = selLeaves.size > 0 && selLeaves.size < pendingLeaveIds.length; }}
                      onChange={toggleAllLeaves}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Dates</th>
                  <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                    Reason
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : leaves.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      No leave requests
                    </td>
                  </tr>
                ) : (
                  leaves.map((leave) => (
                    <tr
                      key={leave._id}
                      onClick={() => { setReviewLeave(leave); setComment(''); }}
                      className="hover:bg-gray-50:bg-gray-800/40 cursor-pointer"
                    >
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        {leave.status === 'Pending' && (
                          <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                            checked={selLeaves.has(leave._id)}
                            onChange={() => toggleLeaveSel(leave._id)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {leave.employeeId?.userId?.name || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {leave.leaveTypeId.name}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {formatDateIST(leave.fromDate)} –{' '}
                        {formatDateIST(leave.toDate)}
                        <span className="text-xs text-gray-400 ml-1">({leave.totalDays}d)</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell max-w-xs truncate">
                        {leave.reason}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={leave.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setReviewLeave(leave);
                            setComment('');
                          }}
                          className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* WFH tab */}
      {tab === 'wfh' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b border-gray-100">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                      checked={selWFH.size > 0 && selWFH.size === pendingWFHIds.length}
                      ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = selWFH.size > 0 && selWFH.size < pendingWFHIds.length; }}
                      onChange={toggleAllWFH}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Mode</th>
                  <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                    Reason
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : wfhRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                      No WFH requests
                    </td>
                  </tr>
                ) : (
                  wfhRequests.map((req) => {
                    const empObj = req.employeeId as {
                      _id: string;
                      employeeId: string;
                      userId?: { name: string };
                    };
                    const empName =
                      req.employeeName ||
                      (typeof req.employeeId === 'object' ? empObj?.userId?.name : '') ||
                      '—';
                    const empCode =
                      typeof req.employeeId === 'string'
                        ? req.employeeId
                        : empObj?.employeeId || '';
                    return (
                      <tr
                        key={req._id || req.id}
                        onClick={() => { setReviewWFH(req); setComment(''); }}
                        className="hover:bg-gray-50:bg-gray-800/40 cursor-pointer"
                      >
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {req.status === 'Pending' && (
                            <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                              checked={selWFH.has(req._id || req.id || '')}
                              onChange={() => toggleWFHSel(req._id || req.id || '')}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          <div className="font-medium text-gray-900">{empName}</div>
                          {empCode && <div className="text-xs text-gray-400">{empCode}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatDateIST(req.date)}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{req.mode}</td>
                        <td className="px-4 py-3 text-gray-500 hidden sm:table-cell max-w-xs truncate">
                          {req.reason}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={req.status} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewWFH(req);
                              setComment('');
                            }}
                            className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Regularizations tab */}
      {tab === 'regularizations' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b border-gray-100">
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                      checked={selRegs.size > 0 && selRegs.size === pendingRegIds.length}
                      ref={(el: HTMLInputElement | null) => { if (el) el.indeterminate = selRegs.size > 0 && selRegs.size < pendingRegIds.length; }}
                      onChange={toggleAllRegs}
                    />
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3 font-medium text-gray-600">
                    Att. Status
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                    Reason
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="skeleton h-4 rounded" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : regularizations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                      No regularization requests
                    </td>
                  </tr>
                ) : (
                  regularizations.map((log) => {
                    return (
                      <tr
                        key={log._id || log.id}
                        onClick={() => { setReviewReg(log); setComment(''); }}
                        className="hover:bg-gray-50:bg-gray-800/40 cursor-pointer"
                      >
                        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                          {log.regularizationStatus === 'Pending' && (
                            <input type="checkbox" className="rounded border-gray-300 cursor-pointer"
                              checked={selRegs.has((log._id || log.id) ?? '')}
                              onChange={() => toggleRegSel((log._id || log.id) ?? '')}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {log.employee?.user?.name || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatDateIST(log.date)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={log.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-500 hidden sm:table-cell max-w-xs truncate">
                          {log.regularizationReason || '—'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewReg(log);
                              setComment('');
                            }}
                            className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Review Leave Modal */}
      {reviewLeave && (
        <ReviewModal
          title="Review Leave Request"
          details={[
            { label: 'Employee', value: reviewLeave.employeeId?.userId?.name || '—' },
            { label: 'Type', value: reviewLeave.leaveTypeId.name },
            { label: 'From', value: formatDateIST(reviewLeave.fromDate) },
            { label: 'To', value: formatDateIST(reviewLeave.toDate) },
            { label: 'Days', value: String(reviewLeave.totalDays) },
            { label: 'Reason', value: reviewLeave.reason || '—' },
          ]}
          comment={comment}
          onCommentChange={setComment}
          onClose={() => setReviewLeave(null)}
          onApprove={() => handleLeaveReview('Approved')}
          onReject={() => handleLeaveReview('Rejected')}
          submitting={submitting}
        />
      )}

      {/* Review WFH Modal */}
      {reviewWFH && (
        <ReviewModal
          title="Review WFH Request"
          details={[
            {
              label: 'Employee',
              value:
                reviewWFH.employeeName ||
                (typeof reviewWFH.employeeId === 'object'
                  ? reviewWFH.employeeId.userId?.name
                  : '') ||
                '—',
            },
            {
              label: 'Emp ID',
              value:
                typeof reviewWFH.employeeId === 'string'
                  ? reviewWFH.employeeId
                  : reviewWFH.employeeId?.employeeId || '—',
            },
            { label: 'Date', value: formatDateIST(reviewWFH.date) },
            { label: 'Mode', value: reviewWFH.mode },
            { label: 'Reason', value: reviewWFH.reason },
          ]}
          comment={comment}
          onCommentChange={setComment}
          onClose={() => setReviewWFH(null)}
          onApprove={() => handleWFHReview('Approved')}
          onReject={() => handleWFHReview('Rejected')}
          submitting={submitting}
        />
      )}

      {/* Review Regularization Modal */}
      {reviewReg && (
        <ReviewModal
          title="Review Regularization"
          details={[
            { label: 'Employee', value: reviewReg.employee?.user?.name || '—' },
            { label: 'Date', value: formatDateIST(reviewReg.date) },
            { label: 'Status', value: reviewReg.status },
            { label: 'Reason', value: reviewReg.regularizationReason || '—' },
          ]}
          comment={comment}
          onCommentChange={setComment}
          onClose={() => setReviewReg(null)}
          onApprove={() => handleRegReview('Approved')}
          onReject={() => handleRegReview('Rejected')}
          submitting={submitting}
        />
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  return <ApprovalsHub />;
}
