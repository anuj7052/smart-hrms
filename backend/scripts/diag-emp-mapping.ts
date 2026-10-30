/**
 * Diagnostic: check employee ID mapping for raw punch logs
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const p = new PrismaClient();

(async () => {
  // Distinct employeeDeviceIds in June 2/3 raw punch logs
  const logs = await p.rawPunchLog.findMany({
    where: { timestamp: { gte: new Date('2026-06-01T18:30:00Z') } },
    select: { employeeDeviceId: true },
    distinct: ['employeeDeviceId'],
  });
  console.log('Distinct employeeDeviceIds:', logs.map(l => l.employeeDeviceId).join(', '));

  // Check employee table for each
  let matchCount = 0;
  for (const { employeeDeviceId: id } of logs) {
    const emp = await p.employee.findFirst({
      where: { OR: [{ employeeId: id }, { devicePin: id }] },
      select: { id: true, employeeId: true, devicePin: true },
    });
    if (emp) {
      matchCount++;
      console.log(`  ✅ ${id} → id=${emp.id} (employeeId=${emp.employeeId}, devicePin=${emp.devicePin})`);
    } else {
      console.log(`  ❌ ${id} → NOT FOUND in employees table`);
    }
  }
  console.log(`\nMatched ${matchCount}/${logs.length} device IDs to employees`);

  // Also show all employees with their IDs for reference
  const allEmps = await p.employee.findMany({ select: { employeeId: true, devicePin: true }, orderBy: { employeeId: 'asc' } });
  console.log('\nAll employees in DB:');
  allEmps.forEach(e => console.log(`  employeeId=${e.employeeId} | devicePin=${e.devicePin ?? 'null'}`));

  await p.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
