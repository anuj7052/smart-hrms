import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import toast from 'react-hot-toast';
import type { Employee, PaginatedResponse, Shift } from '../types';

interface EmployeeFormData {
  name: string; email: string; password: string; employeeId: string;
  department: string; designation: string; joinDate: string; shift: string;
  shiftId: string; phone: string; role: string; birthday: string;
  isActive: boolean; lastWorkingDate: string;
}

const defaultForm: EmployeeFormData = {
  name: '', email: '', password: '', employeeId: '',
  department: '', designation: '', joinDate: '', shift: 'General',
  shiftId: '', phone: '', role: 'Employee', birthday: '',
  isActive: true, lastWorkingDate: '',
};

import { useEffect as useEffectModal } from 'react';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffectModal(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl rounded-3xl border border-gray-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.22)] animate-slide-in max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[20px]">person</span>
            </div>
            <h2 className="text-lg font-black text-gray-900 tracking-tight">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  );
}

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm bg-white border border-primary/10 rounded-card shadow-soft-high p-6 animate-slide-in">
        <div className="w-12 h-12 rounded-xl bg-error-container flex items-center justify-center text-error mb-4">
          <span className="material-symbols-outlined fill">warning</span>
        </div>
        <p className="text-body-md text-on-surface mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-outline-variant text-on-surface text-label-md hover:bg-surface-container-low transition-colors">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-error text-white text-label-md hover:bg-error/90 transition-colors">Confirm</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full h-11 px-4 rounded-2xl border border-gray-200 bg-gray-50/50 text-sm font-medium text-gray-900 focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/10 focus:bg-white transition-all disabled:bg-gray-100 disabled:text-gray-400 placeholder:text-gray-400';
const labelCls = 'block text-[11px] font-black uppercase tracking-wider text-gray-500 mb-1.5';

export default function EmployeesPage() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [deptFilter, setDeptFilter] = useState('');
  const departments = ['Data and AI Team', 'Sales', 'Finance', 'Technical Support', 'Security', 'Management'];
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editEmployee, setEditEmployee] = useState<Employee | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeFormData>(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSetupOnly, setPendingSetupOnly] = useState(false);

  useEffect(() => {
    api.get<Shift[]>('/settings/shifts').then((r) => setShifts(r.data)).catch(() => {});
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PaginatedResponse<Employee>>('/employees', {
        params: { page: 1, limit: 1000, search, status: statusFilter, ...(deptFilter && { department: deptFilter }) },
      });
      setEmployees(res.data.data);
      setTotal(res.data.total);
    } catch {
      toast.error('Failed to load employees');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, deptFilter]);

  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  function openAdd() { setForm(defaultForm); setEditEmployee(null); setShowModal(true); }
  function openEdit(emp: Employee) {
    setEditEmployee(emp);
    setForm({
      name: emp.userId.name, email: emp.userId.email, password: '',
      employeeId: emp.employeeId, department: emp.department,
      designation: emp.designation, joinDate: emp.joinDate.split('T')[0],
      shift: emp.shift, shiftId: (emp.shiftId as Shift | null)?._id || '',
      phone: emp.phone || '', role: emp.userId.role,
      birthday: emp.birthday ? emp.birthday.split('T')[0] : '',
      isActive: emp.isActive,
      lastWorkingDate: emp.lastWorkingDate ? emp.lastWorkingDate.split('T')[0] : '',
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        ...form,
        shiftId: form.shiftId || null,
        ...(editEmployee && { isActive: form.isActive }),
        ...(editEmployee && { lastWorkingDate: form.lastWorkingDate || null }),
      };
      if (editEmployee) {
        await api.put(`/employees/${editEmployee._id}`, payload);
        toast.success('Employee updated');
      } else {
        await api.post('/employees', payload);
        toast.success('Employee added');
      }
      setShowModal(false);
      fetchEmployees();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/employees/${deleteTarget._id}`);
      toast.success('Employee permanently deleted');
      setDeleteTarget(null);
      fetchEmployees();
    } catch {
      toast.error('Delete failed');
    }
  }

  const placeholderCount = employees.filter((e) => e.userId.name.startsWith('Employee ') && e.userId.email.endsWith('@device.local')).length;

  const isPlaceholder = (emp: Employee) =>
    emp.userId.name.startsWith('Employee ') && emp.userId.email.endsWith('@device.local');

  const displayedEmployees = pendingSetupOnly ? employees.filter(isPlaceholder) : employees;

  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h2 className="page-title">Employee Directory</h2>
          <p className="text-body-md text-on-surface-variant mt-1.5">
            {total} {statusFilter === 'all' ? 'total' : statusFilter} employee{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="group relative px-4 py-2 bg-cta-primary hover:bg-cta-primary-hover text-white rounded-xl text-label-md transition-all flex items-center gap-2 shadow-glow-primary hover:shadow-glow-primary-lg active:scale-[0.985] overflow-hidden"
        >
          <span className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/15 to-transparent opacity-60 pointer-events-none" />
          <span className="material-symbols-outlined text-[18px] relative">add</span>
          <span className="relative tracking-wide">Add Employee</span>
        </button>
      </div>

      {/* Placeholder warning */}
      {placeholderCount > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 text-[20px] mt-0.5">warning</span>
          <p className="text-body-sm text-amber-800 flex-1">
            <strong>{placeholderCount}</strong> employee{placeholderCount > 1 ? 's were' : ' was'} auto-created from the biometric device with placeholder names. Click the <strong>edit</strong> icon to update their name, department, and designation.
          </p>
          <button
            onClick={() => setPendingSetupOnly(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-200 text-amber-800 hover:bg-amber-300 transition-colors"
          >
            View {placeholderCount}
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-white border border-primary/10 rounded-card shadow-soft-low p-4 mb-6 flex flex-wrap items-center gap-3">
          {pendingSetupOnly && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-100 border border-amber-300 text-amber-800 rounded-lg text-xs font-bold shrink-0">
              <span className="material-symbols-outlined text-[15px]">warning</span>
              Setup Required only
              <button onClick={() => setPendingSetupOnly(false)} className="ml-1 hover:text-amber-900">
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          )}

          <div className="relative flex-1 min-w-[220px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">search</span>
          <input
            type="text"
            placeholder="Search by name, email or ID…"
            className="w-full pl-10 pr-9 h-10 bg-surface-container-lowest border border-outline-variant/60 rounded-lg text-body-md text-on-surface placeholder:text-outline-variant focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition-all"
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface p-1">
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        <div className="flex rounded-lg border border-outline-variant/60 overflow-hidden shrink-0 bg-surface-container-lowest">
          {(['all', 'active', 'inactive'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); }}
              className={`px-3 py-2 text-label-md capitalize transition-colors ${
                statusFilter === s ? 'bg-primary text-white' : 'text-on-surface-variant hover:bg-primary/5'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          className="h-10 px-3 rounded-lg border border-outline-variant/60 bg-surface-container-lowest text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          value={deptFilter}
          onChange={(e) => { setDeptFilter(e.target.value); }}
        >
          <option value="">All Departments</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Table card */}
      <div className="bg-white border border-primary/10 rounded-card shadow-soft-low overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-primary/10 bg-surface-container-low/50">
                <th className="px-6 py-3 text-label-md text-on-surface-variant uppercase tracking-wider">Employee</th>
                <th className="px-6 py-3 text-label-md text-on-surface-variant uppercase tracking-wider">Department</th>
                <th className="px-6 py-3 text-label-md text-on-surface-variant uppercase tracking-wider">Manager</th>
                <th className="px-6 py-3 text-label-md text-on-surface-variant uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-label-md text-on-surface-variant uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/5">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-6 py-4"><div className="skeleton h-4 rounded w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[32px] block mb-2 text-outline-variant">person_search</span>
                  No employees found
                </td></tr>
              ) : (
                displayedEmployees.map((emp) => (
                  <tr
                    key={emp._id}
                    className={`transition-colors cursor-pointer group ${
                      isPlaceholder(emp)
                        ? 'bg-amber-50 hover:bg-amber-100'
                        : 'hover:bg-primary/5'
                    }`}
                    onClick={() => navigate(`/employees/${emp._id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${
                          isPlaceholder(emp) ? 'bg-amber-100 text-amber-600' : 'bg-primary/10 text-primary'
                        }`}>
                          {emp.userId.name[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-body-md text-on-surface font-bold truncate">{emp.userId.name}</p>
                            {isPlaceholder(emp) && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-200 text-amber-800">
                                <span className="material-symbols-outlined text-[11px]">warning</span>
                                Setup Required
                              </span>
                            )}
                          </div>
                          <p className="text-body-sm text-outline truncate">
                            {emp.userId.email.endsWith('@device.local') ? `ID: ${emp.employeeId}` : emp.userId.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">
                      {emp.department === 'To Be Updated'
                        ? <span className="text-warning italic text-body-sm">—</span>
                        : emp.department}
                    </td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">
                      {emp.managerName
                        ? emp.managerName
                        : <span className="text-outline italic text-body-sm">—</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-label-md ${
                          emp.userId.role === 'Admin'
                            ? 'bg-secondary-container/15 text-secondary-container border border-secondary-container/30'
                            : emp.userId.role === 'HR'
                            ? 'bg-primary/10 text-primary border border-primary/30'
                            : 'bg-tertiary-container/15 text-tertiary border border-tertiary-container/30'
                        }`}
                      >
                        {emp.userId.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(emp); }}
                          className="p-2 rounded-lg text-on-surface-variant hover:bg-primary/10 hover:text-primary transition-colors"
                          aria-label="Edit"
                        >
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(emp); }}
                          className="p-2 rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error transition-colors"
                          aria-label="Deactivate"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer total */}
        {total > 0 && (
          <div className="px-6 py-4 border-t border-primary/10 flex items-center justify-between">
            <p className="text-body-sm text-outline">
              Showing all {total} employee{total === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <Modal title={editEmployee ? 'Edit Employee' : 'Add Employee'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Full Name</label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Email</label>
                <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
              </div>
              {!editEmployee && (
                <div className="col-span-2">
                  <label className={labelCls}>Password</label>
                  <input type="password" className={inputCls} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
                </div>
              )}
              <div>
                <label className={labelCls}>Employee ID</label>
                <input className={inputCls} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} required />
              </div>
              <div>
                <label className={labelCls}>Role</label>
                <select className={inputCls} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                  <option>Employee</option><option>HR</option><option>Admin</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Department</label>
                <select className={inputCls} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} required>
                  <option value="">Select Department</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Designation</label>
                <input className={inputCls} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} required />
              </div>
              <div>
                <label className={labelCls}>Join Date</label>
                <input type="date" className={inputCls} value={form.joinDate} onChange={(e) => setForm((f) => ({ ...f, joinDate: e.target.value }))} required />
              </div>
              <div>
                <label className={labelCls}>Shift</label>
                <select
                  className={inputCls}
                  value={form.shiftId || ''}
                  onChange={(e) => {
                    const selected = shifts.find((s) => s._id === e.target.value);
                    setForm((f) => ({ ...f, shiftId: e.target.value, shift: selected?.name || 'General' }));
                  }}
                >
                  <option value="">General (default)</option>
                  {shifts.filter((s) => s.isActive).map((s) => (
                    <option key={s._id} value={s._id}>{s.name} ({s.startTime}–{s.endTime})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Phone (optional)</label>
                <input type="tel" className={inputCls} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Birthday (optional)</label>
                <input type="date" className={inputCls} value={form.birthday} onChange={(e) => setForm((f) => ({ ...f, birthday: e.target.value }))} />
              </div>
              {editEmployee && (
                <div className="col-span-2 border-t border-gray-100 pt-4">
                  <label className={labelCls}>Account Status</label>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, isActive: true, lastWorkingDate: '' }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
                        form.isActive
                          ? 'bg-green-600 text-white border-green-600'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      ✓ Active
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, isActive: false }))}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold border transition-colors ${
                        !form.isActive
                          ? 'bg-red-500 text-white border-red-500'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      ✕ Inactive
                    </button>
                  </div>
                  {!form.isActive && (
                    <div className="mt-3">
                      <label className={labelCls}>Last Working Date</label>
                      <input
                        type="date"
                        className={inputCls}
                        value={form.lastWorkingDate}
                        onChange={(e) => setForm(f => ({ ...f, lastWorkingDate: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 justify-end pt-4 border-t border-gray-100 mt-2">
              <button type="button" onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-2xl border border-gray-200 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-primary-600 text-white text-sm font-black shadow-[0_10px_24px_rgba(2,76,128,0.22)] hover:-translate-y-0.5 hover:bg-primary-700 transition-all disabled:opacity-60 disabled:translate-y-0">
                {submitting && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {editEmployee ? 'Save Changes' : 'Add Employee'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          message={`Permanently delete ${deleteTarget.userId.name}? This will remove all their attendance records, leaves, and account data. This action cannot be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
