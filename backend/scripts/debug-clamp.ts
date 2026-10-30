import { PrismaClient } from '@prisma/client';
import { fetchFromETimeTrackLite, decryptFromStorage } from '../src/services/etlService';
import { parseISTWallClockToUTC } from '../src/utils/dateIST';
const prisma = new PrismaClient();

(async () => {
  const IST_MS = 330 * 60 * 1000;
  const device = await prisma.device.findFirst({ where: { autoSync: true } });
  if (!device) { console.error('No autoSync device'); process.exit(1); }

  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch { }
  }
  const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
  if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
  const baseUrl = `http://${device.ip}:${device.port}`;

  const fromDate = '2026-06-09';
  const toDate = '2026-06-09';

  // Show what the clamp range would be
  const rangeStart = parseISTWallClockToUTC(`${fromDate}T00:00:00`);
  const rangeEnd = parseISTWallClockToUTC(`${toDate}T23:59:59`);
  console.log('Clamp range:');
  console.log('  rangeStart:', rangeStart.toISOString(), '=', new Date(rangeStart.getTime() + IST_MS).toISOString().replace('Z', ' IST'));
  console.log('  rangeEnd:', rangeEnd.toISOString(), '=', new Date(rangeEnd.getTime() + IST_MS).toISOString().replace('Z', ' IST'));

  console.log('\nFetching from portal (without clamping)...');
  const result = await fetchFromETimeTrackLite(baseUrl, username!, password!, fromDate, toDate);
  console.log('Result:', result.records.length, 'records after clamping');
  console.log('Message:', result.message);

  // Now let's call it with a wider date range to see if records get through
  console.log('\n--- Trying wider range: 2026-06-08 to 2026-06-10 ---');
  const result2 = await fetchFromETimeTrackLite(baseUrl, username!, password!, '2026-06-08', '2026-06-10');
  console.log('Result:', result2.records.length, 'records');
  if (result2.records.length > 0) {
    const byDate: Record<string, number> = {};
    result2.records.forEach(r => {
      const ist = new Date(r.timestamp.getTime() + IST_MS);
      const key = ist.toISOString().split('T')[0];
      byDate[key] = (byDate[key] || 0) + 1;
    });
    console.log('Records by IST date:', byDate);
    
    console.log('\nFirst 3 records:');
    result2.records.slice(0, 3).forEach(r => {
      console.log(`  empId=${r.employeeDeviceId} timestamp=${r.timestamp.toISOString()} IST=${new Date(r.timestamp.getTime()+IST_MS).toISOString().replace('Z',' IST')} raw=${r.raw}`);
    });
    console.log('\nLast 3 records:');
    result2.records.slice(-3).forEach(r => {
      console.log(`  empId=${r.employeeDeviceId} timestamp=${r.timestamp.toISOString()} IST=${new Date(r.timestamp.getTime()+IST_MS).toISOString().replace('Z',' IST')} raw=${r.raw}`);
    });
  }
  
  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
