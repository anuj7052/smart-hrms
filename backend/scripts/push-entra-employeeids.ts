/**
 * Writes Sphere FCS employeeIds back to Microsoft Entra `employeeId` field.
 * Reads /tmp/entra-employee-id-mapping.csv. Skips shared mailboxes.
 * Requires az CLI session with User.ReadWrite.All Graph permission.
 */
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const SHARED_MAILBOXES = new Set([
  'leave@foetron.com',
  'fin-corp@foetron.com',
  'finance@foetron.com',
  'arun@foetron.com', // FCSPL017 generic HR alias — verify before pushing
]);

const csv = readFileSync('/tmp/entra-employee-id-mapping.csv', 'utf8').trim().split('\n').slice(1);

let pushed = 0;
let skipped = 0;
let failed = 0;
const failedRows: string[] = [];

for (const line of csv) {
  const match = line.match(/^([^,]+),"([^"]*)",(.+)$/);
  if (!match) continue;
  const [, employeeId, displayName, upn] = match;
  const upnLower = upn.toLowerCase().trim();

  if (SHARED_MAILBOXES.has(upnLower)) {
    console.log(`  [skip shared] ${employeeId.padEnd(8)} ${displayName} (${upn})`);
    skipped++;
    continue;
  }

  const body = JSON.stringify({ employeeId });
  writeFileSync('/tmp/patch_body.json', body);

  try {
    execSync(
      `az rest --method PATCH --url "https://graph.microsoft.com/v1.0/users/${upnLower}" --headers "Content-Type=application/json" --body @/tmp/patch_body.json 2>&1`,
      { encoding: 'utf8', stdio: 'pipe' },
    );
    console.log(`  ✓ ${employeeId.padEnd(8)} -> ${upn}`);
    pushed++;
  } catch (e: unknown) {
    const msg = (e as { stderr?: Buffer; message?: string }).stderr?.toString() ?? (e as Error).message;
    const short = msg.split('\n')[0].slice(0, 140);
    console.log(`  ✗ ${employeeId.padEnd(8)} ${upn}  ${short}`);
    failed++;
    failedRows.push(`${employeeId},${upn},${short}`);
  }
}

console.log(`\nPushed: ${pushed}  Skipped: ${skipped}  Failed: ${failed}`);
if (failedRows.length) {
  writeFileSync('/tmp/entra-writeback-failures.csv', 'employeeId,upn,error\n' + failedRows.join('\n'));
  console.log('Failures saved to /tmp/entra-writeback-failures.csv');
}
