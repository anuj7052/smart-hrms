/**
 * SmartHRMS eSSL proxy
 * --------------------------------------------------------------
 * Supports THREE source modes (configurable per request):
 *
 *  1. mode='soap'     – eTimeTrackLite SOAP (GetTransactionsLog)
 *                       body: { mode:'soap', serverUrl, userName, password }
 *
 *  2. mode='adms'     – Pull from a remote ADMS / iclock server (best-effort,
 *                       tries common admin REST/SOAP paths). Most eSSL ADMS
 *                       deployments DO NOT expose a query API – this mode is
 *                       a fallback.  body: { mode:'adms', serverUrl, userName, password }
 *
 *  3. mode='receiver' – Use the punches that real ZK/eSSL devices have PUSHED
 *                       to this proxy via the ADMS protocol.
 *                       Point each device's "Cloud Server Address" at
 *                       http://<this-machine-ip>:4000  (path /iclock).
 *                       No body fields needed.
 *
 * Run:
 *   cd essl-proxy && npm install && npm start
 *
 * Endpoints:
 *   GET  /health
 *   POST /api/essl/test       { mode, ...creds }
 *   POST /api/essl/punches    { mode, ...creds, fromDate?, toDate? }
 *
 *   ADMS device endpoints (devices talk to these – do not call manually):
 *     GET  /iclock/cdata
 *     POST /iclock/cdata
 *     GET  /iclock/getrequest
 *     POST /iclock/devicecmd
 *     GET  /iclock/ping
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const etl = require('./etimetrack');
const ebs = require('./ebioserver');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/plain', 'application/octet-stream', 'text/*'], limit: '2mb' }));

const PORT = process.env.PORT || 4000;
const xmlParser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

// In-memory ring buffer of punches received via ADMS push (mode='receiver')
const RECV_PUNCHES = []; // newest last
const RECV_LIMIT = 5000;
const RECV_DEVICES = new Map(); // serial -> { lastSeen, ip }

const pad = (n) => String(n).padStart(2, '0');
const fmtLocal = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// ===========================================================================
// MODE 1 – eTimeTrackLite SOAP
// ===========================================================================
function buildSoapEnvelope({ userName, password, fromDate, toDate, serialNumber = '', empCode = '' }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetTransactionsLog xmlns="http://tempuri.org/">
      <FromDateTime>${fromDate}</FromDateTime>
      <ToDateTime>${toDate}</ToDateTime>
      <SerialNumber>${serialNumber}</SerialNumber>
      <UserName>${userName}</UserName>
      <UserPassword>${password}</UserPassword>
      <strDataList></strDataList>
      <EmployeeCode>${empCode}</EmployeeCode>
    </GetTransactionsLog>
  </soap:Body>
</soap:Envelope>`;
}

async function callSoap({ serverUrl, userName, password, fromDate, toDate }) {
  const url = serverUrl.replace(/\/+$/, '') + '/iWsService.asmx';
  const body = buildSoapEnvelope({ userName, password, fromDate, toDate });
  const res = await axios.post(url, body, {
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'http://tempuri.org/GetTransactionsLog',
    },
    timeout: 15000,
  });
  return res.data;
}

function parseSoapPunches(xml) {
  try {
    const json = xmlParser.parse(xml);
    const result = json?.Envelope?.Body?.GetTransactionsLogResponse?.GetTransactionsLogResult ?? '';
    const out = [];
    const lines = String(result).split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const cols = line.split('|').map((s) => s.trim());
      if (cols.length < 4) continue;
      const [empCode, empName, date, time, inOut = '', serial = ''] = cols;
      out.push({
        id: `${empCode}-${date}-${time}`.replace(/\s+/g, ''),
        empCode,
        empName,
        timestamp: `${date} ${time}`,
        direction: /out/i.test(inOut) ? 'out' : 'in',
        deviceSerial: serial,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ===========================================================================
// MODE 2 – Remote ADMS pull (best-effort)
// ===========================================================================
async function tryAdmsPull({ serverUrl, userName, password, fromDate, toDate }) {
  const base = serverUrl.replace(/\/+$/, '');
  const auth = userName ? { username: userName, password: password || '' } : undefined;
  const candidates = [
    `${base}/iclock/api/transactions?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
    `${base}/api/transactions?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
    `${base}/api/attendance?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`,
    `${base}/iclock/getrequest`,
  ];
  const errors = [];
  for (const url of candidates) {
    try {
      const r = await axios.get(url, { auth, timeout: 8000, validateStatus: () => true });
      if (r.status >= 200 && r.status < 300 && r.data) {
        const parsed = parseAdmsPayload(r.data);
        if (parsed.length) return { ok: true, punches: parsed, source: url };
      }
      errors.push(`${r.status} ${url}`);
    } catch (e) {
      errors.push(`${e.code || 'ERR'} ${url}`);
    }
  }
  return { ok: false, punches: [], error: 'No ADMS query endpoint responded. Try receiver mode. Tried: ' + errors.join(' | ') };
}

function parseAdmsPayload(data) {
  if (Array.isArray(data)) return data.map(normalizeJsonPunch).filter(Boolean);
  if (typeof data === 'object' && Array.isArray(data?.data)) return data.data.map(normalizeJsonPunch).filter(Boolean);
  if (typeof data === 'string') {
    const out = [];
    for (const raw of data.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const cols = line.split(/\t|,|\|/).map((s) => s.trim());
      if (cols.length < 3) continue;
      const empCode = cols[0];
      const ts = cols.slice(1, 3).join(' ').trim();
      const status = cols[3] || '0';
      out.push(makePunch(empCode, '', ts, status, ''));
    }
    return out;
  }
  return [];
}

// ===========================================================================
// MODE 3 – ADMS receiver (devices PUSH to us)
// ===========================================================================
const sendOK = (res, body = 'OK') => res.set('Content-Type', 'text/plain').send(body);

function makePunch(empCode, empName, timestamp, status, deviceSerial) {
  // ZK status codes: 0=check-in, 1=check-out, 2=break-out, 3=break-in, 4=ot-in, 5=ot-out
  const direction = ['1', '3', '5'].includes(String(status)) ? 'out' : 'in';
  return {
    id: `${deviceSerial || 'dev'}-${empCode}-${timestamp}`.replace(/\s+/g, ''),
    empCode: String(empCode),
    empName: empName || '',
    timestamp,
    direction,
    deviceSerial: deviceSerial || '',
  };
}

function normalizeJsonPunch(o) {
  const empCode = o.empCode || o.pin || o.emp_code || o.user_id || o.userId;
  const ts = o.timestamp || o.time || (o.date && o.time && `${o.date} ${o.time}`) || o.datetime;
  if (!empCode || !ts) return null;
  return makePunch(empCode, o.empName || o.name || '', ts, o.status || o.in_out || '0', o.deviceSerial || o.sn || '');
}

function pushPunches(arr) {
  const fresh = [];
  const seen = new Set(RECV_PUNCHES.map((p) => p.id));
  for (const p of arr) {
    if (!seen.has(p.id)) {
      RECV_PUNCHES.push(p);
      fresh.push(p);
      seen.add(p.id);
    }
  }
  while (RECV_PUNCHES.length > RECV_LIMIT) RECV_PUNCHES.shift();
  return fresh;
}

// Device ↔ proxy handshake
app.get('/iclock/cdata', (req, res) => {
  const { SN, options } = req.query;
  if (SN) RECV_DEVICES.set(String(SN), { lastSeen: new Date().toISOString(), ip: req.ip });
  if (options === 'all') {
    return res.set('Content-Type', 'text/plain').send(
      `GET OPTION FROM: ${SN}\nATTLOGStamp=None\nOPERLOGStamp=9999\nATTPHOTOStamp=None\nErrorDelay=30\nDelay=10\nTransTimes=00:00;14:05\nTransInterval=1\nTransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser\tEnrollFP\tChgFP\tFPImag\nTimeZone=8\nRealtime=1\nEncrypt=None`
    );
  }
  return sendOK(res);
});

app.post('/iclock/cdata', (req, res) => {
  const { SN, table } = req.query;
  if (SN) RECV_DEVICES.set(String(SN), { lastSeen: new Date().toISOString(), ip: req.ip });
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
  if (String(table).toUpperCase() === 'ATTLOG' || /\d+\t\d{4}-\d\d-\d\d/.test(body)) {
    const punches = [];
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const cols = line.split(/\t|,|\|/).map((s) => s.trim());
      if (cols.length < 2) continue;
      punches.push(makePunch(cols[0], '', cols[1], cols[2] || '0', SN));
    }
    const fresh = pushPunches(punches);
    return sendOK(res, `OK: ${fresh.length}`);
  }
  return sendOK(res);
});

app.get('/iclock/getrequest', (req, res) => {
  const { SN } = req.query;
  if (SN) RECV_DEVICES.set(String(SN), { lastSeen: new Date().toISOString(), ip: req.ip });
  return sendOK(res);
});

app.post('/iclock/devicecmd', (_req, res) => sendOK(res));
app.get('/iclock/ping', (_req, res) => sendOK(res, 'OK'));

// ===========================================================================
// JSON API for the mobile app
// ===========================================================================
app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    service: 'smarthrms-essl-proxy',
    port: PORT,
    receivedPunches: RECV_PUNCHES.length,
    devicesSeen: [...RECV_DEVICES.entries()].map(([sn, v]) => ({ sn, ...v })),
  })
);

app.post('/api/essl/test', async (req, res) => {
  const { mode = 'receiver', serverUrl, userName, password } = req.body || {};
  if (mode === 'receiver') {
    return res.json({
      ok: true,
      mode,
      message: `Receiver active. ${RECV_DEVICES.size} device(s) checked in. Point each eSSL device's Cloud Server Address to http://<this-machine-ip>:${PORT}`,
      devices: [...RECV_DEVICES.entries()].map(([sn, v]) => ({ sn, ...v })),
    });
  }
  if (mode === 'session') {
    if (!serverUrl || !userName || !password) {
      return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
    }
    try {
      await etl.login(serverUrl, userName, password);
      return res.json({ ok: true, mode, message: 'eTimeTrackLite session login OK.' });
    } catch (e) {
      return res.status(502).json({ ok: false, mode, error: e.message });
    }
  }
  if (mode === 'ebioserver') {
    if (!serverUrl || !userName || !password) {
      return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
    }
    try {
      const r = await ebs.ping({ serverUrl, userName, password });
      return res.json({
        ok: true, mode, url: r.url,
        message: `eBioServerNew OK at ${r.url} — ${r.devices.length} device(s).`,
        devices: r.devices.slice(0, 5),
        sample: r.sample,
      });
    } catch (e) {
      return res.status(502).json({ ok: false, mode, error: e.message });
    }
  }
  if (!serverUrl) return res.status(400).json({ ok: false, error: 'serverUrl required' });
  if (mode === 'soap') {
    try {
      const now = new Date();
      const xml = await callSoap({
        serverUrl, userName, password,
        fromDate: fmtLocal(new Date(now.getTime() - 60 * 60 * 1000)),
        toDate: fmtLocal(now),
      });
      const ok = !/Invalid|Authentication|Error/i.test(xml.slice(0, 800));
      return res.json({ ok, mode, raw: xml.slice(0, 400) });
    } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
  }
  if (mode === 'adms') {
    const now = new Date();
    const r = await tryAdmsPull({
      serverUrl, userName, password,
      fromDate: fmtLocal(new Date(now.getTime() - 60 * 60 * 1000)),
      toDate: fmtLocal(now),
    });
    return res.json({ ok: r.ok, mode, source: r.source, error: r.error, samples: r.punches?.slice(0, 3) });
  }
  return res.status(400).json({ ok: false, error: 'Unknown mode' });
});

app.post('/api/essl/punches', async (req, res) => {
  const { mode = 'receiver', serverUrl, userName, password, fromDate, toDate, sinceId } = req.body || {};
  const now = new Date();
  const from = fromDate || fmtLocal(new Date(now.getTime() - 5 * 60 * 1000));
  const to = toDate || fmtLocal(now);

  if (mode === 'receiver') {
    let list = RECV_PUNCHES;
    if (sinceId) {
      const idx = list.findIndex((p) => p.id === sinceId);
      if (idx >= 0) list = list.slice(idx + 1);
    }
    return res.json({ ok: true, mode, fromDate: from, toDate: to, count: list.length, punches: list.slice(-200) });
  }
  if (mode === 'session') {
    if (!serverUrl || !userName || !password) {
      return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
    }
    try {
      const punches = await etl.getReportPunches({ baseUrl: serverUrl, userName, password, fromDate: from, toDate: to });
      return res.json({ ok: true, mode, fromDate: from, toDate: to, count: punches.length, punches });
    } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
  }
  if (mode === 'ebioserver') {
    if (!serverUrl || !userName || !password) {
      return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
    }
    try {
      const fromDay = (from || '').slice(0, 10);
      const toDay = (to || '').slice(0, 10);
      const { punches, errors } = await ebs.getPunchesInRange({
        serverUrl, userName, password, location: req.body?.location || '',
        fromDate: fromDay, toDate: toDay,
      });
      return res.json({
        ok: true, mode, fromDate: fromDay, toDate: toDay,
        count: punches.length, punches, dayErrors: errors,
      });
    } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
  }
  if (!serverUrl) return res.status(400).json({ ok: false, error: 'serverUrl required' });
  if (mode === 'soap') {
    try {
      const xml = await callSoap({ serverUrl, userName, password, fromDate: from, toDate: to });
      const punches = parseSoapPunches(xml);
      return res.json({ ok: true, mode, fromDate: from, toDate: to, count: punches.length, punches });
    } catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
  }
  if (mode === 'adms') {
    const r = await tryAdmsPull({ serverUrl, userName, password, fromDate: from, toDate: to });
    if (!r.ok) return res.status(502).json({ ok: false, error: r.error });
    return res.json({ ok: true, mode, fromDate: from, toDate: to, count: r.punches.length, punches: r.punches });
  }
  return res.status(400).json({ ok: false, error: 'Unknown mode' });
});

// ---------------------------------------------------------------------------
// eBioServerNew helper endpoints (per eSSL eBioServerNew Web API doc v1.3).
// All require body: { serverUrl, userName, password }
// ---------------------------------------------------------------------------
app.post('/api/ebs/devices', async (req, res) => {
  const { serverUrl, userName, password, location = '' } = req.body || {};
  if (!serverUrl || !userName || !password) return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
  try {
    const devices = await ebs.getDevices({ serverUrl, userName, password, location });
    res.json({ ok: true, count: devices.length, devices });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/api/ebs/employees', async (req, res) => {
  const { serverUrl, userName, password, includeDetails = false } = req.body || {};
  if (!serverUrl || !userName || !password) return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
  try {
    const codes = await ebs.getEmployeeCodes({ serverUrl, userName, password });
    if (!includeDetails) return res.json({ ok: true, count: codes.length, codes });
    const out = [];
    for (const c of codes) {
      try { out.push(await ebs.getEmployeeDetails({ serverUrl, userName, password, empCode: c })); }
      catch { out.push({ empCode: c, error: true }); }
    }
    res.json({ ok: true, count: out.length, employees: out });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/api/ebs/punches/since', async (req, res) => {
  const { serverUrl, userName, password, location = '', logId = '0', logCount = '500' } = req.body || {};
  if (!serverUrl || !userName || !password) return res.status(400).json({ ok: false, error: 'serverUrl, userName, password required' });
  try {
    const r = await ebs.getDeviceLogsSince({ serverUrl, userName, password, location, logId, logCount });
    res.json({ ok: true, lastLogId: r.lastLogId, count: r.punches.length, punches: r.punches });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.post('/api/ebs/employee/punches', async (req, res) => {
  const { serverUrl, userName, password, empCode, date } = req.body || {};
  if (!serverUrl || !userName || !password || !empCode || !date) {
    return res.status(400).json({ ok: false, error: 'serverUrl, userName, password, empCode, date required' });
  }
  try {
    const punches = await ebs.getEmployeePunchLogs({ serverUrl, userName, password, empCode, date });
    res.json({ ok: true, count: punches.length, punches });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[smarthrms-essl-proxy] listening on http://0.0.0.0:${PORT}`);
  console.log(`[smarthrms-essl-proxy] ADMS receiver path: /iclock/cdata  /iclock/getrequest`);
  console.log(`[smarthrms-essl-proxy] eBioServerNew SOAP endpoints: /api/ebs/devices /api/ebs/employees /api/ebs/punches/since /api/ebs/employee/punches`);

  // Print local network IPs so you know what address to enter in the app
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    const ips = [];
    for (const iface of Object.values(nets)) {
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
      }
    }
    if (ips.length) {
      console.log(`\n[smarthrms-essl-proxy] 📱 Use one of these in your mobile app's Proxy URL:`);
      ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
    }
  } catch { /* ignore */ }
});
