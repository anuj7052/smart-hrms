/**
 * Seed script — creates / updates 4 demo accounts in PostgreSQL.
 * Run: npx ts-node --transpile-only scripts/seed-demo.ts
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12');

const DEMO_USERS = [
  {
    name: 'Rahul Employee',
    email: 'rahul@foetron.com',
    password: 'Employee@123',
    role: 'Employee' as const,
    department: 'Engineering',
    designation: 'Software Engineer',
    employeeId: 'EMP001',
  },
  {
    name: 'Sam Manager',
    email: 'manager@foetron.com',
    password: 'Manager@123',
    role: 'Manager' as const,
    department: 'Engineering',
    designation: 'Engineering Manager',
    employeeId: 'MGR001',
  },
  {
    name: 'Priya HR',
    email: 'hr@foetron.com',
    password: 'Hr@123456',
    role: 'HR' as const,
    department: 'Human Resources',
    designation: 'HR Manager',
    employeeId: 'HR001',
  },
  {
    name: 'Anuj Admin',
    email: 'anuj@foetron.com',
    password: 'Admin@1234',
    role: 'Admin' as const,
    department: 'Administration',
    designation: 'System Administrator',
    employeeId: 'ADM001',
  },
];

async function main() {
  console.log('🌱  Seeding demo accounts…\n');

  for (const u of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(u.password, ROUNDS);

    // Upsert User
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        department: u.department,
        passwordHash,
        isEmailVerified: true,
        emailVerificationToken: null,
      },
      create: {
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        department: u.department,
        isEmailVerified: true,
      },
    });

    // Upsert Employee profile
    const existing = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.employee.create({
        data: {
          userId: user.id,
          employeeId: u.employeeId,
          department: u.department,
          designation: u.designation,
          joinDate: new Date('2024-01-01'),
          isActive: true,
        },
      });
      console.log(`  ✅  Created  [${u.role.padEnd(8)}]  ${u.email}  (${u.password})`);
    } else {
      await prisma.employee.update({
        where: { userId: user.id },
        data: {
          department: u.department,
          designation: u.designation,
          isActive: true,
        },
      });
      console.log(`  🔄  Updated  [${u.role.padEnd(8)}]  ${u.email}  (${u.password})`);
    }
  }

  console.log('\n✨  Done! You can now log in with any of the above credentials.\n');
  console.table(
    DEMO_USERS.map((u) => ({ Role: u.role, Email: u.email, Password: u.password }))
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
