/**
 * One-time sync: Pull department/jobTitle/manager from Microsoft Entra into
 * Sphere's Employee table (matched by email). Read-only — does not write to Entra.
 *
 * Uses pre-fetched JSON at /tmp/graph_users_full.json. Refresh with:
 *   az rest --method GET --url "https://graph.microsoft.com/v1.0/users?\$select=displayName,mail,userPrincipalName,employeeId,department,jobTitle&\$top=999" -o json > /tmp/graph_users_full.json
 *
 * Outputs CSV at /tmp/entra-employee-id-mapping.csv listing Sphere FCS codes
 * that should be set on Entra's `employeeId` field (apply via Entra admin UI).
 */
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const prisma = new PrismaClient();

type EntraUser = {
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
  employeeId: string | null;
  department: string | null;
  jobTitle: string | null;
};

function azGet<T>(url: string): T | null {
  try {
    const out = execSync(`az rest --method GET --url '${url}' -o json 2>/dev/null`, { encoding: 'utf8' });
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

async function main() {
  const cachePath = '/tmp/graph_users_full.json';
  if (!existsSync(cachePath)) {
    console.error(`Missing cache: ${cachePath}`);
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(cachePath, 'utf8')) as { value: EntraUser[] };
  const allUsers = data.value;
  console.log(`-> Loaded ${allUsers.length} users from cache\n`);

  const entraByEmail = new Map<string, EntraUser>();
  for (const u of allUsers) {
    if (u.mail) entraByEmail.set(u.mail.toLowerCase(), u);
    if (u.userPrincipalName) entraByEmail.set(u.userPrincipalName.toLowerCase(), u);
  }

  const emps = await prisma.employee.findMany({
    where: { isActive: true },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { employeeId: 'asc' },
  });

  const csvRows: string[] = ['employeeId,displayName,userPrincipalName'];
  let synced = 0;
  let skipped = 0;
  let noMatch = 0;

  for (const emp of emps) {
    const email = (emp.user.email || '').toLowerCase();
    if (!email.endsWith('@foetron.com')) {
      skipped++;
      continue;
    }

    let entra = entraByEmail.get(email);
    if (!entra) {
      const local = email.split('@')[0];
      const alt1 = `t-${local}@foetron.com`;
      const alt2 = local.startsWith('t-') ? `${local.slice(2)}@foetron.com` : null;
      entra = entraByEmail.get(alt1) || (alt2 ? entraByEmail.get(alt2) : undefined);
    }

    if (!entra) {
      console.log(`  [no entra match] ${emp.employeeId.padEnd(8)} ${emp.user.name}  (${email})`);
      noMatch++;
      continue;
    }

    const mgr = azGet<{ displayName?: string }>(
      `https://graph.microsoft.com/v1.0/users/${entra.userPrincipalName}/manager?$select=displayName`,
    );
    const managerName = mgr?.displayName ?? null;

    const updateData: Record<string, string> = {};
    if (entra.department) updateData.department = entra.department;
    if (entra.jobTitle) updateData.designation = entra.jobTitle;
    if (managerName) updateData.managerName = managerName;

    if (Object.keys(updateData).length > 0) {
      await prisma.employee.update({ where: { id: emp.id }, data: updateData });
      synced++;
    }

    if (!entra.employeeId) {
      csvRows.push(`${emp.employeeId},"${entra.displayName}",${entra.userPrincipalName}`);
    }

    const parts: string[] = [];
    if (entra.department) parts.push(`dept=${entra.department}`);
    if (entra.jobTitle) parts.push(`title=${entra.jobTitle}`);
    if (managerName) parts.push(`mgr=${managerName}`);
    console.log(`  ${emp.employeeId.padEnd(8)} ${(emp.user.name ?? '').padEnd(28)} <- ${parts.join(', ') || '(no entra data)'}`);
  }

  writeFileSync('/tmp/entra-employee-id-mapping.csv', csvRows.join('\n'));
  console.log(`\nSynced to Sphere DB: ${synced}`);
  console.log(`No Entra match: ${noMatch}`);
  console.log(`Skipped (non-foetron email): ${skipped}`);
  console.log(`\nCSV mapping saved to: /tmp/entra-employee-id-mapping.csv`);
  console.log(`(${csvRows.length - 1} employees need FCS-ID set in Entra manually)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
