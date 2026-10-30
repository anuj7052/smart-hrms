import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env') });

import { fetchFromETimeTrackLite } from '../src/services/etlService';
import * as XLSX from 'xlsx';

const BASE = 'http://98.70.41.54:85';
const UN = process.env.ESSL_ETL_USERNAME!;
const PW = process.env.ESSL_ETL_PASSWORD!;
const IST_MS = 330 * 60 * 1000;

(async () => {
  // Fetch a wide range: Jun 28 - Jul 4 to see all available dates
  // We'll bypass clampToRange by using the internal function's approach
  // Instead, use the public API but with a wider from/to that covers both days
  
  // Since fetchFromETimeTrackLite clamps to [fromDate, toDate] IST range,
  // we request Jun 28 to Jul 4 to get everything
  console.log('Fetching ESSL data Jun 28 → Jul 4...');
  
  // The function internally fetches queryFromDate=Jun 27 to queryToDate=Jul 5 for the Excel
  // And clamps to rangeStart=Jun 28 IST to rangeEnd=Jul 4 IST
  // This should capture all Jul 2 and Jul 3 records if they exist
  const result = await fetchFromETimeTrackLite(BASE, UN, PW, '2026-06-28', '2026-07-04', 120000);
  
  console.log('success:', result.success);
  console.log('message:', result.message);
  console.log('Total records returned:', result.records.length);
  
  if (result.records.length > 0) {
    // Group by IST date (UTC timestamp + 5.5h → IST day)
    const byDate: Record<string, number> = {};
    for (const r of result.records) {
      const istTs = new Date(r.timestamp.getTime() + IST_MS);
      const ds = istTs.toISOString().slice(0, 10);
      byDate[ds] = (byDate[ds] || 0) + 1;
    }
    console.log('\nRecords by IST date:');
    for (const [d, c] of Object.entries(byDate).sort()) console.log(`  ${d}: ${c}`);
    
    // Show first and last
    console.log('\nEarliest:', result.records[result.records.length - 1]?.timestamp?.toISOString());
    console.log('Latest:', result.records[0]?.timestamp?.toISOString());
  } else {
    // Log what exactly the Excel returned via the internal function  
    console.log('\nNo records in Jun 28 - Jul 4 IST range.');
    console.log('This means the ESSL server database has NO punch records for these dates.');
    console.log('\nChecking smaller range - just today Jul 3...');
    
    const r2 = await fetchFromETimeTrackLite(BASE, UN, PW, '2026-07-03', '2026-07-03', 120000);
    console.log('Jul 3 only:', r2.records.length, 'records |', r2.message);
    
    const r3 = await fetchFromETimeTrackLite(BASE, UN, PW, '2026-07-02', '2026-07-02', 120000);
    console.log('Jul 2 only:', r3.records.length, 'records |', r3.message);
    
    const r4 = await fetchFromETimeTrackLite(BASE, UN, PW, '2026-07-01', '2026-07-01', 120000);
    console.log('Jul 1 only:', r4.records.length, 'records |', r4.message);
  }
})();
