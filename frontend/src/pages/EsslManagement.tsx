import { useState, useEffect, useCallback } from 'react';
import {
  Users, Monitor, Building2, RefreshCw, Plus, Trash2,
  Search, Loader2, ChevronDown, Shield, UserPlus, Upload,
  Server, Activity, X, AlertCircle, CheckCircle2,
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import DeviceOffBanner from '../components/DeviceOffBanner';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EsslEmployee {
  empCode: string;
  name: string;
  department: string;
  designation: string;
  category: string;
  status: string;
  joiningDate: string;
  cardNo: string;
  deviceGroup: string;
}

interface EsslDevice {
  serialNumber: string;
  name: string;
  ip: string;
  lastActivity: string;
  status: string;
  type: string;
  totalUsers: string;
  totalFP: string;
  totalFace: string;
}

interface EsslDepartment {
  id: string;
  name: string;
}

type Tab = 'employees' | 'devices' | 'departments';

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EsslManagement() {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<EsslEmployee[]>([]);
  const [devices, setDevices] = useState<EsslDevice[]>([]);
  const [departments, setDepartments] = useState<EsslDepartment[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('All');
  const [deleteTarget, setDeleteTarget] = useState<EsslEmployee | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch data ──────────────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/essl/machine/employees');
      if (data.ok) {
        setEmployees(data.employees || []);
      } else {
        toast.error(data.message || 'Failed to fetch employees');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to connect to ESSL machine');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/essl/machine/devices');
      if (data.ok) {
        setDevices(data.devices || []);
      } else {
        toast.error(data.message || 'Failed to fetch devices');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/essl/machine/departments');
      if (data.ok) {
        setDepartments(data.departments || []);
      } else {
        toast.error(data.message || 'Failed to fetch departments');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'employees') fetchEmployees();
    else if (tab === 'devices') fetchDevices();
    else if (tab === 'departments') fetchDepartments();
  }, [tab, fetchEmployees, fetchDevices, fetchDepartments]);

  const refresh = () => {
    if (tab === 'employees') fetchEmployees();
    else if (tab === 'devices') fetchDevices();
    else fetchDepartments();
  };

  // ── Add Employee ────────────────────────────────────────────────────────
  const handleAddEmployee = async (empData: { empCode: string; firstName: string; lastName: string; department: string; cardNo: string }) => {
    try {
      const { data } = await api.post('/essl/machine/employees', empData);
      if (data.ok) {
        toast.success(data.message || 'Employee added');
        setShowAddModal(false);
        fetchEmployees();
      } else {
        toast.error(data.message || 'Failed to add employee');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to add employee');
    }
  };

  // ── Delete Employee ─────────────────────────────────────────────────────
  const handleDeleteEmployee = async (empCode: string) => {
    setDeleting(true);
    try {
      const { data } = await api.delete(`/essl/machine/employees/${empCode}`);
      if (data.ok) {
        toast.success(data.message || 'Employee deleted');
        setDeleteTarget(null);
        fetchEmployees();
      } else {
        toast.error(data.message || 'Failed to delete');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  // ── Upload User to Device ──────────────────────────────────────────────
  const handleUploadToDevice = async (empCode: string) => {
    try {
      const { data } = await api.post(`/essl/machine/employees/${empCode}/upload`);
      if (data.ok) {
        toast.success(data.message || 'Upload request sent');
      } else {
        toast.error(data.message || 'Upload failed');
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Upload failed');
    }
  };

  // ── Filter employees ───────────────────────────────────────────────────
  const filteredEmployees = employees.filter(emp => {
    const matchSearch = !search || 
      emp.empCode.toLowerCase().includes(search.toLowerCase()) ||
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      emp.department.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'All' || emp.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statuses = ['All', ...new Set(employees.map(e => e.status).filter(Boolean))];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <DeviceOffBanner />
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Shield className="w-7 h-7 text-indigo-600" />
            ESSL Machine Control
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Direct control of employees, devices & settings on the biometric machine
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {tab === 'employees' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
            >
              <UserPlus className="w-4 h-4" />
              Add Employee
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {([
          { key: 'employees' as Tab, label: 'Employees', icon: Users, count: employees.length },
          { key: 'devices' as Tab, label: 'Devices', icon: Monitor, count: devices.length },
          { key: 'departments' as Tab, label: 'Departments', icon: Building2, count: departments.length },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === t.key
                ? 'bg-white text-indigo-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900:text-white'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                tab === t.key
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-200 text-gray-600'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search + Filters (employees tab) */}
      {tab === 'employees' && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by code, name, or department..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="relative">
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="appearance-none px-4 py-2.5 pr-8 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700"
            >
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
          <span className="ml-3 text-gray-500">Fetching from ESSL machine...</span>
        </div>
      )}

      {/* Employees Table */}
      {tab === 'employees' && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Emp Code</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Department</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Designation</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden xl:table-cell">Card No</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                      {employees.length === 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          <AlertCircle className="w-8 h-8 text-gray-400" />
                          <p>No employees found on ESSL machine</p>
                          <p className="text-xs text-gray-400">Try refreshing or check device connection</p>
                        </div>
                      ) : (
                        'No employees match your search'
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map((emp, idx) => (
                    <tr key={`${emp.empCode}-${idx}`} className="hover:bg-gray-50:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-indigo-600">
                          {emp.empCode}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">{emp.name}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm text-gray-600">{emp.department}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-gray-600">{emp.designation}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                          emp.status === 'Working' || emp.status === 'Active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {emp.status || 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="text-sm text-gray-500 font-mono">{emp.cardNo || '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleUploadToDevice(emp.empCode)}
                            title="Upload to device"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50:bg-blue-900/20 rounded-lg transition-colors"
                          >
                            <Upload className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(emp)}
                            title="Delete from ESSL"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50:bg-red-900/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredEmployees.length > 0 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
              Showing {filteredEmployees.length} of {employees.length} employees on ESSL machine
            </div>
          )}
        </div>
      )}

      {/* Devices Table */}
      {tab === 'devices' && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Serial Number</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">IP Address</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Users</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden xl:table-cell">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {devices.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <Server className="w-8 h-8 text-gray-400" />
                        <p>No devices found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  devices.map(dev => (
                    <tr key={dev.serialNumber} className="hover:bg-gray-50:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-semibold text-gray-900">{dev.serialNumber}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-900">{dev.name}</span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm font-mono text-gray-600">{dev.ip}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="flex items-center gap-1.5">
                          <Activity className={`w-3 h-3 ${dev.status === 'Online' ? 'text-green-500' : 'text-gray-400'}`} />
                          <span className="text-sm text-gray-700">{dev.status || 'Unknown'}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-gray-600">{dev.type}</span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-gray-600">{dev.totalUsers || '—'}</span>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <span className="text-sm text-gray-500">{dev.lastActivity || '—'}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {devices.length > 0 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
              {devices.length} device(s) connected to ESSL server
            </div>
          )}
        </div>
      )}

      {/* Departments Table */}
      {tab === 'departments' && !loading && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Department Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {departments.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center gap-2">
                        <Building2 className="w-8 h-8 text-gray-400" />
                        <p>No departments found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  departments.map((dept, i) => (
                    <tr key={i} className="hover:bg-gray-50:bg-gray-700/50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-gray-600">{dept.id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-gray-900">{dept.name}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {departments.length > 0 && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
              {departments.length} department(s) on ESSL machine
            </div>
          )}
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddModal && (
        <AddEmployeeModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddEmployee}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <DeleteEmployeeModal
          employee={deleteTarget}
          loading={deleting}
          onCancel={() => !deleting && setDeleteTarget(null)}
          onConfirm={() => handleDeleteEmployee(deleteTarget.empCode)}
        />
      )}
    </div>
  );
}

// ─── Add Employee Modal ───────────────────────────────────────────────────────
function AddEmployeeModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (data: { empCode: string; firstName: string; lastName: string; department: string; cardNo: string }) => void;
}) {
  const [empCode, setEmpCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState('');
  const [cardNo, setCardNo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!empCode.trim() || !firstName.trim()) {
      toast.error('Employee code and first name are required');
      return;
    }
    setSubmitting(true);
    await onAdd({ empCode: empCode.trim(), firstName: firstName.trim(), lastName: lastName.trim(), department: department.trim(), cardNo: cardNo.trim() });
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-indigo-600" />
            Add Employee to ESSL
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Employee Code *</label>
            <input
              type="text"
              value={empCode}
              onChange={e => setEmpCode(e.target.value)}
              placeholder="e.g. FCS099"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
              <input
                type="text"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="First name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
              <input
                type="text"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Last name"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              placeholder="e.g. Engineering"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Card Number</label>
            <input
              type="text"
              value={cardNo}
              onChange={e => setCardNo(e.target.value)}
              placeholder="RFID card number"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200:bg-gray-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add to ESSL
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Employee Confirmation Modal ───────────────────────────────────────
function DeleteEmployeeModal({
  employee,
  loading,
  onCancel,
  onConfirm,
}: {
  employee: EsslEmployee;
  loading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
      if (e.key === 'Enter' && !loading) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loading, onCancel, onConfirm]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            Delete Employee
          </h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="p-1 hover:bg-gray-100:bg-gray-700 rounded-lg disabled:opacity-50"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
              <Trash2 className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-700">
                Are you sure you want to delete this employee from the ESSL machine?
              </p>
              <p className="text-xs text-gray-500 mt-1">
                This will remove the local record and attempt to remove the user from the biometric device. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Emp Code</span>
              <span className="font-mono font-semibold text-indigo-600">{employee.empCode}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{employee.name}</span>
            </div>
            {employee.department && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Department</span>
                <span className="text-gray-700">{employee.department}</span>
              </div>
            )}
            {employee.cardNo && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Card No</span>
                <span className="font-mono text-gray-700">{employee.cardNo}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-100:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            {loading ? 'Deleting…' : 'Delete Employee'}
          </button>
        </div>
      </div>
    </div>
  );
}
