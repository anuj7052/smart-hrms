import { prisma } from '../src/lib/prisma';

(async () => {
  // Count punches per day for the last 10 days (IST)
  const since = new Date();
  since.setDate(since.getDate() - 10);
  const rows = await prisma.rawPunchLog.findMany({
    where: { timestamp: { gte: since } },
    select: { timestamp: true, employeeDeviceId: true, raw: true, createdAt: true },
    orderBy: { timestamp: 'desc' },
  });
  const byDay = new Map<string, { count: number; firstCreated: Date; lastCreated: Date }>();
  for (const r of rows) {
    const day = r.timestamp.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
    const e = byDay.get(day) || { count: 0, firstCreated: r.createdAt, lastCreated: r.createdAt };
    e.count++;
    if (r.createdAt < e.firstCreated) e.firstCreated = r.createdAt;
    if (r.createdAt > e.lastCreated) e.lastCreated = r.createdAt;
    byDay.set(day, e);
  }
  console.log('punchDay | count | firstInsertedAt(UTC) | lastInsertedAt(UTC)');
  for (const [day, e] of [...byDay.entries()].sort()) {
    console.log(`${day} | ${e.count} | ${e.firstCreated.toISOString()} | ${e.lastCreated.toISOString()}`);
  }
  console.log('\nTotal rows in window:', rows.length);
  await prisma.$disconnect();
  process.exit(0);
})().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
