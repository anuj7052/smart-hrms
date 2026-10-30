import { PrismaClient } from '@prisma/client';
import { decryptFromStorage } from '../src/services/etlService';
import axios from 'axios';

const prisma = new PrismaClient();

function pickHidden(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) out[m[1]] = m[2];
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*type="hidden"/gi)) out[m[1]] = m[2];
  return out;
}

async function main() {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.log('Device not found'); return; }

  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch (e) {}
  }
  if (!password) password = process.env.ESSL_ETL_PASSWORD;
  const username = (device.etlUsername || process.env.ESSL_ETL_USERNAME)!;
  const baseUrl = `http://${device.ip}:${device.port}`;
  const todayIST = new Date(Date.now() + 330 * 60000).toISOString().split('T')[0];
  const [todayY, todayM, todayD] = todayIST.split('-');
  console.log('Today IST:', todayIST, '| Portal:', baseUrl);

  const client = axios.create({ baseURL: baseUrl, timeout: 30000, maxRedirects: 5 });
  let cookies = '';

  // Login
  const r1 = await client.get('/iclock/');
  const html1 = String(r1.data);
  cookies = (r1.headers['set-cookie'] || []).join('; ');
  const hidden1 = pickHidden(html1);
  const txtKeyMatch = html1.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]+)"/i);
  const txtKey = txtKeyMatch ? txtKeyMatch[1] : '';

  // ESSL portal password: XOR with key then base64
  function encryptPwd(pwd: string, key: string): string {
    if (!key) return pwd;
    let r = '';
    for (let i = 0; i < pwd.length; i++) r += String.fromCharCode(pwd.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return Buffer.from(r, 'binary').toString('base64');
  }

  const formData = new URLSearchParams({
    ...hidden1,
    '__EVENTTARGET': '',
    '__EVENTARGUMENT': '',
    'StaffloginDialog$txt_LoginName': username,
    'StaffloginDialog$Txt_Password': encryptPwd(password!, txtKey),
    'StaffloginDialog$txtKey': txtKey,
    'StaffloginDialog$Btn_Ok': 'Login',
  });

  const r2 = await client.post('/iclock/Default.aspx', formData.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}/iclock/`, Cookie: cookies },
  });
  cookies = [cookies, ...(r2.headers['set-cookie'] || [])].join('; ');
  const loggedIn = !r2.data.includes('StaffloginDialog$Btn_Ok');
  console.log('Logged in:', loggedIn);
  if (!loggedIn) { console.log('Login FAILED'); await prisma.$disconnect(); return; }

  // DeviceLogList.aspx - GET page
  const r3 = await client.get('/iclock/Manage/DeviceLogList.aspx', {
    headers: { Cookie: cookies, Referer: `${baseUrl}/iclock/Main.aspx` }
  });
  cookies = [cookies, ...(r3.headers['set-cookie'] || [])].join('; ');
  const html3 = String(r3.data);
  const hidden3 = pickHidden(html3);

  // POST for today
  const form3 = new URLSearchParams({
    ...hidden3,
    '__EVENTTARGET': 'btnUpdate',
    '__EVENTARGUMENT': '',
    'drp_Devices': '0',
    'ddlFromDate': String(parseInt(todayD)),
    'ddlToDate': String(parseInt(todayD)),
    'ddlMonth': String(parseInt(todayM)),
    'ddlYear': todayY,
    'btnUpdate': 'Update',
  });
  const r4 = await client.post('/iclock/Manage/DeviceLogList.aspx', form3.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies, Referer: `${baseUrl}/iclock/Manage/DeviceLogList.aspx` }
  });
  cookies = [cookies, ...(r4.headers['set-cookie'] || [])].join('; ');
  const html4 = String(r4.data);
  const june2 = (html4.match(/6\/2\/2026|02\/06\/2026|2026-06-02/g) || []).length;
  const june1 = (html4.match(/6\/1\/2026|01\/06\/2026|2026-06-01/g) || []).length;
  const todayStr = `${parseInt(todayM)}/${parseInt(todayD)}/${todayY}`;
  const todayMentions = (html4.match(new RegExp(todayStr.replace(/\//g,'\\/'),'g')) || []).length;
  console.log(`\nDeviceLogList.aspx today (${todayIST}):`);
  console.log(` - June 2 date mentions: ${june2}`);
  console.log(` - June 1 date mentions: ${june1}`);
  console.log(` - Today format (${todayStr}) mentions: ${todayMentions}`);
  console.log(` - Response length: ${html4.length}`);

  // Show first 3000 chars of response after body tag
  const bodyStart = html4.indexOf('<body');
  const snippet = bodyStart >= 0 ? html4.slice(bodyStart, bodyStart + 3000) : html4.slice(0, 3000);
  console.log('\n--- DeviceLogList response snippet ---');
  console.log(snippet.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2000));

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
