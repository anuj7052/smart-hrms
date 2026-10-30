/**
 * Test DeviceLogList.aspx directly (approach 2) to confirm it has June 2/3 data
 */
import { PrismaClient } from '@prisma/client';
import { decryptFromStorage } from '../src/services/etlService';
import axios from 'axios';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();
const IST_MS = 330 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function createClient(baseUrl: string) {
  const jar = new CookieJar();
  return wrapper(axios.create({
    jar, baseURL: baseUrl, withCredentials: true, timeout: 30000, maxRedirects: 5,
    validateStatus: () => true,
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  }));
}

function pickHidden(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const re = /<input[^>]+type=['"]?hidden['"]?[^>]*>/gi;
  const re2 = /name=['"]([^'"]+)['"]/i;
  const re3 = /value=['"]([^'"]*)['"]/i;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM = re2.exec(tag);
    const valM = re3.exec(tag);
    if (nameM) fields[nameM[1]] = valM ? valM[1] : '';
  }
  return fields;
}

(async () => {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.error('Device not found'); process.exit(1); }
  const baseUrl = `http://${device.ip}:${device.port}`;
  const username = device.etlUsername || process.env.ESSL_ETL_USERNAME || '';
  const password = device.etlPassword ? decryptFromStorage(device.etlPassword) : (process.env.ESSL_ETL_PASSWORD || '');

  const client = createClient(baseUrl);

  // LOGIN
  console.log(`Logging in to ${baseUrl} as ${username}...`);
  const loginPage = await client.get('/iclock/Login.aspx');
  const loginHtml = String(loginPage.data);
  const hidden = pickHidden(loginHtml);

  const loginForm = new URLSearchParams({
    ...hidden,
    'Login1$UserName': username,
    'Login1$Password': password,
    'Login1$LoginButton': 'Log In',
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
  });
  const loginResp = await client.post('/iclock/Login.aspx', loginForm.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}/iclock/Login.aspx` },
    maxRedirects: 5,
  });
  const loginBody = String(loginResp.data || '');
  const loggedIn = loginBody.includes('Main.aspx') || loginBody.includes('Logout') || loginResp.request?.path?.includes('Main');
  console.log('Login success:', loggedIn);
  if (!loggedIn) {
    const errM = loginBody.match(/class="failureText[^"]*">([^<]+)</i);
    console.log('Login error:', errM ? errM[1].trim() : 'unknown');
    process.exit(1);
  }

  // Test DeviceLogList.aspx for June 2026
  const pageUrl = '/iclock/Manage/DeviceLogList.aspx';
  console.log('\nFetching DeviceLogList.aspx...');
  const r1 = await client.get(pageUrl, { headers: { Referer: `${baseUrl}/iclock/Main.aspx` } });
  const html1 = String(r1.data);
  console.log('GET status:', r1.status, '| Response size:', html1.length);

  const hidden2 = pickHidden(html1);

  // Post for June 2026 (all days 1-30)
  const formData = new URLSearchParams({
    ...hidden2,
    '__EVENTTARGET': 'btnUpdate',
    '__EVENTARGUMENT': '',
    'drp_Devices': '0',
    'ddlFromDate': '1',
    'ddlToDate': '30',
    'ddlMonth': '06',
    'ddlYear': '2026',
    'btnUpdate': 'Update',
  });

  const r2 = await client.post(pageUrl, formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}${pageUrl}` },
  });
  const html2 = String(r2.data);
  console.log('POST status:', r2.status, '| Response size:', html2.length);

  // Check for date patterns
  const june2 = (html2.match(/6\/2\/2026|2026-06-02/g) || []).length;
  const june3 = (html2.match(/6\/3\/2026|2026-06-03/g) || []).length;
  const june1 = (html2.match(/6\/1\/2026|2026-06-01/g) || []).length;
  console.log(`Date mentions - June 1: ${june1}, June 2: ${june2}, June 3: ${june3}`);

  // Show snippet of the table
  const tableMatch = html2.match(/<table[^>]*GridView[^>]*>([\s\S]*?)<\/table>/i);
  if (tableMatch) {
    const rows = tableMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
    console.log(`\nTable rows: ${rows.length}`);
    rows.slice(0, 8).forEach((row, i) => {
      const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || [])
        .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()).slice(0, 8);
      if (cells.some(c => c)) console.log(`  Row ${i}:`, cells.join(' | '));
    });
  } else {
    // no GridView — check what the page contains
    const bodyText = html2.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('\nPage text snippet:', bodyText.substring(0, 500));
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
