/**
 * Seed fake virtual login + attendance data for Rahul (EMP001).
 * - Enables virtualLoginEnabled
 * - Creates virtual punch logs + matching AttendanceLog rows for the past 14 days
 *   (skipping Sundays, with realistic IN/OUT times and a mix of WFH/Field/Client modes).
 *
 * Run: cd backend && npx ts-node --transpile-only scripts/seed-virtual-rahul.ts
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function getOrCreateVirtualDevice(): Promise<string> {
  const existing = await prisma.device.findUnique({ where: { serialNumber: 'VIRTUAL-DEVICE' } });
  if (existing) return existing.id;
  const device = await prisma.device.create({
    data: {
      name: 'Virtual Login Device',
      ip: '0.0.0.0', port: 0,
      serialNumber: 'VIRTUAL-DEVICE',
      username: 'system', passwordHash: 'n/a',
      autoSync: false, status: 'Online', isActive: false,
    },
  });
  return device.id;
}

async function main() {
  const rahul = await prisma.employee.findFirst({
    where: { OR: [{ employeeId: 'EMP001' }, { user: { email: 'rahul@foetron.com' } }] },
    include: { user: true },
  });

  if (!rahul) {
    console.error('❌ Rahul (EMP001) not found. Run seed-demo.ts first.');
    process.exit(1);
  }

  console.log(`✅ Found ${rahul.user.name} (${rahul.employeeId})`);

  // 1) Enable virtual login
  await prisma.employee.update({
    where: { id: rahul.id },
    data: { virtualLoginEnabled: true },
  });
  console.log('✅ Virtual login enabled');

  // 2) Create a virtual device (so RawPunchLog has a valid FK)
  const virtualDeviceId = await getOrCreateVirtualDevice();
  const pin = rahul.devicePin || rahul.employeeId;

  // 3) Seed past 14 days (skip Sundays); mix of times & modes
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const modes: Array<'WFH' | 'Field' | 'ClientVisit'> = ['WFH', 'WFH', 'Field', 'WFH', 'ClientVisit'];

  let created = 0;
  for (let daysBack = 1; daysBack <= 14; daysBack++) {
    const dateUtc = new Date(today);
    dateUtc.setUTCDate(today.getUTCDate() - daysBack);

    // Check IST day of week
    const istDay = new Date(dateUtc.getTime() + 330 * 60 * 1000).getUTCDay();
    if (istDay === 0) continue; // skip Sundays

    // Punch-in between 09:00 and 10:15 IST, punch-out between 18:00 and 19:30 IST
    const inHour = 9 + Math.floor(Math.random() * 2);
    const inMin = Math.floor(Math.random() * 60);
    const outHour = 18 + Math.floor(Math.random() * 2);
    const outMin = Math.floor(Math.random() * 60);

    const punchIn = new Date(
      Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate(), inHour, inMin, 0) - 330 * 60 * 1000
    );
    const punchOut = new Date(
      Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate(), outHour, outMin, 0) - 330 * 60 * 1000
    );
    const workHours = parseFloat(((punchOut.getTime() - punchIn.getTime()) / (1000 * 60 * 60)).toFixed(2));
    const mode = modes[daysBack % modes.length];

    // Late if punch-in is after 09:15 IST
    const shiftStartUtc = new Date(
      Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate(), 9, 0, 0) - 330 * 60 * 1000
    );
    const lateBy = (punchIn.getTime() - shiftStartUtc.getTime()) / (1000 * 60);
    const status = lateBy > 15 ? 'Late' : 'Present';

    // AttendanceLog
    await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: rahul.id, date: dateUtc } },
      update: { punchIn, punchOut, workHours, status, source: 'virtual', attendanceMode: mode },
      create: {
        employeeId: rahul.id, date: dateUtc, punchIn, punchOut, workHours,
        status, source: 'virtual', attendanceMode: mode,
      },
    });

    // VirtualPunchLog audit row
    await prisma.virtualPunchLog.upsert({
      where: { employeeId_date: { employeeId: rahul.id, date: dateUtc } },
      update: { punchIn, punchOut, reason: `Seeded virtual ${mode}`, source: 'virtual' },
      create: {
        employeeId: rahul.id, date: dateUtc, punchIn, punchOut,
        reason: `Seeded virtual ${mode}`, source: 'virtual',
      },
    });

    // RawPunchLog rows (for ESSL feed compatibility)
    await prisma.rawPunchLog.createMany({
      data: [
        { deviceId: virtualDeviceId, employeeDeviceId: pin, timestamp: punchIn, punchType: 0, raw: `VIRTUAL_IN|${pin}|${punchIn.toISOString()}` },
        { deviceId: virtualDeviceId, employeeDeviceId: pin, timestamp: punchOut, punchType: 1, raw: `VIRTUAL_OUT|${pin}|${punchOut.toISOString()}` },
      ],
      skipDuplicates: true,
    });

    created++;
  }

  console.log(`✅ Seeded ${created} virtual attendance days for ${rahul.user.name}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
