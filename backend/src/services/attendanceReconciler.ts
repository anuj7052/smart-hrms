/**
 * Daily attendance reconciliation:
 * - Marks approved Leave days as status='Leave'
 * - Marks approved WFH days as status='Present', attendanceMode='WFH'
 * - Marks Holidays as status='Holiday'
 * - Marks Weekly Off days
 * Runs once daily and is idempotent.
 */
import { prisma } from '../lib/prisma';
import { getISTDateOnly, IST_OFFSET_MINUTES } from '../utils/dateIST';

export async function reconcileAttendance(targetDate?: Date): Promise<{ leavesApplied: number; wfhApplied: number; holidaysApplied: number; weeklyOffsApplied: number }> {
  const date = getISTDateOnly(targetDate ?? new Date());

  let leavesApplied = 0;
  let wfhApplied = 0;
  let holidaysApplied = 0;
  let weeklyOffsApplied = 0;

  // 0. Sunday weekly-off — applies to ALL active employees (IST calendar)
  // `date` is midnight-IST stored as a UTC Date. Add IST offset, then getUTCDay → 0 means Sunday.
  const istDay = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000).getUTCDay();
  if (istDay === 0) {
    const activeEmployees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true } });
    for (const emp of activeEmployees) {
      const existing = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId: emp.id, date } },
      });
      // Don't overwrite real punches or already-applied leave/wfh/holiday
      if (existing?.punchIn) continue;
      if (existing && existing.status !== 'Absent') continue;
      await prisma.attendanceLog.upsert({
        where: { employeeId_date: { employeeId: emp.id, date } },
        update: { status: 'WeeklyOff', source: 'weekly-off-sunday' },
        create: { employeeId: emp.id, date, status: 'WeeklyOff', source: 'weekly-off-sunday' },
      });
      weeklyOffsApplied += 1;
    }
  }

  // 1. Holidays — applies to ALL active employees
  const holiday = await prisma.holiday.findFirst({ where: { date } });
  if (holiday) {
    const activeEmployees = await prisma.employee.findMany({ where: { isActive: true }, select: { id: true } });
    for (const emp of activeEmployees) {
      const existing = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId: emp.id, date } },
      });
      // Don't overwrite a real punch
      if (existing?.punchIn) continue;
      await prisma.attendanceLog.upsert({
        where: { employeeId_date: { employeeId: emp.id, date } },
        update: { status: 'Holiday', source: 'holiday' },
        create: { employeeId: emp.id, date, status: 'Holiday', source: 'holiday' },
      });
      holidaysApplied += 1;
    }
  }

  // 2. Approved Leaves covering this date
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      status: 'Approved',
      fromDate: { lte: date },
      toDate: { gte: date },
    },
    select: { employeeId: true },
  });
  for (const lv of leaves) {
    const existing = await prisma.attendanceLog.findUnique({
      where: { employeeId_date: { employeeId: lv.employeeId, date } },
    });
    if (existing?.punchIn) continue;
    await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: lv.employeeId, date } },
      update: { status: 'Leave', source: 'leave-approved' },
      create: { employeeId: lv.employeeId, date, status: 'Leave', source: 'leave-approved' },
    });
    leavesApplied += 1;
  }

  // 3. Approved WFH for this date
  const wfhs = await prisma.wFHRequest.findMany({
    where: { status: 'Approved', date },
    select: { employeeId: true, mode: true },
  });
  for (const w of wfhs) {
    const mode = w.mode === 'Field' ? 'Field' : w.mode === 'ClientVisit' ? 'ClientVisit' : 'WFH';
    await prisma.attendanceLog.upsert({
      where: { employeeId_date: { employeeId: w.employeeId, date } },
      update: { status: 'Present', attendanceMode: mode, source: 'wfh-approved' },
      create: {
        employeeId: w.employeeId,
        date,
        status: 'Present',
        attendanceMode: mode,
        source: 'wfh-approved',
      },
    });
    wfhApplied += 1;
  }

  console.log(`[Reconcile] ${date.toISOString().split('T')[0]}: leaves=${leavesApplied}, wfh=${wfhApplied}, holidays=${holidaysApplied}, weeklyOff=${weeklyOffsApplied}`);
  return { leavesApplied, wfhApplied, holidaysApplied, weeklyOffsApplied };
}
