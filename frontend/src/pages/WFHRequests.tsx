import { useState, useEffect, useCallback } from 'react';
import { Plus, Home, Briefcase, MapPin, CheckCircle, XCircle, Loader2, X } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import type { WFHRequest } from '../types';
import { formatDateIST } from '../lib/datetime';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Pending: 'badge-yellow',
    Approved: 'badge-green',
    Rejected: 'badge-red',
  };
  return <span className={map[status] || 'badge-gray'}>{status}</span>;
}

const MODE_OPTIONS = [
  { value: 'WFH', label: 'Work from Home', icon: Home },
  { value: 'Field', label: 'Field Work', icon: MapPin },
  { value: 'ClientVisit', label: 'Client Visit', icon: Briefcase },
];

export default function WFHRequestsPage() {
  const { user } = useAuth();
  const isAdminOrHR = user?.role === 'Admin' || user?.role === 'HR';
  const [requests, setRequests] = useState<WFHRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: '', mode: 'WFH', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [reviewModal, setReviewModal] = useState<WFHRequest | null>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<WFHRequest[]>('/attendance/wfh-requests', {
        params: statusFilter ? { status: statusFilter } : {},
      });
      setRequests(res.data);
    } catch {
      toast.error('Failed to load WFH requests');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post('/attendance/wfh-request', form);
      toast.success('WFH request submitted');
      setShowModal(false);
      setForm({ date: '', mode: 'WFH', reason: '' });
      fetchRequests();
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed to submit'
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReview(status: 'Approved' | 'Rejected') {
    if (!reviewModal) return;
    setReviewing(true);
    try {
      await api.put(`/attendance/wfh-requests/${reviewModal._id}/review`, {
        status,
        reviewComment,
      });
      toast.success(`Request ${status}`);
      setReviewModal(null);
      setReviewComment('');
      fetchRequests();
    } catch (err: unknown) {
      toast.error(
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Review failed'
      );
    } finally {
      setReviewing(false);
    }
  }

  const today = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (
    <div className="space-y-5 pb-20 lg:pb-0">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">WFH / Work Arrangements</h1>
        {!isAdminOrHR && (
          <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Apply
          </button>
        )}
      </div>

      {/* Status filter */}
      <div className="card p-3 flex gap-2 flex-wrap">
        {['', 'Pending', 'Approved', 'Rejected'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200:bg-gray-700'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Requests table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left border-b border-gray-100">
                {isAdminOrHR && (
                  <th className="px-4 py-3 font-medium text-gray-600">Employee</th>
                )}
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">Mode</th>
                <th className="px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">
                  Reason
                </th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                {isAdminOrHR && (
                  <th className="px-4 py-3 font-medium text-gray-600 text-right">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: isAdminOrHR ? 6 : 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="skeleton h-4 rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : requests.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdminOrHR ? 6 : 4}
                    className="px-4 py-10 text-center text-gray-400"
                  >
                    No WFH requests found
                  </td>
                </tr>
              ) : (
                requests.map((req) => {
                  const emp = req.employeeId as {
                    _id: string;
                    employeeId: string;
                    userId?: { name: string; email: string };
                  };
                  return (
                    <tr key={req._id} className="hover:bg-gray-50:bg-gray-800/40">
                      {isAdminOrHR && (
                        <td className="px-4 py-3 text-gray-700">
                          {emp?.userId?.name || emp?.employeeId || '—'}
                        </td>
                      )}
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
                      {isAdminOrHR && (
                        <td className="px-4 py-3 text-right">
                          {req.status === 'Pending' && (
                            <button
                              onClick={() => {
                                setReviewModal(req);
                                setReviewComment('');
                              }}
                              className="text-xs bg-primary-50 text-primary-700 px-2 py-1 rounded hover:bg-primary-100 transition-colors"
                            >
                              Review
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Apply Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
          <div className="card w-full max-w-md p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg text-gray-900">
                Apply for Work Arrangement
              </h2>
              <button onClick={() => setShowModal(false)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  className="input"
                  value={form.date}
                  min={today}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Work Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, mode: value }))}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 text-xs font-medium transition-all ${
                        form.mode === value
                          ? 'border-primary-500 bg-primary-50 text-primary-700'
                          : 'border-gray-200 text-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason
                </label>
                <textarea
                  className="input min-h-[80px] resize-none"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Reason for working remotely..."
                  required
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary flex-1 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Submit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 animate-fade-in">
          <div className="card w-full max-w-md p-6 animate-slide-in">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-gray-900">
                Review WFH Request
              </h2>
              <button onClick={() => setReviewModal(null)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
              <div className="flex gap-2">
                <span className="text-gray-500 w-14 shrink-0">Date:</span>
                <span className="text-gray-700">
                  {formatDateIST(reviewModal.date)}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-14 shrink-0">Mode:</span>
                <span className="text-gray-700">{reviewModal.mode}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-gray-500 w-14 shrink-0">Reason:</span>
                <span className="text-gray-700">{reviewModal.reason}</span>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Comment (optional)
              </label>
              <input
                type="text"
                className="input"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Add a comment..."
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleReview('Rejected')}
                disabled={reviewing}
                className="btn-danger flex-1 flex items-center justify-center gap-2"
              >
                {reviewing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                Reject
              </button>
              <button
                onClick={() => handleReview('Approved')}
                disabled={reviewing}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {reviewing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
