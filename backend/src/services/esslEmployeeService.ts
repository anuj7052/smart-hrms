/**
 * ESSL Employee Management Service
 *
 * Scrapes the eTimeTrackLite portal to manage employees on the ESSL device.
 * Pages used:
 *   - Manage/Employees.aspx       → list / add / edit / delete employees
 *   - Manage/Departments.aspx     → list departments
 *   - Manage/Devices.aspx         → list devices & send commands
 *   - Manage/UploadUsersToMultipleDevice.aspx → push users to devices
 *   - Manage/DeleteUsersFromMultipleDevice.aspx → remove users from devices
 */
import crypto from 'crypto';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// ── Session cache ─────────────────────────────────────────────────────────────
const SESSIONS = new Map<string, { client: ReturnType<typeof createClient>; expiresAt: number }>();
const SESSION_TTL = 8 * 60 * 1000; // 8 minutes

function createClient(baseUrl: string) {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      baseURL: baseUrl.replace(/\/+$/, ''),
      withCredentials: true,
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { 'User-Agent': DESKTOP_UA, 'Accept-Language': 'en-US,en;q=0.9' },
    })
  );
}

function encryptPassword(plain: string, key: string): string {
  const keyBuf = Buffer.from(key, 'utf8');
  const keySize = keyBuf.length <= 16 ? 16 : keyBuf.length <= 24 ? 24 : 32;
  const padKey = Buffer.alloc(keySize, 0);
  keyBuf.copy(padKey);
  const cipher = crypto.createCipheriv(`aes-${keySize * 8}-ecb` as any, padKey, null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function pickHidden(html: string): Record<string, string> {
  const f: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*/gi)) {
    const n = m[0].match(/name="([^"]*)"/i);
    const v = m[0].match(/value="([^"]*)"/i);
    if (n) f[n[1]] = v ? v[1] : '';
  }
  return f;
}

function pickFieldValue(html: string, fieldName: string): string {
  const esc = fieldName.replace(/\$/g, '\\$');
  const re = new RegExp(`name="${esc}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`value="([^"]*)"[^>]*name="${esc}"`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : '';
}

async function getClient(baseUrl: string, username: string, password: string) {
  const key = `${baseUrl}|${username}`;
  const now = Date.now();
  const cached = SESSIONS.get(key);
  if (cached && cached.expiresAt > now) return cached.client;

  const client = createClient(baseUrl);
  const r1 = await client.get('/iclock/');
  const html = String(r1.data);
  const hidden = pickHidden(html);
  const txtKey = pickFieldValue(html, 'StaffloginDialog$txtKey');
  if (!txtKey) throw new Error('Cannot find login key — portal may be down');

  const form = new URLSearchParams({
    ...hidden,
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': username,
    'StaffloginDialog$Txt_Password': encryptPassword(password, txtKey),
    'StaffloginDialog$txtKey': txtKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });

  const r2 = await client.post('/iclock/Default.aspx', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}/iclock/` },
  });
  const body = String(r2.data);
  if (/name="StaffloginDialog\$Btn_Ok"/i.test(body)) {
    throw new Error('ESSL portal login failed — check credentials');
  }

  SESSIONS.set(key, { client, expiresAt: now + SESSION_TTL });
  return client;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EsslEmployee {
  empCode: string;
  name: string;
  department: string;
  designation: string;
  company: string;
  category: string;
  status: string;
  joiningDate: string;
  cardNo: string;
  deviceGroup: string;
}

export interface EsslDevice {
  serialNumber: string;
  name: string;
  ip: string;
  lastActivity: string;
  status: string;
  type: string;
  totalUsers: string;
  totalFP: string;
  totalFace: string;
}

export interface EsslDepartment {
  id: string;
  name: string;
  company: string;
}

// ── Parse OBout grid HTML ─────────────────────────────────────────────────────

/**
 * Parse an OBout Inc. grid.  The grid body lives inside a div whose id ends
 * with "BodyContainer".  Inside that div is a `<table class="ob_gBody">`.
 * Data rows have class `ob_gR` (normal) or `ob_gRA` (alternate detail/flyout —
 * we skip those).  Each `<td>` may contain a `<div class="ob_gR*">` wrapper.
 * Hidden cells have `display:none` on the `<td>` `style` attribute.
 * We return ALL cell text (including hidden cells) so the caller can map by
 * absolute index.
 */
function parseOboutGrid(html: string): string[][] {
  const rows: string[][] = [];

  // Locate the BodyContainer
  const bodyMatch = html.match(/id="[^"]*BodyContainer"[^>]*>([\s\S]*?)(?=<div[^>]*id="[^"]*FooterContainer"|$)/i);
  if (!bodyMatch) return rows;
  const bodyHtml = bodyMatch[1];

  // Data rows: <tr class="ob_gR"> (skip ob_gRA which are flyout/detail rows)
  const rowMatches = bodyHtml.match(/<tr[^>]*class="ob_gR"[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells: string[] = [];
    const tdIter = rowHtml.matchAll(/<td([\s\S]*?)>([\s\S]*?)<\/td>/gi);
    for (const m of tdIter) {
      const content = m[2];
      const text = content.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
      cells.push(text);
    }
    if (cells.length >= 5) {
      rows.push(cells);
    }
  }

  return rows;
}

// ── List Employees ────────────────────────────────────────────────────────────

export async function listEsslEmployees(
  baseUrl: string, username: string, password: string
): Promise<{ success: boolean; employees: EsslEmployee[]; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);

    // First GET to obtain the page + hidden fields, then POST back with a large
    // page size so we get all records in one shot.
    const r = await client.get('/iclock/Manage/Employees.aspx', {
      headers: { Referer: `${baseUrl}/iclock/Main.aspx` },
    });
    let html = String(r.data);
    if (html.length < 1000 || html.includes('CustomError')) {
      return { success: false, employees: [], message: 'Cannot access Employees page' };
    }

    // Check total records
    const totalMatch = html.match(/TotalRecords[^>]*value="(\d+)"/i);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;
    const pageSize = 5; // OBout grid default page size
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 1;

    // Collect all rows: page 0 is already loaded, fetch remaining pages
    const allRows: string[][] = [];
    allRows.push(...parseOboutGrid(html));

    if (totalPages > 1) {
      const hidden = pickHidden(html);
      const pageSelectorKey = Object.keys(hidden).find(
        k => /PageSelector$/i.test(k) && k.includes('Dg_Employee') && !k.includes('PageSize') && !k.includes('Total')
      ) || 'Dg_Employee$ctl29$ob_Dg_EmployeePageSelector';

      for (let page = 1; page < Math.min(totalPages, 20); page++) {
        const form = new URLSearchParams({
          ...hidden,
          '__EVENTTARGET': pageSelectorKey,
          '__EVENTARGUMENT': '',
          [pageSelectorKey]: String(page),
        });
        const rPage = await client.post('/iclock/Manage/Employees.aspx', form.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: `${baseUrl}/iclock/Manage/Employees.aspx`,
          },
        });
        const pageHtml = String(rPage.data);
        if (pageHtml.length > 1000 && !pageHtml.includes('StaffloginDialog')) {
          const pageRows = parseOboutGrid(pageHtml);
          if (pageRows.length > 0) {
            allRows.push(...pageRows);
            // Update hidden fields for next page iteration
            const newHidden = pickHidden(pageHtml);
            Object.assign(hidden, newHidden);
          } else {
            break; // no more data
          }
        } else {
          break;
        }
      }
    }

    const employees: EsslEmployee[] = [];

    // Parse the OBout grid.  Columns by absolute cell index:
    //   [0]  EmployeeId (internal, hidden)
    //   [1]  EmpCode
    //   [2]  EmpName
    //   [3]  Company
    //   [4]  Department
    //   [5]  Designation
    //   [6]  Location (often empty)
    //   [7]  Category / DeviceGroup
    //   [8]  Status (Working / Resigned)
    //   [9]  EmploymentType (Permanent, etc.)
    //   …
    //   [13] JoiningDate
    //   [24] EmployeeCodeInDevice
    //   [25] Gender
    //   [47] RFID / CardNo
    for (const cells of allRows) {
      if (cells.length < 5) continue;
      const empCode  = (cells[1] || '').trim();
      const name     = (cells[2] || '').trim();
      if (!empCode || !name) continue;
      // Filter junk rows (header leaks, script text, etc.)
      if (/function |Employees List|SetSource/i.test(empCode + name)) continue;

      employees.push({
        empCode,
        name,
        department:  (cells[4] || '').trim(),
        designation: (cells[5] || '').trim(),
        company:     (cells[3] || '').trim(),
        category:    (cells[7] || '').trim(),
        status:      (cells[8] || '').trim() || 'Active',
        joiningDate: (cells[13] || '').trim(),
        cardNo:      (cells[47] || '').trim(),
        deviceGroup: (cells[9] || '').trim(),
      });
    }

    return {
      success: true,
      employees,
      message: `Found ${employees.length} employee(s) on ESSL device (total ${total})`,
    };
  } catch (e: any) {
    return { success: false, employees: [], message: e.message || 'Failed to fetch employees' };
  }
}

// ── List Devices ──────────────────────────────────────────────────────────────

export async function listEsslDevices(
  baseUrl: string, username: string, password: string
): Promise<{ success: boolean; devices: EsslDevice[]; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const r = await client.get('/iclock/Manage/Devices.aspx', {
      headers: { Referer: `${baseUrl}/iclock/Main.aspx` },
    });
    const html = String(r.data);
    if (html.length < 1000 || html.includes('CustomError')) {
      return { success: false, devices: [], message: 'Cannot access Devices page' };
    }

    const devices: EsslDevice[] = [];
    const rows = parseOboutGrid(html);
    for (const cells of rows) {
      if (cells.length < 3) continue;
      const offset = (cells[0] === '' || /^\s*$/.test(cells[0])) ? 1 : 0;
      const sn = (cells[offset] || '').trim();
      const name = (cells[offset + 1] || '').trim();
      if (!sn || sn.toLowerCase().includes('serial') || sn.toLowerCase() === 'device name') continue;

      devices.push({
        serialNumber: sn,
        name,
        ip: (cells[offset + 2] || '').trim(),
        lastActivity: (cells[offset + 3] || '').trim(),
        status: (cells[offset + 4] || '').trim(),
        type: (cells[offset + 5] || '').trim(),
        totalUsers: (cells[offset + 6] || '').trim(),
        totalFP: (cells[offset + 7] || '').trim(),
        totalFace: (cells[offset + 8] || '').trim(),
      });
    }

    return { success: true, devices, message: `Found ${devices.length} device(s)` };
  } catch (e: any) {
    return { success: false, devices: [], message: e.message };
  }
}

// ── List Departments ──────────────────────────────────────────────────────────

export async function listEsslDepartments(
  baseUrl: string, username: string, password: string
): Promise<{ success: boolean; departments: EsslDepartment[]; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const r = await client.get('/iclock/Manage/Departments.aspx', {
      headers: { Referer: `${baseUrl}/iclock/Main.aspx` },
    });
    const html = String(r.data);
    if (html.length < 1000) {
      return { success: false, departments: [], message: 'Cannot access Departments page' };
    }

    const departments: EsslDepartment[] = [];
    const rows = parseOboutGrid(html);
    for (const cells of rows) {
      if (cells.length < 2) continue;
      const offset = (cells[0] === '' || /^\s*$/.test(cells[0])) ? 1 : 0;
      const name = (cells[offset] || '').trim();
      if (!name || name.toLowerCase() === 'department') continue;
      departments.push({
        id: (cells[offset + 1] || name).trim(),
        name,
        company: (cells[offset + 2] || '').trim(),
      });
    }

    return { success: true, departments, message: `Found ${departments.length} department(s)` };
  } catch (e: any) {
    return { success: false, departments: [], message: e.message };
  }
}

// ── Add Employee ──────────────────────────────────────────────────────────────

export async function addEsslEmployee(
  baseUrl: string,
  username: string,
  password: string,
  empData: { empCode: string; firstName: string; lastName?: string; department?: string; cardNo?: string }
): Promise<{ success: boolean; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const page = '/iclock/Manage/Employees.aspx';
    const r1 = await client.get(page, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
    const html = String(r1.data);

    if (html.includes('CustomError')) {
      return { success: false, message: 'Cannot access Employees page' };
    }

    // The Employees.aspx page has a flyout panel (Flyout_Details) for adding employees
    // We need to POST with the flyout fields filled in + a save button trigger
    const hidden = pickHidden(html);

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) form.append(k, v);

    // Set employee data in the flyout fields
    form.set('Flyout_Details$txt_EmpCode', empData.empCode);
    form.set('Flyout_Details$txt_FirstName', empData.firstName);
    form.set('Flyout_Details$txt_LastName', empData.lastName || '');
    if (empData.cardNo) form.set('Flyout_Details$txt_Card', empData.cardNo);

    // Trigger the save button
    form.set('__EVENTTARGET', 'Flyout_Details$btn_Save');
    form.set('__EVENTARGUMENT', '');

    const r2 = await client.post(page, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${page}` },
      timeout: 30000,
    });

    const body = String(r2.data);
    // Check for error messages
    if (body.includes('already exists') || body.includes('duplicate')) {
      return { success: false, message: `Employee code ${empData.empCode} already exists on the device` };
    }
    if (body.includes('CustomError') || body.includes('error')) {
      // Try to extract error message
      const errMatch = body.match(/(?:error|alert|message)[^>]*>([^<]+)/i);
      if (errMatch) return { success: false, message: errMatch[1].trim() };
    }

    // Invalidate session cache so next call re-reads fresh data
    SESSIONS.delete(`${baseUrl}|${username}`);

    return { success: true, message: `Employee ${empData.empCode} (${empData.firstName}) added successfully` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Edit Employee ─────────────────────────────────────────────────────────────

export async function editEsslEmployee(
  baseUrl: string,
  username: string,
  password: string,
  empCode: string,
  empData: { firstName?: string; lastName?: string; department?: string; cardNo?: string }
): Promise<{ success: boolean; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const page = '/iclock/Manage/Employees.aspx';
    const r1 = await client.get(page, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
    const html = String(r1.data);

    if (html.includes('CustomError')) {
      return { success: false, message: 'Cannot access Employees page' };
    }

    const hidden = pickHidden(html);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) form.append(k, v);

    // Select the employee for editing and trigger the edit/save action
    form.set('Flyout_Details$txt_EmpCode', empCode);
    if (empData.firstName !== undefined) form.set('Flyout_Details$txt_FirstName', empData.firstName);
    if (empData.lastName !== undefined) form.set('Flyout_Details$txt_LastName', empData.lastName);
    if (empData.cardNo !== undefined) form.set('Flyout_Details$txt_Card', empData.cardNo);

    // Trigger edit/update via the save button with the employee selected
    form.set('__EVENTTARGET', 'Flyout_Details$btn_Save');
    form.set('__EVENTARGUMENT', empCode);

    const r2 = await client.post(page, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${page}` },
      timeout: 30000,
    });

    const body = String(r2.data);
    if (body.includes('CustomError')) {
      const errMatch = body.match(/(?:error|alert|message)[^>]*>([^<]+)/i);
      if (errMatch) return { success: false, message: errMatch[1].trim() };
      return { success: false, message: 'Update request returned an error' };
    }

    SESSIONS.delete(`${baseUrl}|${username}`);
    return { success: true, message: `Employee ${empCode} updated successfully` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Delete Employee ───────────────────────────────────────────────────────────

export async function deleteEsslEmployee(
  baseUrl: string,
  username: string,
  password: string,
  empCode: string
): Promise<{ success: boolean; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const page = '/iclock/Manage/Employees.aspx';
    const r1 = await client.get(page, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
    const html = String(r1.data);

    const hidden = pickHidden(html);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) form.append(k, v);

    // Trigger delete via the delete flyout — select the employee and post
    form.set('__EVENTTARGET', 'Wnd_DeleteEmployees$btn_DeleteEmployees');
    form.set('__EVENTARGUMENT', empCode);

    const r2 = await client.post(page, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${page}` },
      timeout: 30000,
    });

    SESSIONS.delete(`${baseUrl}|${username}`);

    const body = String(r2.data);
    if (body.includes('CustomError')) {
      return { success: false, message: 'Delete request returned an error' };
    }

    return { success: true, message: `Employee ${empCode} delete request sent` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Upload User to Device ─────────────────────────────────────────────────────

export async function uploadUserToDevice(
  baseUrl: string,
  username: string,
  password: string,
  empCode: string
): Promise<{ success: boolean; message: string }> {
  try {
    const client = await getClient(baseUrl, username, password);
    const page = '/iclock/Manage/Employees.aspx';
    const r1 = await client.get(page, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
    const html = String(r1.data);
    const hidden = pickHidden(html);

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(hidden)) form.append(k, v);

    // The "Add To All Devices" button on Employees.aspx
    form.set('__EVENTTARGET', 'btn_AddToAllDevices');
    form.set('__EVENTARGUMENT', empCode);

    const r2 = await client.post(page, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${page}` },
      timeout: 30000,
    });

    const body = String(r2.data);
    if (body.includes('CustomError')) {
      return { success: false, message: 'Upload to device failed' };
    }

    return { success: true, message: `User ${empCode} upload to all devices requested` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Get Portal URL for iframe embedding ───────────────────────────────────────

export function getPortalPages(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  return {
    main: `${base}/iclock/Main.aspx`,
    employees: `${base}/iclock/Manage/Employees.aspx`,
    devices: `${base}/iclock/Manage/Devices.aspx`,
    departments: `${base}/iclock/Manage/Departments.aspx`,
    attendance: `${base}/iclock/Manage/AttendenceLog.aspx`,
    deviceLogs: `${base}/iclock/Manage/DeviceLogList.aspx`,
    deviceCommands: `${base}/iclock/Manage/DeviceCommands.aspx`,
    uploadUsers: `${base}/iclock/Manage/UploadUsersToMultipleDevice.aspx`,
    deleteUsers: `${base}/iclock/Manage/DeleteUsersFromMultipleDevice.aspx`,
    shifts: `${base}/iclock/Manage/ShiftDetails.aspx`,
    leaveTypes: `${base}/iclock/Manage/LeaveTypes.aspx`,
    settings: `${base}/iclock/Manage/MasterSettings.aspx`,
    reports: `${base}/iclock/Reports/LogRecords.aspx`,
    companies: `${base}/iclock/Manage/Companies.aspx`,
    categories: `${base}/iclock/Manage/EmployeeCategories.aspx`,
    holidays: `${base}/iclock/Manage/PublicHolidays.aspx`,
  };
}
