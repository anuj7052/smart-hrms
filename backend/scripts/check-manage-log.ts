import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import * as crypto from 'crypto';
import axios from 'axios';
import * as tough from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';

const BASE = 'http://98.70.41.54:85';
const UN = process.env.ESSL_ETL_USERNAME || 'Essl';
const PW = process.env.ESSL_ETL_PASSWORD || '';
const SN = 'CGKK220762223';

function encryptPassword(plain: string, secretKey: string): string {
  const keyBuf = Buffer.from(secretKey, 'utf8');
  const keySize = keyBuf.length <= 16 ? 16 : keyBuf.length <= 24 ? 24 : 32;
  const paddedKey = Buffer.alloc(keySize, 0); keyBuf.copy(paddedKey);
  const cipher = crypto.createCipheriv(`aes-${keySize * 8}-ecb` as any, paddedKey, null);
  return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
}

function extractHidden(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const nm = m[0].match(/name="([^"]*)"/i);
    const vm = m[0].match(/value="([^"]*)"/i);
    if (nm) out[nm[1]] = vm ? vm[1] : '';
  }
  return out;
}

interface PunchRecord {
  userId: string;
  logDate: Date;  // actual punch time (IST wall-clock parsed to UTC)
  attState: string; // Check-In or Check-Out
  deviceSN: string;
}

function parseDeviceLogHtml(html: string): PunchRecord[] {
  const records: PunchRecord[] = [];
  
  // Extract all data rows - each row contains ob_gRC divs with the cell values
  // Structure: <tr class="ob_gR ..."> containing <td class="ob_gC"><div class="ob_gRC">VALUE</div></td>
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
    
    // Column layout (from the HTML header): Download Date | [hidden ID] | User Id | Log Date | Device Name | Serial No | Att State | ...
    // But the hidden column might not appear in ob_gRC. Let's match by content pattern.
    // We have Download Date (date pattern) and Log Date (date pattern) in cells.
    // Find indices of date-like values and string values
    
    if (cellValues.length < 5) continue;
    
    // Find the Log Date - it's the date that's the actual punch time
    // Download Date is when server got it, Log Date is actual punch time
    // Usually: cell[0]=DownloadDate, cell[1]=UserId, cell[2]=LogDate, cell[3]=DeviceName, cell[4]=SerialNo, cell[5]=AttState
    // OR: cell[0]=DownloadDate, cell[1]=UserId, cell[2]=LogDate, cell[3]=DeviceName, cell[4]=SerialNo, cell[5]=AttState
    
    const datePat = /^\d{2}\s+[A-Za-z]{3}\s+\d{4}/;
    const dateIndices = cellValues.map((v, i) => datePat.test(v) ? i : -1).filter(i => i >= 0);
    
    if (dateIndices.length < 1) continue;
    
    // User ID should come after the first date
    const downloadDateIdx = dateIndices[0];
    const logDateIdx = dateIndices.length >= 2 ? dateIndices[1] : -1;
    
    // User Id is between dates or after first date
    let userId = '';
    let logDateStr = '';
    let attState = '';
    let serialNo = '';
    
    // Layout: DownloadDate, UserId, LogDate, DeviceName, SerialNo, AttState
    if (logDateIdx === downloadDateIdx + 2) {
      userId = cellValues[downloadDateIdx + 1];
      logDateStr = cellValues[logDateIdx];
      serialNo = cellValues.find(v => /^[A-Z]{4}\d{9,}/.test(v)) || '';
      attState = cellValues.find(v => /Check[-\s]/i.test(v)) || '';
    } else if (dateIndices.length >= 1) {
      // Fallback: try positions
      userId = cellValues.find(v => /^[A-Z]{2,4}\d{3,}/.test(v) && !datePat.test(v) && !/^CGKK/.test(v)) || '';
      logDateStr = cellValues[downloadDateIdx]; // Use first date as log date
      serialNo = cellValues.find(v => /^CGKK/.test(v)) || '';
      attState = cellValues.find(v => /Check[-\s]/i.test(v)) || '';
    }
    
    if (!userId || !logDateStr || !attState) continue;
    
    // Parse date "02 Jul 2026 18:39:57" as IST wall-clock
    const parsed = new Date(logDateStr + ' +05:30');
    if (isNaN(parsed.getTime())) continue;
    
    records.push({ userId: userId.trim(), logDate: parsed, attState: attState.trim(), deviceSN: serialNo.trim() });
  }
  
  return records;
}

async function main() {
  const jar = new tough.CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, timeout: 90000, maxRedirects: 10,
    withCredentials: true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
  }));

  // Login
  const r1 = await client.get('/iclock/');
  const h1 = r1.data as string;
  const hidden = extractHidden(h1);
  const keyMatch = h1.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]*)"/);
  const encKey = keyMatch ? keyMatch[1] : '';
  const encPw = encKey ? encryptPassword(PW, encKey) : PW;

  const fp = new URLSearchParams({
    ...hidden, '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': UN,
    'StaffloginDialog$Txt_Password': encPw,
    'StaffloginDialog$txtKey': encKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });
  const r2 = await client.post('/iclock/Default.aspx', fp.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/iclock/` }
  });
  if (/StaffloginDialog\$Btn_Ok/i.test(r2.data as string)) { console.error('Login failed'); process.exit(1); }
  console.log('Login OK');
  
  // Access Main.aspx to establish full session context
  await client.get('/iclock/Main.aspx', { headers: { Referer: `${BASE}/iclock/` } });
  
  // Now try to access the Manage/DeviceLogList.aspx for Jul 1-3
  for (const { day1, day2, month, year } of [
    { day1: 1, day2: 1, month: 7, year: 2026 },
    { day1: 2, day2: 2, month: 7, year: 2026 },
    { day1: 3, day2: 3, month: 7, year: 2026 },
  ]) {
    const url = `/iclock/Manage/DeviceLogList.aspx?Device=0&FromDay=${day1.toString().padStart(2,'0')}&ToDay=${day2.toString().padStart(2,'0')}&Month=${month.toString().padStart(2,'0')}&Year=${year}&VerifyMode=0&SortBy=LogDate&SortOrder=Asc&PageSize=5000`;
    try {
      const r = await client.get(url, {
        headers: { Referer: `${BASE}/iclock/Main.aspx` }
      });
      const html = r.data as string;
      const hasError = /CustomError/.test(html) || html.length < 5000;
      
      if (hasError) {
        console.log(`Jul ${day1}: ⚠ Cannot access (len=${html.length})`);
      } else {
        const records = parseDeviceLogHtml(html);
        console.log(`Jul ${day1}: ✓ len=${html.length} records found: ${records.length}`);
        if (records.length > 0) {
          console.log('First 3:'); records.slice(0, 3).forEach(r => console.log(' ', r.userId, r.logDate.toISOString(), r.attState));
          console.log('Last 3:');  records.slice(-3).forEach(r => console.log(' ', r.userId, r.logDate.toISOString(), r.attState));
        } else if (records.length === 0) {
          const sampleMatch = html.match(/\d{2}\s+[A-Za-z]{3}\s+202\d[\s\S]{0,200}/);
          console.log('Sample with date:', sampleMatch ? sampleMatch[0].slice(0, 200) : 'None found');
        }
      }
    } catch (e: any) {
      console.log(`Jul ${day1}: error - ${e.message}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
