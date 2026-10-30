/**
 * Force run processAttendanceFromRaw for the ESSL device
 */
import { PrismaClient } from '@prisma/client';
import { processAttendanceFromRaw } from '../src/services/esslService';
import * as dotenv from 'dotenv';
dotenv.config();

const p = new PrismaClient();

(async () => {
  const device = await p.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.error('Device not found'); process.exit(1); }
  console.log(`Device: ${device.id}`);

  console.log('Running processAttendanceFromRaw (from June 1 IST = 2026-05-31T18:30:00Z)...');
  // Only process logs from June 1 IST onwards to avoid processing all historical data
  await processAttendanceFromRaw(device.id, new Date('2026-05-31T18:30:00Z'));
  console.log('Done.');

  const att2 = await p.attendanceLog.findMany({ where: { date: new Date('2026-06-02') }, select: { employeeId: true, punchIn: true, punchOut: true, status: true } });
  const att3 = await p.attendanceLog.findMany({ where: { date: new Date('2026-06-03') }, select: { employeeId: true, punchIn: true, punchOut: true, status: true } });
  const IST = 330 * 60 * 1000;
  console.log(`\nAttendanceLogs June 2: ${att2.length}`);
  att2.slice(0, 5).forEach(a => console.log(`  ${a.employeeId} in=${new Date(a.punchIn.getTime()+IST).toISOString().slice(11,19)} out=${a.punchOut ? new Date(a.punchOut.getTime()+IST).toISOString().slice(11,19) : 'null'} status=${a.status}`));
  console.log(`\nAttendanceLogs June 3: ${att3.length}`);
  att3.slice(0, 5).forEach(a => console.log(`  ${a.employeeId} in=${new Date(a.punchIn.getTime()+IST).toISOString().slice(11,19)} out=${a.punchOut ? new Date(a.punchOut.getTime()+IST).toISOString().slice(11,19) : 'null'} status=${a.status}`));

  await p.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
