import { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Wifi, WifiOff, CircleDot, Loader2, X, Pencil, Trash2, Fingerprint, AlertCircle } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { usePermissions } from '../hooks/usePermissions';

// Types
interface LocalDevice {
  id: string; name: string; ip: string; port: number;
  serialNumber: string; etlUsername: string; etlPassword?: string;
  hasCredentials: boolean; status: string;
}
interface DeviceForm {
  name: string; ip: string; port: string; serialNumber: string;
  etlUsername: string; etlPassword: string;
}
const defaultForm: DeviceForm = { name: '', ip: '', port: '85', serialNumber: '', etlUsername: '', etlPassword: '' };

function StatusBadge({ status }: { status: string }) {
  if (status === 'Online') return <span className='badge-green flex items-center gap-1'><Wifi className='w-3 h-3' /> Online</span>;
  if (status === 'Offline') return <span className='badge-red flex items-center gap-1'><WifiOff className='w-3 h-3' /> Offline</span>;
  return <span className='badge-gray flex items-center gap-1'><CircleDot className='w-3 h-3' /> Unknown</span>;
}

function DeviceCard({ device, isAdmin, onTest, onEdit, onDelete }: {
  device: LocalDevice; isAdmin: boolean;
  onTest: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  async function handleTest() { setTesting(true); await onTest(); setTesting(false); }
  return (
    <div className='card p-5 space-y-4 animate-fade-in'>
      <div className='flex items-start justify-between'>
        <div>
          <h3 className='font-semibold text-gray-900'>{device.name}</h3>
          <p className='text-xs text-gray-500 font-mono mt-0.5'>{device.ip}:{device.port}</p>
        </div>
        <StatusBadge status={device.status} />
      </div>
      <div className='grid grid-cols-2 gap-3 text-sm'>
        <div>
          <p className='text-xs text-gray-500'>Portal User</p>
          <p className='font-medium text-gray-700 text-xs'>{device.etlUsername || '—'}</p>
        </div>
        <div>
          <p className='text-xs text-gray-500'>Credentials</p>
          <p className={'text-xs font-medium ' + (device.hasCredentials ? 'text-green-600' : 'text-amber-500')}>
            {device.hasCredentials ? '✓ Configured' : '⚠ Not set'}
          </p>
        </div>
        {device.serialNumber && (
          <div className='col-span-2'>
            <p className='text-xs text-gray-500'>Serial No.</p>
            <p className='font-mono text-xs text-gray-700 truncate'>{device.serialNumber}</p>
          </div>
        )}
      </div>
      <div className='flex gap-2 flex-wrap items-center'>
        <button onClick={handleTest} disabled={testing || !device.hasCredentials}
          className='btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-50'>
          {testing ? <Loader2 className='w-3.5 h-3.5 animate-spin' /> : <Wifi className='w-3.5 h-3.5' />}
          {testing ? 'Testing…' : 'Test Login'}
        </button>
        {isAdmin && (
          <div className='ml-auto flex gap-1'>
            <button onClick={onEdit} className='p-1.5 text-gray-400 hover:text-primary-600 transition-colors'>
              <Pencil className='w-4 h-4' />
            </button>
            <button onClick={onDelete} className='p-1.5 text-gray-400 hover:text-red-600 transition-colors'>
              <Trash2 className='w-4 h-4' />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40'>
      <div className='card w-full max-w-md p-6'>
        <div className='flex items-center justify-between mb-5'>
          <h2 className='font-semibold text-lg text-gray-900'>{title}</h2>
          <button onClick={onClose}><X className='w-5 h-5 text-gray-400' /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function DevicesPage() {
  const { isAdmin } = usePermissions();
  const [devices, setDevices] = useState<LocalDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editDevice, setEditDevice] = useState<LocalDevice | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LocalDevice | null>(null);
  const [form, setForm] = useState<DeviceForm>(defaultForm);
  const [submitting, setSubmitting] = useState(false);

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = isAdmin ? '/essl/devices' : '/essl/live-devices';
      const res = await api.get<LocalDevice[]>(endpoint);
      setDevices(res.data);
    } catch { toast.error('Failed to load devices'); }
    finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  async function handleTest(device: LocalDevice) {
    try {
      const res = await api.post<{ ok: boolean; message: string }>('/essl/devices/' + device.id + '/test');
      if (res.data.ok) toast.success(res.data.message); else toast.error(res.data.message);
      fetchDevices();
    } catch { toast.error('Connection test failed'); }
  }

  function openAdd() { setEditDevice(null); setForm(defaultForm); setShowModal(true); }

  function openEdit(device: LocalDevice) {
    setEditDevice(device);
    setForm({ name: device.name, ip: device.ip, port: String(device.port), serialNumber: device.serialNumber, etlUsername: device.etlUsername, etlPassword: '' });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSubmitting(true);
    try {
      if (editDevice) {
        const body: Record<string, unknown> = { name: form.name, ip: form.ip, port: Number(form.port), serialNumber: form.serialNumber, etlUsername: form.etlUsername };
        if (form.etlPassword) body.etlPassword = form.etlPassword;
        await api.put('/essl/devices/' + editDevice.id, body);
        toast.success('Device updated');
      } else {
        await api.post('/essl/devices', { name: form.name, ip: form.ip, port: Number(form.port), serialNumber: form.serialNumber, etlUsername: form.etlUsername, etlPassword: form.etlPassword });
        toast.success('Device added');
      }
      setShowModal(false); fetchDevices();
    } catch (err: unknown) {
      toast.error((err as {response?:{data?:{message?:string}}})?.response?.data?.message || 'Failed');
    } finally { setSubmitting(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try { await api.delete('/essl/devices/' + deleteTarget.id); toast.success('Device removed'); setDeleteTarget(null); fetchDevices(); }
    catch { toast.error('Delete failed'); }
  }

  return (
    <div className='space-y-5 pb-20 lg:pb-0'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold text-gray-900'>ESSL Devices</h1>
          <p className='text-sm text-gray-500 mt-0.5'>Biometric device configuration</p>
        </div>
        <div className='flex gap-2'>
          <button onClick={fetchDevices} className='btn-secondary flex items-center gap-2'>
            <RefreshCw className='w-4 h-4' /><span className='hidden sm:inline'>Refresh</span>
          </button>
          {isAdmin && (
            <button onClick={openAdd} className='btn-primary flex items-center gap-2'>
              <Plus className='w-4 h-4' /> Add Device
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className='grid sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {[0,1].map(i => (
            <div key={i} className='card p-5 space-y-4'>
              <div className='flex justify-between'><div className='skeleton h-5 w-32 rounded' /><div className='skeleton h-5 w-16 rounded' /></div>
              <div className='grid grid-cols-2 gap-3'><div className='skeleton h-8 rounded' /><div className='skeleton h-8 rounded' /></div>
              <div className='skeleton h-8 w-24 rounded' />
            </div>
          ))}
        </div>
      ) : devices.length === 0 ? (
        <div className='card p-12 text-center'>
          <Fingerprint className='w-12 h-12 text-gray-300 mx-auto mb-3' />
          <p className='text-gray-500'>No devices configured yet.</p>
          {isAdmin && <button onClick={openAdd} className='btn-primary mt-4'>Add your first device</button>}
        </div>
      ) : (
        <div className='grid sm:grid-cols-2 lg:grid-cols-3 gap-4'>
          {devices.map(device => (
            <DeviceCard key={device.id} device={device} isAdmin={isAdmin}
              onTest={() => handleTest(device)}
              onEdit={() => openEdit(device)}
              onDelete={() => setDeleteTarget(device)}
            />
          ))}
        </div>
      )}

      {!loading && devices.length > 0 && (
        <div className='rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-3'>
          <Fingerprint className='w-4 h-4 text-blue-500 mt-0.5 shrink-0' />
          <p className='text-sm text-blue-700'>
            Punch data <strong>auto-syncs every minute</strong> from active devices into the database.
            Visit <strong>Dashboard</strong> or <strong>Attendance</strong> for synced data, or <strong>ESSL Live</strong> for real-time punches direct from the device.
          </p>
        </div>
      )}

      {showModal && (
        <Modal title={editDevice ? 'Edit Device' : 'Add ESSL Device'} onClose={() => setShowModal(false)}>
          <form onSubmit={handleSubmit} className='space-y-4'>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1'>Device Name</label>
              <input className='input' placeholder='Office Biometric' value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} required />
            </div>
            <div className='grid grid-cols-3 gap-3'>
              <div className='col-span-2'>
                <label className='block text-sm font-medium text-gray-700 mb-1'>IP Address</label>
                <input className='input font-mono' placeholder='98.70.41.54' value={form.ip} onChange={e => setForm(f => ({...f, ip: e.target.value}))} required />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 mb-1'>Port</label>
                <input type='number' className='input' placeholder='85' value={form.port} onChange={e => setForm(f => ({...f, port: e.target.value}))} required min={1} max={65535} />
              </div>
            </div>
            <div>
              <label className='block text-sm font-medium text-gray-700 mb-1'>Serial Number <span className='text-gray-400 font-normal'>(optional)</span></label>
              <input className='input font-mono' placeholder='CGKK220762223' value={form.serialNumber} onChange={e => setForm(f => ({...f, serialNumber: e.target.value}))} />
            </div>
            <div className='pt-1 border-t border-gray-100'>
              <p className='text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3'>Portal Login (eTimeTrackLite)</p>
              <div className='grid grid-cols-2 gap-3'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>Username</label>
                  <input className='input' placeholder='Essl' value={form.etlUsername} onChange={e => setForm(f => ({...f, etlUsername: e.target.value}))} required />
                </div>
                <div>
                  <label className='block text-sm font-medium text-gray-700 mb-1'>Password</label>
                  <input type='password' className='input' value={form.etlPassword} onChange={e => setForm(f => ({...f, etlPassword: e.target.value}))} required={!editDevice} placeholder={editDevice ? 'Leave blank to keep' : ''} />
                </div>
              </div>
            </div>
            <div className='flex gap-3 justify-end pt-2'>
              <button type='button' onClick={() => setShowModal(false)} className='btn-secondary'>Cancel</button>
              <button type='submit' disabled={submitting} className='btn-primary flex items-center gap-2'>
                {submitting && <Loader2 className='w-4 h-4 animate-spin' />}
                {editDevice ? 'Save Changes' : 'Add Device'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40'>
          <div className='card w-full max-w-sm p-6 space-y-4'>
            <div className='flex items-center gap-3'>
              <div className='w-10 h-10 rounded-full bg-red-100 flex items-center justify-center'>
                <AlertCircle className='w-5 h-5 text-red-500' />
              </div>
              <div>
                <p className='font-semibold text-gray-900'>Delete device?</p>
                <p className='text-sm text-gray-500'>Remove <strong>{deleteTarget.name}</strong> from config.</p>
              </div>
            </div>
            <div className='flex gap-3 justify-end'>
              <button onClick={() => setDeleteTarget(null)} className='btn-secondary'>Cancel</button>
              <button onClick={handleDelete} className='px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold flex items-center gap-2'>
                <Trash2 className='w-4 h-4' /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
