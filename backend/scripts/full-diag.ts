import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { prisma } from '../src/lib/prisma';
import { fetchFromETimeTrackLite } from '../src/services/etlService';
import { processAttendanceFromRaw } from '../src/services/esslService';
import { invalidateCache } from '../src/lib/prisma';

const BASE = 'http://98.70.41.54:85';
const IST_MS = 330 * 60 * 1000;

function istDateStr(offset = 0): string {
  const d = new Date(Date.now() + IST_MS + offset * 86400000);
  return d.toISOString().split('T')[0];
}

(async () => {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_MS);
  console.log('=== Full Diagnostic ===');
  console.log('UTC now:', now.toISOString());
  console.log('IST now:', istNow.toISOString());
  console.log('Today IST:', istDateStr(0), '| Yesterday IST:', istDateStr(-1));

  // 1. DB check for last 3 days
  console.log('\n--- DB: AttendanceLog last 3 IST days ---');
  for (let d = -2; d <= 0; d++) {
    const ds = istDateStr(d);
    const istMid = new Date(ds + 'T00:00:00Z'); // "UTC midnight = IST midnight" per our schema
    const count = await prisma.attendanceLog.count({ where: { date: istMid } });
    const recent = await prisma.attendanceLog.findMany({
      where: { date: istMid }, take: 3,
      select: { date: true, status: true, punchIn: true, punchOut: true, source: true }
    });
    const suffix = count > 0 ? ('| first: ' + JSON.stringify(recent[0])) : '';
    console.log(`  ${ds}: ${count} rows`, suffix);
  }

  console.log('\n--- DB: RawPunchLog last 48h ---');
  const raw48 = await prisma.rawPunchLog.findMany({
    where: { timestamp: { gte: new Date(now.getTime() - 48 * 3600000) } },
    orderBy: { timestamp: 'desc' }, take: 5,
    select: { timestamp: true, employeeDeviceId: true }
  });
  console.log('  Count last 48h:', raw48.length > 0 ? '5+' : '0');
  raw48.forEach(r => console.log('  ', r.timestamp.toISOString(), r.employeeDeviceId));

  // 2. Device state
  const device = await prisma.device.findFirst({ where: { autoSync: true, isActive: true } });
  console.log('\n--- Device state ---');
  console.log('  lastEtlSync:', device?.lastEtlSync?.toISOString());
  console.log('  status:', device?.status, '| lastError:', device?.lastError?.slice(0, 100) || 'none');

  // 3. Fetch from ESSL for today and yesterday
  const UN = process.env.ESSL_ETL_USERNAME!;
  const PW = process.env.ESSL_ETL_PASSWORD!;

  for (const ds of [istDateStr(-1), istDateStr(0)]) {
    console.log(`\n--- ESSL Portal fetch for ${ds} ---`);
    try {
      const result = await fetchFromETimeTrackLite(BASE, UN, PW, ds, ds, 90000);
      console.log('  success:', result.success, '| records:', result.records.length, '| message:', result.message);
      if (result.records.length > 0) {
        console.log('  First:', JSON.stringify(result.records[0]));
        console.log('  Last:', JSON.stringify(result.records[result.records.length - 1]));

        // Store into DB
        const { count } = await prisma.rawPunchLog.createMany({
          data: result.records.map(r => ({
            deviceId: device!.id,
            employeeDeviceId: r.employeeDeviceId,
            timestamp: r.timestamp,
            punchType: r.punchType,
            raw: r.raw,
          })),
          skipDuplicates: true,
        });
        console.log(`  Stored ${count} new RawPunchLogs for ${ds}`);

        if (count > 0 || result.records.length > 0) {
          console.log(`  Processing attendance from raw for ${ds}...`);
          await processAttendanceFromRaw(device!.id);
          invalidateCache('attendance:');
          console.log('  Done processing.');
        }
      }
    } catch (e) {
      console.error('  Error:', (e as Error).message);
    }
  }

  // 4. Re-check DB after sync attempt
  console.log('\n--- DB after sync attempt ---');
  for (let d = -2; d <= 0; d++) {
    const ds = istDateStr(d);
    const istMid = new Date(ds + 'T00:00:00Z');
    const count = await prisma.attendanceLog.count({ where: { date: istMid } });
    console.log(`  ${ds}: ${count} AttendanceLogs`);
  }

  await prisma.$disconnect();
})();
