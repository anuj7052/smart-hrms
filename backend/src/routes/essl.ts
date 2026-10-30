/**
 * /api/essl — Backend acting as eSSL proxy for mobile app
 *
 * Mobile app's "Proxy URL" should be set to:
 *   https://smarthrms-backend-fggdhde8dvfheygd.centralindia-01.azurewebsites.net
 *   (no trailing /api — the app appends /api/essl/... itself)
 *
 * GET  /api/essl/config       → returns eSSL config from DB (requires auth)
 * POST /api/essl/test         → connectivity check
 * POST /api/essl/punches      → returns punch events from AttendanceLog
 * GET  /api/essl/live         → fetch punches DIRECTLY from device (no DB storage)
 * GET  /api/essl/live-devices → list devices available for live fetch
 */
import { Router, Request, Response } from 'express';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { requireDeviceOnlineHours } from '../utils/deviceHours';
import { prisma } from '../lib/prisma';
import { fetchFromETimeTrackLite, fetchFromIClockServerDirect, decryptFromStorage, encryptForStorage, pingEtlPortal } from '../services/etlService';
import { addEsslEmployee, editEsslEmployee, deleteEsslEmployee, uploadUserToDevice, getPortalPages } from '../services/esslEmployeeService';
import { todayISTDateOnly } from '../utils/dateIST';

const router = Router();

/**
 * Format a Date as the IST wall-clock string "YYYY-MM-DD HH:mm:ss".
 *
 * IMPORTANT: ESSL devices report IST wall-clock without timezone info; some
 * upstream parsers create a `Date` by treating that string as the server's
 * local time. To guarantee the value we return is always IST regardless of
 * server TZ, we format using `Intl` with the Asia/Kolkata zone.
 */
function toISTString(d: Date): string {
  // sv-SE yields "YYYY-MM-DD HH:mm:ss"-compatible output
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).replace('T', ' ');
}

type LiveDeviceRow = {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string;
  etlUsername: string | null;
  status: string;
  lastEtlSync: Date | null;
};

/**
 * Infer punch direction when the ESSL device reports all punches as punchType=0 (IN).
 * Decides PER employee+day group (not globally) whether the device differentiated
 * direction. When it didn't (all punches in that day share the same direction), the
 * direction is inferred from position within the day:
 *   • a single punch          → IN  (checked in, not yet out)
 *   • first punch of the day  → IN
 *   • last punch of the day   → OUT (a real checkout, even with an odd punch count)
 *   • middle punches          → alternate IN / OUT
 * Forcing the last punch to OUT fixes the long-standing bug where an odd number of
 * punches made a checkout show as a check-in (and vice-versa).
 */
function inferDirections(punches: Array<{ empCode: string; timestamp: string; direction: string }>): void {
  if (punches.length < 2) return;

  const groups = new Map<string, typeof punches>();
  for (const p of punches) {
    const date = p.timestamp.slice(0, 10);
    const key = `${p.empCode}-${date}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // If the device differentiated direction for this employee's day (mixed
    // in/out), trust it and don't override.
    const allSame = group.every(p => p.direction === group[0].direction);
    if (!allSame) continue;

    const n = group.length;
    if (n === 1) { group[0].direction = 'in'; continue; }
    // Mark the LAST punch of the day as 'out' and all preceding punches as
    // 'in'. This is more accurate than alternating (in/out/in/out) because
    // the actual last scan is the departure, and any intermediate scans are
    // either arrivals or returns from a break.
    for (let i = 0; i < n; i++) {
      group[i].direction = i === n - 1 ? 'out' : 'in';
    }
  }
}

// ─── GET /api/essl/config ─────────────────────────────────────────────────────
// Returns eSSL config stored in DB — mobile app loads this on login
// Password is NOT returned (set from backend/DB only)
router.get('/config', authenticateJWT, async (_req: Request, res: Response): Promise<void> => {
  let s = await prisma.appSettings.findFirst();
  if (!s) s = await prisma.appSettings.create({ data: {} });
  res.json({
    enabled:    (s as any).esslEnabled   ?? true,
    mode:       (s as any).esslMode      ?? 'session',
    proxyUrl:   (s as any).esslProxyUrl  ?? 'https://smarthrms-backend-fggdhde8dvfheygd.centralindia-01.azurewebsites.net',
    serverUrl:  (s as any).esslServerUrl ?? '',
    userName:   (s as any).esslUserName  ?? '',
    pollMs:     (s as any).esslPollMs    ?? 5000,
    // password intentionally omitted — stored in DB only
  });
});

// ─── POST /api/essl/test ──────────────────────────────────────────────────────
router.post('/test', async (_req: Request, res: Response): Promise<void> => {
  res.json({ ok: true, message: 'SmartHRMS backend connected successfully.' });
});

// ─── POST /api/essl/punches ───────────────────────────────────────────────────
// Body: { fromDate?: string, toDate?: string }
// Returns EsslPunch[] built from AttendanceLog records
router.post('/punches', async (req: Request, res: Response): Promise<void> => {
  try {
    const { fromDate, toDate } = req.body as { fromDate?: string; toDate?: string };

    const from = fromDate ? new Date(`${fromDate}T00:00:00.000Z`) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to   = toDate   ? new Date(`${toDate}T23:59:59.999Z`) : new Date();

    const logs = await prisma.attendanceLog.findMany({
      where: {
        date: { gte: from, lte: to },
        OR: [{ punchIn: { not: null } }, { punchOut: { not: null } }],
      },
      include: {
        employee: {
          select: {
            employeeId: true,
            user: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const punches: object[] = [];

    for (const log of logs) {
      const empCode = log.employee?.employeeId ?? log.employeeId;
      const empName = log.employee?.user?.name ?? empCode;

      if (log.punchIn) {
        const ts = log.punchIn instanceof Date ? log.punchIn : new Date(log.punchIn);
        punches.push({
          id: `${log.id}-in`,
          empCode,
          empName,
          timestamp: toISTString(ts),
          direction: 'in',
          deviceSerial: 'BACKEND',
        });
      }

      if (log.punchOut) {
        const ts = log.punchOut instanceof Date ? log.punchOut : new Date(log.punchOut);
        punches.push({
          id: `${log.id}-out`,
          empCode,
          empName,
          timestamp: toISTString(ts),
          direction: 'out',
          deviceSerial: 'BACKEND',
        });
      }
    }

    res.json({ ok: true, punches });
  } catch (err: any) {
    console.error('[essl] /punches error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
});

// Resolve employee names from device IDs (matches employeeId or devicePin)
async function resolveEmployeeNames(empCodes: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(empCodes)];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const employees = await prisma.employee.findMany({
    where: { OR: [{ employeeId: { in: unique } }, { devicePin: { in: unique } }] },
    select: { employeeId: true, devicePin: true, user: { select: { name: true } } },
  });
  for (const emp of employees) {
    if (emp.user?.name) {
      map.set(emp.employeeId, emp.user.name);
      if (emp.devicePin) map.set(emp.devicePin, emp.user.name);
    }
  }
  return map;
}

// ─── GET /api/essl/live-devices ───────────────────────────────────────────────
// Lists devices that have ETL credentials configured (usable for live fetch)
router.get('/live-devices', authenticateJWT, requireRole(['Admin', 'HR']), async (_req: AuthRequest, res: Response): Promise<void> => {
  const devices = await prisma.device.findMany({
    where: { isActive: true },
    select: { id: true, name: true, ip: true, port: true, serialNumber: true, etlUsername: true, status: true, lastEtlSync: true },
    orderBy: { name: 'asc' },
  }) as LiveDeviceRow[];
  res.json(devices.map((d) => ({
    ...d,
    hasCredentials: !!(d.etlUsername),
  })));
});

// ─── GET /api/essl/devices ────────────────────────────────────────────────────
// Admin: list all devices (Postgres-backed) with credential metadata.
// Used by the ESSL Control / Devices page.
router.get('/devices', authenticateJWT, requireRole(['Admin']), async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const devices = await prisma.device.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, ip: true, port: true, serialNumber: true,
        etlUsername: true, etlPassword: true, status: true, lastEtlSync: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json(devices.map((d) => ({
      id: d.id,
      name: d.name,
      ip: d.ip,
      port: d.port,
      serialNumber: d.serialNumber,
      etlUsername: d.etlUsername || '',
      etlPassword: d.etlPassword ? '••••••' : '',
      hasCredentials: !!(d.etlUsername && d.etlPassword),
      status: d.status || 'Unknown',
    })));
  } catch (err: any) {
    res.status(500).json({ message: err?.message || 'Failed to load devices' });
  }
});

// ─── POST /api/essl/devices ───────────────────────────────────────────────────
// Admin: add a new device
router.post('/devices', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, ip, port, serialNumber, etlUsername, etlPassword } = req.body as {
      name?: string; ip?: string; port?: number | string;
      serialNumber?: string; etlUsername?: string; etlPassword?: string;
    };
    if (!name || !ip) {
      res.status(400).json({ message: 'name and ip are required' });
      return;
    }
    const serial = (serialNumber || '').trim() || `LOCAL-${Date.now()}`;
    const device = await prisma.device.create({
      data: {
        name,
        ip,
        port: Number(port) || 85,
        serialNumber: serial,
        username: '',
        passwordHash: '',
        etlUsername: etlUsername || null,
        etlPassword: etlPassword ? encryptForStorage(etlPassword) : null,
        status: 'Unknown',
        isActive: true,
      },
    });
    res.status(201).json({
      message: 'Device added',
      device: {
        id: device.id, name: device.name, ip: device.ip, port: device.port,
        serialNumber: device.serialNumber, etlUsername: device.etlUsername || '',
        hasCredentials: !!(device.etlUsername && device.etlPassword), status: device.status,
      },
    });
  } catch (err: any) {
    const msg = err?.code === 'P2002' ? 'Serial number already exists' : (err?.message || 'Failed to add device');
    res.status(400).json({ message: msg });
  }
});

// ─── PUT /api/essl/devices/:id ────────────────────────────────────────────────
// Admin: update a device. Empty/masked etlPassword leaves it unchanged.
router.put('/devices/:id', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, ip, port, serialNumber, etlUsername, etlPassword } = req.body as {
      name?: string; ip?: string; port?: number | string;
      serialNumber?: string; etlUsername?: string; etlPassword?: string;
    };
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (ip !== undefined) data.ip = ip;
    if (port !== undefined) data.port = Number(port);
    if (serialNumber !== undefined && serialNumber.trim()) data.serialNumber = serialNumber.trim();
    if (etlUsername !== undefined) data.etlUsername = etlUsername || null;
    if (etlPassword && etlPassword !== '••••••') {
      data.etlPassword = encryptForStorage(etlPassword);
    }
    const updated = await prisma.device.update({ where: { id: req.params.id }, data });
    res.json({
      message: 'Device updated',
      device: {
        id: updated.id, name: updated.name, ip: updated.ip, port: updated.port,
        serialNumber: updated.serialNumber, etlUsername: updated.etlUsername || '',
        hasCredentials: !!(updated.etlUsername && updated.etlPassword), status: updated.status,
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ message: 'Device not found' }); return; }
    const msg = err?.code === 'P2002' ? 'Serial number already exists' : (err?.message || 'Failed to update device');
    res.status(400).json({ message: msg });
  }
});

// ─── DELETE /api/essl/devices/:id ────────────────────────────────────────────
// Admin: soft-delete (mark inactive) to preserve attendance history FK refs.
router.delete('/devices/:id', authenticateJWT, requireRole(['Admin']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.device.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Device removed' });
  } catch (err: any) {
    if (err?.code === 'P2025') { res.status(404).json({ message: 'Device not found' }); return; }
    res.status(500).json({ message: err?.message || 'Failed to delete device' });
  }
});

// ─── POST /api/essl/devices/:id/test ─────────────────────────────────────────
// Test connection to the device portal using stored credentials.
// Lightweight: performs ONLY the login handshake (no slow Excel report export),
// so it reflects reachability + credential validity quickly.
router.post('/devices/:id/test', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findUnique({ where: { id: req.params.id } });
  if (!device) { res.status(404).json({ ok: false, message: 'Device not found' }); return; }
  if (!device.etlUsername || !device.etlPassword) {
    res.json({ ok: false, reachable: false, message: 'No credentials configured for this device' });
    return;
  }
  const baseUrl = `http://${device.ip}:${device.port}`;
  try {
    const password = decryptFromStorage(device.etlPassword);
    const result = await pingEtlPortal(baseUrl, device.etlUsername, password);
    const newStatus = result.ok ? 'Online' : 'Offline';
    await prisma.device.update({ where: { id: device.id }, data: { status: newStatus } });
    res.json({
      ok: result.ok,
      reachable: result.reachable,
      message: result.ok ? `Connected to ${device.name} — login successful` : result.message,
    });
  } catch (err: any) {
    await prisma.device.update({ where: { id: device.id }, data: { status: 'Offline' } }).catch(() => {});
    res.json({ ok: false, reachable: false, message: err?.message || 'Connection failed' });
  }
});

// ─── GET /api/essl/live ───────────────────────────────────────────────────────
// Fetches attendance punches DIRECTLY from the ESSL device — data is NOT stored.
// Query params: deviceId (required), fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD)
router.get('/live', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const { deviceId, fromDate, toDate } = req.query as { deviceId?: string; fromDate?: string; toDate?: string };

  if (!deviceId) {
    res.status(400).json({ ok: false, error: 'deviceId is required' });
    return;
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || !device.isActive) {
    res.status(404).json({ ok: false, error: 'Device not found or inactive' });
    return;
  }

  const from = fromDate || todayISTDateOnly().toISOString().slice(0, 10);
  const to   = toDate   || todayISTDateOnly().toISOString().slice(0, 10);

  // Build base URL from device IP + port
  const baseUrl = `http://${device.ip}:${device.port}`;

  try {
    // Strategy 1 (PRIMARY): PostgreSQL rawPunchLog.
    // This is the fast, reliable source. The cron sync (cronService.syncEtlDevice)
    // already pulls every captured punch from the device into rawPunchLog every
    // minute, so the DB is normally current. Querying it first keeps the Live
    // page snappy — the previous order hit two slow on-prem network scrapes
    // (eTimeTrackLite Excel export + iClock REST/portal), each up to a 60s
    // timeout against a flaky device, before falling back here. That is what
    // made the page take a long time to load.
    const dbFrom = new Date(`${from}T00:00:00.000+05:30`);
    const dbTo   = new Date(`${to}T23:59:59.999+05:30`);
    const dbLogs = await prisma.rawPunchLog.findMany({
      where: { deviceId: device.id, timestamp: { gte: dbFrom, lte: dbTo } },
      orderBy: { timestamp: 'asc' },
    });
    if (dbLogs.length > 0) {
      const nameMap = await resolveEmployeeNames(dbLogs.map((l) => l.employeeDeviceId));
      const punches = dbLogs.map((l) => ({
        id: l.id,
        empCode: l.employeeDeviceId,
        empName: nameMap.get(l.employeeDeviceId) || l.employeeDeviceId,
        timestamp: toISTString(l.timestamp),
        direction: (l.punchType === 1 ? 'out' : 'in') as 'in' | 'out',
        deviceSerial: device.serialNumber,
        deviceName: device.name,
      }));
      inferDirections(punches);
      res.json({ ok: true, punches, source: 'postgres', deviceName: device.name, count: punches.length });
      return;
    }

    // ─── Live device fallbacks (slow — only when the DB has nothing in range) ──
    // Strategy 2: eTimeTrackLite web portal (ETL credentials)
    if (device.etlUsername && (device as any).etlPassword) {
      let plainPw: string;
      try {
        plainPw = decryptFromStorage((device as any).etlPassword);
      } catch {
        res.status(500).json({ ok: false, error: 'Failed to decrypt device credentials' });
        return;
      }
      const result = await fetchFromETimeTrackLite(baseUrl, device.etlUsername, plainPw, from, to);
      // Only return the ETL result when it actually yielded punches in range.
      // The eTimeTrackLite report DB can lag behind the live device buffer, so
      // when it has no rows for the requested range we fall through to the
      // iClock-direct device buffer (same source the cron sync uses) below.
      if (result.success && result.records.length > 0) {
        const nameMap = await resolveEmployeeNames(result.records.map((r) => r.employeeDeviceId));
        const punches = result.records.map((r) => ({
          id: `${r.employeeDeviceId}-${r.timestamp.toISOString()}`,
          empCode: r.employeeDeviceId,
          empName: nameMap.get(r.employeeDeviceId) || r.employeeDeviceId,
          timestamp: toISTString(r.timestamp),
          direction: r.punchType === 1 ? 'out' : 'in',
          deviceSerial: device.serialNumber,
          deviceName: device.name,
        }));
        inferDirections(punches);
        res.json({ ok: true, punches, source: 'etl', deviceName: device.name, count: punches.length });
        return;
      }
    }

    // Strategy 3: iClock direct (REST API or ADMS pull protocol)
    let icPassword: string | undefined;
    if ((device as any).passwordHash) {
      try { icPassword = decryptFromStorage((device as any).passwordHash); } catch { /* not stored as AES */ }
    }
    const result2 = await fetchFromIClockServerDirect(
      baseUrl,
      device.serialNumber,
      undefined,
      device.etlUsername || device.username || undefined,
      icPassword,
    );
    if (result2.success && result2.records.length > 0) {
      const dateFrom = new Date(`${from}T00:00:00`);
      const dateTo   = new Date(`${to}T23:59:59`);
      const filtered = result2.records.filter((r) => r.timestamp >= dateFrom && r.timestamp <= dateTo);
      const nameMap = await resolveEmployeeNames(filtered.map((r) => r.employeeDeviceId));
      const punches = filtered.map((r) => ({
        id: `${r.employeeDeviceId}-${r.timestamp.toISOString()}`,
        empCode: r.employeeDeviceId,
        empName: nameMap.get(r.employeeDeviceId) || r.employeeDeviceId,
        timestamp: toISTString(r.timestamp),
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
    console.error('[essl] /live error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Failed to fetch from device' });
  }
});

// ─── GET /api/essl/db-punches ─────────────────────────────────────────────────
// Returns punch events from rawPunchLog (Postgres) — same shape as /live
// Query params: deviceId (optional), fromDate (YYYY-MM-DD), toDate (YYYY-MM-DD)
router.get('/db-punches', authenticateJWT, requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { deviceId, fromDate, toDate } = req.query as { deviceId?: string; fromDate?: string; toDate?: string };

    // Use IST (UTC+5:30) for date boundaries
    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = new Date(`${fromDate || todayIST}T00:00:00.000+05:30`);
    const to   = new Date(`${toDate || todayIST}T23:59:59.999+05:30`);

    const where: any = { timestamp: { gte: from, lte: to } };
    if (deviceId) where.deviceId = deviceId;

    const logs = await prisma.rawPunchLog.findMany({
      where,
      include: { device: { select: { name: true, serialNumber: true } } },
      orderBy: { timestamp: 'asc' },
    });

    // Resolve employee names from Employee table (employeeDeviceId → employeeId or devicePin)
    const empCodes = [...new Set(logs.map((l) => l.employeeDeviceId))];
    const employees = await prisma.employee.findMany({
      where: { OR: [{ employeeId: { in: empCodes } }, { devicePin: { in: empCodes } }] },
      select: { employeeId: true, devicePin: true, user: { select: { name: true } } },
    });
    const nameMap = new Map<string, string>();
    for (const emp of employees) {
      if (emp.user?.name) {
        nameMap.set(emp.employeeId, emp.user.name);
        if (emp.devicePin) nameMap.set(emp.devicePin, emp.user.name);
      }
    }

    const punches = logs.map((l) => {
      return {
        id: l.id,
        empCode: l.employeeDeviceId,
        empName: nameMap.get(l.employeeDeviceId) || l.employeeDeviceId,
        timestamp: toISTString(l.timestamp),
        direction: l.punchType === 1 ? 'out' as const : 'in' as const,
        deviceSerial: l.device.serialNumber,
        deviceName: l.device.name,
      };
    });
    inferDirections(punches as any);

    res.json({ ok: true, punches, source: 'postgres', count: punches.length });
  } catch (err: any) {
    console.error('[essl] /db-punches error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
});

// ─── GET /api/essl/employee-punches/:empCode ─────────────────────────────────
// Returns punch events for a specific employee by their device code (e.g. FCS001)
router.get('/employee-punches/:empCode', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { empCode } = req.params;
    const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };

    const todayIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const from = new Date(`${fromDate || todayIST}T00:00:00.000+05:30`);
    const to   = new Date(`${toDate || todayIST}T23:59:59.999+05:30`);

    const logs = await prisma.rawPunchLog.findMany({
      where: {
        employeeDeviceId: { equals: empCode, mode: 'insensitive' },
        timestamp: { gte: from, lte: to },
      },
      include: { device: { select: { name: true, serialNumber: true } } },
      orderBy: { timestamp: 'asc' },
    });

    // Resolve employee name
    const employee = await prisma.employee.findFirst({
      where: { OR: [{ employeeId: empCode }, { devicePin: empCode }] },
      select: { user: { select: { name: true } } },
    });
    const empName = employee?.user?.name || empCode;

    const punches = logs.map((l) => ({
      id: l.id,
      empCode: l.employeeDeviceId,
      empName,
      timestamp: toISTString(l.timestamp),
      direction: l.punchType === 1 ? 'out' as const : 'in' as const,
      deviceSerial: l.device.serialNumber,
      deviceName: l.device.name,
    }));
    inferDirections(punches as any);

    res.json({ ok: true, punches, count: punches.length });
  } catch (err: any) {
    console.error('[essl] /employee-punches error:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Internal server error' });
  }
});

// ─── GET /api/essl/portal-pages ────────────────────────────────────────────────
// Get all available portal page URLs for iframe embedding
router.get('/portal-pages', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (_req: AuthRequest, res: Response): Promise<void> => {
  const device = await prisma.device.findFirst({ where: { isActive: true } });
  if (!device) { res.json({ ok: false, pages: {}, message: 'No devices configured' }); return; }
  const baseUrl = `http://${device.ip}:${device.port}`;
  res.json({ ok: true, pages: getPortalPages(baseUrl), baseUrl });
});

// ─── GET /api/essl/machine/employees ──────────────────────────────────────────
// Returns employees registered on devices (from rawPunchLog distinct employeeDeviceIds)
// Enriched with Employee table data (name, department, designation, etc.)
router.get('/machine/employees', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const devices = await prisma.device.findMany({ where: { isActive: true }, select: { id: true, name: true, serialNumber: true } });
    const logs = await prisma.rawPunchLog.findMany({ distinct: ['employeeDeviceId'], select: { employeeDeviceId: true, deviceId: true } });

    // Resolve employee details from Employee table
    const empCodes = logs.map((l) => l.employeeDeviceId);
    const dbEmployees = await prisma.employee.findMany({
      where: { OR: [{ employeeId: { in: empCodes } }, { devicePin: { in: empCodes } }] },
      include: { user: { select: { name: true } } },
    });

    // Build lookup: deviceId/pin → employee record
    const empMap = new Map<string, typeof dbEmployees[number]>();
    for (const emp of dbEmployees) {
      empMap.set(emp.employeeId, emp);
      if (emp.devicePin) empMap.set(emp.devicePin, emp);
    }

    const employees = logs.map((l) => {
      const dev = devices.find((d) => d.id === l.deviceId);
      const emp = empMap.get(l.employeeDeviceId);
      return {
        empCode: l.employeeDeviceId,
        name: emp?.user?.name || l.employeeDeviceId,
        department: emp?.department || '',
        designation: emp?.designation || '',
        company: '',
        category: '',
        status: emp ? (emp.isActive ? 'Active' : 'Inactive') : 'Unknown',
        joiningDate: emp?.joinDate ? emp.joinDate.toISOString().slice(0, 10) : '',
        cardNo: emp?.devicePin || '',
        deviceGroup: dev?.name || 'Unknown',
      };
    });
    res.json({ ok: true, employees, message: `${employees.length} machine employees found` });
  } catch (err: any) {
    res.status(500).json({ ok: false, employees: [], message: err?.message || 'Failed to fetch machine employees' });
  }
});

// ─── GET /api/essl/machine/devices ────────────────────────────────────────────
// List devices from Postgres
router.get('/machine/devices', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const devices = await prisma.device.findMany({
      where: { isActive: true },
      select: { id: true, name: true, ip: true, port: true, serialNumber: true, status: true, lastSync: true },
    });
    const result = devices.map((d) => ({
      serialNumber: d.serialNumber,
      name: d.name,
      ip: d.ip,
      lastActivity: d.lastSync?.toISOString() || '',
      status: d.status || 'Unknown',
      type: 'Biometric',
      totalUsers: '-',
      totalFP: '-',
      totalFace: '-',
    }));
    res.json({ ok: true, devices: result, message: `${result.length} device(s) found` });
  } catch (err: any) {
    res.status(500).json({ ok: false, devices: [], message: err?.message || 'Failed to fetch devices' });
  }
});

// ─── GET /api/essl/machine/departments ────────────────────────────────────────
// List departments from Postgres employees
router.get('/machine/departments', authenticateJWT, requireRole(['Admin', 'HR']), requireDeviceOnlineHours, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const emps = await prisma.employee.findMany({
      where: { isActive: true },
      select: { department: true },
      distinct: ['department'],
    });
    const departments = emps.map((e) => ({ name: e.department }));
    res.json({ ok: true, departments, message: `${departments.length} department(s) found` });
  } catch (err: any) {
    res.status(500).json({ ok: false, departments: [], message: err?.message || 'Failed to fetch departments' });
  }
});

// ─── Helper: get first active device with ETL credentials ────────────────────
async function getDeviceWithCreds() {
  const device = await prisma.device.findFirst({ where: { isActive: true, etlUsername: { not: null } } });
  if (!device || !device.etlUsername || !device.etlPassword) return null;
  const password = decryptFromStorage(device.etlPassword!);
  return { baseUrl: `http://${device.ip}:${device.port}`, username: device.etlUsername, password };
}

// ─── POST /api/essl/machine/employees ─────────────────────────────────────────
router.post('/machine/employees', authenticateJWT, requireRole(['Admin']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode, firstName, lastName, department, cardNo } = req.body;
  if (!empCode || !firstName) {
    res.status(400).json({ ok: false, message: 'empCode and firstName are required' });
    return;
  }
  const creds = await getDeviceWithCreds();
  if (!creds) { res.json({ ok: false, message: 'No device with credentials configured' }); return; }
  const result = await addEsslEmployee(creds.baseUrl, creds.username, creds.password, { empCode, firstName, lastName, department, cardNo });
  res.json({ ok: result.success, ...result });
});

// ─── PUT /api/essl/machine/employees/:empCode ────────────────────────────────
router.put('/machine/employees/:empCode', authenticateJWT, requireRole(['Admin']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const { firstName, lastName, department, cardNo } = req.body;
  if (!firstName) {
    res.status(400).json({ ok: false, message: 'firstName is required' });
    return;
  }
  const creds = await getDeviceWithCreds();
  if (!creds) { res.json({ ok: false, message: 'No device with credentials configured' }); return; }
  const result = await editEsslEmployee(creds.baseUrl, creds.username, creds.password, empCode, { firstName, lastName, department, cardNo });
  res.json({ ok: result.success, ...result });
});

// ─── DELETE /api/essl/machine/employees/:empCode ──────────────────────────────
router.delete('/machine/employees/:empCode', authenticateJWT, requireRole(['Admin']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const creds = await getDeviceWithCreds();
  if (!creds) { res.json({ ok: false, message: 'No device with credentials configured' }); return; }
  const result = await deleteEsslEmployee(creds.baseUrl, creds.username, creds.password, empCode);
  res.json({ ok: result.success, ...result });
});

// ─── POST /api/essl/machine/employees/:empCode/upload ─────────────────────────
router.post('/machine/employees/:empCode/upload', authenticateJWT, requireRole(['Admin']), requireDeviceOnlineHours, async (req: AuthRequest, res: Response): Promise<void> => {
  const { empCode } = req.params;
  const creds = await getDeviceWithCreds();
  if (!creds) { res.json({ ok: false, message: 'No device with credentials configured' }); return; }
  const result = await uploadUserToDevice(creds.baseUrl, creds.username, creds.password, empCode);
  res.json({ ok: result.success, ...result });
});

// ─── POST /api/essl/historical-sync ──────────────────────────────────────────
// Fetches punch data from the ESSL device for a date range, stores it in
// rawPunchLog, and processes it into attendanceLog (punchIn / punchOut).
// Body: { fromDate: "YYYY-MM-DD", toDate?: "YYYY-MM-DD" }
router.post('/historical-sync', authenticateJWT, requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fromDate, toDate } = req.body as { fromDate?: string; toDate?: string };

    if (!fromDate) {
      res.status(400).json({ ok: false, message: 'fromDate is required' });
      return;
    }

    const from = new Date(`${fromDate}T00:00:00.000+05:30`);
    if (isNaN(from.getTime())) {
      res.status(400).json({ ok: false, message: 'Invalid fromDate' });
      return;
    }

    const devices = await prisma.device.findMany({ where: { isActive: true } });
    if (devices.length === 0) {
      res.status(404).json({ ok: false, message: 'No active devices found' });
      return;
    }

    let totalNew = 0;
    const results: { device: string; logsImported: number; message: string }[] = [];

    for (const device of devices) {
      let password: string | undefined;
      if (device.etlPassword) {
        try { password = decryptFromStorage(device.etlPassword); } catch { /* */ }
      }
      const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
      if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
      const baseUrl = `http://${device.ip}:${device.port}`;

      try {
        const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, from, username, password);
        const { count: newLogs } = await prisma.rawPunchLog.createMany({
          data: result.records.map((r) => ({
            deviceId: device.id,
            employeeDeviceId: r.employeeDeviceId,
            timestamp: r.timestamp,
            punchType: r.punchType,
            raw: r.raw,
          })),
          skipDuplicates: true,
        });
        // Always reprocess from the requested start date so punchIn/punchOut
        // are correctly set for every day in the range — including days that
        // already had records but lacked a check-out time.
        await (await import('../services/esslService')).processAttendanceFromRaw(device.id, from);
        await prisma.device.update({
          where: { id: device.id },
          data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null },
        }).catch(() => {});
        totalNew += newLogs;
        results.push({ device: device.name, logsImported: newLogs, message: result.message });
      } catch (e) {
        results.push({ device: device.name, logsImported: 0, message: (e as Error).message });
      }
    }

    res.json({
      ok: true,
      message: totalNew > 0
        ? `Historical sync from ${fromDate}: ${totalNew} new punch(es) imported and attendance updated.`
        : `Historical sync from ${fromDate}: No new punches found, but attendance has been reprocessed.`,
      totalLogsImported: totalNew,
      devices: results,
    });
  } catch (err: any) {
    console.error('[essl] /historical-sync error:', err);
    res.status(500).json({ ok: false, message: err?.message || 'Internal server error' });
  }
});

export default router;
