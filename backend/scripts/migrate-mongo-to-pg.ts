/**
 * One-time migration script: MongoDB → PostgreSQL
 *
 * Reads data from your local/cloud MongoDB and inserts it into PostgreSQL via Prisma.
 * Run AFTER `npx prisma migrate deploy` has created the tables.
 *
 * Usage:
 *   1. Set MONGODB_URI to the source MongoDB
 *   2. Set DATABASE_URL to the target PostgreSQL
 *   3. npx ts-node scripts/migrate-mongo-to-pg.ts
 *
 * The script preserves Mongo ObjectIds as String IDs in PostgreSQL so all relations stay intact.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const idMap = new Map<string, string>(); // mongoId -> pgId (we just keep the same string)

const toId = (oid: unknown): string => {
  if (!oid) return '';
  const s = String(oid);
  if (!idMap.has(s)) idMap.set(s, s);
  return idMap.get(s)!;
};

async function migrate() {
  const MONGO = process.env.MONGODB_URI;
  if (!MONGO) throw new Error('MONGODB_URI not set');

  await mongoose.connect(MONGO);
  console.log('[Migrate] Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) throw new Error('No MongoDB DB handle');

  // 1. Users
  const users = await db.collection('users').find({}).toArray();
  console.log(`[Migrate] Users: ${users.length}`);
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: toId(u._id) },
      update: {},
      create: {
        id: toId(u._id),
        name: u.name,
        email: u.email,
        passwordHash: u.passwordHash || '',
        role: (u.role || 'Employee') as 'Admin' | 'HR' | 'Manager' | 'Employee',
        department: u.department,
        isEmailVerified: u.isEmailVerified ?? false,
        emailVerificationToken: u.emailVerificationToken,
        emailVerificationExpiry: u.emailVerificationExpiry,
        passwordResetToken: u.passwordResetToken,
        passwordResetExpiry: u.passwordResetExpiry,
        refreshToken: u.refreshToken,
        createdAt: u.createdAt || new Date(),
        updatedAt: u.updatedAt || new Date(),
      },
    });
  }

  // 2. Shifts (before Employees because Employee references Shift)
  const shifts = await db.collection('shifts').find({}).toArray();
  console.log(`[Migrate] Shifts: ${shifts.length}`);
  for (const s of shifts) {
    await prisma.shift.upsert({
      where: { id: toId(s._id) },
      update: {},
      create: {
        id: toId(s._id),
        name: s.name,
        startTime: s.startTime || '09:00',
        endTime: s.endTime || '18:00',
        gracePeriodMinutes: s.gracePeriodMinutes ?? 15,
        halfDayThresholdHours: s.halfDayThresholdHours ?? 4,
        isActive: s.isActive ?? true,
      },
    });
  }

  // 3. Employees
  const employees = await db.collection('employees').find({}).toArray();
  console.log(`[Migrate] Employees: ${employees.length}`);
  for (const e of employees) {
    await prisma.employee.upsert({
      where: { id: toId(e._id) },
      update: {},
      create: {
        id: toId(e._id),
        userId: toId(e.userId),
        employeeId: e.employeeId,
        department: e.department || 'Unassigned',
        designation: e.designation || 'Unassigned',
        shift: e.shift || 'General',
        shiftId: e.shiftId ? toId(e.shiftId) : null,
        joinDate: e.joinDate || new Date(),
        phone: e.phone,
        address: e.address,
        emergencyContact: e.emergencyContact,
        devicePin: e.devicePin,
        isActive: e.isActive ?? true,
      },
    });
  }

  // 4. Devices
  const devices = await db.collection('devices').find({}).toArray();
  console.log(`[Migrate] Devices: ${devices.length}`);
  for (const d of devices) {
    await prisma.device.upsert({
      where: { id: toId(d._id) },
      update: {},
      create: {
        id: toId(d._id),
        name: d.name,
        ip: d.ip,
        port: d.port || 80,
        serialNumber: d.serialNumber,
        username: d.username,
        passwordHash: d.passwordHash || '',
        etlUsername: d.etlUsername,
        etlPassword: d.etlPassword,
        autoSync: d.autoSync ?? false,
        syncInterval: d.syncInterval ?? 5,
        lastEtlSync: d.lastEtlSync,
        status: (d.status || 'Unknown') as 'Online' | 'Offline' | 'Unknown',
        lastSync: d.lastSync,
        lastError: d.lastError,
        isActive: d.isActive ?? true,
      },
    });
  }

  // 5. AttendanceLogs — batch insert, skip already migrated
  const logs = await db.collection('attendancelogs').find({}).toArray();
  console.log(`[Migrate] AttendanceLogs: ${logs.length}`);
  const LOG_BATCH = 200;
  let logInserted = 0;
  for (let i = 0; i < logs.length; i += LOG_BATCH) {
    const batch = logs.slice(i, i + LOG_BATCH);
    const data = batch.map(l => ({
      id: toId(l._id),
      employeeId: toId(l.employeeId),
      date: l.date,
      punchIn: l.punchIn ?? null,
      punchOut: l.punchOut ?? null,
      workHours: l.workHours ?? null,
      status: (l.status || 'Absent') as 'Present' | 'Absent' | 'Late' | 'HalfDay' | 'Leave' | 'Holiday' | 'WeeklyOff',
      attendanceMode: (l.attendanceMode ?? null) as 'Office' | 'WFH' | 'Field' | 'ClientVisit' | null,
      punchInLat: l.punchInLocation?.lat ?? null,
      punchInLng: l.punchInLocation?.lng ?? null,
      punchOutLat: l.punchOutLocation?.lat ?? null,
      punchOutLng: l.punchOutLocation?.lng ?? null,
      appPunched: l.appPunched ?? false,
      source: l.source || 'device',
      isRegularized: l.isRegularized ?? false,
      regularizationReason: l.regularizationReason ?? null,
      regularizationStatus: (l.regularizationStatus ?? null) as 'Pending' | 'Approved' | 'Rejected' | null,
      regularizationRequestedAt: l.regularizationRequestedAt ?? null,
      deviceId: l.deviceId ? toId(l.deviceId) : null,
    }));
    const result = await prisma.attendanceLog.createMany({ data, skipDuplicates: true });
    logInserted += result.count;
    if ((i + LOG_BATCH) % 1000 === 0 || i + LOG_BATCH >= logs.length) {
      console.log(`[Migrate] AttendanceLogs: ${Math.min(i + LOG_BATCH, logs.length)}/${logs.length} processed, ${logInserted} inserted`);
    }
  }

  // 6. RawPunchLogs — batch insert
  const punches = await db.collection('rawpunchlogs').find({}).toArray();
  console.log(`[Migrate] RawPunchLogs: ${punches.length}`);
  const PUNCH_BATCH = 200;
  let punchInserted = 0;
  for (let i = 0; i < punches.length; i += PUNCH_BATCH) {
    const batch = punches.slice(i, i + PUNCH_BATCH);
    const data = batch.map(p => ({
      id: toId(p._id),
      deviceId: toId(p.deviceId),
      employeeDeviceId: p.employeeDeviceId,
      timestamp: p.timestamp,
      punchType: p.punchType ?? 0,
      raw: p.raw ?? null,
    }));
    const result = await prisma.rawPunchLog.createMany({ data, skipDuplicates: true });
    punchInserted += result.count;
    if ((i + PUNCH_BATCH) % 1000 === 0 || i + PUNCH_BATCH >= punches.length) {
      console.log(`[Migrate] RawPunchLogs: ${Math.min(i + PUNCH_BATCH, punches.length)}/${punches.length} processed, ${punchInserted} inserted`);
    }
  }

  // 7. Leaves
  const leaveTypes = await db.collection('leavetypes').find({}).toArray();
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { id: toId(lt._id) },
      update: {},
      create: {
        id: toId(lt._id),
        name: lt.name,
        daysAllowed: lt.daysAllowed,
        description: lt.description,
        isActive: lt.isActive ?? true,
      },
    });
  }

  const balances = await db.collection('leavebalances').find({}).toArray();
  for (const b of balances) {
    await prisma.leaveBalance.upsert({
      where: { id: toId(b._id) },
      update: {},
      create: {
        id: toId(b._id),
        employeeId: toId(b.employeeId),
        leaveTypeId: toId(b.leaveTypeId),
        year: b.year,
        allocated: b.allocated || 0,
        used: b.used || 0,
        remaining: b.remaining || 0,
      },
    });
  }

  const requests = await db.collection('leaverequests').find({}).toArray();
  for (const r of requests) {
    await prisma.leaveRequest.upsert({
      where: { id: toId(r._id) },
      update: {},
      create: {
        id: toId(r._id),
        employeeId: toId(r.employeeId),
        leaveTypeId: toId(r.leaveTypeId),
        fromDate: r.fromDate,
        toDate: r.toDate,
        totalDays: r.totalDays,
        reason: r.reason,
        status: (r.status || 'Pending') as 'Pending' | 'Approved' | 'Rejected' | 'Cancelled',
        reviewedById: r.reviewedBy ? toId(r.reviewedBy) : null,
        reviewedAt: r.reviewedAt,
        reviewComment: r.reviewComment,
      },
    });
  }

  // 8. WFH Requests
  const wfh = await db.collection('wfhrequests').find({}).toArray();
  for (const w of wfh) {
    await prisma.wFHRequest.upsert({
      where: { id: toId(w._id) },
      update: {},
      create: {
        id: toId(w._id),
        employeeId: toId(w.employeeId),
        date: w.date,
        mode: w.mode as 'WFH' | 'Field' | 'ClientVisit',
        reason: w.reason,
        status: (w.status || 'Pending') as 'Pending' | 'Approved' | 'Rejected',
        reviewedById: w.reviewedBy ? toId(w.reviewedBy) : null,
        reviewedAt: w.reviewedAt,
        reviewComment: w.reviewComment,
      },
    });
  }

  // 9. AppSettings (single row)
  const settings = await db.collection('appsettings').findOne({});
  if (settings) {
    await prisma.appSettings.upsert({
      where: { id: toId(settings._id) },
      update: {},
      create: {
        id: toId(settings._id),
        allowedEmailDomains: settings.allowedEmailDomains || [],
        shiftStart: settings.shiftStart || '09:00',
        shiftEnd: settings.shiftEnd || '18:00',
        lateThresholdMinutes: settings.lateThresholdMinutes ?? 15,
        halfDayThresholdHours: settings.halfDayThresholdHours ?? 4,
        workingDays: settings.workingDays || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        holidays: settings.holidays || [],
        smtpHost: settings.smtpHost || '',
        smtpPort: settings.smtpPort ?? 587,
        smtpUser: settings.smtpUser || '',
        smtpPass: settings.smtpPass || '',
        smtpFrom: settings.smtpFrom || '',
        emailNotificationsEnabled: settings.emailNotificationsEnabled ?? false,
      },
    });
  }

  await mongoose.disconnect();
  await prisma.$disconnect();
  console.log('\n[Migrate] ✓ All collections migrated successfully');
}

migrate().catch((err) => {
  console.error('[Migrate] Failed:', err);
  process.exit(1);
});
