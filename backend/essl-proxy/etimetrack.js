/**
 * eTimeTrackLite session client.
 *
 * Real data path (verified against http://98.70.41.54:85/iclock/):
 *   1. GET  /iclock/                                     -> __VIEWSTATE + AES txtKey
 *   2. POST /iclock/                                     -> login (AES-128-ECB password)
 *   3. GET  /iclock/Reports/LogRecords.aspx              -> form viewstate
 *   4. POST /iclock/Reports/LogRecords.aspx              -> generate report (Date Wise)
 *   5. GET  /iclock/Reserved.ReportViewerWebControl.axd  -> Excel export of punches
 *   6. Parse the .xls (CDFV2) with the `xlsx` lib       -> array of
 *      { empCode, empName, timestamp, direction, deviceSerial }
 *
 * The legacy SOAP service /iWsService.asmx is broken on this server
 * (every method returns CustomError.aspx?error=1 even with a valid session),
 * so we use the Reporting Services export endpoint instead.
 *
 * The server REQUIRES a desktop User-Agent header — without it every page
 * (including post-login Main.aspx) is redirected to LogOut.aspx.
 */

const axios = require('axios');
const crypto = require('crypto');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const XLSX = require('xlsx');

const SESSIONS = new Map(); // key -> { client, expiresAt }
const SESSION_TTL_MS = 10 * 60 * 1000;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function newClient() {
  const jar = new CookieJar();
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 60000,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
  );
}

function pickHidden(html, name) {
  const re = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

// AES-128-ECB / PKCS7, key = txtKey hidden field. CryptoJS in the browser
// returns base64 ciphertext; we replicate that.
function aesEncryptPassword(plain, txtKey) {
  const keyBuf = Buffer.from(txtKey, 'utf8');
  let keyLen = 16;
  if (keyBuf.length >= 32) keyLen = 32;
  else if (keyBuf.length >= 24) keyLen = 24;
  const key = Buffer.alloc(keyLen);
  keyBuf.copy(key, 0, 0, Math.min(keyBuf.length, keyLen));
  const cipher = crypto.createCipheriv(`aes-${keyLen * 8}-ecb`, key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

async function login(baseUrl, userName, password) {
  const base = baseUrl.replace(/\/+$/, '');
  const client = newClient();
  const r1 = await client.get(`${base}/iclock/`);
  const html = String(r1.data || '');
  const VS = pickHidden(html, '__VIEWSTATE');
  const VSG = pickHidden(html, '__VIEWSTATEGENERATOR');
  const EV = pickHidden(html, '__EVENTVALIDATION');
  const txtKey = pickHidden(html, 'StaffloginDialog\\$txtKey');
  if (!VS) throw new Error('Could not parse login form (no __VIEWSTATE).');
  if (!txtKey) throw new Error('Could not parse login form (no txtKey for AES).');

  const encryptedPassword = aesEncryptPassword(password, txtKey);

  const params = new URLSearchParams();
  params.append('__VIEWSTATE', VS);
  params.append('__VIEWSTATEGENERATOR', VSG);
  if (EV) params.append('__EVENTVALIDATION', EV);
  params.append('__EVENTTARGET', '');
  params.append('__EVENTARGUMENT', '');
  params.append('StaffloginDialog$txt_LoginName', userName);
  params.append('StaffloginDialog$Txt_Password', encryptedPassword);
  params.append('StaffloginDialog$txtKey', txtKey);
  params.append('StaffloginDialog$Btn_Ok', 'Login');

  const r2 = await client.post(`${base}/iclock/`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${base}/iclock/` },
  });
  const finalUrl = r2.request?.res?.responseUrl || r2.config?.url || '';
  const body = String(r2.data || '');
  const stillOnLogin = /name="StaffloginDialog\$Btn_Ok"/i.test(body);
  const errorMsg = (body.match(/InValidError[\s\S]{0,200}<font color="Red">([^<]+)</i) || [])[1];
  if (stillOnLogin || errorMsg) {
    throw new Error(`Login failed: ${errorMsg ? errorMsg.trim() : 'invalid id/password'}`);
  }
  if (/LogOut\.aspx/i.test(finalUrl) && body.length < 2000) {
    throw new Error('Login failed: server returned logout page.');
  }
  return client;
}

async function getClient(baseUrl, userName, password) {
  const key = `${baseUrl}|${userName}`;
  const now = Date.now();
  const cached = SESSIONS.get(key);
  if (cached && cached.expiresAt > now) return cached.client;
  const client = await login(baseUrl, userName, password);
  SESSIONS.set(key, { client, expiresAt: now + SESSION_TTL_MS });
  return client;
}

// --- Helpers -------------------------------------------------------------

function pickAllHidden(html) {
  const out = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*type="hidden"/gi)) out[m[1]] = m[2];
  return out;
}
function selectedOf(html, name) {
  const re = new RegExp('<select[^>]*name="' + name.replace('$', '\\$') + '"[\\s\\S]*?</select>', 'i');
  const m = html.match(re);
  if (!m) return '';
  const sel = m[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/i);
  return sel ? sel[1] : '';
}

// Accepts "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS"
function parseDateInput(s) {
  const d = new Date(String(s).replace(' ', 'T'));
  if (isNaN(d)) throw new Error('Invalid date: ' + s);
  return d;
}

// --- Report-export based punch fetcher (the one that actually works) -----

async function fetchReportXls(client, base, fromD, toD) {
  const url = `${base}/iclock/Reports/LogRecords.aspx`;
  const r = await client.get(url, { headers: { Referer: `${base}/iclock/Main.aspx` } });
  const html = String(r.data || '');
  if (!/ReportProtoType\$btn_GenerateReport/.test(html)) {
    throw new Error('LogRecords.aspx not accessible (session lost?).');
  }
  const hidden = pickAllHidden(html);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.append(k, v);
  params.set('ReportProtoType$Drp_FromDateDD', String(fromD.getDate()).padStart(2, '0'));
  params.set('ReportProtoType$Drp_FromDateMM', String(fromD.getMonth() + 1));
  params.set('ReportProtoType$Drp_FromDateYYYY', String(fromD.getFullYear()));
  params.set('ReportProtoType$Drp_ToDateDD', String(toD.getDate()).padStart(2, '0'));
  params.set('ReportProtoType$Drp_ToDateMM', String(toD.getMonth() + 1));
  params.set('ReportProtoType$Drp_ToDateYYYY', String(toD.getFullYear()));
  params.set('ReportProtoType$drp_ReportType', 'Date Wise');
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

function parsePunchesFromXls(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  /*
    Row layout (Date Wise):
      ["", "Date:", "", "2026-04-01", ...]                                  -> sets currentDate
      ["", "Log Date", "", "Employee Code", "Employee Name", "", "Direction", "DeviceName", ...] -> header
      ["", "10:09:01", "", "6666", "Brajmohan", "", "", "Biometric", ...]   -> punch row
  */
  const punches = [];
  let currentDate = '';
  for (const row of rows) {
    if (!row || row.length < 4) continue;
    if (String(row[1]).trim() === 'Date:' && row[3]) {
      const v = row[3];
      if (v instanceof Date && !isNaN(v)) {
        const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
        currentDate = `${y}-${m}-${d}`;
      } else {
        const s = String(v).trim();
        const md = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (md) currentDate = `${md[1]}-${md[2]}-${md[3]}`;
      }
      continue;
    }
    if (String(row[1]).trim() === 'Log Date') continue;

    const time = String(row[1] || '').trim();
    const empCode = String(row[3] || '').trim();
    if (!time || !empCode || !currentDate) continue;
    if (!/^\d{1,2}:\d{2}/.test(time)) continue;
    const empName = String(row[4] || '').trim();
    const dirRaw = String(row[6] || '').trim().toLowerCase();
    const device = String(row[7] || '').trim();
    const direction = dirRaw === 'out' || dirRaw === 'check-out' || dirRaw === '1' ? 'out' : 'in';
    const timestamp = `${currentDate} ${time.length === 5 ? time + ':00' : time}`;
    punches.push({
      id: `${empCode}-${currentDate}-${time}`.replace(/\s+/g, ''),
      empCode,
      empName,
      timestamp,
      direction,
      deviceSerial: device,
    });
  }
  return punches;
}

async function getReportPunches({ baseUrl, userName, password, fromDate, toDate }) {
  const base = baseUrl.replace(/\/+$/, '');
  const fromD = parseDateInput(fromDate);
  const toD = parseDateInput(toDate);
  let client = await getClient(base, userName, password);
  let buf;
  try {
    buf = await fetchReportXls(client, base, fromD, toD);
  } catch (e) {
    // session may have expired – retry once with a fresh login
    SESSIONS.delete(`${base}|${userName}`);
    client = await getClient(base, userName, password);
    buf = await fetchReportXls(client, base, fromD, toD);
  }
  return parsePunchesFromXls(buf);
}

module.exports = { login, getReportPunches };
