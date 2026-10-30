import { fetchFromIClockServerDirect } from '../src/services/etlService';

const BASE = 'http://98.70.41.54:85';
const USER = 'Essl';
const PASS = 'qizqer-1stDec2025';

(async () => {
  console.log('=== iClock direct (device buffer) ===');
  const res = await fetchFromIClockServerDirect(BASE, 'CGKK220762223', undefined, USER, PASS);
  console.log('success:', res.success, '| message:', res.message);
  console.log('records:', res.records.length);
  if (res.records.length) {
    const days = new Map<string, number>();
    for (const r of res.records) {
      const d = r.timestamp.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
      days.set(d, (days.get(d) || 0) + 1);
    }
    console.log('punches per day (IST):');
    for (const [d, c] of [...days.entries()].sort()) console.log(`  ${d}: ${c}`);
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(1); });
