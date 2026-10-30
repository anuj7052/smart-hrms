export type UserRole = 'Admin' | 'HR' | 'Manager' | 'Employee';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department?: string;
}

export interface Shift {
  _id: string; id?: string;
  name: string;
  startTime: string;
  endTime: string;
  gracePeriodMinutes: number;
  halfDayThresholdHours: number;
  isActive: boolean;
}

export interface Employee {
  _id: string; id?: string;
  userId: { _id: string; id?: string; name: string; email: string; role: UserRole };
  employeeId: string;
  department: string;
  designation: string;
  managerName?: string | null;
  shift: string;
  shiftId?: Shift | null;
  joinDate: string;
  birthday?: string | null;
  lastWorkingDate?: string | null;
  phone?: string;
  isActive: boolean;
}

export interface Device {
  _id: string; id?: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string;
  username: string;
  etlUsername?: string;
  autoSync?: boolean;
  syncInterval?: number;
  lastEtlSync?: string;
  status: 'Online' | 'Offline' | 'Unknown';
  lastSync?: string;
  lastError?: string;
  isActive: boolean;
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'HalfDay' | 'Leave' | 'Holiday' | 'WeeklyOff';

export type HolidayType = 'National' | 'Festival' | 'CompanyHoliday';

export interface Holiday {
  id: string;
  name: string;
  date: string;
  festivalName?: string | null;
  description?: string | null;
  holidayType: HolidayType;
  isOptional: boolean;
  year: number;
  createdAt?: string;
  updatedAt?: string;
}
export type AttendanceMode = 'Office' | 'WFH' | 'Field' | 'ClientVisit';

export interface GeoPoint { lat: number; lng: number; }

export interface PunchLog {
  time: string;
  direction: 'IN' | 'OUT';
  deviceName: string;
  deviceSN: string;
}

export interface AttendanceLog {
  // Both MongoDB (_id) and Prisma (id) field names supported
  _id?: string; id?: string;
  employeeId: string | { _id?: string; id?: string; employeeId: string; userId?: { name: string }; user?: { name: string } };
  // Prisma populated relation
  employee?: { id: string; employeeId: string; user: { name: string } };
  date: string;
  punchIn?: string;
  punchOut?: string;
  workHours?: number;
  status: AttendanceStatus;
  attendanceMode?: AttendanceMode;
  // MongoDB nested location
  punchInLocation?: GeoPoint;
  punchOutLocation?: GeoPoint;
  // Prisma flat location fields
  punchInLat?: number; punchInLng?: number; punchInAddress?: string | null;
  punchOutLat?: number; punchOutLng?: number; punchOutAddress?: string | null;
  appPunched?: boolean;
  source?: string;
  punchLogs?: PunchLog[];
  isRegularized: boolean;
  regularizationStatus?: 'Pending' | 'Approved' | 'Rejected';
  regularizationReason?: string;
  regularizationRequestedAt?: string;
}

export type WFHMode = 'WFH' | 'Field' | 'ClientVisit';
export type WFHRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface WFHRequest {
  _id: string;
  id?: string;
  employeeId: string | { _id: string; employeeId: string; userId?: { name: string; email: string } };
  /** Flat fields returned by the admin WFH list endpoint */
  employeeDbId?: string;
  employeeName?: string;
  employeeEmail?: string;
  department?: string;
  designation?: string;
  date: string;
  mode: WFHMode;
  reason: string;
  status: WFHRequestStatus;
  reviewComment?: string;
  createdAt: string;
}

export interface LeaveType {
  _id: string;
  name: string;
  daysAllowed: number;
  isUnlimited?: boolean;
  description?: string;
}

export interface LeaveBalance {
  _id: string;
  leaveTypeId: { _id: string; name: string; isUnlimited?: boolean };
  allocated: number;
  used: number;
  remaining: number;
}

export type LeaveStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface LeaveRequest {
  _id: string;
  employeeId: { _id: string; employeeId: string; userId?: { name: string; email: string } };
  leaveTypeId: { _id: string; name: string };
  fromDate: string;
  toDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewComment?: string;
  createdAt: string;
}

export interface AppSettings {
  allowedEmailDomains: string[];
  shiftStart: string;
  shiftEnd: string;
  lateThresholdMinutes: number;
  lateArrivalTime: string;
  halfDayThresholdHours: number;
  workingDays: string[];
  holidays: Array<{ name: string; date: string }>;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  emailNotificationsEnabled: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface TodayPunchStatus {
  log: AttendanceLog | null;
  isPunchedIn: boolean;
  isPunchedOut: boolean;
  shiftStart: string;
  todayDate: string;
}
