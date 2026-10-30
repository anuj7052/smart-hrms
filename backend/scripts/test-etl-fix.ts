/**
 * Test script to verify the fixed ETL date range behavior.
 * Run: node_modules/.bin/ts-node-dev --transpile-only --no-notify scripts/test-etl-fix.ts
 */
import { PrismaClient } from '@prisma/client';
import { fetchFromETimeTrackLite, decryptFromStorage } from '../src/services/etlService';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

(async () => {
  const IST_MS = 330 * 60 * 1000;
  const now = new Date();
  console.log(`\nCurrent UTC: ${now.toISOString()}`);
  console.log(`Current IST: ${new Date(now.getTime() + IST_MS).toISOString().replace('Z', '+05:30')}`);

  const d = await prisma.device.findFirst({ where: { serialNumber: 'CGKK220762223' } });
  if (!d) { console.error('Device not found!'); process.exit(1); }

  const pw = d.etlPassword ? decryptFromStorage(d.etlPassword) : process.env.ESSL_ETL_PASSWORD;
  const user = d.etlUsername || process.env.ESSL_ETL_USERNAME;
  const base = `http://${d.ip}:${d.port}`;
  console.log(`Device: ${d.name} @ ${base}`);
  console.log(`ETL user: ${user} | lastEtlSync: ${d.lastEtlSync?.toISOString() ?? 'null'}`);

  // Step 1: What the FIXED cronService uses (latestPunch from DB)
  const latestPunch = await prisma.rawPunchLog.findFirst({
    where: { deviceId: d.id },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });
  console.log(`\nLatest DB punch: ${latestPunch?.timestamp?.toISOString() ?? 'NONE'}`);
  if (latestPunch?.timestamp) {
    console.log(`  = ${new Date(latestPunch.timestamp.getTime() + IST_MS).toISOString().replace('Z', '+05:30')} IST`);
  }

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const effectiveLastSync = latestPunch?.timestamp
    ? new Date(Math.max(latestPunch.timestamp.getTime(), startOfMonth.getTime()))
    : null;
  const overlapMs = 2 * 60 * 60 * 1000;
  const fromDate = effectiveLastSync ? new Date(effectiveLastSync.getTime() - overlapMs) : startOfMonth;

  // Step 2: What the FIXED etlService strategy 3 computes
  const fromIST = new Date(fromDate.getTime() + IST_MS);
  const toIST = new Date(Date.now() + IST_MS + 24 * 60 * 60 * 1000);
  const fromDateStr = fromIST.toISOString().split('T')[0];
  const toDateStr = toIST.toISOString().split('T')[0];
  console.log(`\nFixed query window: ${fromDateStr} → ${toDateStr} (IST)\n`);

  // Step 3: Actually fetch from portal
  console.log(`Fetching from portal...`);
  const result = await fetchFromETimeTrackLite(base, user!, pw!, fromDateStr, toDateStr);
  console.log(`\nResult: ${result.records.length} records | message: ${result.message}`);

  if (result.records.length > 0) {
    const grouped: Record<string, number> = {};
    result.records.forEach(r => {
      const key = new Date(r.timestamp.getTime() + IST_MS).toISOString().split('T')[0];
      grouped[key] = (grouped[key] || 0) + 1;
    });
    console.log('Records by IST date:', JSON.stringify(grouped, null, 2));

    const june2 = result.records.filter(r => new Date(r.timestamp.getTime() + IST_MS).toISOString().startsWith('2026-06-02')).length;
    const june3 = result.records.filter(r => new Date(r.timestamp.getTime() + IST_MS).toISOString().startsWith('2026-06-03')).length;
    console.log(`\nJune 2 IST: ${june2} records | June 3 IST: ${june3} records`);
    if (june2 === 0 && june3 === 0) {
      console.log('\n⚠️  DEVICE-TO-PORTAL SYNC STILL BROKEN: Portal has no June 2/3 data yet.');
      console.log('   Action required: Check ESSL device connectivity and force sync from portal admin.');
    } else {
      console.log('\n✅ Portal now has June 2/3 data! ETL will sync it on next cron run.');
    }
  } else {
    console.log('\n⚠️  Portal returned 0 records — device-to-portal sync is still broken.');
  }

  await prisma.$disconnect();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
