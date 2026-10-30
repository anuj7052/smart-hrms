/**
 * /api/essl — Local mode, no database.
 * Devices configured in src/config/local-devices.json
 *
 * GET  /api/essl/live-devices  → list configured devices
 * GET  /api/essl/live          → fetch punches DIRECTLY from the ESSL device
 * POST /api/essl/devices       → save device config to local JSON (Admin only)
 */
import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { fetchFromETimeTrackLite, fetchFromIClockServerDirect, probeEsslPortal } from '../services/etlService';
import {
  listEsslEmployees,
  listEsslDevices,
  listEsslDepartments,
  addEsslEmployee,
  editEsslEmployee,
  deleteEsslEmployee,
  uploadUserToDevice,
  getPortalPages,
} from '../services/esslEmployeeService';

const router = Router();

const DEVICES_PATH = path.join(__dirname, '../config/local-devices.json');
const EMPLOYEES_PATH = path.join(__dirname, '../config/local-employees.json');

// Build a map of employeeId → name for punch name lookup
function buildEmpNameMap(): Record<string, string> {
  try {
    const emps = JSON.parse(fs.readFileSync(EMPLOYEES_PATH, 'utf-8')) as Array<{
      employeeId: string; userId: { name: string };
    }>;
    const map: Record<string, string> = {};
    for (const e of emps) {
      if (e.employeeId) map[e.employeeId.toUpperCase()] = e.userId.name;
    }
    return map;
  } catch {
    return {};
  }
}

interface LocalDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string;
  etlUsername: string;
  etlPassword: string;
  status: string;
}

function loadDevices(): LocalDevice[] {
  try {
    return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

function saveDevices(devices: LocalDevice[]): void {
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Format a Date as IST string: "YYYY-MM-DD HH:mm:ss" in Asia/Kolkata timezone */
function toIST(d: Date): string {
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace('T', ' ');
}

/**
 * Infer punch direction when the ESSL device reports all punches as punchType=0 (IN).
 * Groups by empCode+date, then alternates: first=IN, then OUT, IN, OUT, ...
 * Only overrides if ALL punches have the same direction (device doesn't report direction).
 */
function inferDirections(punches: Array<{ empCode: string; timestamp: string; direction: string }>): void {
  if (punches.length < 2) return;
  const allSame = punches.every(p => p.direction === punches[0].direction);
  if (!allSame) return; // Device reports direction correctly

  const groups = new Map<string, typeof punches>();
  for (const p of punches) {
    const date = p.timestamp.slice(0, 10);
    const key = `${p.empCode}-${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    for (let i = 0; i < group.length; i++) {
      group[i].direction = i % 2 === 0 ? 'in' : 'out';
    }
  }
}

// ─── GET /api/essl/live-devices ───────────────────────────────────────────────
router.get('/live-devices', authenticateJWT, requireRole(['Admin', 'HR']), (_req: AuthRequest, res: Response): void => {
  const devices = loadDevices();
  res.json(devices.map((d) => ({
    ...d,
    etlPassword: undefined, // never expose password
    hasCredentials: !!(d.etlUsername && d.etlPassword),
  })));
});

// ─── GET /api/essl/live ───────────────────────────────────────────────────────
router.get('/live', authenticateJWT, requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { deviceId, fromDate, toDate } = req.query as { deviceId?: string; fromDate?: string; toDate?: string };

  if (!deviceId) {
    res.status(400).json({ ok: false, error: 'deviceId is required' });
    return;
  }

  const devices = loadDevices();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) {
    res.status(404).json({ ok: false, error: 'Device not found' });
    return;
  }

  const from = fromDate || todayStr();
  const to   = toDate   || todayStr();
  const baseUrl = `http://${device.ip}:${device.port}`;

  try {
    const empNames = buildEmpNameMap();
    const resolveName = (code: string) => empNames[code.toUpperCase()] || code;

    // Strategy 1: eTimeTrackLite web portal (ETL credentials)
    if (device.etlUsername && device.etlPassword) {
      const result = await fetchFromETimeTrackLite(baseUrl, device.etlUsername, device.etlPassword, from, to);
      if (result.success && result.records.length > 0) {
        const punches = result.records.map((r) => ({
          id: `${r.employeeDeviceId}-${toIST(r.timestamp)}`,
          empCode: r.employeeDeviceId,
          empName: resolveName(r.employeeDeviceId),
          timestamp: toIST(r.timestamp),
          direction: r.punchType === 1 ? 'out' : 'in',
          deviceSerial: device.serialNumber,
          deviceName: device.name,
        }));
        inferDirections(punches);
        res.json({ ok: true, punches, source: 'etl', deviceName: device.name, count: punches.length });
        return;
      }
      if (result.success && result.records.length === 0) {
        res.json({ ok: true, punches: [], source: 'etl', deviceName: device.name, count: 0, message: result.message });
        return;
      }
    }

    // Strategy 2: iClock direct REST / ADMS
    const result2 = await fetchFromIClockServerDirect(
      baseUrl,
      device.serialNumber,
      undefined,
      device.etlUsername || undefined,
      device.etlPassword || undefined,
    );

    if (result2.success) {
      const dateFrom = new Date(`${from}T00:00:00`);
      const dateTo   = new Date(`${to}T23:59:59`);
      const filtered = result2.records.filter((r) => r.timestamp >= dateFrom && r.timestamp <= dateTo);
      const punches = filtered.map((r) => ({
        id: `${r.employeeDeviceId}-${toIST(r.timestamp)}`,
        empCode: r.employeeDeviceId,
        empName: resolveName(r.employeeDeviceId),
        timestamp: toIST(r.timestamp),
        direction: r.punchType === 1 ? 'out' : 'in',
        deviceSerial: device.serialNumber,
        deviceName: device.name,
      }));
      inferDirections(punches);
      res.json({ ok: true, punches, source: 'iclock', deviceName: device.name, count: punches.length });
      return;
    }

    res.json({ ok: true, punches: [], source: 'none', deviceName: device.name, count: 0, message: result2.message });
  } catch (err: any) {
    console.error('[essl-local] /live error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to connect to device' });
  }
});

// ─── GET /api/essl/devices ────────────────────────────────────────────────────
// Admin: get all devices with full config (including credentials for editing)
router.get('/devices', authenticateJWT, requireRole(['Admin']), (_req: AuthRequest, res: Response): void => {
  res.json(loadDevices().map((d) => ({ ...d, etlPassword: d.etlPassword ? '••••••' : '' })));
});

// ─── PUT /api/essl/devices/:id ────────────────────────────────────────────────
// Admin: update a device's IP/port/credentials
router.put('/devices/:id', authenticateJWT, requireRole(['Admin']), (req: AuthRequest, res: Response): void => {
  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === req.params.id);
  if (idx === -1) {
    res.status(404).json({ message: 'Device not found' });
    return;
  }
  const { name, ip, port, serialNumber, etlUsername, etlPassword } = req.body as Partial<LocalDevice>;
  if (name) devices[idx].name = name;
  if (ip) devices[idx].ip = ip;
  if (port) devices[idx].port = Number(port);
  if (serialNumber !== undefined) devices[idx].serialNumber = serialNumber;
  if (etlUsername !== undefined) devices[idx].etlUsername = etlUsername;
  if (etlPassword && etlPassword !== '••••••') devices[idx].etlPassword = etlPassword;
  saveDevices(devices);
  res.json({ message: 'Device updated', device: { ...devices[idx], etlPassword: undefined } });
});

// ─── POST /api/essl/devices ───────────────────────────────────────────────────
// Admin: add a new device
router.post('/devices', authenticateJWT, requireRole(['Admin']), (req: AuthRequest, res: Response): void => {
  const { name, ip, port, serialNumber, etlUsername, etlPassword } = req.body as LocalDevice;
  if (!name || !ip) {
    res.status(400).json({ message: 'name and ip are required' });
    return;
  }
  const devices = loadDevices();
  const newDevice: LocalDevice = {
    id: `dev_${Date.now()}`,
    name, ip,
    port: Number(port) || 85,
    serialNumber: serialNumber || '',
    etlUsername: etlUsername || '',
    etlPassword: etlPassword || '',
    status: 'Unknown',
  };
  devices.push(newDevice);
  saveDevices(devices);
  res.status(201).json({ message: 'Device added', device: { ...newDevice, etlPassword: undefined } });
});

// ─── DELETE /api/essl/devices/:id ────────────────────────────────────────────
router.delete('/devices/:id', authenticateJWT, requireRole(['Admin']), (req: AuthRequest, res: Response): void => {
  const devices = loadDevices();
  const idx = devices.findIndex((d) => d.id === req.params.id);
  if (idx === -1) { res.status(404).json({ message: 'Device not found' }); return; }
  devices.splice(idx, 1);
  saveDevices(devices);
  res.json({ message: 'Device deleted' });
});

// ─── POST /api/essl/devices/:id/test ─────────────────────────────────────────
// Test connection to the ESSL device portal
router.post('/devices/:id/test', authenticateJWT, requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {  const devices = loadDevices();
  const device = devices.find((d) => d.id === req.params.id);
  if (!device) { res.status(404).json({ ok: false, message: 'Device not found' }); return; }

  const baseUrl = `http://${device.ip}:${device.port}`;

  if (!device.etlUsername || !device.etlPassword) {
    res.json({ ok: false, message: 'No credentials configured for this device' });
    return;
  }

  try {
    const result = await fetchFromETimeTrackLite(baseUrl, device.etlUsername, device.etlPassword, todayStr(), todayStr());
    if (result.success) {
      // Update device status
      const idx = devices.findIndex((d) => d.id === device.id);
      if (idx !== -1) { devices[idx].status = 'Online'; saveDevices(devices); }
      res.json({ ok: true, message: `Connected to ${device.name} (${result.records.length} record(s) today)`, records: result.records.length });
    } else {
      const idx = devices.findIndex((d) => d.id === device.id);
      if (idx !== -1) { devices[idx].status = 'Offline'; saveDevices(devices); }
      res.json({ ok: false, message: result.message });
    }
  } catch (err: unknown) {
    const idx = devices.findIndex((d) => d.id === device.id);
    if (idx !== -1) { devices[idx].status = 'Offline'; saveDevices(devices); }
    res.json({ ok: false, message: (err as Error)?.message || 'Connection failed' });
  }
});

// ─── GET /api/essl/employee-punches/:empCode ─────────────────────────────────
// Fetch all punch logs for a specific employee by their ESSL punch code (e.g. FCS001)
router.get('/employee-punches/:empCode', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };

  const from = fromDate || todayStr();
  const to   = toDate   || todayStr();

  const devices = loadDevices();
  if (devices.length === 0) {
    res.json({ ok: true, punches: [], message: 'No devices configured' });
    return;
  }

  const empNames = buildEmpNameMap();
  const resolveName = (code: string) => empNames[code.toUpperCase()] || code;
  const allPunches: Array<{ id: string; empCode: string; empName: string; timestamp: string; direction: string; deviceSerial: string; deviceName: string }> = [];

  for (const device of devices) {
    const baseUrl = `http://${device.ip}:${device.port}`;
    try {
      if (device.etlUsername && device.etlPassword) {
        const result = await fetchFromETimeTrackLite(baseUrl, device.etlUsername, device.etlPassword, from, to);
        if (result.success && result.records.length > 0) {
          const filtered = result.records.filter((r) => r.employeeDeviceId.toUpperCase() === empCode.toUpperCase());
          for (const r of filtered) {
            allPunches.push({
              id: `${r.employeeDeviceId}-${toIST(r.timestamp)}`,
              empCode: r.employeeDeviceId,
              empName: resolveName(r.employeeDeviceId),
              timestamp: toIST(r.timestamp),
              direction: r.punchType === 1 ? 'out' : 'in',
              deviceSerial: device.serialNumber,
              deviceName: device.name,
            });
          }
          continue;
        }
      }

      // Fallback: iClock direct
      const result2 = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, undefined, device.etlUsername || undefined, device.etlPassword || undefined);
      if (result2.success) {
        const dateFrom = new Date(`${from}T00:00:00`);
        const dateTo   = new Date(`${to}T23:59:59`);
        const filtered = result2.records.filter((r) => r.employeeDeviceId.toUpperCase() === empCode.toUpperCase() && r.timestamp >= dateFrom && r.timestamp <= dateTo);
        for (const r of filtered) {
          allPunches.push({
            id: `${r.employeeDeviceId}-${toIST(r.timestamp)}`,
            empCode: r.employeeDeviceId,
            empName: resolveName(r.employeeDeviceId),
            timestamp: toIST(r.timestamp),
            direction: r.punchType === 1 ? 'out' : 'in',
            deviceSerial: device.serialNumber,
            deviceName: device.name,
          });
        }
      }
    } catch (err) {
      console.error(`[essl-local] employee-punches error for device ${device.id}:`, err);
    }
  }

  // Sort by timestamp ascending
  allPunches.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  inferDirections(allPunches);

  res.json({ ok: true, punches: allPunches, count: allPunches.length });
});

// ─── GET /api/essl/probe/:id — Admin debug: discover portal pages ─────────────
router.get('/probe/:id', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const devices = loadDevices();
  const device = devices.find((d) => d.id === req.params.id);
  if (!device || !device.etlUsername || !device.etlPassword) {
    res.status(400).json({ ok: false, message: 'Device not found or no credentials' });
    return;
  }
  const baseUrl = `http://${device.ip}:${device.port}`;
  try {
    const result = await probeEsslPortal(baseUrl, device.etlUsername, device.etlPassword);
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ ok: false, message: (err as Error)?.message });
  }
});

// ─── GET /api/essl/portal-pages ────────────────────────────────────────────────
// Get all available portal page URLs for iframe embedding
router.get('/portal-pages', authenticateJWT, requireRole(['Admin', 'HR']), (_req: AuthRequest, res: Response): void => {
  const devices = loadDevices();
  if (devices.length === 0) {
    res.json({ ok: false, pages: {}, message: 'No devices configured' });
    return;
  }
  const device = devices[0];
  const baseUrl = `http://${device.ip}:${device.port}`;
  res.json({ ok: true, pages: getPortalPages(baseUrl), baseUrl });
});

// ─── GET /api/essl/machine/employees ──────────────────────────────────────────
// List all employees registered on the ESSL machine
router.get('/machine/employees', authenticateJWT, requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, employees: [], message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await listEsslEmployees(baseUrl, d.etlUsername, d.etlPassword);
  res.json({ ok: result.success, ...result });
});

// ─── GET /api/essl/machine/devices ────────────────────────────────────────────
// List all devices connected to the ESSL server
router.get('/machine/devices', authenticateJWT, requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, devices: [], message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await listEsslDevices(baseUrl, d.etlUsername, d.etlPassword);
  res.json({ ok: result.success, ...result });
});

// ─── GET /api/essl/machine/departments ────────────────────────────────────────
router.get('/machine/departments', authenticateJWT, requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, departments: [], message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await listEsslDepartments(baseUrl, d.etlUsername, d.etlPassword);
  res.json({ ok: result.success, ...result });
});

// ─── POST /api/essl/machine/employees ─────────────────────────────────────────
// Add a new employee to the ESSL machine
router.post('/machine/employees', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode, firstName, lastName, department, cardNo } = req.body;
  if (!empCode || !firstName) {
    res.status(400).json({ ok: false, message: 'empCode and firstName are required' });
    return;
  }
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await addEsslEmployee(baseUrl, d.etlUsername, d.etlPassword, {
    empCode, firstName, lastName, department, cardNo,
  });
  res.json({ ok: result.success, ...result });
});

// ─── PUT /api/essl/machine/employees/:empCode ────────────────────────────────
// Edit an employee on the ESSL machine
router.put('/machine/employees/:empCode', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const { firstName, lastName, department, cardNo } = req.body;
  if (!firstName) {
    res.status(400).json({ ok: false, message: 'firstName is required' });
    return;
  }
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await editEsslEmployee(baseUrl, d.etlUsername, d.etlPassword, empCode, {
    firstName, lastName, department, cardNo,
  });
  res.json({ ok: result.success, ...result });
});

// ─── DELETE /api/essl/machine/employees/:empCode ──────────────────────────────
// Delete an employee from the ESSL machine
router.delete('/machine/employees/:empCode', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await deleteEsslEmployee(baseUrl, d.etlUsername, d.etlPassword, empCode);
  res.json({ ok: result.success, ...result });
});

// ─── POST /api/essl/machine/employees/:empCode/upload ─────────────────────────
// Upload/sync an employee to all connected ESSL devices
router.post('/machine/employees/:empCode/upload', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const devices = loadDevices();
  if (devices.length === 0 || !devices[0].etlUsername) {
    res.json({ ok: false, message: 'No devices configured' });
    return;
  }
  const d = devices[0];
  const baseUrl = `http://${d.ip}:${d.port}`;
  const result = await uploadUserToDevice(baseUrl, d.etlUsername, d.etlPassword, empCode);
  res.json({ ok: result.success, ...result });
});

export default router;
