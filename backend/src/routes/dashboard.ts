import { Router, Response } from 'express';
import { authenticateJWT, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { todayISTDateOnly, getISTMonthRange, getISTDateOnly } from '../utils/dateIST';

const router = Router();
router.use(authenticateJWT);

// ─── GET /api/dashboard/overview ────────────────────────────────────────────
// Returns role-aware overview data for the logged-in user.
// Employees see their own stats; Admin/HR/Manager see company-wide stats.
router.get('/overview', async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const role = req.user!.role;
  const isAdminOrHR = role === 'Admin' || role === 'HR' || role === 'Manager';

  const todayDate = todayISTDateOnly();
  const istNow = new Date(Date.now() + 330 * 60 * 1000);
  const year = istNow.getUTCFullYear();
  const istMonth = istNow.getUTCMonth() + 1;
  const { start: monthStart, end: monthEnd } = getISTMonthRange(year, istMonth);

  try {
    // ── EMPLOYEE OVERVIEW ──────────────────────────────────────────────────
    if (!isAdminOrHR) {
      const employee = await prisma.employee.findFirst({
        where: { userId },
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
      });

      if (!employee) {
        res.json({
          role,
          employee: null,
          today: null,
          thisMonth: { present: 0, absent: 0, leave: 0, late: 0, halfDay: 0, wfh: 0, workingDays: 0 },
          leaves: { pending: 0, approved: 0, balances: [] },
          wfh: { pending: 0, approved: 0 },
          recentActivity: [],
        });
        return;
      }

      // Today's attendance
      const todayLog = await prisma.attendanceLog.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: todayDate } },
      });

      // This month's attendance
      const monthLogs = await prisma.attendanceLog.findMany({
        where: {
          employeeId: employee.id,
          date: { gte: monthStart, lt: monthEnd },
        },
        orderBy: { date: 'desc' },
        select: { date: true, status: true, punchIn: true, punchOut: true, workHours: true, attendanceMode: true },
      });

      const monthStats = monthLogs.reduce(
        (acc, log) => {
          const s = log.status;
          if (s === 'Present' || s === 'Late') acc.present++;
          else if (s === 'Absent') acc.absent++;
          else if (s === 'Leave') acc.leave++;
          if (s === 'Late') acc.late++;
          if (s === 'HalfDay') acc.halfDay++;
          if (log.attendanceMode === 'WFH') acc.wfh++;
          return acc;
        },
        { present: 0, absent: 0, leave: 0, late: 0, halfDay: 0, wfh: 0 }
      );

      // Working days in month so far (Mon-Sat, skip Sun)
      let workingDays = 0;
      const scanDay = new Date(monthStart);
      while (scanDay <= todayDate) {
        const dow = scanDay.getUTCDay();
        if (dow !== 0) workingDays++;
        scanDay.setUTCDate(scanDay.getUTCDate() + 1);
      }

      // Leave stats
      const [pendingLeaves, approvedLeaves] = await Promise.all([
        prisma.leaveRequest.count({ where: { employeeId: employee.id, status: 'Pending' } }),
        prisma.leaveRequest.count({
          where: {
            employeeId: employee.id,
            status: 'Approved',
            fromDate: { gte: monthStart },
          },
        }),
      ]);

      // Leave balances
      const rawBalances = await prisma.leaveBalance.findMany({
        where: { employeeId: employee.id, year },
        include: { leaveType: { select: { id: true, name: true } } },
      });
      const leaveBalances = rawBalances.map((b) => ({
        _id: b.id,
        leaveTypeId: { _id: b.leaveType.id, name: b.leaveType.name },
        allocated: b.allocated,
        used: b.used,
        remaining: b.remaining,
      }));

      // WFH stats
      const [pendingWFH, approvedWFH] = await Promise.all([
        prisma.wFHRequest.count({ where: { employeeId: employee.id, status: 'Pending' } }),
        prisma.wFHRequest.count({
          where: {
            employeeId: employee.id,
            status: 'Approved',
            date: { gte: monthStart },
          },
        }),
      ]);

      // Recent activity (last 7 days)
      const recentActivity = monthLogs.slice(0, 7).map((l) => ({
        date: l.date,
        status: l.status,
        punchIn: l.punchIn,
        punchOut: l.punchOut,
        workHours: l.workHours,
        mode: l.attendanceMode,
      }));

      // Upcoming holidays
      const upcomingHolidays = await prisma.holiday.findMany({
        where: { date: { gte: todayDate } },
        orderBy: { date: 'asc' },
        take: 5,
      });

      res.json({
        role,
        employee: {
          _id: employee.id,
          employeeId: employee.employeeId,
          name: employee.user.name,
          email: employee.user.email,
          department: employee.department,
          designation: employee.designation,
          joinDate: employee.joinDate,
          shift: employee.shift,
        },
        today: todayLog
          ? {
              status: todayLog.status,
              punchIn: todayLog.punchIn,
              punchOut: todayLog.punchOut,
              workHours: todayLog.workHours,
              mode: todayLog.attendanceMode,
              isPresent: todayLog.status === 'Present' || todayLog.status === 'Late',
            }
          : { status: 'No Record', punchIn: null, punchOut: null, workHours: null, mode: null, isPresent: false },
        thisMonth: { ...monthStats, workingDays },
        leaves: { pending: pendingLeaves, approved: approvedLeaves, balances: leaveBalances },
        wfh: { pending: pendingWFH, approved: approvedWFH },
        recentActivity,
        upcomingHolidays,
      });
      return;
    }

    // ── ADMIN / HR / MANAGER OVERVIEW ──────────────────────────────────────
    const [
      totalEmployees,
      activeEmployees,
      todayLogs,
      monthAggregateLogs,
      pendingLeaves,
      approvedLeavesMonth,
      pendingWFH,
      approvedWFHMonth,
      recentLogs,
    ] = await Promise.all([
      prisma.employee.count(),
      prisma.employee.count({ where: { isActive: true } }),

      // Today's attendance logs
      prisma.attendanceLog.findMany({
        where: { date: todayDate },
        select: { status: true, punchIn: true, punchOut: true, attendanceMode: true },
      }),

      // This month's logs (just status counts)
      prisma.attendanceLog.groupBy({
        by: ['status'],
        where: { date: { gte: monthStart, lt: monthEnd } },
        _count: { status: true },
      }),

      prisma.leaveRequest.count({ where: { status: 'Pending' } }),

      prisma.leaveRequest.count({
        where: { status: 'Approved', fromDate: { gte: monthStart } },
      }),

      prisma.wFHRequest.count({ where: { status: 'Pending' } }),

      prisma.wFHRequest.count({
        where: { status: 'Approved', date: { gte: monthStart } },
      }),

      // Recent attendance feed (last 10 records today or recent)
      prisma.attendanceLog.findMany({
        where: {
          date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          punchIn: { not: null },
        },
        include: {
          employee: {
            select: {
              id: true,
              employeeId: true,
              department: true,
              user: { select: { name: true } },
            },
          },
        },
        orderBy: { punchIn: 'desc' },
        take: 10,
      }),
    ]);

    // Today stats
    const todayPresent = todayLogs.filter((l) => l.status === 'Present' || l.status === 'Late' || l.status === 'HalfDay').length;
    const todayAbsent  = todayLogs.filter((l) => l.status === 'Absent').length;
    const todayOnLeave = todayLogs.filter((l) => l.status === 'Leave').length;
    const todayLate    = todayLogs.filter((l) => l.status === 'Late').length;
    const todayWFH     = todayLogs.filter((l) => l.attendanceMode === 'WFH').length;
    const todayWithPunchIn = todayLogs.filter((l) => l.punchIn !== null).length;
    const todayWithPunchOut = todayLogs.filter((l) => l.punchOut !== null).length;

    // Month stats
    const monthStats: Record<string, number> = {};
    for (const row of monthAggregateLogs) {
      monthStats[row.status] = row._count.status;
    }

    const recentActivity = recentLogs.map((l) => ({
      date: l.date,
      status: l.status,
      punchIn: l.punchIn,
      punchOut: l.punchOut,
      workHours: l.workHours,
      mode: l.attendanceMode,
      employee: {
        id: l.employee.id,
        employeeId: l.employee.employeeId,
        name: l.employee.user?.name || 'Unknown',
        department: l.employee.department,
      },
    }));

    // Upcoming holidays
    const upcomingHolidays = await prisma.holiday.findMany({
      where: { date: { gte: todayDate } },
      orderBy: { date: 'asc' },
      take: 5,
    });

    res.json({
      role,
      company: { totalEmployees, activeEmployees },
      today: {
        present: todayPresent,
        absent: todayAbsent,
        onLeave: todayOnLeave,
        late: todayLate,
        wfh: todayWFH,
        punchIns: todayWithPunchIn,
        punchOuts: todayWithPunchOut,
        totalExpected: activeEmployees,
      },
      thisMonth: {
        present: monthStats['Present'] || 0,
        absent: monthStats['Absent'] || 0,
        leave: monthStats['Leave'] || 0,
        late: monthStats['Late'] || 0,
        halfDay: monthStats['HalfDay'] || 0,
        holiday: monthStats['Holiday'] || 0,
        weeklyOff: monthStats['WeeklyOff'] || 0,
      },
      leaves: { pending: pendingLeaves, approved: approvedLeavesMonth },
      wfh: { pending: pendingWFH, approved: approvedWFHMonth },
      recentActivity,
      upcomingHolidays,
    });
  } catch (err) {
    console.error('[dashboard/overview] Error:', err);
    res.status(500).json({ message: 'Failed to load dashboard data' });
  }
});

export default router;
