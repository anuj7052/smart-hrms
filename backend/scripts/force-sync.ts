import { PrismaClient } from '@prisma/client';
import { fetchFromIClockServerDirect, decryptFromStorage } from '../src/services/etlService';
const prisma = new PrismaClient();

(async () => {
  const IST_MS = 330 * 60 * 1000;
  
  const device = await prisma.device.findFirst({ where: { autoSync: true } });
  if (!device) { console.error('No autoSync device found'); process.exit(1); }
  
  console.log(`Device: ${device.name}`);
  console.log(`lastEtlSync: ${device.lastEtlSync?.toISOString()}`);
  
  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch { }
  }
  const username = device.etlUsername ?? process.env.ESSL_ETL_USERNAME ?? undefined;
  if (!password) password = process.env.ESSL_ETL_PASSWORD ?? undefined;
  const baseUrl = `http://${device.ip}:${device.port}`;
  
  console.log(`\nFetching from ${baseUrl} with lastSync=${device.lastEtlSync?.toISOString()}...`);
  
  const result = await fetchFromIClockServerDirect(
    baseUrl,
    device.serialNumber,
    device.lastEtlSync ?? undefined,
    username,
    password,
  );
  
  console.log(`\nResult: success=${result.success}, records=${result.records.length}`);
  console.log(`Message: ${result.message}`);
  
  if (result.records.length > 0) {
    // Show date distribution
    const byDate: Record<string, number> = {};
    result.records.forEach(r => {
      const ist = new Date(r.timestamp.getTime() + IST_MS);
      const key = ist.toISOString().split('T')[0];
      byDate[key] = (byDate[key] || 0) + 1;
    });
    console.log('\nRecords by IST date:', byDate);
    
    // Show latest records
    const sorted = [...result.records].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    console.log('\nLatest 5 records:');
    sorted.slice(0, 5).forEach(r => {
      const ist = new Date(r.timestamp.getTime() + IST_MS);
      console.log(`  ${r.employeeDeviceId} | ${ist.toISOString().replace('Z', ' IST')} | type: ${r.punchType}`);
    });
    
    // Try inserting
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
    console.log(`\nNew records inserted: ${newLogs}`);
    
    if (newLogs > 0) {
      // Process attendance
      const { processAttendanceFromRaw } = await import('../src/services/esslService');
      await processAttendanceFromRaw(device.id);
      console.log('Attendance processed!');
      
      await prisma.device.update({
        where: { id: device.id },
        data: { lastEtlSync: new Date(), status: 'Online', lastSync: new Date(), lastError: null }
      });
      console.log('Device lastEtlSync updated.');
    }
  }
  
  // Final count
  const today = new Date('2026-06-09T00:00:00.000+05:30');
  const tomorrow = new Date('2026-06-09T23:59:59.999+05:30');
  const count = await prisma.rawPunchLog.count({ where: { deviceId: device.id, timestamp: { gte: today, lte: tomorrow } } });
  console.log(`\nTotal raw punches in DB for today: ${count}`);
  
  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
