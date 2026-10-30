/**
 * Debug script to fetch and inspect Employees.aspx HTML from ESSL portal
 * Run: npx ts-node scripts/debug-employees-grid.ts
 */
import crypto from 'crypto';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import fs from 'fs';

const BASE = 'http://98.70.41.54:85';
const USER = 'Essl';
const PASS = 'qizqer-1stDec2025';

function encPwd(plain: string, key: string): string {
  const kb = Buffer.from(key, 'utf8');
  const ks = kb.length <= 16 ? 16 : kb.length <= 24 ? 24 : 32;
  const pk = Buffer.alloc(ks, 0);
  kb.copy(pk);
  const c = crypto.createCipheriv(`aes-${ks * 8}-ecb` as any, pk, null);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
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

(async () => {
  const jar = new CookieJar();
  const client = wrapper(axios.create({
    jar, baseURL: BASE, withCredentials: true, timeout: 30000,
    maxRedirects: 5, validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
  }));

  // Step 1: Get login page
  console.log('Fetching login page...');
  const r1 = await client.get('/iclock/');
  const html = String(r1.data);
  console.log('Login page:', html.length, 'bytes');

  const hidden = pickHidden(html);
  console.log('Hidden fields:', Object.keys(hidden).length);

  // Find txtKey
  const keyMatch = html.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]*)"/i);
  const txtKey = keyMatch ? keyMatch[1] : (hidden['StaffloginDialog$txtKey'] || '');
  console.log('txtKey:', txtKey ? txtKey.substring(0, 20) + '...' : 'NOT FOUND');

  if (!txtKey) {
    console.log('Hidden field keys:', Object.keys(hidden).join('\n'));
    process.exit(1);
  }

  // Step 2: Login
  console.log('Logging in...');
  const form = new URLSearchParams({
    ...hidden,
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': USER,
    'StaffloginDialog$Txt_Password': encPwd(PASS, txtKey),
    'StaffloginDialog$txtKey': txtKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });

  const r2 = await client.post('/iclock/Default.aspx', form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/iclock/` },
  });
  const loginBody = String(r2.data);
  const loginFailed = /name="StaffloginDialog\$Btn_Ok"/i.test(loginBody);
  console.log('Login result:', loginFailed ? 'FAILED' : 'SUCCESS', `(${loginBody.length} bytes)`);

  if (loginFailed) {
    console.log('Login page still shown');
    process.exit(1);
  }

  // Step 3: Fetch Employees.aspx
  console.log('Fetching Employees.aspx...');
  const r3 = await client.get('/iclock/Manage/Employees.aspx', {
    headers: { Referer: `${BASE}/iclock/Main.aspx` },
  });
  const empHtml = String(r3.data);
  console.log('Employees page:', empHtml.length, 'bytes');

  // Save full HTML for inspection
  fs.writeFileSync('/tmp/employees-page.html', empHtml);
  console.log('Saved to /tmp/employees-page.html');

  // Look for grid headers
  const headerContainer = empHtml.match(/id="[^"]*HeaderContainer"[^>]*>([\s\S]*?)(?=<div[^>]*id="[^"]*BodyContainer")/i);
  if (headerContainer) {
    console.log('\n=== HEADER CONTAINER ===');
    const headerCells = headerContainer[1].match(/<div[^>]*class="[^"]*ob_gHC[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    headerCells.forEach((c, i) => {
      const text = c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
      console.log(`  Header[${i}]: "${text}"`);
    });
  } else {
    console.log('No HeaderContainer found');
  }

  // Look for body container and first few rows
  const bodyContainer = empHtml.match(/id="[^"]*BodyContainer"[^>]*>([\s\S]*?)(?=<div[^>]*id="[^"]*FooterContainer"|<div[^>]*id="[^"]*FCnC")/i);
  if (bodyContainer) {
    console.log('\n=== BODY CONTAINER ===');
    const rowDivs = bodyContainer[1].match(/<div[^>]*id="[^"]*_R_\d+[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*id="[^"]*_R_\d+[^"]*"|$)/gi) || [];
    console.log(`Found ${rowDivs.length} row divs`);
    // Show first 3 rows
    for (let r = 0; r < Math.min(3, rowDivs.length); r++) {
      const cells = rowDivs[r].match(/<div[^>]*class="[^"]*ob_gBC[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
      console.log(`\n  Row ${r} (${cells.length} cells):`);
      cells.forEach((c, i) => {
        const text = c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').trim();
        console.log(`    Cell[${i}]: "${text.substring(0, 80)}"`);
      });
    }
  } else {
    console.log('No BodyContainer found');
    // Try finding any grid structure
    const gridDivs = empHtml.match(/ob_g[A-Z]+/g);
    console.log('OBout grid classes found:', [...new Set(gridDivs || [])]);
    
    // Try finding table structure
    const tables = empHtml.match(/<table[^>]*>/gi);
    console.log('Tables found:', tables?.length || 0);
    
    // Look for "Employees List" or similar text
    const empListIdx = empHtml.indexOf('Employees List');
    if (empListIdx > 0) {
      console.log('\n"Employees List" found at offset', empListIdx);
      console.log('Context:', empHtml.substring(empListIdx - 100, empListIdx + 200).replace(/<[^>]+>/g, '|'));
    }
  }
})();
