/**
 * Diagnostic: Check DB state and try all ETL strategies including iClock direct
 */
import { PrismaClient } from '@prisma/client';
import { fetchFromIClockServerDirect, decryptFromStorage } from '../src/services/etlService';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const IST_MS = 330 * 60 * 1000;

(async () => {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.error('Device not found'); process.exit(1); }

  console.log('=== DB STATE ===');
  const latestPunch = await prisma.rawPunchLog.findFirst({ orderBy: { timestamp: 'desc' }, select: { timestamp: true } });
  console.log('Latest punch UTC:', latestPunch?.timestamp?.toISOString());
  console.log('Latest punch IST:', latestPunch?.timestamp ? new Date(latestPunch.timestamp.getTime() + IST_MS).toISOString().replace('Z', '+05:30') : 'NONE');

  const june2 = await prisma.rawPunchLog.count({ where: { timestamp: { gte: new Date('2026-06-01T18:30:00Z'), lt: new Date('2026-06-03T00:00:00Z') } } });
  const june3 = await prisma.rawPunchLog.count({ where: { timestamp: { gte: new Date('2026-06-02T18:30:00Z') } } });
  console.log('Raw punches June 2 IST:', june2);
  console.log('Raw punches June 3 IST:', june3);

  const attJune2 = await prisma.attendanceLog.count({ where: { date: new Date('2026-06-02') } });
  const attJune3 = await prisma.attendanceLog.count({ where: { date: new Date('2026-06-03') } });
  console.log('AttendanceLogs June 2:', attJune2);
  console.log('AttendanceLogs June 3:', attJune3);

  console.log('\n=== TRYING DIRECT DEVICE FETCH (all strategies) ===');
  const baseUrl = `http://${device.ip}:${device.port}`;
  const username = device.etlUsername || process.env.ESSL_ETL_USERNAME || '';
  const password = device.etlPassword ? decryptFromStorage(device.etlPassword) : (process.env.ESSL_ETL_PASSWORD || '');

  // Use June 1 18:00 IST (= June 1 12:30 UTC) as start — catch everything after
  const fromDate = new Date('2026-06-01T12:30:00Z');
  console.log(`fromDate: ${fromDate.toISOString()} (= June 1 18:00 IST)`);
  console.log(`baseUrl: ${baseUrl}`);

  const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, fromDate, username, password);
  console.log('\nResult:', result.success ? '✅ SUCCESS' : '❌ FAILED');
  console.log('Message:', result.message);
  console.log('Records:', result.records.length);

  if (result.records.length > 0) {
    const grouped: Record<string, number> = {};
    result.records.forEach(r => {
      const k = new Date(r.timestamp.getTime() + IST_MS).toISOString().split('T')[0];
      grouped[k] = (grouped[k] || 0) + 1;
    });
    console.log('By IST date:', JSON.stringify(grouped, null, 2));
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
