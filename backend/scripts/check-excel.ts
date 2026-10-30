import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import axios from 'axios';
import * as crypto from 'crypto';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const BASE = 'http://98.70.41.54:85';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UN = process.env.ESSL_ETL_USERNAME!;
const PW = process.env.ESSL_ETL_PASSWORD!;

function ph(html: string, name: string): string {
  return (html.match(new RegExp(`name="${name.replace(/\$/g, '\\$')}"[^>]*value="([^"]*)"`, 'i')) || [])[1] ?? '';
}
function pickAll(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*type="hidden"/gi)) out[m[1]] = m[2];
  return out;
}
function sel(html: string, name: string): string {
  const re = new RegExp('<select[^>]*name="' + name.replace(/\$/g, '\\$') + '"[\\s\\S]*?</select>', 'i');
  const m = html.match(re);
  return m ? ((m[0].match(/<option[^>]*selected[^>]*value="([^"]*)"/i) || [])[1] || '') : '';
}
function aes(p: string, k: string): string {
  const kb = Buffer.alloc(16); Buffer.from(k).copy(kb, 0, 0, Math.min(Buffer.from(k).length, 16));
  const c = crypto.createCipheriv('aes-128-ecb', kb, null);
  return Buffer.concat([c.update(p, 'utf8'), c.final()]).toString('base64');
}

(async () => {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true, timeout: 90000, maxRedirects: 5, validateStatus: () => true, headers: { 'User-Agent': UA } }));

  // Login
  const r1 = await client.get(`${BASE}/iclock/`);
  const h = String(r1.data);
  const txtKey = ph(h, 'StaffloginDialog$txtKey');
  const fp = new URLSearchParams({
    '__VIEWSTATE': ph(h, '__VIEWSTATE'), '__VIEWSTATEGENERATOR': ph(h, '__VIEWSTATEGENERATOR'),
    '__EVENTVALIDATION': ph(h, '__EVENTVALIDATION'), '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': UN, 'StaffloginDialog$Txt_Password': aes(PW, txtKey),
    'StaffloginDialog$txtKey': txtKey, 'StaffloginDialog$Btn_Ok': 'Login',
  });
  const r2 = await client.post(`${BASE}/iclock/`, fp.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (/StaffloginDialog\$Btn_Ok/i.test(String(r2.data))) { console.error('Login failed'); process.exit(1); }
  console.log('Logged in OK');

  // Fetch LogRecords for Jun 28 - Jul 4 (broader range)
  const url = `${BASE}/iclock/Reports/LogRecords.aspx`;
  const r3 = await client.get(url, { headers: { Referer: `${BASE}/iclock/Main.aspx` } });
  const lh = String(r3.data);
  if (!/btn_GenerateReport/.test(lh)) { console.error('Cannot access LogRecords'); process.exit(1); }

  const hidden = pickAll(lh);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) params.append(k, v);
  // Wide range: Jun 28 to Jul 4
  params.set('ReportProtoType$Drp_FromDateDD', '28');
  params.set('ReportProtoType$Drp_FromDateMM', '6');
  params.set('ReportProtoType$Drp_FromDateYYYY', '2026');
  params.set('ReportProtoType$Drp_ToDateDD', '04');
  params.set('ReportProtoType$Drp_ToDateMM', '7');
  params.set('ReportProtoType$Drp_ToDateYYYY', '2026');
  params.set('ReportProtoType$drp_ReportType', 'Date Wise');
  for (const sn of ['ReportProtoType$drp_EmployeeCategory', 'ReportProtoType$drp_EmployeeDesignation', 'ReportProtoType$drp_EmployeeLocation', 'ReportProtoType$drp_EmployeeType', 'ReportProtoType$Lst_FilterCompany', 'ReportProtoType$Lst_FilterDepartment', 'ReportProtoType$Lst_FilterDevice']) {
    const v = sel(lh, sn); if (v) params.set(sn, v);
  }
  params.set('ReportProtoType$btn_GenerateReport', 'Generate Report');
  params.set('__EVENTTARGET', ''); params.set('__EVENTARGUMENT', '');

  const r4 = await client.post(url, params.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, Origin: BASE }, timeout: 90000 });
  const html2 = String(r4.data);
  const m = html2.match(/"ExportUrlBase"\s*:\s*"([^"]+)"/);
  if (!m) { console.error('No ExportUrlBase. Report snippet:', html2.slice(0, 500)); process.exit(1); }

  const exportBase = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  const controlID = (exportBase.match(/ControlID=([0-9a-f]{20,})/) || [])[1];
  const exportUrl = `${BASE}/iclock/Reserved.ReportViewerWebControl.axd?Culture=1033&CultureOverrides=True&UICulture=1033&UICultureOverrides=True&ReportStack=1&ControlID=${controlID}&Mode=true&OpType=Export&FileName=LogRecords&ContentDisposition=OnlyHtmlInline&Format=EXCEL`;

  const r5 = await client.get(exportUrl, { headers: { Referer: url }, responseType: 'arraybuffer', timeout: 120000 });
  const buf = Buffer.from(r5.data);
  console.log('Excel size:', buf.length, '| content-type:', r5.headers['content-type']);

  // Save raw Excel for inspection
  const savePath = '/tmp/essl-report.xlsx';
  fs.writeFileSync(savePath, buf);
  console.log('Excel saved to:', savePath);

  // Parse and show ALL dates
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log('\nTotal Excel rows:', rows.length);

  const dateSummary: Record<string, number> = {};
  let currentDate = '';
  let firstDateRow = '';

  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const col1 = String(row[1] || '').trim();
    if (col1 === 'Date:' && row[3] !== undefined) {
      const v = row[3];
      if (v instanceof Date) {
        const y = v.getFullYear(), mo = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
        currentDate = `${y}-${mo}-${d}`;
      } else {
        currentDate = String(v).trim().slice(0, 10);
      }
      if (!firstDateRow) firstDateRow = 'col3 type=' + (v instanceof Date ? 'Date' : typeof v) + ' val=' + String(v).slice(0, 30);
    } else if (col1 !== 'Log Date' && /^\d{1,2}:\d{2}/.test(col1) && currentDate) {
      dateSummary[currentDate] = (dateSummary[currentDate] || 0) + 1;
    }
  }

  console.log('First date row info:', firstDateRow);
  console.log('\nAll dates in Excel report:');
  if (Object.keys(dateSummary).length === 0) {
    console.log('  *** NO DATES FOUND IN EXCEL ***');
    console.log('  First 20 rows raw:');
    rows.slice(0, 20).forEach((r, i) => console.log(`  ${i}:`, JSON.stringify(r.slice(0, 6))));
  } else {
    for (const [d, c] of Object.entries(dateSummary).sort()) console.log(`  ${d}: ${c} punch records`);
  }
})();
