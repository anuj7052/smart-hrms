/**
 * eTimeTrackLite Web Scraper Service
 *
 * Logs into the eTimeTrackLite ASP.NET web portal and downloads attendance
 * records for a given date range.
 */
import crypto from 'crypto';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as XLSX from 'xlsx';
import { parseISTWallClockToUTC } from '../utils/dateIST';

/**
 * Parse a US-format "M/D/YYYY h:mm:ss AM/PM" string as an IST wall-clock
 * and return the corresponding UTC Date. Robust to server TZ.
 */
function parseUSDateTimeAsIST(input: string): Date {
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return new Date(NaN);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);
  const ampm = m[7]?.toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  return parseISTWallClockToUTC(iso);
}

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function createEtlClient(baseUrl: string, timeoutMs = 30000) {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      baseURL: baseUrl,
      withCredentials: true,
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': DESKTOP_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
  );
}

// ── Credential encryption (AES-256-CBC) ──────────────────────────────────────
// Used to store ETL Portal passwords in MongoDB in a retrievable (non-bcrypt) form.
function getEncKey(): Buffer {
  const secret = process.env.JWT_SECRET || 'hrms-default-key-change-in-production';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptForStorage(plain: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

export function decryptFromStorage(stored: string): string {
  const [ivHex, encHex] = stored.split(':');
  if (!ivHex || !encHex) throw new Error('Invalid encrypted credential format');
  const decipher = crypto.createDecipheriv('aes-256-cbc', getEncKey(), Buffer.from(ivHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
// ─────────────────────────────────────────────────────────────────────────────

export interface EtlAttendanceRecord {
  employeeDeviceId: string;
  timestamp: Date;
  punchType: number;
  raw: string;
}

export interface EtlFetchResult {
  success: boolean;
  message: string;
  records: EtlAttendanceRecord[];
}

/**
 * AES-128-ECB encryption matching:
 *   CryptoJS.AES.encrypt(plain, CryptoJS.enc.Utf8.parse(key), {mode:ECB, padding:Pkcs7})
 *
 * The key is the 16-digit number from StaffloginDialog$txtKey.
 */
function encryptPassword(plain: string, secretKey: string): string {
  const keyBuf = Buffer.from(secretKey, 'utf8');
  const keySize = keyBuf.length <= 16 ? 16 : keyBuf.length <= 24 ? 24 : 32;
  const paddedKey = Buffer.alloc(keySize, 0);
  keyBuf.copy(paddedKey);
  const cipher = crypto.createCipheriv(`aes-${keySize * 8}-ecb` as crypto.CipherGCMTypes, paddedKey, null);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

function extractHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const matches = html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi);
  for (const m of matches) {
    const nameM = m[0].match(/name="([^"]*)"/i);
    const valM = m[0].match(/value="([^"]*)"/i);
    if (nameM) fields[nameM[1]] = valM ? valM[1] : '';
  }
  return fields;
}

function extractFieldByName(html: string, fieldName: string): string {
  // Avoid $ in regex — search by literal index
  const nameAttr = `name="${fieldName}"`;
  const idx = html.indexOf(nameAttr);
  if (idx === -1) return '';
  const chunk = html.substring(Math.max(0, idx - 200), idx + 300);
  const m = chunk.match(/value="([^"]*)"/);
  return m ? m[1] : '';
}

/**
 * Parse attendance lines from eTimeTrackLite export.
 * Supported formats:
 *   TAB-delimited: PIN\tDate Time\tVerifyType\tPunchType
 *   Comma-delimited: PIN,Date Time,VerifyType,PunchType
 */
function parseAttendanceData(raw: string): EtlAttendanceRecord[] {
  const records: EtlAttendanceRecord[] = [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Skip HTML, headers
    if (line.startsWith('<') || line.startsWith('PIN') || line.startsWith('No.')) continue;

    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length < 2) continue;

    const pin = parts[0]?.trim();
    const dateTime = parts[1]?.trim();
    if (!pin || !dateTime || !/^\d/.test(pin)) continue;

    const timestamp = parseISTWallClockToUTC(dateTime.replace(' ', 'T'));
    if (isNaN(timestamp.getTime())) continue;

    const punchType = parseInt(parts[3]?.trim() || '0') || 0;
    records.push({ employeeDeviceId: pin, timestamp, punchType, raw: line });
  }
  return records;
}

async function etlLogin(
  baseUrl: string,
  username: string,
  password: string,
  timeoutMs = 30000,
): Promise<{ client: ReturnType<typeof createEtlClient>; success: boolean; message: string }> {
  const client = createEtlClient(baseUrl, timeoutMs);

  // Step 1: GET login page
  const r1 = await client.get('/iclock/');
  if (r1.status !== 200) {
    return { client, success: false, message: `eTimeTrackLite unreachable (HTTP ${r1.status})` };
  }

  const html1 = String(r1.data);
  const hidden = extractHiddenFields(html1);
  const txtKey = extractFieldByName(html1, 'StaffloginDialog$txtKey');
  if (!txtKey) {
    return { client, success: false, message: 'Could not find login key on eTimeTrackLite page (server may be down or URL is wrong)' };
  }

  // Step 2: Encrypt password & POST login form
  const encPassword = encryptPassword(password, txtKey);
  const formData = new URLSearchParams({
    ...hidden,
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': username,
    'StaffloginDialog$Txt_Password': encPassword,
    'StaffloginDialog$txtKey': txtKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });

  const r2 = await client.post('/iclock/Default.aspx', formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}/iclock/` },
  });

  const loginBody = String(r2.data);
  const finalUrl: string = (r2.request as { res?: { responseUrl?: string } })?.res?.responseUrl || '';

  // Login failed if form still visible or server redirected to logout
  const stillOnLogin = /name="StaffloginDialog\$Btn_Ok"/i.test(loginBody);
  const errorMsg = (loginBody.match(/InValidError[\s\S]{0,200}<font color="Red">([^<]+)</i) || [])[1];
  const redirectedToLogout = /LogOut\.aspx/i.test(finalUrl) && loginBody.length < 2000;

  if (stillOnLogin || redirectedToLogout) {
    const reason = errorMsg ? errorMsg.trim() : redirectedToLogout ? 'server rejected login (check User-Agent or credentials)' : 'invalid username or password';
    return { client, success: false, message: `eTimeTrackLite login failed — ${reason}` };
  }

  return { client, success: true, message: 'Login successful' };
}

// ── Excel Report Export (LogRecords.aspx → Excel download) ────────────────────
// This approach gets ALL punch records with NO pagination limit.
// Ported from essl-proxy/etimetrack.js which is proven to work.

function pickAllHidden(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*type="hidden"/gi)) out[m[1]] = m[2];
  return out;
}

function selectedOf(html: string, name: string): string {
  const re = new RegExp('<select[^>]*name="' + name.replace(/\$/g, '\\$') + '"[\\s\\S]*?</select>', 'i');
  const m = html.match(re);
  if (!m) return '';
  const sel = m[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/i);
  return sel ? sel[1] : '';
}

async function fetchReportXlsBuffer(
  client: ReturnType<typeof createEtlClient>,
  baseUrl: string,
  fromD: Date,
  toD: Date,
): Promise<Buffer> {
  const base = baseUrl.replace(/\/+$/, '');
  const url = `${base}/iclock/Reports/LogRecords.aspx`;

  // Step 1: GET the report page to get form fields
  const r = await client.get(url, { headers: { Referer: `${base}/iclock/Main.aspx` } });
  const html = String(r.data || '');
  if (!/ReportProtoType\$btn_GenerateReport/.test(html)) {
    throw new Error('LogRecords.aspx not accessible (session lost?).');
  }

  const hidden = pickAllHidden(html);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.append(k, v);

  // Set date range
  params.set('ReportProtoType$Drp_FromDateDD', String(fromD.getDate()).padStart(2, '0'));
  params.set('ReportProtoType$Drp_FromDateMM', String(fromD.getMonth() + 1));
  params.set('ReportProtoType$Drp_FromDateYYYY', String(fromD.getFullYear()));
  params.set('ReportProtoType$Drp_ToDateDD', String(toD.getDate()).padStart(2, '0'));
  params.set('ReportProtoType$Drp_ToDateMM', String(toD.getMonth() + 1));
  params.set('ReportProtoType$Drp_ToDateYYYY', String(toD.getFullYear()));
  params.set('ReportProtoType$drp_ReportType', 'Date Wise');

  // Preserve selected filter values
  for (const sn of [
    'ReportProtoType$drp_EmployeeCategory',
    'ReportProtoType$drp_EmployeeDesignation',
    'ReportProtoType$drp_EmployeeLocation',
    'ReportProtoType$drp_EmployeeType',
    'ReportProtoType$Lst_FilterCompany',
    'ReportProtoType$Lst_FilterDepartment',
    'ReportProtoType$Lst_FilterDevice',
  ]) {
    const v = selectedOf(html, sn);
    if (v) params.set(sn, v);
  }
  params.set('ReportProtoType$btn_GenerateReport', 'Generate Report');
  params.set('__EVENTTARGET', '');
  params.set('__EVENTARGUMENT', '');

  // Step 2: POST to generate the report
  const r2 = await client.post(url, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: url,
      Origin: base,
    },
    timeout: 90000,
  });
  const html2 = String(r2.data || '');
  const m = html2.match(/"ExportUrlBase"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error('Report did not render (no ExportUrlBase).');
  const exportBase = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const ctlMatch = exportBase.match(/ControlID=([0-9a-f]{20,})/);
  if (!ctlMatch) throw new Error('No ControlID in ExportUrlBase.');
  const controlID = ctlMatch[1];

  // Step 3: Download the Excel export
  const exportUrl =
    `${base}/iclock/Reserved.ReportViewerWebControl.axd` +
    '?Culture=1033&CultureOverrides=True&UICulture=1033&UICultureOverrides=True' +
    '&ReportStack=1&ControlID=' + controlID +
    '&Mode=true&OpType=Export&FileName=LogRecords' +
    '&ContentDisposition=OnlyHtmlInline&Format=EXCEL';

  const r3 = await client.get(exportUrl, {
    headers: { Referer: url },
    responseType: 'arraybuffer',
    timeout: 120000,
  });
  if (r3.status !== 200 || !r3.data || r3.data.length < 4096) {
    throw new Error(`Excel export failed (status ${r3.status}, len ${r3.data?.length}).`);
  }
  const ct = String(r3.headers['content-type'] || '');
  if (/text\/html/i.test(ct)) {
    throw new Error('Excel export returned HTML (auth/session error).');
  }
  return Buffer.from(r3.data);
}

function parsePunchesFromXls(buf: Buffer): EtlAttendanceRecord[] {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  /*
    Row layout (Date Wise):
      ["", "Date:", "", "2026-04-01", ...]                                  -> sets currentDate
      ["", "Log Date", "", "Employee Code", "Employee Name", ...] -> header
      ["", "10:09:01", "", "6666", "Brajmohan", "", "", "Biometric", ...]   -> punch row
  */
  const records: EtlAttendanceRecord[] = [];
  let currentDate = '';

  for (const row of rows) {
    if (!row || row.length < 4) continue;

    // Date header row
    if (String(row[1]).trim() === 'Date:' && row[3]) {
      const v = row[3];
      if (v instanceof Date && !isNaN(v.getTime())) {
        const y = v.getFullYear(), mo = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
        currentDate = `${y}-${mo}-${d}`;
      } else {
        const s = String(v).trim();
        const md = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (md) currentDate = `${md[1]}-${md[2]}-${md[3]}`;
      }
      continue;
    }
    // Skip headers
    if (String(row[1]).trim() === 'Log Date') continue;

    const time = String(row[1] || '').trim();
    const empCode = String(row[3] || '').trim();
    if (!time || !empCode || !currentDate) continue;
    if (!/^\d{1,2}:\d{2}/.test(time)) continue;

    const empName = String(row[4] || '').trim();
    const dirRaw = String(row[6] || '').trim().toLowerCase();
    const fullTime = time.length === 5 ? time + ':00' : time;
    const timestamp = parseISTWallClockToUTC(`${currentDate}T${fullTime}`);
    if (isNaN(timestamp.getTime())) continue;

    const punchType = (dirRaw === 'out' || dirRaw === 'check-out' || dirRaw === '1') ? 1 : 0;
    records.push({
      employeeDeviceId: empCode,
      timestamp,
      punchType,
      raw: `${empCode}|${empName}|${currentDate} ${fullTime}|${dirRaw}`,
    });
  }
  return records;
}

async function fetchReportExcel(
  client: ReturnType<typeof createEtlClient>,
  baseUrl: string,
  fromDate: string,
  toDate: string,
): Promise<EtlAttendanceRecord[]> {
  const fromD = new Date(fromDate);
  const toD = new Date(toDate);
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) throw new Error('Invalid date range');

  let buf: Buffer;
  try {
    buf = await fetchReportXlsBuffer(client, baseUrl, fromD, toD);
  } catch (e) {
    // Session may have expired — caller will retry with fresh login
    throw e;
  }
  const records = parsePunchesFromXls(buf);
  console.log(`[ETL] Excel report export: ${records.length} punches for ${fromDate} → ${toDate}`);
  return records;
}

/**
 * Fetch raw device punch records directly from Manage/DeviceLogList.aspx.
 * This is the preferred strategy since the Excel report (LogRecords.aspx)
 * can lag by 1-2 days for recent data.
 */
export async function fetchFromESSLDeviceLogList(
  baseUrl: string,
  username: string,
  password: string,
  fromDate: string,  // YYYY-MM-DD
  toDate: string,    // YYYY-MM-DD
  timeoutMs = 60000,
): Promise<EtlFetchResult> {
  const { client, success, message } = await etlLogin(baseUrl, username, password, timeoutMs);
  if (!success) return { success: false, message, records: [] };

  const referer = `${baseUrl}/iclock/Main.aspx`;
  const rangeStart = parseISTWallClockToUTC(`${fromDate}T00:00:00`);
  const rangeEnd = parseISTWallClockToUTC(`${toDate}T23:59:59`);

  try {
    const allRecords = await fetchDeviceLogList(client, fromDate, toDate, referer);
    const records = allRecords.filter(r => r.timestamp >= rangeStart && r.timestamp <= rangeEnd);
    return { success: true, message: `Fetched ${records.length} record(s) via DeviceLogList`, records };
  } catch (e) {
    return { success: false, message: `DeviceLogList fetch failed: ${(e as Error).message}`, records: [] };
  }
}

export async function fetchFromETimeTrackLite(
  baseUrl: string,   // e.g. http://98.70.41.54:85
  username: string,
  password: string,
  fromDate: string,  // YYYY-MM-DD
  toDate: string,    // YYYY-MM-DD
  timeoutMs = 60000, // network timeout for login/report-page steps
): Promise<EtlFetchResult> {

  const { client, success, message } = await etlLogin(baseUrl, username, password, timeoutMs);
  if (!success) return { success: false, message, records: [] };

  const referer = `${baseUrl}/iclock/Main.aspx`;

  // The eTimeTrackLite portal (esp. the LogRecords.aspx Excel report) does NOT
  // reliably honour an empty date range — when the requested range has no
  // punches it returns the MOST RECENT available data instead of an empty set.
  // We therefore clamp every approach's output to the requested [from, to] IST
  // day window so the caller only ever sees punches that truly fall in range.
  const rangeStart = parseISTWallClockToUTC(`${fromDate}T00:00:00`);
  const rangeEnd = parseISTWallClockToUTC(`${toDate}T23:59:59`);
  const clampToRange = (records: EtlAttendanceRecord[]): EtlAttendanceRecord[] => {
    if (isNaN(rangeStart.getTime()) || isNaN(rangeEnd.getTime())) return records;
    return records.filter((r) => r.timestamp >= rangeStart && r.timestamp <= rangeEnd);
  };

  // The portal's internal date filter often uses UTC boundaries rather than IST,
  // so a request for "2026-06-09" may only return records from UTC midnight to
  // midnight (IST 05:30 to next 05:30), missing early-morning IST punches.
  // Extend the query by ±1 day so we capture the full IST day; clampToRange
  // still correctly filters to only the requested IST window.
  const queryFromD = new Date(new Date(`${fromDate}T00:00:00Z`).getTime() - 86400000);
  const queryToD = new Date(new Date(`${toDate}T00:00:00Z`).getTime() + 86400000);
  const queryFromDate = queryFromD.toISOString().split('T')[0];
  const queryToDate = queryToD.toISOString().split('T')[0];

  // Approach 0 (PRIMARY): Manage/DeviceLogList.aspx — raw device punches, always up-to-date
  // This is tried first because the Excel report (LogRecords.aspx) can lag by 1-2 days.
  try {
    const records = clampToRange(await fetchDeviceLogList(client, queryFromDate, queryToDate, referer));
    if (records.length > 0) {
      return { success: true, message: `Fetched ${records.length} record(s) via DeviceLogList`, records };
    }
  } catch (e) {
    console.warn('[ETL] DeviceLogList approach failed:', (e as Error).message);
  }

  // Approach 1 (FALLBACK): Excel Report Export from LogRecords.aspx — gets ALL records, no pagination limit
  try {
    const records = clampToRange(await fetchReportExcel(client, baseUrl, queryFromDate, queryToDate));
    if (records.length > 0) {
      return { success: true, message: `Fetched ${records.length} record(s) via Excel report export`, records };
    }
  } catch (e) {
    console.warn('[ETL] Excel report export failed:', (e as Error).message);
  }

  // Approach 2: Manage/AttendenceLog.aspx (processed attendance — InTime/OutTime per employee)
  try {
    const records = clampToRange(await fetchAttendenceLog(client, queryFromDate, queryToDate, referer));
    if (records.length > 0) {
      return { success: true, message: `Fetched ${records.length} attendance record(s)`, records };
    }
  } catch (e) {
    console.warn('[ETL] AttendenceLog approach failed:', (e as Error).message);
  }

  return {
    success: true,
    message: 'Login succeeded but no attendance records found for the selected date range.',
    records: [],
  };
}

/**
 * Lightweight connectivity check for an eTimeTrackLite portal.
 *
 * Unlike `fetchFromETimeTrackLite`, this ONLY performs the login handshake —
 * it does NOT download the (slow) Excel report. Use this for "Test Connection"
 * buttons so the check is fast and reflects reachability + credential validity
 * rather than whether any attendance rows exist for today.
 */
export interface EtlPingResult {
  /** TCP/HTTP reachable AND login succeeded. */
  ok: boolean;
  /** Portal was reachable over the network (even if login failed). */
  reachable: boolean;
  message: string;
}

export async function pingEtlPortal(
  baseUrl: string,
  username: string,
  password: string,
  timeoutMs = 15000,
): Promise<EtlPingResult> {
  try {
    const { success, message } = await etlLogin(baseUrl, username, password, timeoutMs);
    return { ok: success, reachable: true, message };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    // Distinguish "device unreachable" from other failures for clearer UX.
    const unreachable =
      e?.code === 'ECONNABORTED' || e?.code === 'ECONNREFUSED' ||
      e?.code === 'EHOSTUNREACH' || e?.code === 'ETIMEDOUT' ||
      e?.code === 'ENOTFOUND' || /timeout/i.test(e?.message || '');
    const msg = unreachable
      ? `Device unreachable at ${baseUrl} — check that it is powered on and on the network (${e?.code || 'timeout'}).`
      : (e?.message || 'Connection failed');
    return { ok: false, reachable: !unreachable, message: msg };
  }
}

/**
 * Fetch from Manage/AttendenceLog.aspx — processed daily attendance (InTime/OutTime).
 * Date selects: drp_FromddDate, drp_FromMMDate, drp_FromYYYYDate (and To variants).
 */
async function fetchAttendenceLog(
  client: ReturnType<typeof createEtlClient>,
  fromDate: string,
  toDate: string,
  referer: string,
): Promise<EtlAttendanceRecord[]> {
  const pageUrl = '/iclock/Manage/AttendenceLog.aspx';
  const r1 = await client.get(pageUrl, { headers: { Referer: referer } });
  const html = String(r1.data);
  if (html.includes('CustomError')) throw new Error('Access denied to AttendenceLog.aspx');

  const hidden = extractHiddenFields(html);

  // Parse date parts
  const [fy, fm, fd] = fromDate.split('-');
  const [ty, tm, td] = toDate.split('-');

  const formData = new URLSearchParams({
    ...hidden,
    '__EVENTTARGET': 'btnUpdate',
    '__EVENTARGUMENT': '',
    // AttendenceLog uses zero-padded day/month options ('01','02'...)
    'drp_FromddDate': fd,
    'drp_FromMMDate': fm,
    'drp_FromYYYYDate': fy,
    // To date fields (may or may not exist on the page - server ignores unknown fields)
    'drp_ToddDate': td,
    'drp_ToMMDate': tm,
    'drp_ToYYYYDate': ty,
    'drp_AttStatus': 'All',
    'btnUpdate': 'Update',
  });

  const r2 = await client.post(pageUrl, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: referer },
  });
  const body = String(r2.data);
  return parseAttendanceLogTable(body);
}

/**
 * Parse the Manage/AttendenceLog.aspx table.
 * Columns: AttendanceLogId | Attendance Date | Emp Code | Emp Name | InTime | OutTime
 */
function parseAttendanceLogTable(html: string): EtlAttendanceRecord[] {
  const records: EtlAttendanceRecord[] = [];
  // Find the data grid table rows
  const rows = html.match(/<tr[^>]*>\s*(?:<td[^>]*>[\s\S]*?<\/td>\s*){4,}<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim());

    if (cells.length < 6) continue;

    // Detect header rows
    if (/AttendanceLogId|Emp Code|Attendance Date/i.test(cells.join(' '))) continue;

    // cells: [id, date, empCode, empName, inTime, outTime, ...]
    const dateStr = cells[1];
    const empCode = cells[2];
    const inTimeStr = cells[4];
    const outTimeStr = cells[5];

    if (!dateStr || !empCode || !/\d/.test(dateStr)) continue;

    // Parse InTime as check-in record
    if (inTimeStr && /\d:\d/.test(inTimeStr)) {
      const ts = parseISTWallClockToUTC(`${dateStr.trim()} ${inTimeStr.trim()}`.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
      if (!isNaN(ts.getTime())) {
        records.push({ employeeDeviceId: empCode.trim(), timestamp: ts, punchType: 0, raw: row.replace(/<[^>]+>/g, ' ').trim() });
      }
    }
    // Parse OutTime as check-out record
    if (outTimeStr && /\d:\d/.test(outTimeStr)) {
      const ts = parseISTWallClockToUTC(`${dateStr.trim()} ${outTimeStr.trim()}`.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1'));
      if (!isNaN(ts.getTime())) {
        records.push({ employeeDeviceId: empCode.trim(), timestamp: ts, punchType: 1, raw: row.replace(/<[^>]+>/g, ' ').trim() });
      }
    }
  }
  return records;
}

/**
 * Fetch from Manage/DeviceLogList.aspx — raw device punch events.
 * Uses GET with query params per day (one request per day in range).
 * Confirmed working format: ?Device=0&FromDay=DD&ToDay=DD&Month=MM&Year=YYYY&VerifyMode=0&SortBy=LogDate&SortOrder=Asc&PageSize=5000
 */
async function fetchDeviceLogList(
  client: ReturnType<typeof createEtlClient>,
  fromDate: string,
  toDate: string,
  referer: string,
): Promise<EtlAttendanceRecord[]> {
  const allRecords: EtlAttendanceRecord[] = [];
  const from = new Date(fromDate + 'T00:00:00Z');
  const to = new Date(toDate + 'T00:00:00Z');

  // Iterate day by day
  for (let cur = new Date(from); cur <= to; cur.setUTCDate(cur.getUTCDate() + 1)) {
    const dd = String(cur.getUTCDate()).padStart(2, '0');
    const mm = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = String(cur.getUTCFullYear());
    const url = `/iclock/Manage/DeviceLogList.aspx?Device=0&FromDay=${dd}&ToDay=${dd}&Month=${mm}&Year=${yyyy}&VerifyMode=0&SortBy=LogDate&SortOrder=Asc&PageSize=5000`;
    try {
      const r = await client.get(url, { headers: { Referer: referer } });
      const html = String(r.data || '');
      if (html.includes('CustomError') || html.length < 5000) continue;
      const recs = parseDeviceLogTable(html);
      allRecords.push(...recs);
      console.log(`[ETL] DeviceLogList ${yyyy}-${mm}-${dd}: ${recs.length} punches`);
    } catch (e) {
      console.warn(`[ETL] DeviceLogList fetch failed for ${yyyy}-${mm}-${dd}:`, (e as Error).message);
    }
  }

  return allRecords;
}

/**
 * Parse the Manage/DeviceLogList.aspx table.
 * ASP.NET GridView uses ob_gR rows with ob_gRC divs inside ob_gC cells.
 * Column order: Download Date | [hidden] | User Id | Log Date | Device Name | Serial No | Att State | ...
 */
function parseDeviceLogTable(html: string): EtlAttendanceRecord[] {
  const records: EtlAttendanceRecord[] = [];
  const datePat = /^\d{2}\s+[A-Za-z]{3}\s+\d{4}/;

  // Match ASP.NET GridView rows (ob_gR class)
  const rowRe = /<tr[^>]*class="ob_gR[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    // Extract all cell values from ob_gRC divs
    const cellValues: string[] = [];
    const cellRe = /class="ob_gRC[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      const val = cellMatch[1].replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      cellValues.push(val);
    }

    if (cellValues.length < 5) continue;

    // Find date indices — column layout: DownloadDate (date), UserId, LogDate (date), DeviceName, SerialNo, AttState, ...
    const dateIndices = cellValues.map((v, i) => datePat.test(v) ? i : -1).filter(i => i >= 0);
    if (dateIndices.length < 1) continue;

    const downloadDateIdx = dateIndices[0];
    const logDateIdx = dateIndices.length >= 2 ? dateIndices[1] : -1;

    let userId = '';
    let logDateStr = '';
    let attState = '';
    let serialNo = '';

    if (logDateIdx === downloadDateIdx + 2) {
      // Standard layout: DownloadDate, UserId, LogDate, DeviceName, SerialNo, AttState
      userId = cellValues[downloadDateIdx + 1];
      logDateStr = cellValues[logDateIdx];
      serialNo = cellValues.find(v => /^[A-Z]{4}\d{9,}/.test(v)) || '';
      attState = cellValues.find(v => /Check[-\s]/i.test(v)) || '';
    } else {
      // Fallback: infer by content patterns
      userId = cellValues.find(v => /^[A-Z]{2,4}\d{3,}/.test(v) && !datePat.test(v) && !/^CGKK/.test(v)) || '';
      logDateStr = cellValues[downloadDateIdx];
      serialNo = cellValues.find(v => /^CGKK/.test(v)) || '';
      attState = cellValues.find(v => /Check[-\s]/i.test(v)) || '';
    }

    if (!userId || !logDateStr || !attState) continue;

    // Parse "02 Jul 2026 18:39:57" as IST wall-clock (+05:30)
    const parsed = new Date(logDateStr + ' +05:30');
    if (isNaN(parsed.getTime())) continue;

    const punchType = /out|exit|check.?out/i.test(attState) ? 1 : 0;
    records.push({ employeeDeviceId: userId.trim(), timestamp: parsed, punchType, raw: cellValues.join('\t') });
  }
  return records;
}

/**
 * Parse manually-pasted or uploaded attendance data.
 * Accepts TAB-delimited or comma-separated lines in iClock format:
 *   PIN  Date Time  VerifyType  PunchType
 */
export function parseManualAttendanceData(raw: string): EtlAttendanceRecord[] {
  return parseAttendanceData(raw);
}

// ── Employee scraper ──────────────────────────────────────────────────────────

export interface EtlEmployee {
  pin: string;
  name: string;
  department?: string;
}

/**
 * Login to eTimeTrackLite and attempt to scrape the employee/staff list.
 * Returns an empty array when login succeeds but the employee-list page is
 * not found (different firmware versions use different URL patterns).
 */
export async function fetchEmployeesFromETL(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ success: boolean; employees: EtlEmployee[]; message: string }> {
  const { client, success, message } = await etlLogin(baseUrl, username, password);
  if (!success) return { success: false, employees: [], message };

  const staffPages = [
    '/iclock/StaffInfo.aspx',
    '/iclock/UserInfo.aspx',
    '/iclock/Staff.aspx',
    '/iclock/EmployeeInfo.aspx',
    '/iclock/Personnel/StaffInfo.aspx',
  ];

  for (const page of staffPages) {
    try {
      const r = await client.get(page);
      if (r.status === 200) {
        const body = String(r.data);
        if (body.includes('RedirectToHome')) continue;
        const employees = parseEmployeeTable(body);
        if (employees.length > 0) {
          return { success: true, employees, message: `Found ${employees.length} employee(s) from ${page}` };
        }
      }
    } catch { /* try next */ }
  }

  return {
    success: true,
    employees: [],
    message: 'Login succeeded but employee list page not found. Employees will be auto-created from punch data.',
  };
}

function parseEmployeeTable(html: string): EtlEmployee[] {
  const employees: EtlEmployee[] = [];
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
      .map(td => td.replace(/<[^>]+>/g, '').trim());
    if (cells.length < 2) continue;
    const pin = cells[0];
    const name = cells[1];
    if (!pin || !name || !/^\d+$/.test(pin) || name.toLowerCase() === 'pin') continue;
    employees.push({ pin, name, department: cells[2] || undefined });
  }
  return employees;
}

// ── Direct iClock Server / ESSL REST Pull ─────────────────────────────────────
/**
 * Fetch attendance data from an eTimeTrackLite server using multiple strategies:
 * 1. ESSL REST API (JWT token — newer ZKTeco/ESSL firmware)
 * 2. iClock cdata GET with table=ATTLOG (device-protocol pull mode)
 * 3. Portal HTML scraping (fallback — same as fetchFromETimeTrackLite)
 *
 * Strategy 1 & 2 work without knowing the web-portal password when the server
 * exposes a REST endpoint or allows device-style pulls.
 */
export async function fetchFromIClockServerDirect(
  serverUrl: string,    // e.g. http://98.70.41.54:85
  deviceSN: string,     // e.g. CGKK220762223
  lastSync?: Date,
  username?: string,
  password?: string,
): Promise<EtlFetchResult> {

  // Calculate Stamp — 2-hour overlap to avoid gaps
  const overlapMs = 2 * 60 * 60 * 1000;
  const fromDate = lastSync
    ? new Date(lastSync.getTime() - overlapMs)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1); // start of current month

  // eSSL REST API expects local (IST) wall-clock timestamps, NOT UTC.
  // Convert UTC dates to IST strings for the API query parameters.
  const IST_MS = 330 * 60 * 1000;
  const fromIST = new Date(fromDate.getTime() + IST_MS);
  const nowIST = new Date(Date.now() + IST_MS);
  const fromStr = fromIST.toISOString().replace('T', ' ').split('.')[0];
  const toStr = nowIST.toISOString().replace('T', ' ').split('.')[0];
  const stampSec = Math.floor(fromDate.getTime() / 1000);

  const client = createEtlClient(serverUrl);

  // ── Strategy 1: ESSL REST API (JWT token-auth) ─────────────────────────────
  if (username && password) {
    try {
      const tokenRes = await client.post('/iclock/api/token-auth/', { username, password }, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (tokenRes.status === 200 && tokenRes.data?.token) {
        const token = String(tokenRes.data.token);
        console.log('[iClockDirect] REST API token obtained');

        // Paginate through all records
        const allRecords: EtlAttendanceRecord[] = [];
        let nextUrl: string | null =
          `/iclock/api/attlogs/?page_size=1000&terminal_sn=${deviceSN}&start_time=${encodeURIComponent(fromStr)}&end_time=${encodeURIComponent(toStr)}`;

        while (nextUrl) {
          const currentUrl: string = nextUrl;
          // eslint-disable-next-line no-await-in-loop
          const logsRes = await client.get<{ next?: string; data?: unknown[] }>(currentUrl, {
            headers: { Authorization: `JWT ${token}` },
            baseURL: serverUrl,
          });
          if (logsRes.status !== 200 || !logsRes.data) break;
          const pageRecs = parseRestApiLogs(logsRes.data.data || []);
          allRecords.push(...pageRecs);
          // Follow "next" page URL if provided
          const rawNext: string | null = logsRes.data.next || null;
          if (!rawNext) {
            nextUrl = null;
          } else if (rawNext.startsWith('http')) {
            nextUrl = rawNext.replace(serverUrl, '');
          } else {
            nextUrl = rawNext;
          }
        }

        if (allRecords.length > 0) {
          return {
            success: true,
            message: `Fetched ${allRecords.length} records via ESSL REST API`,
            records: allRecords,
          };
        }
      }
    } catch (e) {
      console.warn('[iClockDirect] REST API attempt failed:', (e as Error).message);
    }
  }

  // ── Strategy 2: iClock cdata GET — table=ATTLOG (no auth needed on some servers) ──
  const cdataUrls = [
    `/iclock/cdata?SN=${deviceSN}&table=ATTLOG&Stamp=${stampSec}&command_id=0`,
    `/iclock/cdata?SN=${deviceSN}&table=ATTLOG&Stamp=0&command_id=0`,
    `/iclock/download?SN=${deviceSN}&table=ATTLOG&Stamp=${stampSec}`,
  ];

  for (const path of cdataUrls) {
    try {
      const res = await client.get(path);
      if (res.status === 200) {
        const body = String(res.data);
        // Only count if actual punch records present (not just server config response)
        if (body.includes('\t') && /\d{4}-\d{2}-\d{2}/.test(body)) {
          const records = parseAttendanceData(body);
          if (records.length > 0) {
            console.log(`[iClockDirect] iClock cdata returned ${records.length} records from ${path}`);
            // Filter to afterFromDate
            const filtered = records.filter(r => r.timestamp >= fromDate);
            return {
              success: true,
              message: `Fetched ${filtered.length} records via iClock cdata protocol`,
              records: filtered,
            };
          }
        }
      }
    } catch (e) {
      console.warn(`[iClockDirect] cdata GET ${path} failed:`, (e as Error).message);
    }
  }

  // ── Strategy 3: Portal scraping (fallback) ────────────────────────────────
  if (username && password) {
    // Use IST dates (not UTC) so the portal date range covers the correct IST day
    const fromDateStr = fromIST.toISOString().split('T')[0];
    const toDateStr = nowIST.toISOString().split('T')[0];
    console.log(`[iClockDirect] Falling back to portal scraping ${fromDateStr} → ${toDateStr}`);
    return fetchFromETimeTrackLite(serverUrl, username, password, fromDateStr, toDateStr);
  }

  return {
    success: false,
    message: 'Could not fetch data from the server. Please enter portal credentials in Device > Configure Live Sync.',
    records: [],
  };
}

function parseRestApiLogs(data: unknown[]): EtlAttendanceRecord[] {
  // ESSL REST API attlog record:
  // { emp_code, punch_time, punch_state, verify_type, terminal_sn, work_code, ... }
  const records: EtlAttendanceRecord[] = [];
  if (!Array.isArray(data)) return records;

  for (const item of data) {
    const d = item as {
      emp_code?: string | number;
      punch_time?: string;
      punch_state?: string | number;
    };
    if (!d.emp_code || !d.punch_time) continue;
    const timestamp = new Date(String(d.punch_time).replace(' ', 'T'));
    if (isNaN(timestamp.getTime())) continue;
    records.push({
      employeeDeviceId: String(d.emp_code),
      timestamp,
      punchType: parseInt(String(d.punch_state || '0')) || 0,
      raw: JSON.stringify(d),
    });
  }
  return records;
}

// ── Portal Probe — discover available pages & attendance download form ────────
/**
 * Log into the portal and sniff what URLs/form fields are available
 * for downloading attendance data.
 */
export async function probeEsslPortal(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{
  success: boolean;
  loginMessage: string;
  pages: Array<{ url: string; status: number; size: number; htmlSnippet: string }>;
  rawSample?: string;
}> {
  const { client, success, message: loginMessage } = await etlLogin(baseUrl, username, password);
  if (!success) return { success: false, loginMessage, pages: [] };

  const probePaths = [
    '/iclock/Default.aspx',
    '/iclock/attlog.aspx',
    '/iclock/Checkinout.aspx',
    '/iclock/download.aspx',
    '/iclock/Report/AttLog.aspx',
  ];

  const pages: Array<{ url: string; status: number; size: number; htmlSnippet: string }> = [];

  for (const urlPath of probePaths) {
    try {
      const r = await client.get(urlPath, {
        headers: {
          Referer: `${baseUrl}/iclock/Default.aspx`,
          'X-Requested-With': '',
        },
      });
      const body = String(r.data);
      pages.push({
        url: urlPath,
        status: r.status,
        size: body.length,
        htmlSnippet: body.replace(/\s+/g, ' ').substring(0, 1200),
      });
    } catch (e) {
      console.log(`[ETL Probe] ${urlPath} → error: ${(e as Error).message}`);
    }
  }

  return { success: true, loginMessage, pages };
}
