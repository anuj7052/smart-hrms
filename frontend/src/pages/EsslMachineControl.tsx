import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import DeviceOffBanner from '../components/DeviceOffBanner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EsslEmployee {
  empCode: string;
  name: string;
  department: string;
  designation: string;
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

interface PortalPages {
  main: string;
  employees: string;
  devices: string;
  departments: string;
  attendance: string;
  deviceLogs: string;
  deviceCommands: string;
  uploadUsers: string;
  deleteUsers: string;
  shifts: string;
  leaveTypes: string;
  settings: string;
  reports: string;
  companies: string;
  categories: string;
  holidays: string;
}

type TabId = 'overview' | 'employees' | 'devices' | 'portal' | 'punches';

// ── Component ─────────────────────────────────────────────────────────────────

export default function EsslMachineControl() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [employees, setEmployees] = useState<EsslEmployee[]>([]);
  const [devices, setDevices] = useState<EsslDevice[]>([]);
  const [portalPages, setPortalPages] = useState<PortalPages | null>(null);
  const [portalBaseUrl, setPortalBaseUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [portalPage, setPortalPage] = useState<keyof PortalPages>('main');

  // Add employee form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ empCode: '', firstName: '', lastName: '', department: '', cardNo: '' });
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState('');

  // Edit employee form
  const [editingEmployee, setEditingEmployee] = useState<EsslEmployee | null>(null);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', department: '', cardNo: '' });
  const [editLoading, setEditLoading] = useState(false);
  const [editMessage, setEditMessage] = useState('');

  // Historical sync
  const [syncFromDate, setSyncFromDate] = useState(() => {
    const d = new Date(); d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [syncToDate, setSyncToDate] = useState(() => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncSuccess, setSyncSuccess] = useState(false);

  // Reprocess (no device fetch — works on existing rawPunchLog data)
  const [reprocessLoading, setReprocessLoading] = useState(false);
  const [reprocessMessage, setReprocessMessage] = useState('');  
  const [reprocessSuccess, setReprocessSuccess] = useState(false);

  // Punch viewer
  const [punchFromDate, setPunchFromDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });
  const [punchToDate, setPunchToDate] = useState(() => new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [punches, setPunches] = useState<any[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [punchMessage, setPunchMessage] = useState('');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchPortalPages = useCallback(async () => {
    try {
      const res = await api.get<{ ok: boolean; pages: PortalPages; baseUrl: string }>('/essl/portal-pages');
      if (res.data.ok) {
        setPortalPages(res.data.pages);
        setPortalBaseUrl(res.data.baseUrl);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ ok: boolean; employees: EsslEmployee[]; message: string }>('/essl/machine/employees');
      if (res.data.ok) {
        setEmployees(res.data.employees);
      } else {
        setError(res.data.message);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    }
    setLoading(false);
  }, []);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ ok: boolean; devices: EsslDevice[]; message: string }>('/essl/machine/devices');
      if (res.data.ok) {
        setDevices(res.data.devices);
      } else {
        setError(res.data.message);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || e.message);
    }
    setLoading(false);
  }, []);

  const fetchPunches = useCallback(async () => {
    setPunchLoading(true);
    setPunchMessage('');
    try {
      // Get deviceId from local devices
      const devRes = await api.get<any[]>('/essl/live-devices');
      const deviceId = devRes.data?.[0]?.id;
      if (!deviceId) { setPunchMessage('No device configured'); setPunchLoading(false); return; }

      const res = await api.get<{ ok: boolean; punches: any[]; message?: string; count: number }>(
        `/essl/db-punches?deviceId=${deviceId}&fromDate=${punchFromDate}&toDate=${punchToDate}`
      );
      if (res.data.ok) {
        setPunches(res.data.punches);
        setPunchMessage(`Found ${res.data.count} punch record(s)`);
      } else {
        setPunchMessage(res.data.message || 'No data');
      }
    } catch (e: any) {
      setPunchMessage(e.response?.data?.error || e.message);
    }
    setPunchLoading(false);
  }, [punchFromDate, punchToDate]);

  useEffect(() => {
    fetchPortalPages();
  }, [fetchPortalPages]);

  useEffect(() => {
    if (activeTab === 'employees') fetchEmployees();
    else if (activeTab === 'devices') fetchDevices();
    else if (activeTab === 'punches') fetchPunches();
  }, [activeTab, fetchEmployees, fetchDevices, fetchPunches]);

  // ── Add employee ──────────────────────────────────────────────────────────

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.empCode || !addForm.firstName) return;
    setAddLoading(true);
    setAddMessage('');
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/essl/machine/employees', addForm);
      setAddMessage(res.data.message);
      if (res.data.ok) {
        setAddForm({ empCode: '', firstName: '', lastName: '', department: '', cardNo: '' });
        setShowAddForm(false);
        fetchEmployees();
      }
    } catch (e: any) {
      setAddMessage(e.response?.data?.message || 'Failed to add employee');
    }
    setAddLoading(false);
  };

  // ── Delete employee ──────────────────────────────────────────────────────

  const handleDelete = async (empCode: string) => {
    if (!confirm(`Delete employee ${empCode} from ESSL machine?`)) return;
    try {
      const res = await api.delete<{ ok: boolean; message: string }>(`/essl/machine/employees/${empCode}`);
      if (res.data.ok) fetchEmployees();
      alert(res.data.message);
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed to delete');
    }
  };

  // ── Edit employee ───────────────────────────────────────────────────────

  const handleStartEdit = (emp: EsslEmployee) => {
    const nameParts = emp.name.split(' ');
    setEditForm({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      department: emp.department || '',
      cardNo: emp.cardNo || '',
    });
    setEditingEmployee(emp);
    setEditMessage('');
  };

  const handleEditEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEmployee || !editForm.firstName) return;
    setEditLoading(true);
    setEditMessage('');
    try {
      const res = await api.put<{ ok: boolean; message: string }>(`/essl/machine/employees/${editingEmployee.empCode}`, editForm);
      setEditMessage(res.data.message);
      if (res.data.ok) {
        setEditingEmployee(null);
        fetchEmployees();
      }
    } catch (e: any) {
      setEditMessage(e.response?.data?.message || 'Failed to update employee');
    }
    setEditLoading(false);
  };

  // ── Upload to device ──────────────────────────────────────────────────────

  const handleUpload = async (empCode: string) => {
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/essl/machine/employees/${empCode}/upload`);
      alert(res.data.message);
    } catch (e: any) {
      alert(e.response?.data?.message || 'Failed');
    }
  };

  // ── Historical sync to database ────────────────────────────────────────────

  const handleHistoricalSync = async () => {
    if (!confirm(`This will fetch all punch data from ${syncFromDate} to ${syncToDate} from the ESSL device and store it in the database. This may take several minutes. Continue?`)) return;
    setSyncLoading(true);
    setSyncMessage('');
    setSyncSuccess(false);
    try {
      const res = await api.post<{ ok: boolean; message: string; totalLogsImported?: number }>('/essl/historical-sync', {
        fromDate: syncFromDate,
        toDate: syncToDate,
      });
      setSyncMessage(res.data.message);
      setSyncSuccess(res.data.ok);
    } catch (e: any) {
      setSyncMessage(e.response?.data?.message || 'Failed to sync historical data');
      setSyncSuccess(false);
    }
    setSyncLoading(false);
  };

  // ── Reprocess existing raw punch data into attendance logs ─────────────────
  // Use this when punches are already in the database but attendance records
  // (check-in / check-out) are missing or outdated for a given month.

  const handleReprocessMonth = async (fromDate: string) => {
    if (!confirm(`This will reprocess all stored punch data from ${fromDate} onwards into attendance records (check-in / check-out times). No device fetch needed. Continue?`)) return;
    setReprocessLoading(true);
    setReprocessMessage('');
    setReprocessSuccess(false);
    try {
      const res = await api.post<{ success: boolean; message: string }>('/attendance/reprocess-month', { fromDate });
      setReprocessMessage(res.data.message);
      setReprocessSuccess(res.data.success);
    } catch (e: any) {
      setReprocessMessage(e.response?.data?.message || 'Failed to reprocess attendance data');
      setReprocessSuccess(false);
    }
    setReprocessLoading(false);
  };

  // ── Replace with real data (delete old device records & rebuild) ───────────
  // Fixes the old alternating IN-OUT-IN-OUT direction bug by deleting stale
  // attendanceLog records and rebuilding them from rawPunchLog using the
  // corrected first=IN / last=OUT logic.

  const handleReplaceWithRealData = async (fromDate: string, toDate: string) => {
    if (!confirm(`This will DELETE all device-sourced attendance records from ${fromDate} to ${toDate} and rebuild them from the real ESSL punch data.\n\nThis fixes wrong check-in/check-out times. Continue?`)) return;
    setReprocessLoading(true);
    setReprocessMessage('');
    setReprocessSuccess(false);
    try {
      const res = await api.post<{ success: boolean; message: string; deletedRecords: number }>('/attendance/reimport-real-data', { fromDate, toDate });
      setReprocessMessage(res.data.message);
      setReprocessSuccess(res.data.success);
    } catch (e: any) {
      setReprocessMessage(e.response?.data?.message || 'Failed to replace attendance data');
      setReprocessSuccess(false);
    }
    setReprocessLoading(false);
  };

  // ── Filtered employees ──────────────────────────────────────────────────

  const filteredEmployees = employees.filter(emp =>
    !searchTerm ||
    emp.empCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.department.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'employees', label: 'Employees', icon: '👥' },
    { id: 'devices', label: 'Devices', icon: '🖥️' },
    { id: 'punches', label: 'All Punches', icon: '📋' },
    { id: 'portal', label: 'ESSL Portal', icon: '🌐' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <h1 className="text-2xl font-bold text-gray-900">ESSL Machine Control</h1>
        <p className="text-sm text-gray-500 mt-1">Direct control over your biometric device — employees, punches, settings</p>
      </div>

      <div className="px-6 pt-4">
        <DeviceOffBanner />
      </div>

      {/* Tabs */}
      <div className="bg-white border-b px-6">
        <div className="flex space-x-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium rounded-t-lg transition-colors ${
                activeTab === tab.id
                  ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* ── Overview Tab ─────────────────────────────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Machine Employees</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{employees.length || '—'}</p>
                  </div>
                  <div className="text-4xl">👥</div>
                </div>
                <button onClick={() => { setActiveTab('employees'); }} className="mt-4 text-blue-600 text-sm hover:underline">
                  View all employees →
                </button>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Connected Devices</p>
                    <p className="text-3xl font-bold text-gray-900 mt-1">{devices.length || '—'}</p>
                  </div>
                  <div className="text-4xl">🖥️</div>
                </div>
                <button onClick={() => { setActiveTab('devices'); }} className="mt-4 text-blue-600 text-sm hover:underline">
                  View devices →
                </button>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">ESSL Portal</p>
                    <p className="text-lg font-semibold text-gray-700 mt-1">{portalBaseUrl || 'Not configured'}</p>
                  </div>
                  <div className="text-4xl">🌐</div>
                </div>
                <button onClick={() => { setActiveTab('portal'); }} className="mt-4 text-blue-600 text-sm hover:underline">
                  Open portal →
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <button onClick={() => { setActiveTab('employees'); fetchEmployees(); }} className="flex flex-col items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition">
                  <span className="text-2xl mb-2">🔄</span>
                  <span className="text-sm font-medium text-blue-700">Sync Employees</span>
                </button>
                <button onClick={() => { setActiveTab('punches'); }} className="flex flex-col items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition">
                  <span className="text-2xl mb-2">📋</span>
                  <span className="text-sm font-medium text-green-700">View All Punches</span>
                </button>
                <button onClick={() => { setActiveTab('portal'); setPortalPage('employees'); }} className="flex flex-col items-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition">
                  <span className="text-2xl mb-2">➕</span>
                  <span className="text-sm font-medium text-purple-700">Add Employee</span>
                </button>
                <button onClick={() => { setActiveTab('portal'); setPortalPage('settings'); }} className="flex flex-col items-center p-4 bg-orange-50 rounded-lg hover:bg-orange-100 transition">
                  <span className="text-2xl mb-2">⚙️</span>
                  <span className="text-sm font-medium text-orange-700">Machine Settings</span>
                </button>
              </div>
            </div>

            {/* Historical Sync */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">📥 Sync Historical Data to Database</h3>
              <p className="text-sm text-gray-500 mb-4">
                Fetch past punch data from the ESSL device and store it in the database. This makes the data available in Attendance, Dashboard, and Reports pages.
              </p>
              <div className="flex items-end space-x-4 flex-wrap gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">From Date</label>
                  <input
                    type="date" value={syncFromDate}
                    onChange={e => setSyncFromDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">To Date</label>
                  <input
                    type="date" value={syncToDate}
                    onChange={e => setSyncToDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <button
                  onClick={handleHistoricalSync}
                  disabled={syncLoading}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
                >
                  {syncLoading ? '⏳ Syncing...' : '📥 Fetch & Sync to DB'}
                </button>
                <button onClick={() => {
                  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
                  setSyncFromDate(d.toISOString().slice(0, 10));
                  setSyncToDate(new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
                }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Past 1 Year</button>
                <button onClick={() => {
                  setSyncFromDate('2025-01-01');
                  setSyncToDate(new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
                }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Since Jan 2025</button>
              </div>
              {syncMessage && (
                <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${syncSuccess ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {syncMessage}
                </div>
              )}
            </div>

            {/* Reprocess Existing Data */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">🔄 Reprocess Attendance from Stored Punch Data</h3>
              <p className="text-sm text-gray-500 mb-4">
                If punch data is already stored in the database but check-in / check-out times are missing or outdated,
                use this to rebuild attendance records without re-fetching from the device.
              </p>

              {/* Primary action: replace with real data */}
              <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-semibold text-amber-800 mb-1">⚠️ Replace with Real Data (Fixes IN-OUT-IN-OUT sequence)</p>
                <p className="text-xs text-amber-700 mb-3">
                  This deletes stale device attendance records for the selected range and rebuilds them using the real first check-in / last check-out from raw punch data.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                      const julyFirst = `${now.getUTCFullYear()}-07-01`;
                      const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
                      handleReplaceWithRealData(julyFirst, today);
                    }}
                    disabled={reprocessLoading}
                    className="px-5 py-2.5 bg-amber-600 text-white rounded-lg text-sm font-semibold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {reprocessLoading ? '⏳ Processing...' : '📅 Replace July 1 – Today with Real Data'}
                  </button>
                  <button
                    onClick={() => {
                      const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                      const jan1 = `${now.getUTCFullYear()}-01-01`;
                      const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
                      handleReplaceWithRealData(jan1, today);
                    }}
                    disabled={reprocessLoading}
                    className="px-4 py-2.5 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700 disabled:opacity-50"
                  >
                    {reprocessLoading ? '⏳ Processing...' : '📆 Replace Full Year with Real Data'}
                  </button>
                </div>
              </div>

              {/* Secondary: reprocess without delete */}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                    const julydDate = `${now.getUTCFullYear()}-07-01`;
                    handleReprocessMonth(julydDate);
                  }}
                  disabled={reprocessLoading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50 font-medium"
                >
                  {reprocessLoading ? '⏳ Processing...' : '📅 Update July Attendance (Check-In & Check-Out)'}
                </button>
                <button
                  onClick={() => {
                    const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
                    handleReprocessMonth(thisMonth);
                  }}
                  disabled={reprocessLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {reprocessLoading ? '⏳ Processing...' : '🔄 Reprocess This Month'}
                </button>
              </div>
              {reprocessMessage && (
                <div className={`mt-4 px-4 py-3 rounded-lg text-sm ${reprocessSuccess ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                  {reprocessMessage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Employees Tab ────────────────────────────────────────────── */}
        {activeTab === 'employees' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  placeholder="Search employees..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="px-4 py-2 border rounded-lg w-64 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button onClick={fetchEmployees} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                  {loading ? 'Loading...' : '🔄 Refresh from ESSL'}
                </button>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
              >
                ➕ Add Employee
              </button>
            </div>

            {/* Add Employee Form */}
            {showAddForm && (
              <div className="bg-white rounded-xl shadow-sm border p-6">
                <h3 className="text-lg font-semibold mb-4">Add New Employee to ESSL Machine</h3>
                {addMessage && (
                  <div className={`mb-4 px-4 py-2 rounded text-sm ${addMessage.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {addMessage}
                  </div>
                )}
                <form onSubmit={handleAddEmployee} className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Employee Code *</label>
                    <input
                      type="text" required value={addForm.empCode}
                      onChange={e => setAddForm(p => ({ ...p, empCode: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="e.g. FCS099"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">First Name *</label>
                    <input
                      type="text" required value={addForm.firstName}
                      onChange={e => setAddForm(p => ({ ...p, firstName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="John"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                    <input
                      type="text" value={addForm.lastName}
                      onChange={e => setAddForm(p => ({ ...p, lastName: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Doe"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Card No</label>
                    <input
                      type="text" value={addForm.cardNo}
                      onChange={e => setAddForm(p => ({ ...p, cardNo: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Optional"
                    />
                  </div>
                  <div className="flex items-end">
                    <button type="submit" disabled={addLoading} className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                      {addLoading ? 'Adding...' : 'Add to Machine'}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Employee Table */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {loading ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Emp Code</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Designation</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Device</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-16 rounded" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-28 rounded" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-20 rounded" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-24 rounded" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-5 w-14 rounded-full" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-16 rounded" /></td>
                          <td className="px-4 py-3"><div className="skeleton h-4 w-24 rounded" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : filteredEmployees.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p className="text-lg mb-2">No employees found</p>
                  <p className="text-sm">
                    {employees.length === 0
                      ? 'Click "Refresh from ESSL" to load employees from the machine, or use the ESSL Portal tab to manage employees directly.'
                      : 'No employees match your search.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Emp Code</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Department</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Designation</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Device</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredEmployees.map((emp, i) => (
                        <tr key={emp.empCode || i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono font-semibold text-blue-700">{emp.empCode}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{emp.name !== emp.empCode ? emp.name : '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{emp.department || '—'}</td>
                          <td className="px-4 py-3 text-gray-600">{emp.designation || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              emp.status === 'Active' ? 'bg-green-100 text-green-800' :
                              emp.status === 'Resigned' || emp.status === 'Inactive' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {emp.status || 'Unknown'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">{emp.deviceGroup || '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center space-x-2">
                              <button onClick={() => handleStartEdit(emp)} className="text-yellow-600 hover:text-yellow-800 text-xs" title="Edit employee">
                                ✏️ Edit
                              </button>
                              <button onClick={() => handleUpload(emp.empCode)} className="text-blue-600 hover:text-blue-800 text-xs" title="Upload to device">
                                📤 Sync
                              </button>
                              <button onClick={() => handleDelete(emp.empCode)} className="text-red-600 hover:text-red-800 text-xs" title="Delete from machine">
                                🗑️ Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {filteredEmployees.length > 0 && (
                <div className="border-t bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  Showing {filteredEmployees.length} of {employees.length} employees on ESSL machine
                </div>
              )}
            </div>
          </div>
        )}

        {/* Edit Employee Modal */}
        {editingEmployee && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
              <h3 className="text-lg font-semibold mb-4">Edit Employee: {editingEmployee.empCode}</h3>
              {editMessage && (
                <div className={`mb-4 px-4 py-2 rounded text-sm ${editMessage.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {editMessage}
                </div>
              )}
              <form onSubmit={handleEditEmployee} className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">First Name *</label>
                  <input
                    type="text" required value={editForm.firstName}
                    onChange={e => setEditForm(p => ({ ...p, firstName: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Last Name</label>
                  <input
                    type="text" value={editForm.lastName}
                    onChange={e => setEditForm(p => ({ ...p, lastName: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Department</label>
                  <input
                    type="text" value={editForm.department}
                    onChange={e => setEditForm(p => ({ ...p, department: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Card No</label>
                  <input
                    type="text" value={editForm.cardNo}
                    onChange={e => setEditForm(p => ({ ...p, cardNo: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex justify-end space-x-3 pt-2">
                  <button type="button" onClick={() => setEditingEmployee(null)} className="px-4 py-2 border rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={editLoading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                    {editLoading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Devices Tab ──────────────────────────────────────────────── */}
        {activeTab === 'devices' && (
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <button onClick={fetchDevices} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50">
                {loading ? 'Loading...' : '🔄 Refresh Devices'}
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {loading ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Serial No</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">IP Address</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Users</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">FP</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Face</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: 9 }).map((_, j) => (
                            <td key={j} className="px-4 py-3"><div className="skeleton h-4 w-full rounded" /></td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : devices.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>No devices found. Use the ESSL Portal to manage devices.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Serial No</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">IP Address</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Users</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">FP</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Face</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Last Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {devices.map((dev, i) => (
                        <tr key={dev.serialNumber || i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono font-semibold">{dev.serialNumber}</td>
                          <td className="px-4 py-3">{dev.name}</td>
                          <td className="px-4 py-3 font-mono text-gray-600">{dev.ip}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              dev.status?.toLowerCase().includes('online') ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            }`}>
                              {dev.status || 'Unknown'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600">{dev.type || '—'}</td>
                          <td className="px-4 py-3">{dev.totalUsers || '—'}</td>
                          <td className="px-4 py-3">{dev.totalFP || '—'}</td>
                          <td className="px-4 py-3">{dev.totalFace || '—'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{dev.lastActivity || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Punches Tab (All Historical Punches) ──────────────────────── */}
        {activeTab === 'punches' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center space-x-4 flex-wrap gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">From Date</label>
                  <input
                    type="date" value={punchFromDate}
                    onChange={e => setPunchFromDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">To Date</label>
                  <input
                    type="date" value={punchToDate}
                    onChange={e => setPunchToDate(e.target.value)}
                    className="px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex items-end space-x-2">
                  <button
                    onClick={fetchPunches} disabled={punchLoading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {punchLoading ? 'Fetching...' : '📋 Fetch All Punches'}
                  </button>
                  {/* Quick range buttons */}
                  <button onClick={() => {
                    const d = new Date();
                    setPunchFromDate(d.toISOString().slice(0, 10));
                    setPunchToDate(d.toISOString().slice(0, 10));
                  }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Today</button>
                  <button onClick={() => {
                    const d = new Date(); d.setDate(d.getDate() - 7);
                    setPunchFromDate(d.toISOString().slice(0, 10));
                    setPunchToDate(new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
                  }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">7 Days</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 1);
                    setPunchFromDate(d.toISOString().slice(0, 10));
                    setPunchToDate(new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
                  }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">1 Month</button>
                  <button onClick={() => {
                    const d = new Date(); d.setMonth(d.getMonth() - 3);
                    setPunchFromDate(d.toISOString().slice(0, 10));
                    setPunchToDate(new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10));
                  }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">3 Months</button>
                </div>
              </div>
              {punchMessage && (
                <p className="mt-3 text-sm text-gray-600">{punchMessage}</p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {punchLoading ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Employee Code</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Timestamp</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Direction</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Device</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2"><div className="skeleton h-4 w-6 rounded" /></td>
                          <td className="px-4 py-2"><div className="skeleton h-4 w-16 rounded" /></td>
                          <td className="px-4 py-2"><div className="skeleton h-4 w-28 rounded" /></td>
                          <td className="px-4 py-2"><div className="skeleton h-4 w-32 rounded" /></td>
                          <td className="px-4 py-2"><div className="skeleton h-5 w-12 rounded-full" /></td>
                          <td className="px-4 py-2"><div className="skeleton h-4 w-20 rounded" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : punches.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <p>No punch records. Select a date range and click "Fetch All Punches".</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">#</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Employee Code</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Timestamp</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Direction</th>
                          <th className="text-left px-4 py-3 font-medium text-gray-600">Device</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {punches.map((p, i) => (
                          <tr key={p.id || i} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-400 text-xs">{i + 1}</td>
                            <td className="px-4 py-2 font-mono font-semibold text-blue-700">{p.empCode}</td>
                            <td className="px-4 py-2 font-medium text-gray-900">{p.empName && p.empName !== p.empCode ? p.empName : '—'}</td>
                            <td className="px-4 py-2 font-mono text-gray-700">{p.timestamp}</td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                p.direction === 'in' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {p.direction === 'in' ? '↙ IN' : '↗ OUT'}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-gray-500 text-xs">{p.deviceSerial || p.deviceName || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    Total: {punches.length} punch records ({punchFromDate} to {punchToDate})
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Portal Tab (iframe) ──────────────────────────────────────── */}
        {activeTab === 'portal' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-center space-x-3 flex-wrap gap-2">
                <span className="text-sm font-medium text-gray-600">Navigate to:</span>
                {portalPages && (
                  <>
                    {([
                      ['main', '🏠 Home'],
                      ['employees', '👥 Employees'],
                      ['devices', '🖥️ Devices'],
                      ['departments', '🏢 Departments'],
                      ['attendance', '📋 Attendance'],
                      ['deviceLogs', '📊 Device Logs'],
                      ['reports', '📈 Reports'],
                      ['settings', '⚙️ Settings'],
                      ['uploadUsers', '📤 Upload Users'],
                      ['deleteUsers', '🗑️ Delete Users'],
                      ['shifts', '🕐 Shifts'],
                      ['holidays', '🎉 Holidays'],
                    ] as [keyof PortalPages, string][]).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setPortalPage(key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                          portalPage === key
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </div>
              {portalPages && (
                <p className="mt-2 text-xs text-gray-400">
                  Direct access to: {portalPages[portalPage]}
                </p>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {portalPages ? (
                <iframe
                  src={portalPages[portalPage]}
                  className="w-full border-0"
                  style={{ height: 'calc(100vh - 280px)', minHeight: '600px' }}
                  title="ESSL Portal"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                />
              ) : (
                <div className="p-8 text-center text-gray-500">
                  <p>ESSL portal not configured. Add a device with credentials first.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
