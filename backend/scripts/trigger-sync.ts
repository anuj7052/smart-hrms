/**
 * One-shot script: fetch from ESSL portal and persist to DB.
 * Mirrors the cron sync logic for the Foetron ESSL device.
 */
import { PrismaClient } from '@prisma/client';
import { fetchFromIClockServerDirect, decryptFromStorage } from '../src/services/etlService';
import { processAttendanceFromRaw } from '../src/services/esslService';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const IST_MS = 330 * 60 * 1000;

(async () => {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.error('Device not found'); process.exit(1); }
  console.log(`Device: ${device.name} (id=${device.id})`);

  // Anchor fetch to latest punch in DB (same logic as cron)
  const latestPunch = await prisma.rawPunchLog.findFirst({
    where: { deviceId: device.id },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const effectiveLastSync = latestPunch?.timestamp
    ? new Date(Math.max(latestPunch.timestamp.getTime(), startOfMonth.getTime()))
    : null;

  console.log(`Latest punch in DB: ${latestPunch?.timestamp?.toISOString() ?? 'NONE'}`);
  console.log(`Fetch anchor:       ${effectiveLastSync?.toISOString() ?? 'start of month'}`);

  const baseUrl = `http://${device.ip}:${device.port}`;
  const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? '';
  const password = device.etlPassword ? decryptFromStorage(device.etlPassword) : (process.env.ESSL_ETL_PASSWORD ?? '');

  console.log('\nFetching from portal...');
  const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, effectiveLastSync ?? undefined, username, password);
  console.log(`Fetch result: ${result.success ? '✅' : '❌'} ${result.message}`);
  console.log(`Total records: ${result.records.length}`);

  if (result.records.length > 0) {
    const grouped: Record<string, number> = {};
    result.records.forEach(r => {
      const k = new Date(r.timestamp.getTime() + IST_MS).toISOString().split('T')[0];
      grouped[k] = (grouped[k] || 0) + 1;
    });
    console.log('By IST date:', JSON.stringify(grouped));
  }

  if (!result.success && result.records.length === 0) {
    console.error('Nothing to sync. Aborting.');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\nWriting raw punch logs to DB...');
  const { count: newLogs } = await prisma.rawPunchLog.createMany({
    data: result.records.map((rec) => ({
      deviceId: device.id,
      employeeDeviceId: rec.employeeDeviceId,
      timestamp: rec.timestamp,
      punchType: rec.punchType,
      raw: rec.raw,
    })),
    skipDuplicates: true,
  });
  console.log(`  Inserted ${newLogs} new raw punch logs (${result.records.length - newLogs} duplicates skipped)`);

  console.log('\nProcessing attendance from raw logs...');
  await processAttendanceFromRaw(device.id);

  // Show results
  const attJune2 = await prisma.attendanceLog.count({ where: { date: new Date('2026-06-02') } });
  const attJune3 = await prisma.attendanceLog.count({ where: { date: new Date('2026-06-03') } });
  const rawJune2 = await prisma.rawPunchLog.count({
    where: { deviceId: device.id, timestamp: { gte: new Date('2026-06-01T18:30:00Z'), lt: new Date('2026-06-02T18:30:00Z') } },
  });
  const rawJune3 = await prisma.rawPunchLog.count({
    where: { deviceId: device.id, timestamp: { gte: new Date('2026-06-02T18:30:00Z'), lt: new Date('2026-06-03T18:30:00Z') } },
  });

  console.log('\n=== RESULTS ===');
  console.log(`Raw punches June 2 IST: ${rawJune2}`);
  console.log(`Raw punches June 3 IST: ${rawJune3}`);
  console.log(`AttendanceLogs June 2:  ${attJune2}`);
  console.log(`AttendanceLogs June 3:  ${attJune3}`);

  if (attJune2 > 0 || attJune3 > 0) {
    console.log('\n✅ June 2/3 attendance is now in the DB!');
  } else {
    console.log('\n⚠️  Still no attendance logs for June 2/3. Check employee code mapping.');
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
