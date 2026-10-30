import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const today = new Date('2026-06-09T00:00:00.000+05:30');
  const tomorrow = new Date('2026-06-09T23:59:59.999+05:30');
  
  const latest = await prisma.rawPunchLog.findMany({
    where: { timestamp: { gte: today, lte: tomorrow } },
    orderBy: { timestamp: 'desc' },
    take: 5,
    select: { employeeDeviceId: true, timestamp: true, punchType: true }
  });
  
  console.log('Latest 5 raw punches today (IST):');
  latest.forEach(l => {
    const ist = new Date(l.timestamp.getTime() + 330 * 60 * 1000);
    console.log('  ', l.employeeDeviceId, ist.toISOString().replace('Z', ' IST'), 'type:', l.punchType);
  });
  
  const count = await prisma.rawPunchLog.count({ where: { timestamp: { gte: today, lte: tomorrow } } });
  console.log('\nTotal raw punches today:', count);
  
  const devices = await prisma.device.findMany({
    select: { id: true, name: true, lastEtlSync: true, lastSync: true, status: true, autoSync: true, syncInterval: true, lastError: true }
  });
  
  console.log('\nDevices:');
  devices.forEach(d => {
    const syncIST = d.lastEtlSync ? new Date(d.lastEtlSync.getTime() + 330 * 60 * 1000).toISOString().replace('Z', ' IST') : 'null';
    console.log(`  ${d.name} | status: ${d.status} | lastEtlSync: ${syncIST} | autoSync: ${d.autoSync} | interval: ${d.syncInterval}min`);
    if (d.lastError) console.log(`    ERROR: ${d.lastError.slice(0, 100)}`);
  });
  
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
