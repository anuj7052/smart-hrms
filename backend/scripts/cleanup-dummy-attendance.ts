/**
 * Cleanup script:
 * 1. Deletes dummy/mock attendance logs (source = 'mock' or 'dummy' or 'manual-test')
 * 2. Optionally wipes all AttendanceLog and RawPunchLog (use --all flag)
 *
 * Run:
 *   npx ts-node --transpile-only scripts/cleanup-dummy-attendance.ts
 *   npx ts-node --transpile-only scripts/cleanup-dummy-attendance.ts --all
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  const wipeAll = process.argv.includes('--all');

  if (wipeAll) {
    console.log('⚠️  --all flag detected. Deleting ALL attendance + raw punches...');
    const r1 = await prisma.attendanceLog.deleteMany({});
    const r2 = await prisma.rawPunchLog.deleteMany({});
    console.log(`Deleted ${r1.count} attendance logs, ${r2.count} raw punches.`);
  } else {
    const dummySources = ['mock', 'dummy', 'manual-test', 'test', 'sample'];
    const result = await prisma.attendanceLog.deleteMany({
      where: { source: { in: dummySources } },
    });
    console.log(`Deleted ${result.count} dummy attendance logs (source in ${JSON.stringify(dummySources)}).`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
