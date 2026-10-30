/**
 * Debug: verify what fetchFromETimeTrackLite returns for a single-day range.
 * Reproduces the "today selected but old data shown" bug.
 * Run: npx ts-node scripts/debug-live-daterange.ts 2026-06-04
 */
import { fetchFromETimeTrackLite } from '../src/services/etlService';

const BASE = 'http://98.70.41.54:85';
const USER = 'Essl';
const PASS = 'qizqer-1stDec2025';

(async () => {
  const day = process.argv[2] || new Date().toISOString().slice(0, 10);
  console.log(`\n=== Live fetch for ${day} → ${day} ===`);
  const res = await fetchFromETimeTrackLite(BASE, USER, PASS, day, day);
  console.log('success :', res.success);
  console.log('message :', res.message);
  console.log('records :', res.records.length);

  if (res.records.length) {
    const sorted = [...res.records].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const min = sorted[0].timestamp;
    const max = sorted[sorted.length - 1].timestamp;
    console.log('minDate :', min.toISOString());
    console.log('maxDate :', max.toISOString());
    const days = new Set(res.records.map(r => r.timestamp.toISOString().slice(0, 10)));
    console.log('distinct dates in result:', [...days].sort().join(', '));
    const outOfRange = res.records.filter(r => r.timestamp.toISOString().slice(0, 10) !== day).length;
    console.log(`records OUTSIDE requested day (${day}):`, outOfRange);
  }
  process.exit(0);
})().catch((e) => { console.error('ERROR:', e); process.exit(1); });
