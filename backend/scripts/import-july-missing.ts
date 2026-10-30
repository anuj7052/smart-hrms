/**
 * One-time import script: fetch July 2 (and July 3 if data exists) from
 * Manage/DeviceLogList.aspx and insert into rawPunchLog → processAttendance.
 *
 * Usage:
 *   cd backend
 *   npx ts-node-dev --transpile-only --exit-child scripts/import-july-missing.ts
 */
import { PrismaClient } from '@prisma/client';
import { fetchFromESSLDeviceLogList, decryptFromStorage } from '../src/services/etlService';
import { processAttendanceFromRaw } from '../src/services/esslService';

const prisma = new PrismaClient();
const IST_MS = 330 * 60 * 1000;

async function main() {
  const device = await prisma.device.findFirst({ where: { autoSync: true, isActive: true } });
  if (!device) { console.error('No autoSync device found'); process.exit(1); }

  console.log(`Device: ${device.name} (${device.id})`);
  console.log(`IP: ${device.ip}:${device.port}, SN: ${device.serialNumber}`);

  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch { /* */ }
  }
  const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
  if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;

  if (!username || !password) {
    console.error('No ETL credentials found. Set ESSL_ETL_USERNAME/ESSL_ETL_PASSWORD env vars.');
    process.exit(1);
  }

  const baseUrl = `http://${device.ip}:${device.port}`;

  // Check what's currently in DB for July
  const jul1Count = await prisma.rawPunchLog.count({
    where: {
      deviceId: device.id,
      timestamp: { gte: new Date('2026-07-01T00:00:00+05:30'), lt: new Date('2026-07-02T00:00:00+05:30') },
    },
  });
  const jul2Count = await prisma.rawPunchLog.count({
    where: {
      deviceId: device.id,
      timestamp: { gte: new Date('2026-07-02T00:00:00+05:30'), lt: new Date('2026-07-03T00:00:00+05:30') },
    },
  });
  const jul3Count = await prisma.rawPunchLog.count({
    where: {
      deviceId: device.id,
      timestamp: { gte: new Date('2026-07-03T00:00:00+05:30'), lt: new Date('2026-07-04T00:00:00+05:30') },
    },
  });
  console.log(`\nCurrent DB punch counts:`);
  console.log(`  Jul 1: ${jul1Count}`);
  console.log(`  Jul 2: ${jul2Count} ← should import if 0`);
  console.log(`  Jul 3: ${jul3Count} ← should import if 0`);

  // Fetch July 2–3 from DeviceLogList (today's date)
  const today = new Date();
  const todayIST = new Date(today.getTime() + IST_MS);
  const todayStr = todayIST.toISOString().split('T')[0];

  console.log(`\nFetching Jul 2 → ${todayStr} from DeviceLogList.aspx...`);
  const result = await fetchFromESSLDeviceLogList(baseUrl, username, password, '2026-07-02', todayStr);
  console.log(`Result: success=${result.success}, records=${result.records.length}`);
  console.log(`Message: ${result.message}`);

  if (!result.success || result.records.length === 0) {
    console.log('No records fetched. Nothing to import.');
    await prisma.$disconnect();
    return;
  }

  // Show distribution by IST date
  const byDate: Record<string, number> = {};
  result.records.forEach(r => {
    const ist = new Date(r.timestamp.getTime() + IST_MS);
    const key = ist.toISOString().split('T')[0];
    byDate[key] = (byDate[key] || 0) + 1;
  });
  console.log('\nRecords by IST date:', byDate);

  // Show sample records
  const sorted = [...result.records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  console.log('\nFirst 5:');
  sorted.slice(0, 5).forEach(r => {
    const ist = new Date(r.timestamp.getTime() + IST_MS);
    console.log(`  ${r.employeeDeviceId} | ${ist.toISOString().slice(0, 19).replace('T', ' ')} IST | type=${r.punchType}`);
  });
  console.log('Last 5:');
  sorted.slice(-5).forEach(r => {
    const ist = new Date(r.timestamp.getTime() + IST_MS);
    console.log(`  ${r.employeeDeviceId} | ${ist.toISOString().slice(0, 19).replace('T', ' ')} IST | type=${r.punchType}`);
  });

  // Insert into rawPunchLog
  const { count: newLogs } = await prisma.rawPunchLog.createMany({
    data: result.records.map(rec => ({
      deviceId: device.id,
      employeeDeviceId: rec.employeeDeviceId,
      timestamp: rec.timestamp,
      punchType: rec.punchType,
      raw: rec.raw,
    })),
    skipDuplicates: true,
  });
  console.log(`\nNew raw punch logs inserted: ${newLogs}`);

  if (newLogs > 0) {
    console.log('Processing attendance...');
    await processAttendanceFromRaw(device.id);
    console.log('Attendance processed!');
  }

  // Show updated DB counts
  const jul2After = await prisma.rawPunchLog.count({
    where: {
      deviceId: device.id,
      timestamp: { gte: new Date('2026-07-02T00:00:00+05:30'), lt: new Date('2026-07-03T00:00:00+05:30') },
    },
  });
  const jul3After = await prisma.rawPunchLog.count({
    where: {
      deviceId: device.id,
      timestamp: { gte: new Date('2026-07-03T00:00:00+05:30'), lt: new Date('2026-07-04T00:00:00+05:30') },
    },
  });
  console.log(`\nUpdated DB punch counts:`);
  console.log(`  Jul 2: ${jul2After}`);
  console.log(`  Jul 3: ${jul3After}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
