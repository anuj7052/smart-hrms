import { Router, Response } from 'express';
import { authenticateJWT, requireRole, AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticateJWT, requireRole(['Admin', 'HR']));

type ReportEmployee = {
  id: string;
  employeeId: string;
  department: string;
  user: { name: string | null; email?: string | null } | null;
};

type ReportLog = {
  employeeId: string;
  status: string;
  workHours: number | null;
  date: Date;
};

// ─── GET /api/reports/monthly ────────────────────────────────────────────────
router.get('/monthly', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const department = (req.query.department as string) || '';

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...(department && { department }) },
    include: { user: { select: { name: true, email: true } } },
  }) as ReportEmployee[];
  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lt: end } },
  }) as ReportLog[];

  const summary = employees.map((emp) => {
    const empLogs = logs.filter((l) => l.employeeId === emp.id);
    return {
      employeeId: emp.employeeId, name: emp.user?.name || '', department: emp.department,
      present: empLogs.filter((l) => l.status === 'Present').length,
      late: empLogs.filter((l) => l.status === 'Late').length,
      absent: empLogs.filter((l) => l.status === 'Absent').length,
      leave: empLogs.filter((l) => l.status === 'Leave').length,
      totalWorkHours: empLogs.reduce((sum, l) => sum + (l.workHours || 0), 0).toFixed(2),
    };
  });

  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const dailyBreakdown = Array.from({ length: days }, (_, i) => {
    const date = new Date(start); date.setDate(date.getDate() + i);
    const dayStr = date.toISOString().split('T')[0];
    const dayLogs = logs.filter((l) => l.date.toISOString().split('T')[0] === dayStr);
    return { date: dayStr, present: dayLogs.filter((l) => l.status === 'Present').length, late: dayLogs.filter((l) => l.status === 'Late').length, absent: dayLogs.filter((l) => l.status === 'Absent').length };
  });

  res.json({ summary, dailyBreakdown, month, year, department });
});

export default router;

// ─── GET /api/reports/export/csv ────────────────────────────────────────────
router.get('/export/csv', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const department = (req.query.department as string) || '';

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  const STATUS_CODE: Record<string, string> = {
    Present: 'P', Late: 'L', Absent: 'A', Leave: 'Lv',
    HalfDay: '1/2', Holiday: 'H', WeeklyOff: 'W',
  };

  const employees = await prisma.employee.findMany({ where: { isActive: true, ...(department && { department }) }, include: { user: { select: { name: true } } }, orderBy: [{ department: 'asc' }, { employeeId: 'asc' }] }) as ReportEmployee[];
  const logs = await prisma.attendanceLog.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lt: end } } }) as ReportLog[];

  // Build day labels
  const dayLabels = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, i + 1));
    return `${i + 1}-${d.toLocaleString('default', { month: 'short', timeZone: 'UTC' })}`;
  });

  const rows = employees.map((emp) => {
    const empLogs = logs.filter((l) => l.employeeId === emp.id);
    const dayMap: Record<number, string> = {};
    empLogs.forEach((l) => { dayMap[new Date(l.date).getUTCDate()] = l.status; });

    const row: Record<string, string | number> = {
      'Emp ID': emp.employeeId, 'Employee Name': emp.user?.name || '', 'Department': emp.department,
    };
    dayLabels.forEach((label, i) => { row[label] = STATUS_CODE[dayMap[i + 1] || ''] || ''; });
    row['Present'] = empLogs.filter((l) => l.status === 'Present').length;
    row['Late'] = empLogs.filter((l) => l.status === 'Late').length;
    row['Absent'] = empLogs.filter((l) => l.status === 'Absent').length;
    row['Leave'] = empLogs.filter((l) => l.status === 'Leave').length;
    row['Work Hrs'] = empLogs.reduce((s, l) => s + (l.workHours || 0), 0).toFixed(2);
    return row;
  });

  const fields = ['Emp ID', 'Employee Name', 'Department', ...dayLabels, 'Present', 'Late', 'Absent', 'Leave', 'Work Hrs'];
  const { Parser } = await import('json2csv');
  const parser = new Parser({ fields });

  // Add title header and legend footer manually
  const csvData = parser.parse(rows);
  const title = `Attendance Sheet for ${monthName} - ${year}${department ? ` (${department})` : ''}`;
  const legend = '\nLegend: P = Present | L = Late | A = Absent | Lv = Leave | H = Holiday | W = Weekly Off | 1/2 = Half Day';
  const final = `${title}\n\n${csvData}${legend}`;

  const deptSuffix = department ? `_${department.replace(/\s+/g, '_')}` : '';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_sheet_${year}_${String(month).padStart(2, '0')}${deptSuffix}.csv"`);
  res.send(final);
});

// ─── GET /api/reports/export/pdf ────────────────────────────────────────────
router.get('/export/pdf', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const department = (req.query.department as string) || '';

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  const employees = await prisma.employee.findMany({ where: { isActive: true, ...(department && { department }) }, include: { user: { select: { name: true } } } }) as ReportEmployee[];
  const logs = await prisma.attendanceLog.findMany({ where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lt: end } } }) as ReportLog[];
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ margin: 40 });
  const deptSuffix = department ? `_${department.replace(/\s+/g, '_')}` : '';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="attendance_${year}_${String(month).padStart(2, '0')}${deptSuffix}.pdf"`);
  doc.pipe(res);
  doc.fontSize(18).text(`Attendance Report — ${monthName} ${year}${department ? ` (${department})` : ''}`, { align: 'center' });
  doc.moveDown();
  employees.forEach((emp) => {
    const empLogs = logs.filter((l) => l.employeeId === emp.id);
    doc.fontSize(11).text(`${emp.employeeId} | ${emp.user?.name || 'Unknown'} | ${emp.department} | Present: ${empLogs.filter((l) => l.status === 'Present').length} | Late: ${empLogs.filter((l) => l.status === 'Late').length} | Absent: ${empLogs.filter((l) => l.status === 'Absent').length} | Leave: ${empLogs.filter((l) => l.status === 'Leave').length} | Hours: ${empLogs.reduce((s, l) => s + (l.workHours || 0), 0).toFixed(2)}`);
  });

  doc.end();
});

// ─── GET /api/reports/sheet ──────────────────────────────────────────────────
// Returns per-employee × per-day attendance status for the sheet grid view
router.get('/sheet', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const department = (req.query.department as string) || '';

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...(department && { department }) },
    include: { user: { select: { name: true } } },
    orderBy: [{ department: 'asc' }, { employeeId: 'asc' }],
  }) as ReportEmployee[];

  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lt: end } },
  }) as (ReportLog & { id: string; punchIn: Date | null; punchOut: Date | null })[];

  const rows = employees.map((emp) => {
    const empLogs = logs.filter((l) => l.employeeId === emp.id);
    const days: Record<number, { status: string; logId: string; punchIn: string | null; punchOut: string | null }> = {};
    empLogs.forEach((l) => {
      const day = new Date(l.date).getUTCDate();
      days[day] = {
        status: l.status,
        logId: l.id,
        punchIn: l.punchIn ? new Date(l.punchIn).toISOString() : null,
        punchOut: l.punchOut ? new Date(l.punchOut).toISOString() : null,
      };
    });
    const presentCount = empLogs.filter((l) => l.status === 'Present').length;
    const lateCount = empLogs.filter((l) => l.status === 'Late').length;
    const absentCount = empLogs.filter((l) => l.status === 'Absent').length;
    const leaveCount = empLogs.filter((l) => l.status === 'Leave').length;
    const totalWorkHours = empLogs.reduce((s, l) => s + (l.workHours || 0), 0);
    return {
      employeeId: emp.employeeId,
      name: emp.user?.name || '',
      department: emp.department,
      days,
      presentCount,
      lateCount,
      absentCount,
      leaveCount,
      totalWorkHours: totalWorkHours.toFixed(2),
    };
  });

  res.json({ rows, daysInMonth, month, year, department });
});

// ─── GET /api/reports/export/excel ──────────────────────────────────────────
// Generates a fully styled Excel file with colored cells and day-of-week headers
router.get('/export/excel', async (req: AuthRequest, res: Response): Promise<void> => {
  const month = parseInt((req.query.month as string) || String(new Date().getMonth() + 1));
  const year = parseInt((req.query.year as string) || String(new Date().getFullYear()));
  const department = (req.query.department as string) || '';

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Status → { code, fgColor (ARGB), bgColor (ARGB) }
  const STATUS_STYLE: Record<string, { code: string; bg: string; fg: string }> = {
    Present:   { code: 'P',   bg: 'FFD1FAE5', fg: 'FF065F46' }, // emerald
    Late:      { code: 'L',   bg: 'FFFEF3C7', fg: 'FF92400E' }, // amber
    Absent:    { code: 'A',   bg: 'FFFEE2E2', fg: 'FF991B1B' }, // red
    HalfDay:   { code: '1/2', bg: 'FFFEFCE8', fg: 'FF854D0E' }, // yellow
    Leave:     { code: 'Lv',  bg: 'FFDBEAFE', fg: 'FF1E40AF' }, // blue
    Holiday:   { code: 'H',   bg: 'FFF3F4F6', fg: 'FF6B7280' }, // gray
    WeeklyOff: { code: 'W',   bg: 'FFEDE9FE', fg: 'FF5B21B6' }, // purple
  };

  const employees = await prisma.employee.findMany({
    where: { isActive: true, ...(department && { department }) },
    include: { user: { select: { name: true } } },
    orderBy: [{ department: 'asc' }, { employeeId: 'asc' }],
  }) as ReportEmployee[];

  const logs = await prisma.attendanceLog.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date: { gte: start, lt: end } },
  }) as ReportLog[];

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'HRMS';
  const ws = wb.addWorksheet(`${monthName} ${year}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 3 }],
  });

  // ── Column widths ──────────────────────────────────────────────────────────
  ws.columns = [
    { width: 11 }, // Emp ID
    { width: 24 }, // Name
    { width: 18 }, // Department
    ...Array.from({ length: daysInMonth }, () => ({ width: 5.5 })),
    { width: 7 }, { width: 7 }, { width: 7 }, { width: 7 }, { width: 10 },
  ];

  // ── Row 1: Title ───────────────────────────────────────────────────────────
  const titleRow = ws.getRow(1);
  const totalCols = 3 + daysInMonth + 5;
  const titleCell = titleRow.getCell(1);
  titleCell.value = `Attendance Sheet — ${monthName} ${year}${department ? ` (${department})` : ''}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF1E293B' } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle' };
  titleRow.height = 28;
  ws.mergeCells(1, 1, 1, totalCols);

  // ── Row 2: Weekday names ───────────────────────────────────────────────────
  const wdRow = ws.getRow(2);
  wdRow.height = 16;
  ['', '', '', ...Array.from({ length: daysInMonth }, (_, i) => {
    const dow = new Date(Date.UTC(year, month - 1, i + 1)).getUTCDay();
    return DAY_ABBR[dow];
  }), '', '', '', '', ''].forEach((val, ci) => {
    const cell = wdRow.getCell(ci + 1);
    cell.value = val;
    cell.font = { size: 8, color: { argb: ci >= 3 && ci < 3 + daysInMonth ? 'FF64748B' : 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (ci >= 3 && ci < 3 + daysInMonth) {
      const dow = new Date(Date.UTC(year, month - 1, ci - 2)).getUTCDay();
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dow === 0 ? 'FFFEE2E2' : 'FFF1F5F9' } };
    }
  });

  // ── Row 3: Column headers ──────────────────────────────────────────────────
  const hdrRow = ws.getRow(3);
  hdrRow.height = 22;
  const hdrCells = ['Emp ID', 'Name', 'Department',
    ...Array.from({ length: daysInMonth }, (_, i) => String(i + 1)),
    'P', 'L', 'A', 'Lv', 'Work Hrs',
  ];
  hdrCells.forEach((val, ci) => {
    const cell = hdrRow.getCell(ci + 1);
    cell.value = val;
    cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const isSunday = ci >= 3 && ci < 3 + daysInMonth && new Date(Date.UTC(year, month - 1, ci - 2)).getUTCDay() === 0;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isSunday ? 'FFB91C1C' : 'FF1E293B' } };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF334155' } },
      right: { style: 'thin', color: { argb: 'FF334155' } },
    };
  });

  // ── Data rows ──────────────────────────────────────────────────────────────
  employees.forEach((emp, ei) => {
    const empLogs = logs.filter((l) => l.employeeId === emp.id);
    const dayMap: Record<number, string> = {};
    empLogs.forEach((l) => { dayMap[new Date(l.date).getUTCDate()] = l.status; });

    const rowNum = ei + 4;
    const dataRow = ws.getRow(rowNum);
    dataRow.height = 18;
    const isEven = ei % 2 === 0;
    const rowBg = isEven ? 'FFFFFFFF' : 'FFF8FAFC';

    // Fixed columns
    const fixedVals = [emp.employeeId, emp.user?.name || '', emp.department];
    fixedVals.forEach((val, ci) => {
      const cell = dataRow.getCell(ci + 1);
      cell.value = val;
      cell.font = { size: 9, bold: ci === 0 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowBg } };
      cell.alignment = { vertical: 'middle', horizontal: ci === 0 ? 'center' : 'left' };
      cell.border = { right: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const status = dayMap[d];
      const cell = dataRow.getCell(3 + d);
      const style = status ? STATUS_STYLE[status] : null;
      const dow = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
      const isSun = dow === 0;

      cell.value = style ? style.code : (isSun ? 'W' : '');
      cell.font = { bold: true, size: 8.5, color: { argb: style ? style.fg : (isSun ? 'FFEF4444' : 'FFCBD5E1') } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: style ? style.bg : (isSun ? 'FFFEF2F2' : rowBg) },
      };
      cell.border = {
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
    }

    // Summary columns
    const summaryVals = [
      empLogs.filter((l) => l.status === 'Present').length,
      empLogs.filter((l) => l.status === 'Late').length,
      empLogs.filter((l) => l.status === 'Absent').length,
      empLogs.filter((l) => l.status === 'Leave').length,
      Number(empLogs.reduce((s, l) => s + (l.workHours || 0), 0).toFixed(2)),
    ];
    const summaryBgs = ['FFD1FAE5', 'FFFEF3C7', 'FFFEE2E2', 'FFDBEAFE', rowBg];
    const summaryFgs = ['FF065F46', 'FF92400E', 'FF991B1B', 'FF1E40AF', 'FF374151'];
    summaryVals.forEach((val, si) => {
      const cell = dataRow.getCell(3 + daysInMonth + si + 1);
      cell.value = val;
      cell.font = { bold: si < 4, size: 9, color: { argb: summaryFgs[si] } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: summaryBgs[si] } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { right: { style: 'thin', color: { argb: 'FFE2E8F0' } }, bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
  });

  // ── Legend ─────────────────────────────────────────────────────────────────
  const legendStartRow = employees.length + 5;
  ws.getRow(legendStartRow).getCell(1).value = 'Legend:';
  ws.getRow(legendStartRow).getCell(1).font = { bold: true, size: 9 };

  const legendItems = [
    { code: 'P', label: 'Present', bg: 'FFD1FAE5', fg: 'FF065F46' },
    { code: 'L', label: 'Late', bg: 'FFFEF3C7', fg: 'FF92400E' },
    { code: 'A', label: 'Absent', bg: 'FFFEE2E2', fg: 'FF991B1B' },
    { code: 'Lv', label: 'Leave', bg: 'FFDBEAFE', fg: 'FF1E40AF' },
    { code: 'H', label: 'Holiday', bg: 'FFF3F4F6', fg: 'FF6B7280' },
    { code: 'W', label: 'Weekly Off', bg: 'FFEDE9FE', fg: 'FF5B21B6' },
    { code: '1/2', label: 'Half Day', bg: 'FFFEFCE8', fg: 'FF854D0E' },
  ];
  legendItems.forEach((item, li) => {
    const codeCell = ws.getRow(legendStartRow + 1).getCell(li + 1);
    codeCell.value = item.code;
    codeCell.font = { bold: true, size: 9, color: { argb: item.fg } };
    codeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: item.bg } };
    codeCell.alignment = { horizontal: 'center', vertical: 'middle' };
    codeCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

    const labelCell = ws.getRow(legendStartRow + 2).getCell(li + 1);
    labelCell.value = `= ${item.label}`;
    labelCell.font = { size: 8, color: { argb: 'FF64748B' } };
  });

  const deptSuffix = department ? `_${department.replace(/\s+/g, '_')}` : '';
  const filename = `attendance_sheet_${year}_${String(month).padStart(2, '0')}${deptSuffix}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
});

// ─── PATCH /api/reports/attendance/:logId ─────────────────────────────────────
// Admin/HR can edit any attendance record: status, punchIn, punchOut, workHours
router.patch('/attendance/:logId', requireRole(['Admin', 'HR']), async (req: AuthRequest, res: Response): Promise<void> => {
  const { logId } = req.params;
  const { status, punchIn, punchOut, workHours, reason } = req.body as {
    status?: string;
    punchIn?: string | null;
    punchOut?: string | null;
    workHours?: number | null;
    reason?: string;
  };

  const VALID_STATUSES = ['Present', 'Late', 'Absent', 'HalfDay', 'Leave', 'Holiday', 'WeeklyOff'];
  if (status && !VALID_STATUSES.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const existing = await prisma.attendanceLog.findUnique({ where: { id: logId } });
  if (!existing) {
    res.status(404).json({ error: 'Attendance record not found' });
    return;
  }

  // Auto-compute workHours if punchIn + punchOut provided but workHours not explicitly set
  let computedWorkHours = workHours;
  if (computedWorkHours === undefined && punchIn && punchOut) {
    const diff = (new Date(punchOut).getTime() - new Date(punchIn).getTime()) / (1000 * 60 * 60);
    computedWorkHours = Math.max(0, Math.round(diff * 100) / 100);
  }

  const updated = await prisma.attendanceLog.update({
    where: { id: logId },
    data: {
      ...(status && { status: status as any }),
      ...(punchIn !== undefined && { punchIn: punchIn ? new Date(punchIn) : null }),
      ...(punchOut !== undefined && { punchOut: punchOut ? new Date(punchOut) : null }),
      ...(computedWorkHours !== undefined && { workHours: computedWorkHours }),
      isRegularized: true,
      regularizationReason: reason || `Edited by admin (${req.user?.email || 'system'})`,
      regularizationStatus: 'Approved',
    },
  });

  res.json({ success: true, log: updated });
});
