/**
 * eBioServerNew SOAP client (per eSSL eBioServerNew Web API doc v1.3).
 *
 * Endpoint: POST <serverUrl>/Webservice.asmx
 *
 * Methods used:
 *   - GetDeviceList(Location)
 *   - GetDeviceLogs(Location, LogDate)             → punches for one day
 *   - GetDeviceLogsByLogId(Location, LogId, LogCount)  → incremental polling
 *   - GetEmployeeCodes()
 *   - GetEmployeeDetails(EmployeeCode)
 *   - GetEmployeePunchLogs(EmployeeCode, AttendanceDate)
 *
 * Auth: UserName/Password (eBioServer admin credentials). Date format: YYYY-MM-DD.
 *
 * Response payloads are pipe/comma/semicolon-delimited strings inside
 * <…Result> elements; the parsers below normalise everything to JSON.
 */

const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');

const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

const xmlEscape = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

function envelope(method, fields) {
  const inner = Object.entries(fields)
    .map(([k, v]) => `      <${k}>${xmlEscape(v)}</${k}>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${method} xmlns="http://tempuri.org/">
${inner}
    </${method}>
  </soap:Body>
</soap:Envelope>`;
}

async function callSoap(serverUrl, method, fields) {
  const base = serverUrl.replace(/\/+$/, '');
  const candidates = [`${base}/Webservice.asmx`, `${base}/WebService.asmx`, `${base}/webservice.asmx`];
  let lastErr;
  for (const url of candidates) {
    try {
      const res = await axios.post(url, envelope(method, fields), {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `http://tempuri.org/${method}`,
        },
        timeout: 30000,
        validateStatus: () => true,
      });
      if (res.status === 404) { lastErr = new Error(`404 at ${url}`); continue; }
      if (res.status >= 400) throw new Error(`HTTP ${res.status} from ${url}: ${String(res.data).slice(0, 200)}`);
      const parsed = xmlParser.parse(String(res.data || ''));
      const body = parsed?.Envelope?.Body;
      if (!body) throw new Error('No SOAP Body in response');
      const fault = body?.Fault;
      if (fault) throw new Error(fault?.faultstring || 'SOAP Fault');
      const respKey = `${method}Response`;
      const resultKey = `${method}Result`;
      const result = body?.[respKey]?.[resultKey];
      return { url, raw: res.data, result: result == null ? '' : String(result) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('eBioServerNew SOAP call failed');
}

// ---------- Parsers ----------
function looksLikeError(s) {
  if (!s) return true;
  const t = s.trim().toLowerCase();
  if (!t) return true;
  return /^(error|invalid|unauthorized|no\s+record|not\s+found)/.test(t);
}

// GetDeviceLogs result: "DateTime,EmpCode,DeviceName,DeviceLocation,Direction;...next…"
function parseDeviceLogs(result, defaultLocation = '') {
  if (looksLikeError(result)) return [];
  const records = String(result)
    .split(/;|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const rec of records) {
    const cols = rec.split(',').map((s) => s.trim());
    if (cols.length < 2) continue;
    const [dt, empCode, deviceName = '', deviceLocation = defaultLocation, direction = ''] = cols;
    if (!empCode || !dt) continue;
    const ts = normaliseTimestamp(dt);
    if (!ts) continue;
    out.push({
      id: `${deviceName || 'dev'}-${empCode}-${ts}`.replace(/\s+/g, ''),
      empCode: String(empCode),
      empName: '',
      timestamp: ts,
      direction: /out|exit/i.test(direction) ? 'out' : 'in',
      deviceSerial: deviceName,
      deviceLocation,
      raw: rec,
    });
  }
  return out;
}

// GetDeviceLogsByLogId result: "LogId,DateTime,EmpCode,DeviceName,DeviceLocation,Direction;..."
function parseDeviceLogsById(result, defaultLocation = '') {
  if (looksLikeError(result)) return { punches: [], lastLogId: null };
  const records = String(result)
    .split(/;|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  let lastLogId = null;
  for (const rec of records) {
    const cols = rec.split(',').map((s) => s.trim());
    if (cols.length < 3) continue;
    const [logId, dt, empCode, deviceName = '', deviceLocation = defaultLocation, direction = ''] = cols;
    const ts = normaliseTimestamp(dt);
    if (!empCode || !ts) continue;
    lastLogId = logId;
    out.push({
      id: logId || `${deviceName || 'dev'}-${empCode}-${ts}`.replace(/\s+/g, ''),
      logId,
      empCode: String(empCode),
      empName: '',
      timestamp: ts,
      direction: /out|exit/i.test(direction) ? 'out' : 'in',
      deviceSerial: deviceName,
      deviceLocation,
      raw: rec,
    });
  }
  return { punches: out, lastLogId };
}

// GetEmployeePunchLogs result: "FirstIn;LastOut;Punch1,Punch2,…"  (single date)
function parseEmployeePunchLogs(result, empCode, date) {
  if (looksLikeError(result)) return [];
  const parts = String(result).split(';').map((s) => s.trim()).filter(Boolean);
  // Sometimes server returns just the comma-separated punch list with no first/last prefix.
  const tail = parts.length >= 3 ? parts[2] : parts[parts.length - 1] || '';
  const punches = tail.split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of punches) {
    const ts = normaliseTimestamp(p.includes(' ') ? p : `${date} ${p}`);
    if (!ts) continue;
    out.push({
      id: `${empCode}-${ts}`.replace(/\s+/g, ''),
      empCode: String(empCode),
      empName: '',
      timestamp: ts,
      direction: 'in', // direction not reported by this method
      deviceSerial: '',
    });
  }
  // Mark alternating in/out as a best-effort.
  out.forEach((p, i) => { p.direction = i % 2 === 0 ? 'in' : 'out'; });
  return out;
}

// GetEmployeeCodes result: "code1,code2,…" or one per line.
function parseEmployeeCodes(result) {
  if (looksLikeError(result)) return [];
  return String(result)
    .split(/[,;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// GetEmployeeDetails result: "EmpCode,Name,Card,Location,Role,VerificationType"
function parseEmployeeDetails(result) {
  if (looksLikeError(result)) return null;
  const cols = String(result).split(',').map((s) => s.trim());
  if (cols.length < 2) return null;
  const [empCode, name, card = '', location = '', role = '', verification = ''] = cols;
  return { empCode, name, card, location, role, verification };
}

// GetDeviceList result: "Serial,Name,Direction,Type,Location,LastSeen;..."
function parseDeviceList(result) {
  if (looksLikeError(result)) return [];
  return String(result)
    .split(/;|\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((row) => {
      const c = row.split(',').map((s) => s.trim());
      return {
        serial: c[0] || '',
        name: c[1] || '',
        direction: c[2] || '',
        type: c[3] || '',
        location: c[4] || '',
        lastSeen: c[5] || '',
      };
    })
    .filter((d) => d.serial);
}

function normaliseTimestamp(s) {
  if (!s) return '';
  const str = String(s).trim();
  // Already YYYY-MM-DD HH:mm:ss
  let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])} ${pad(m[4])}:${pad(m[5])}:${pad(m[6] || '00')}`;
  // DD-MM-YYYY HH:mm:ss
  m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])} ${pad(m[4])}:${pad(m[5])}:${pad(m[6] || '00')}`;
  return '';
}
const pad = (n) => String(n).padStart(2, '0');

// ---------- Public API ----------
async function ping({ serverUrl, userName, password }) {
  // Cheapest call we can use to verify creds + path.
  const r = await callSoap(serverUrl, 'GetDeviceList', { UserName: userName, Password: password, Location: '' });
  const devices = parseDeviceList(r.result);
  return { ok: true, url: r.url, sample: r.result.slice(0, 200), devices };
}

async function getDevices({ serverUrl, userName, password, location = '' }) {
  const r = await callSoap(serverUrl, 'GetDeviceList', { UserName: userName, Password: password, Location: location });
  return parseDeviceList(r.result);
}

async function getEmployeeCodes({ serverUrl, userName, password }) {
  const r = await callSoap(serverUrl, 'GetEmployeeCodes', { UserName: userName, Password: password });
  return parseEmployeeCodes(r.result);
}

async function getEmployeeDetails({ serverUrl, userName, password, empCode }) {
  const r = await callSoap(serverUrl, 'GetEmployeeDetails', {
    UserName: userName, Password: password, EmployeeCode: empCode,
  });
  return parseEmployeeDetails(r.result);
}

async function getDeviceLogsForDate({ serverUrl, userName, password, location = '', date }) {
  const r = await callSoap(serverUrl, 'GetDeviceLogs', {
    UserName: userName, Password: password, Location: location, LogDate: date,
  });
  return parseDeviceLogs(r.result, location);
}

async function getDeviceLogsSince({ serverUrl, userName, password, location = '', logId = '0', logCount = '500' }) {
  const r = await callSoap(serverUrl, 'GetDeviceLogsByLogId', {
    UserName: userName, Password: password, Location: location, LogId: String(logId), LogCount: String(logCount),
  });
  return parseDeviceLogsById(r.result, location);
}

async function getEmployeePunchLogs({ serverUrl, userName, password, empCode, date }) {
  const r = await callSoap(serverUrl, 'GetEmployeePunchLogs', {
    UserName: userName, Password: password, EmployeeCode: empCode, AttendanceDate: date,
  });
  return parseEmployeePunchLogs(r.result, empCode, date);
}

// Fetch a date range by looping per-day GetDeviceLogs. Punches are de-duplicated by id.
async function getPunchesInRange({ serverUrl, userName, password, location = '', fromDate, toDate }) {
  const start = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);
  if (!start || !end) throw new Error('fromDate/toDate must be YYYY-MM-DD');
  const all = [];
  const seen = new Set();
  const errors = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    try {
      const punches = await getDeviceLogsForDate({ serverUrl, userName, password, location, date: dateStr });
      for (const p of punches) {
        if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }
      }
    } catch (e) {
      errors.push(`${dateStr}: ${e.message}`);
    }
  }
  return { punches: all, errors };
}

function parseDateOnly(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

module.exports = {
  ping,
  getDevices,
  getEmployeeCodes,
  getEmployeeDetails,
  getDeviceLogsForDate,
  getDeviceLogsSince,
  getEmployeePunchLogs,
  getPunchesInRange,
};
