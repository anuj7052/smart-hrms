/**
 * Inspect DeviceLogList.aspx form fields and test the filter POST
 */
import { PrismaClient } from '@prisma/client';
import { decryptFromStorage } from '../src/services/etlService';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const IST_MS = 330 * 60 * 1000;

// Replicate the REAL etlLogin approach
function createClient(baseUrl: string) {
  const jar = new CookieJar();
  return wrapper(axios.create({
    jar, baseURL: baseUrl, withCredentials: true, timeout: 30000, maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }));
}

function extractHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) fields[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*type="hidden"/gi)) fields[m[1]] = m[2];
  return fields;
}

function extractFieldByName(html: string, name: string): string | null {
  const m = html.match(new RegExp(`<input[^>]+name=["']${name.replace(/\$/g, '\\$')}["'][^>]*value=["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function encryptPassword(plain: string, secretKey: string): string {
  const keyBuf = Buffer.from(secretKey, 'utf8');
  const keySize = keyBuf.length <= 16 ? 16 : keyBuf.length <= 24 ? 24 : 32;
  const paddedKey = Buffer.alloc(keySize, 0);
  keyBuf.copy(paddedKey);
  const cipher = crypto.createCipheriv(`aes-${keySize * 8}-ecb` as any, paddedKey, null);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

async function login(baseUrl: string, username: string, password: string) {
  const client = createClient(baseUrl);
  const r1 = await client.get('/iclock/');
  const html1 = String(r1.data);
  const hidden = extractHiddenFields(html1);
  const txtKey = extractFieldByName(html1, 'StaffloginDialog$txtKey');
  if (!txtKey) throw new Error('No txtKey found on login page');

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
  const body = String(r2.data);
  if (/StaffloginDialog\$Btn_Ok/.test(body)) throw new Error('Login failed — still on login page');
  console.log('Login OK');
  return client;
}

(async () => {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.error('Device not found'); process.exit(1); }
  const baseUrl = `http://${device.ip}:${device.port}`;
  const username = device.etlUsername || process.env.ESSL_ETL_USERNAME || '';
  const password = device.etlPassword ? decryptFromStorage(device.etlPassword) : (process.env.ESSL_ETL_PASSWORD || '');

  const client = await login(baseUrl, username, password);

  const pageUrl = '/iclock/Manage/DeviceLogList.aspx';
  const r1 = await client.get(pageUrl, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
  const html = String(r1.data);
  console.log('GET status:', r1.status, '| Size:', html.length);

  // Print all form fields
  console.log('\n=== FORM FIELDS ===');
  const allInputs = [...html.matchAll(/<input[^>]+>/gi)].map(m => m[0]);
  const allSelects = [...html.matchAll(/<select[^>]+>/gi)].map(m => m[0]);
  const allButtons = [...html.matchAll(/<(?:input|button)[^>]*type=['"]?submit['"]?[^>]*>/gi)].map(m => m[0]);

  console.log('\nHidden fields:');
  for (const inp of allInputs) {
    if (/type=['"]?hidden/i.test(inp)) {
      const nm = (inp.match(/name=['"]([^'"]+)['"]/i) || [])[1];
      const val = (inp.match(/value=['"]([^'"]*)['"]/i) || [])[1];
      if (nm && !nm.includes('ViewState') && !nm.includes('EventValidation')) console.log(`  ${nm} = "${val}"`);
    }
  }

  console.log('\nSelect/dropdown fields:');
  for (const sel of allSelects) {
    const nm = (sel.match(/name=['"]([^'"]+)['"]/i) || [])[1];
    const id = (sel.match(/id=['"]([^'"]+)['"]/i) || [])[1];
    if (nm || id) console.log(`  name="${nm}" id="${id}"`);
  }

  console.log('\nSubmit buttons:');
  for (const btn of allButtons) {
    const nm = (btn.match(/name=['"]([^'"]+)['"]/i) || [])[1];
    const val = (btn.match(/value=['"]([^'"]*)['"]/i) || [])[1];
    const id = (btn.match(/id=['"]([^'"]+)['"]/i) || [])[1];
    console.log(`  name="${nm}" id="${id}" value="${val}"`);
  }

  // Show options of key select fields
  console.log('\n=== SELECT OPTIONS (key fields) ===');
  const selectBlocks = [...html.matchAll(/<select[^>]*name=['"]([^'"]*(?:Month|Year|Date|From|To|Device)[^'"]*)['"]([\s\S]*?)<\/select>/gi)];
  for (const m of selectBlocks) {
    const name = m[1];
    const opts = [...m[2].matchAll(/<option[^>]*value=['"]([^'"]*)['"]/gi)].map(o => o[1]);
    console.log(`  ${name}: [${opts.slice(0, 10).join(', ')}]`);
  }

  // Now test a POST with June 2026 filter
  console.log('\n=== TESTING POST (June 2026, days 1-30) ===');
  const hidden = extractHiddenFields(html);

  // Try multiple variations to find the right field names
  const variations = [
    // Variation A: original code approach
    { '__EVENTTARGET': 'btnUpdate', 'btnUpdate': 'Update', 'ddlFromDate': '1', 'ddlToDate': '30', 'ddlMonth': '06', 'ddlYear': '2026', 'drp_Devices': '0' },
    // Variation B: __EVENTTARGET empty
    { '__EVENTTARGET': '', 'btnUpdate': 'Update', 'ddlFromDate': '1', 'ddlToDate': '30', 'ddlMonth': '06', 'ddlYear': '2026', 'drp_Devices': '0' },
    // Variation C: no leading zero on month
    { '__EVENTTARGET': '', 'btnUpdate': 'Update', 'ddlFromDate': '1', 'ddlToDate': '30', 'ddlMonth': '6', 'ddlYear': '2026', 'drp_Devices': '0' },
    // Variation D: no leading zero on month with EVENTTARGET
    { '__EVENTTARGET': 'btnUpdate', 'btnUpdate': 'Update', 'ddlFromDate': '1', 'ddlToDate': '30', 'ddlMonth': '6', 'ddlYear': '2026', 'drp_Devices': '0' },
  ];

  for (let i = 0; i < variations.length; i++) {
    const v = variations[i];
    const formData = new URLSearchParams({ ...hidden, '__EVENTARGUMENT': '', ...v });
    const r2 = await client.post(pageUrl, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${pageUrl}` },
    });
    const body = String(r2.data);
    const june2 = (body.match(/6\/2\/2026|2026-06-02/g) || []).length;
    const june3 = (body.match(/6\/3\/2026|2026-06-03/g) || []).length;
    const june1 = (body.match(/6\/1\/2026|2026-06-01/g) || []).length;
    // Count table rows with data
    const dataRows = (body.match(/<tr[^>]*class=['"](?:GridRow|gridrow|alt)[^'"]*['"][^>]*>/gi) || []).length;
    // Extract TotalRecords from response
    const totalM = body.match(/ob_DG_DeviceLogRecordsTotalRecords[^"]*"(\d+)"/);
    const totalRecords = totalM ? totalM[1] : '?';
    console.log(`Variation ${String.fromCharCode(65+i)}: June1=${june1} June2=${june2} June3=${june3} | dataRows=${dataRows} | total=${totalRecords} | bodyLen=${body.length}`);
    if (i === 0) {
      // Show first 5 actual <tr> rows with all cells for debugging
      console.log('\n--- First few table rows (Variation A) ---');
      const allRows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      let shown = 0;
      for (const rowM of allRows) {
        const cells = [...rowM[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
          .map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
        if (cells.length >= 4 && cells.some(c => /\d{1,2}\/\d{1,2}\/\d{4}/.test(c))) {
          console.log(`  cells[0..9]:`, cells.slice(0, 10).join(' | '));
          shown++;
          if (shown >= 5) break;
        }
      }
    }
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
