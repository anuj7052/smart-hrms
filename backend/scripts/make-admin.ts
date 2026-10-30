/**
 * Make t-anuj.singh@foetron.com and anuj.singh@foetron.com Admin users.
 * - If user exists → updates role to Admin
 * - If user doesn't exist → creates with default password Foetron@2026
 *
 * Run: node_modules/.bin/ts-node-dev --transpile-only --no-notify scripts/make-admin.ts
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const TARGETS = [
  { email: 'anuj.singh@foetron.com',   name: 'Anuj Singh' },
  { email: 't-anuj.singh@foetron.com', name: 'Anuj Singh (Trainee)' },
];

const DEFAULT_PASSWORD = 'Foetron@2026';

(async () => {
  for (const target of TARGETS) {
    const existing = await prisma.user.findUnique({ where: { email: target.email } });

    if (existing) {
      const updated = await prisma.user.update({
        where: { email: target.email },
        data: { role: 'Admin' },
        select: { id: true, email: true, name: true, role: true },
      });
      console.log(`✅ Updated  → ${updated.email} | role: ${updated.role} | name: ${updated.name}`);
    } else {
      const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
      const created = await prisma.user.create({
        data: {
          name: target.name,
          email: target.email,
          passwordHash,
          role: 'Admin',
          isEmailVerified: true,
        },
        select: { id: true, email: true, name: true, role: true },
      });
      console.log(`✅ Created  → ${created.email} | role: ${created.role} | password: ${DEFAULT_PASSWORD}`);
    }
  }

  await prisma.$disconnect();
  console.log('\nDone.');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
