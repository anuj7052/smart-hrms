import { PrismaClient } from '@prisma/client';
import { fetchFromIClockServerDirect, decryptFromStorage } from '../src/services/etlService';
import axios from 'axios';

const prisma = new PrismaClient();

async function main() {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.log('Device not found'); return; }

  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch (e) { console.log('decrypt failed'); }
  }
  if (!password) password = process.env.ESSL_ETL_PASSWORD;
  const username = device.etlUsername || process.env.ESSL_ETL_USERNAME;
  const baseUrl = `http://${device.ip}:${device.port}`;

  const todayIST = new Date(Date.now() + 330 * 60000).toISOString().split('T')[0]; // "2026-06-02"
  console.log('Today IST:', todayIST, '| Testing portal at', baseUrl);

  // Test DeviceLogList.aspx directly for today
  // Skip Approach 0 (Excel) and go straight to Approach 2
  try {
    const client = axios.create({ baseURL: baseUrl, timeout: 30000, maxRedirects: 5, withCredentials: true });
    const jar: Record<string, string> = {};
    
    // Login
    const r1 = await client.get('/iclock/');
    const html1 = String(r1.data);
    const hidden: Record<string,string> = {};
    for (const m of html1.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) hidden[m[1]] = m[2];
    const cookies1 = (r1.headers['set-cookie'] || []).join('; ');
    
    // Get encryption key
    const txtKeyMatch = html1.match(/name="StaffloginDialog\$txtKey"[^>]*value="([^"]+)"/i);
    const txtKey = txtKeyMatch ? txtKeyMatch[1] : '';
    
    // Simple XOR "encryption" (ESSL portal uses a simple key)
    function encryptPassword(pwd: string, key: string): string {
      if (!key) return pwd;
      let result = '';
      for (let i = 0; i < pwd.length; i++) result += String.fromCharCode(pwd.charCodeAt(i) ^ key.charCodeAt(i % key.length));
      return Buffer.from(result).toString('base64');
    }
    
    const formData = new URLSearchParams({
      ...hidden,
      '__EVENTTARGET': '',
      '__EVENTARGUMENT': '',
      'StaffloginDialog$txt_LoginName': username!,
      'StaffloginDialog$Txt_Password': encryptPassword(password!, txtKey),
      'StaffloginDialog$txtKey': txtKey,
      'StaffloginDialog$Btn_Ok': 'Login',
    });
    
    const r2 = await client.post('/iclock/Default.aspx', formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${baseUrl}/iclock/`, Cookie: cookies1 },
    });
    const cookies2 = [cookies1, ...(r2.headers['set-cookie'] || [])].join('; ');
    console.log('Login status:', r2.status, '| URL:', (r2.request as any)?.res?.responseUrl || 'unknown');
    
    // Try DeviceLogList.aspx
    const r3 = await client.get('/iclock/Manage/DeviceLogList.aspx', {
      headers: { Cookie: cookies2, Referer: `${baseUrl}/iclock/Main.aspx` }
    });
    const html3 = String(r3.data);
    const hidden3: Record<string,string> = {};
    for (const m of html3.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) hidden3[m[1]] = m[2];
    const cookies3 = [cookies2, ...(r3.headers['set-cookie'] || [])].join('; ');
    
    const [todayY, todayM, todayD] = todayIST.split('-');
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies3, Referer: `${baseUrl}/iclock/Manage/DeviceLogList.aspx` }
    });
    const html4 = String(r4.data);
    
    // Count table rows
    const rows = (html4.match(/<tr[^>]*class="[^"]*gridrow[^"]*"[^>]*>/gi) || []).length;
    const rows2 = (html4.match(/<tr[^>]*>\s*<td[^>]*>\d/gi) || []).length;
    console.log(`\nDeviceLogList for June 2 IST: gridrows=${rows}, data-rows=${rows2}`);
    
    // Look for any June 2 dates in the response
    const june2Mentions = (html4.match(/6\/2\/2026|2026-06-02|02\/06\/2026/g) || []).length;
    const june1Mentions = (html4.match(/6\/1\/2026|2026-06-01|01\/06\/2026/g) || []).length;
    console.log(`June 2 date mentions: ${june2Mentions}, June 1 date mentions: ${june1Mentions}`);
    
    if (html4.length < 5000) {
      console.log('Response HTML (truncated):', html4.slice(0, 2000));
    }
    
  } catch (e: any) {
    console.error('DeviceLogList test failed:', e.message);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });

const prisma = new PrismaClient();

async function main() {
  const device = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!device) { console.log('Device not found'); return; }

  let password: string | undefined;
  if (device.etlPassword) {
    try { password = decryptFromStorage(device.etlPassword); } catch (e) { console.log('decrypt failed'); }
  }
  if (!password) password = process.env.ESSL_ETL_PASSWORD;
  const username = device.etlUsername || process.env.ESSL_ETL_USERNAME;
  const baseUrl = `http://${device.ip}:${device.port}`;

  console.log('lastEtlSync:', device.lastEtlSync?.toISOString());
  const overlapMs = 2 * 60 * 60 * 1000;
  const fromDate = device.lastEtlSync
    ? new Date(device.lastEtlSync.getTime() - overlapMs)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  console.log('Effective fromDate (UTC):', fromDate.toISOString(), '= IST:', new Date(fromDate.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30'));

  // Test portal directly with different date ranges
  const { fetchFromETimeTrackLite } = await import('../src/services/etlService');
  const todayIST = new Date(Date.now() + 330 * 60000).toISOString().split('T')[0];
  const tomorrowIST = new Date(Date.now() + 330 * 60000 + 86400000).toISOString().split('T')[0];
  const yesterdayIST = new Date(Date.now() + 330 * 60000 - 86400000).toISOString().split('T')[0];

  console.log(`\nTest A: fromDate=${todayIST}, toDate=${todayIST}`);
  const resultA = await fetchFromETimeTrackLite(baseUrl, username!, password!, todayIST, todayIST);
  console.log('success:', resultA.success, '| records:', resultA.records.length, '| msg:', resultA.message);
  if (resultA.records.length > 0) {
    const sample = resultA.records[0];
    console.log(' sample IST:', new Date(sample.timestamp.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30'));
  }

  console.log(`\nTest B: fromDate=${yesterdayIST}, toDate=${tomorrowIST}`);
  const resultB = await fetchFromETimeTrackLite(baseUrl, username!, password!, yesterdayIST, tomorrowIST);
  console.log('success:', resultB.success, '| records:', resultB.records.length, '| msg:', resultB.message);
  if (resultB.records.length > 0) {
    const firstIST = new Date(resultB.records[0].timestamp.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30');
    const lastIST = new Date(resultB.records[resultB.records.length-1].timestamp.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30');
    console.log(' first IST:', firstIST, '| last IST:', lastIST);
    // Group by IST date
    const grouped: Record<string, number> = {};
    resultB.records.forEach(r => { const d = new Date(r.timestamp.getTime() + 330*60000).toISOString().split('T')[0]; grouped[d] = (grouped[d]||0)+1; });
    console.log(' by date:', JSON.stringify(grouped));
  }

  const result = await fetchFromIClockServerDirect(baseUrl, device.serialNumber, device.lastEtlSync ?? undefined, username, password);
  console.log('\n--- fetchFromIClockServerDirect ---');
  console.log('success:', result.success, '| records:', result.records.length, '| msg:', result.message);

  if (result.records.length > 0) {
    console.log('\nFirst 5 records:');
    result.records.slice(0, 5).forEach(r => {
      const ist = new Date(r.timestamp.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30');
      console.log(` emp:${r.employeeDeviceId} | UTC:${r.timestamp.toISOString()} | IST:${ist} | type:${r.punchType}`);
    });
    const last = result.records[result.records.length - 1];
    console.log('Last record IST:', new Date(last.timestamp.getTime() + 330 * 60000).toISOString().replace('Z', '+05:30'));

    // Check if first record is already in DB
    const testRec = result.records[0];
    const existing = await prisma.rawPunchLog.count({
      where: { deviceId: device.id, employeeDeviceId: testRec.employeeDeviceId, timestamp: testRec.timestamp }
    });
    console.log('\nFirst record already in DB:', existing > 0);

    // Try insert
    const ins = await prisma.rawPunchLog.createMany({
      data: result.records.map(r => ({
        deviceId: device.id,
        employeeDeviceId: r.employeeDeviceId,
        timestamp: r.timestamp,
        punchType: r.punchType,
        raw: r.raw,
      })),
      skipDuplicates: true,
    });
    console.log('\nInserted', ins.count, 'of', result.records.length, 'records');

    // Verify
    const after = await prisma.rawPunchLog.findFirst({ orderBy: { timestamp: 'desc' } });
    console.log('Latest punch in DB after insert:', after?.timestamp.toISOString());
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
