import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

// Use the existing etlService login mechanism directly
import axios from 'axios';
import * as tough from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as crypto from 'crypto';

const BASE = 'http://98.70.41.54:85';
const UN = process.env.ESSL_ETL_USERNAME || 'Essl';
const PW = process.env.ESSL_ETL_PASSWORD || '';

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

async function main() {
  const jar = new tough.CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, timeout: 90000, maxRedirects: 10,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html,*/*' }
  }));

  // Login
  const r1 = await client.get('/iclock/');
  const h1 = r1.data as string;
  const hidden1 = extractHidden(h1);
  const keyMatch = h1.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]*)"/);
  const encKey = keyMatch ? keyMatch[1] : '';
  const encPw = encKey ? encryptPassword(PW, encKey) : PW;

  const fp = new URLSearchParams({
    ...hidden1, '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': UN,
    'StaffloginDialog$Txt_Password': encPw,
    'StaffloginDialog$txtKey': encKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });
  const r2 = await client.post('/iclock/Default.aspx', fp.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/iclock/` }
  });
  if (/StaffloginDialog\$Btn_Ok/i.test(r2.data as string)) { console.error('Login failed'); process.exit(1); }
  console.log('Logged in. Checking DeviceLogList via GET...');

  // Now navigate to Main.aspx first to establish frameset
  await client.get('/iclock/Main.aspx');

  // Try DeviceLogList with explicit cookie from session
  const cookies = await jar.getCookies(BASE);
  console.log('Session cookies:', cookies.map(c => c.key).join(', '));

  // Try the page with post-to-get navigation approach used by the ASP.NET frameset
  // The frameset uses __doPostBack to navigate - try simulating navigation
  for (const testPath of [
    '/iclock/Reports/DeviceLogList.aspx',
    '/iclock/Reports/AttendenceLog.aspx',  
    '/iclock/Utilities/DeviceLogList.aspx',
  ]) {
    try {
      const rTest = await client.get(testPath, {
        headers: { 
          Referer: `${BASE}/iclock/Main.aspx`,
          'X-Requested-With': 'XMLHttpRequest',
        }
      });
      const h = rTest.data as string;
      const hasContent = h.length > 5000 && !(/CustomError/.test(h));
      const d1 = (h.match(/Jul.*?2026|2026-07-01|01.Jul.2026|01\/07\/2026/g) || []).length;
      const d2 = (h.match(/2026-07-02|02.Jul.2026|02\/07\/2026/g) || []).length;
      const d3 = (h.match(/2026-07-03|03.Jul.2026|03\/07\/2026/g) || []).length;
      console.log(`${testPath}: len=${h.length} hasContent=${hasContent} Jul1=${d1} Jul2=${d2} Jul3=${d3}`);
      if (hasContent) console.log('First 300:', h.slice(0, 300));
    } catch (e: any) {
      console.log(`${testPath}: error - ${e.message}`);
    }
  }

  // Try the iclock/cdata endpoint to see if device is sending punch data
  console.log('\n--- Checking iClock cdata ---');
  try {
    const rc = await client.get('/iclock/cdata', {
      params: { SN: 'CGKK220762223', options: 'all', pushver: '2.3.1', language: '0' },
      headers: { Referer: `${BASE}/iclock/` }
    });
    console.log('cdata response (first 200 chars):', String(rc.data).slice(0, 200));
  } catch (e: any) {
    console.log('cdata error:', e.message);
  }

  // Try the getrequest endpoint (server→device command queue)
  console.log('\n--- Checking getrequest ---');
  try {
    const rg = await client.get('/iclock/getrequest', {
      params: { SN: 'CGKK220762223', INFO: 'firmVer=6.60,pushVer=2.4.1,time=2026-07-03 12:00:00,cloudVer=0' },
      headers: { Referer: `${BASE}/iclock/` }
    });
    console.log('getrequest response (first 200 chars):', String(rg.data).slice(0, 200));
  } catch (e: any) {
    console.log('getrequest error:', e.message);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
