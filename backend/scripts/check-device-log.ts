import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import axios from 'axios';
import * as tough from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as qs from 'qs';
import * as CryptoJS from 'crypto-js';

const BASE = 'http://98.70.41.54:85';
const UN = process.env.ESSL_ETL_USERNAME || 'Essl';
const PW = process.env.ESSL_ETL_PASSWORD || '';

async function main() {
  const jar = new tough.CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, timeout: 60000, maxRedirects: 10,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml,*/*' }
  }));

  // Load login page
  const r1 = await client.get('/iclock/');
  const lh = r1.data as string;
  const viewstate = (lh.match(/id="__VIEWSTATE"[^>]*value="([^"]*)"/) || [])[1] || '';
  const eventval  = (lh.match(/id="__EVENTVALIDATION"[^>]*value="([^"]*)"/) || [])[1] || '';
  const keyMatch  = lh.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]*)"/);
  const encKey    = keyMatch ? keyMatch[1] : '';

  // Encrypt password with AES-ECB matching eTimeTrackLite JS client code
  let encPw = PW;
  const keyBuf = Buffer.from(encKey, 'utf8');
  const keySize = keyBuf.length <= 16 ? 16 : keyBuf.length <= 24 ? 24 : 32;
  const paddedKey = Buffer.alloc(keySize, 0); keyBuf.copy(paddedKey);
  const crypto2 = require('crypto');
  const cipher = crypto2.createCipheriv(`aes-${keySize * 8}-ecb`, paddedKey, null);
  if (encKey) encPw = Buffer.concat([cipher.update(PW, 'utf8'), cipher.final()]).toString('base64');

  // Extract ALL hidden fields from the login page
  const hiddenFields: Record<string, string> = {};
  for (const m of lh.matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const nm = m[0].match(/name="([^"]*)"/i);
    const vm = m[0].match(/value="([^"]*)"/i);
    if (nm) hiddenFields[nm[1]] = vm ? vm[1] : '';
  }

  const formData = qs.stringify({
    ...hiddenFields,
    '__EVENTTARGET': '', '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': UN,
    'StaffloginDialog$Txt_Password': encPw,
    'StaffloginDialog$txtKey': encKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });

  const r2 = await client.post('/iclock/Default.aspx', formData, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/iclock/` }
  });
  
  if (/StaffloginDialog\$Btn_Ok/.test(r2.data as string)) {
    console.error('Login FAILED');
    process.exit(1);
  }
  console.log('Login OK, session URL:', r2.request?.res?.responseUrl || 'unknown');

  // Try DeviceLogList.aspx (raw biometric punch records page)
  console.log('\n--- Checking Reports/DeviceLogList.aspx ---');
  for (const path of [
    '/iclock/Reports/DeviceLogList.aspx',
    '/iclock/DeviceLogList.aspx',
    '/iclock/Reports/AttendenceLog.aspx',
    '/iclock/Reports/LogRecords.aspx',
  ]) {
    try {
      const r3 = await client.get(path, {
        headers: { Referer: `${BASE}/iclock/Main.aspx` }
      });
      const html = r3.data as string;
      const hasError = /CustomError/.test(html) || html.length < 1000;
      const d2 = (html.match(/2026-07-02/g) || []).length;
      const d3 = (html.match(/2026-07-03/g) || []).length;
      const d1 = (html.match(/2026-07-01/g) || []).length;
      const hasBtn = /GenerateReport|btn_Generate/.test(html);
      console.log(`  ${path}: len=${html.length} hasError=${hasError} hasBtn=${hasBtn} Jul1=${d1} Jul2=${d2} Jul3=${d3}`);
    } catch (e: any) {
      console.error(`  ${path}: error - ${e.message}`);
    }
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
