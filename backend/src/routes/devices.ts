import { Router, Response } from 'express';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { syncDevice, testDeviceConnection, processAttendanceFromRaw } from '../services/esslService';
import { fetchFromETimeTrackLite, parseManualAttendanceData, encryptForStorage, decryptFromStorage, fetchEmployeesFromETL, fetchFromIClockServerDirect } from '../services/etlService';
import { io } from '../server';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticateJWT);

type DeviceWithSecret = {
  passwordHash: string;
  [key: string]: unknown;
};

// ─── GET /api/devices ────────────────────────────────────────────────────────
router.get('/', requireRole(['Admin', 'HR']), async (_req, res: Response): Promise<void> => {
  const devices = await prisma.device.findMany({ orderBy: { createdAt: 'desc' } }) as DeviceWithSecret[];
  res.json(devices.map((device) => {
    const { passwordHash: _ph, ...safeDevice } = device;
    void _ph;
    return safeDevice;
  }));
});

// ─── POST /api/devices ───────────────────────────────────────────────────────
router.post(
  '/',
  requireRole(['Admin']),
  [
    body('name').trim().notEmpty(),
    body('ip').matches(/^(\d{1,3}\.){3}\d{1,3}$/).withMessage('Invalid IP address'),
    body('port').isInt({ min: 1, max: 65535 }),
    body('serialNumber').trim().notEmpty(),
    body('username').trim().notEmpty(),
    body('password').notEmpty(),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { name, ip, port, serialNumber, username, password } = req.body as {
      name: string; ip: string; port: number;
      serialNumber: string; username: string; password: string;
    };

    const existing = await prisma.device.findUnique({ where: { serialNumber } });
    if (existing) {
      res.status(409).json({ message: 'Device with this serial number already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const device = await prisma.device.create({ data: { name, ip, port, serialNumber, username, passwordHash } });
    const { passwordHash: _ph, ...safe } = device; void _ph;
    res.status(201).json({ message: 'Device added', device: safe });
  }
);

// ─── PUT /api/devices/:id ────────────────────────────────────────────────────
router.put('/:id', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  const { name, ip, port, serialNumber, username, password, isActive } = req.body as {
    name?: string; ip?: string; port?: number; serialNumber?: string;
    username?: string; password?: string; isActive?: boolean;
  };
  const passwordHash = password ? await bcrypt.hash(password, 10) : undefined;
  await prisma.device.update({
    where: { id: req.params.id },
    data: { ...(name && { name }), ...(ip && { ip }), ...(port && { port }), ...(serialNumber && { serialNumber }), ...(username && { username }), ...(passwordHash && { passwordHash }), ...(isActive !== undefined && { isActive }) },
  });
  res.json({ message: 'Device updated' });
});

// ─── DELETE /api/devices/:id ─────────────────────────────────────────────────
router.delete('/:id', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }
  await prisma.device.delete({ where: { id: req.params.id } });
  res.json({ message: 'Device deleted' });
});

// ─── POST /api/devices/:id/test-connection ────────────────────────────────────
router.post('/:id/test-connection', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }
  const result = await testDeviceConnection(device as any);
  res.json(result);
});

// ─── POST /api/devices/:id/sync ──────────────────────────────────────────────
router.post('/:id/sync', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }
  const { fromDate } = req.body as { fromDate?: string };
  let fromDateObj: Date | undefined;
  if (fromDate) {
    fromDateObj = new Date(fromDate); fromDateObj.setHours(0, 0, 0, 0);
    if (isNaN(fromDateObj.getTime())) { res.status(400).json({ message: 'Invalid fromDate. Use YYYY-MM-DD format.' }); return; }
  }
  const result = await syncDevice(device as any, fromDateObj);
  res.json(result);
});

// ─── PUT /api/devices/:id/etl-credentials ────────────────────────────────────
router.put('/:id/etl-credentials', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }
  const { etlUsername, etlPassword, autoSync, syncInterval } = req.body as { etlUsername: string; etlPassword: string; autoSync?: boolean; syncInterval?: number };
  if (!etlUsername || !etlPassword) { res.status(400).json({ message: 'etlUsername and etlPassword are required' }); return; }
  await prisma.device.update({ where: { id: req.params.id }, data: { etlUsername: etlUsername.trim(), etlPassword: encryptForStorage(etlPassword), ...(autoSync !== undefined && { autoSync }), ...(syncInterval && { syncInterval }) } });
  res.json({ message: 'eTimeTrackLite credentials saved' });
});

// ─── POST /api/devices/:id/test-etl-credentials ───────────────────────────────
router.post('/:id/test-etl-credentials', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ success: false, message: 'Username and password are required' }); return;
  }

  const baseUrl = `http://${device.ip}:${device.port}`;
  const deviceBaseUrl = `http://${device.ip}:${device.port}`;
  try {
    const today = new Date().toISOString().split('T')[0];
    const result = await fetchFromETimeTrackLite(deviceBaseUrl, username, password, today, today);
    if (result.success) {
      res.json({ success: true, message: `Login successful! Portal is accessible. ${result.records.length} records found for today.` });
    } else {
      res.status(400).json({ success: false, message: result.message });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: (e as Error).message });
  }
});

// ─── POST /api/devices/:id/configure-etl ─────────────────────────────────────
router.post('/:id/configure-etl', requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  const { etlUsername, etlPassword, autoSync = true, syncInterval = 5, fetchFrom = '2026-01-01', syncEmployees = true } = req.body as { etlUsername: string; etlPassword: string; autoSync?: boolean; syncInterval?: number; fetchFrom?: string; syncEmployees?: boolean };
  if (!etlUsername || !etlPassword) { res.status(400).json({ message: 'etlUsername and etlPassword are required' }); return; }

  await prisma.device.update({ where: { id: req.params.id }, data: { etlUsername: etlUsername.trim(), etlPassword: encryptForStorage(etlPassword), autoSync, syncInterval } });

  const baseUrl = `http://${device.ip}:${device.port}`;
  const toDate = new Date().toISOString().split('T')[0];

  res.json({ success: true, message: `Credentials saved. Backfill from ${fetchFrom} running in background.`, autoSync, syncInterval });

  (async () => {
    if (syncEmployees) {
      try {
        const empResult = await fetchEmployeesFromETL(baseUrl, etlUsername, etlPassword);
        if (empResult.success) {
          let created = 0;
          for (const emp of empResult.employees) {
            const existing = await prisma.employee.findFirst({ where: { OR: [{ employeeId: emp.pin }, { devicePin: emp.pin }] } });
            if (!existing) {
              const email = `device.pin.${emp.pin}@device.local`;
              let user = await prisma.user.findUnique({ where: { email } });
              if (!user) {
                const { hash } = await import('bcryptjs');
                const tempPw = await hash(Math.random().toString(36), 10);
                user = await prisma.user.create({ data: { name: emp.name, email, passwordHash: tempPw, role: 'Employee', isEmailVerified: false } });
              } else if (user.name.startsWith('Employee ')) {
                await prisma.user.update({ where: { id: user.id }, data: { name: emp.name } });
              }
              const existingEmp = await prisma.employee.findUnique({ where: { userId: user.id } });
              if (!existingEmp) {
                await prisma.employee.create({ data: { userId: user.id, employeeId: emp.pin, department: emp.department || 'To Be Updated', designation: 'To Be Updated', joinDate: new Date(), isActive: true } });
                created++;
              }
            }
          }
          console.log(`[ConfigureETL] ${created} new employees created`);
        }
      } catch (e) { console.error('[ConfigureETL] Employee sync error:', (e as Error).message); }
    }
    try {
      const result = await fetchFromETimeTrackLite(baseUrl, etlUsername, etlPassword, fetchFrom, toDate);
      const fromDateObj = new Date(fetchFrom); fromDateObj.setHours(0, 0, 0, 0);
      const filtered = result.records.filter((record) => record.timestamp >= fromDateObj);
      const { count: newLogs } = await prisma.rawPunchLog.createMany({
        data: filtered.map((record) => ({ deviceId: device.id, employeeDeviceId: record.employeeDeviceId, timestamp: record.timestamp, punchType: record.punchType, raw: record.raw })),
        skipDuplicates: true,
      });
      if (newLogs > 0) await processAttendanceFromRaw(device.id, fromDateObj);
      await prisma.device.update({ where: { id: device.id }, data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null } });
      io.emit('attendance:update', { deviceId: device.id, synced: newLogs });
      console.log(`[ConfigureETL] Backfill: ${newLogs} new records`);
    } catch (e) {
      console.error('[ConfigureETL] Backfill error:', (e as Error).message);
      await prisma.device.update({ where: { id: device.id }, data: { lastError: (e as Error).message } });
    }
  })();
});

// ─── POST /api/devices/:id/sync-now ──────────────────────────────────────────
router.post('/:id/sync-now', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  let password: string | undefined;
  if (device.etlPassword) { try { password = decryptFromStorage(device.etlPassword); } catch { /* bad stored creds */ } }

  const baseUrl = `http://${device.ip}:${device.port}`;
  const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, device.lastEtlSync ?? undefined, device.etlUsername ?? undefined, password);

  if (!result.success && result.records.length === 0) { res.status(400).json({ message: result.message, logsImported: 0 }); return; }

  const cutoff = device.lastEtlSync
    ? new Date(device.lastEtlSync.getTime() - 2 * 60 * 60 * 1000)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const filtered = result.records.filter((record) => record.timestamp >= cutoff);
  const { count: newLogs } = await prisma.rawPunchLog.createMany({
    data: filtered.map((record) => ({ deviceId: device.id, employeeDeviceId: record.employeeDeviceId, timestamp: record.timestamp, punchType: record.punchType, raw: record.raw })),
    skipDuplicates: true,
  });
  if (newLogs > 0) await processAttendanceFromRaw(device.id);
  await prisma.device.update({ where: { id: device.id }, data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null } });
  io.emit('attendance:update', { deviceId: device.id, synced: newLogs });
  res.json({ success: true, message: `${result.message}. ${newLogs} new punch logs stored.`, logsImported: newLogs, total: result.records.length });
});

// ─── POST /api/devices/:id/fetch-from-etl ────────────────────────────────────
router.post('/:id/fetch-from-etl', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  const { fromDate, toDate, etlPassword, etlUsername: etlUsernameBody } = req.body as { fromDate: string; toDate?: string; etlPassword?: string; etlUsername?: string };
  if (!fromDate) { res.status(400).json({ message: 'fromDate is required (YYYY-MM-DD)' }); return; }

  const to = toDate || new Date().toISOString().split('T')[0];
  const baseUrl = `http://${device.ip}:${device.port}`;
  const etlUser = etlUsernameBody || device.etlUsername;
  if (!etlUser) { res.status(400).json({ message: 'Provide etlUsername or configure credentials via Configure button.' }); return; }

  let plainPassword = etlPassword || '';
  if (!plainPassword && device.etlPassword) {
    try { plainPassword = decryptFromStorage(device.etlPassword); }
    catch { res.status(500).json({ message: 'Stored credentials corrupted. Re-enter via Configure.' }); return; }
  }
  if (!plainPassword) { res.status(400).json({ message: 'Provide etlPassword or configure credentials via Configure button.' }); return; }

  const result = await fetchFromETimeTrackLite(baseUrl, etlUser, plainPassword, fromDate, to);
  if (!result.success) { res.status(400).json({ message: result.message, logsImported: 0 }); return; }

  const fromDateObj = new Date(fromDate); fromDateObj.setHours(0, 0, 0, 0);
  const filtered = result.records.filter((record) => record.timestamp >= fromDateObj);
  const { count: newLogs } = await prisma.rawPunchLog.createMany({
    data: filtered.map((record) => ({ deviceId: device.id, employeeDeviceId: record.employeeDeviceId, timestamp: record.timestamp, punchType: record.punchType, raw: record.raw })),
    skipDuplicates: true,
  });
  await processAttendanceFromRaw(device.id, fromDateObj);
  await prisma.device.update({ where: { id: device.id }, data: { status: 'Online', lastSync: new Date(), lastEtlSync: new Date(), lastError: null } });
  io.emit('attendance:update', { deviceId: device.id, synced: newLogs });
  res.json({ success: true, message: `${result.message}. ${newLogs} new records stored.`, logsImported: newLogs, total: result.records.length });
});

// ─── POST /api/devices/:id/manual-import ─────────────────────────────────────
router.post('/:id/manual-import', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ message: 'Device not found' }); return; }

  const { data, fromDate } = req.body as { data: string; fromDate?: string };
  if (!data || !data.trim()) {
    res.status(400).json({ message: 'data field is required with attendance log lines' }); return;
  }

  const records = parseManualAttendanceData(data);
  if (records.length === 0) {
    res.status(400).json({ message: 'No valid attendance records found in provided data. Expected format: PIN\\tDate Time\\tVerifyType\\tPunchType' });
    return;
  }

  const fromDateObj = fromDate ? new Date(fromDate) : undefined;
  if (fromDateObj) fromDateObj.setHours(0, 0, 0, 0);

  const filtered = fromDateObj ? records.filter((record) => record.timestamp >= fromDateObj) : records;
  const { count: newLogs } = await prisma.rawPunchLog.createMany({
    data: filtered.map((record) => ({ deviceId: device.id, employeeDeviceId: record.employeeDeviceId, timestamp: record.timestamp, punchType: record.punchType, raw: record.raw })),
    skipDuplicates: true,
  });
  await processAttendanceFromRaw(device.id, fromDateObj);
  await prisma.device.update({ where: { id: device.id }, data: { lastSync: new Date(), lastError: null } });
  io.emit('attendance:update', { deviceId: device.id, synced: newLogs });
  res.json({ success: true, message: `Import complete. ${newLogs} new records stored (${records.length} total parsed).`, logsImported: newLogs, parsed: records.length });
});

export default router;
