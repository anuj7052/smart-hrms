/**
 * One-off importer: copies devices + employees from src/config/local-*.json
 * into PostgreSQL so the cron worker has something to sync against.
 *
 * Run: npx ts-node-dev --transpile-only --no-notify scripts/import-local-fixtures.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { encryptForStorage } from '../src/services/etlService';

const prisma = new PrismaClient();
const CONFIG_DIR = path.join(__dirname, '..', 'src', 'config');

type LocalDevice = {
  id: string;
  name: string;
  ip: string;
  port: number;
  serialNumber: string;
  etlUsername?: string;
  etlPassword?: string;
};

type LocalEmployee = {
  _id: string;
  userId: { _id: string; name: string; email: string; role: string };
  employeeId: string;
  department: string;
  designation?: string;
  shift?: string;
  joinDate: string;
  phone?: string;
  isActive?: boolean;
};

async function importDevices() {
  const file = path.join(CONFIG_DIR, 'local-devices.json');
  const devices: LocalDevice[] = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n📡  Importing ${devices.length} device(s)…`);

  for (const d of devices) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
    const encryptedEtl = d.etlPassword ? encryptForStorage(d.etlPassword) : null;

    const existing = await prisma.device.findUnique({ where: { serialNumber: d.serialNumber } });
    if (existing) {
      await prisma.device.update({
        where: { id: existing.id },
        data: {
          name: d.name,
          ip: d.ip,
          port: d.port,
          etlUsername: d.etlUsername ?? null,
          etlPassword: encryptedEtl,
          autoSync: true,
          syncInterval: 1, // poll every 1 minute
          isActive: true,
        },
      });
      console.log(`  ↻  Updated  ${d.name}  (auto-sync every 1 min)`);
    } else {
      await prisma.device.create({
        data: {
          name: d.name,
          ip: d.ip,
          port: d.port,
          serialNumber: d.serialNumber,
          username: 'admin',
          passwordHash,
          etlUsername: d.etlUsername ?? null,
          etlPassword: encryptedEtl,
          autoSync: true,
          syncInterval: 1,
          isActive: true,
        },
      });
      console.log(`  ✅ Created  ${d.name}  (auto-sync every 1 min)`);
    }
  }
}

async function importEmployees() {
  const file = path.join(CONFIG_DIR, 'local-employees.json');
  const employees: LocalEmployee[] = JSON.parse(readFileSync(file, 'utf8'));
  console.log(`\n👥  Importing ${employees.length} employee(s)…`);

  let created = 0;
  let updated = 0;

  for (const e of employees) {
    const email = e.userId.email;
    const name = e.userId.name;
    const role = ['Admin', 'HR', 'Manager', 'Employee'].includes(e.userId.role)
      ? (e.userId.role as 'Admin' | 'HR' | 'Manager' | 'Employee')
      : 'Employee';

    // 1) Upsert User
    const tempPwHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
    const user = await prisma.user.upsert({
      where: { email },
      update: { name, role, department: e.department, isEmailVerified: true },
      create: {
        name,
        email,
        passwordHash: tempPwHash,
        role,
        department: e.department,
        isEmailVerified: true,
      },
    });

    // 2) Upsert Employee — devicePin = employeeId so eSSL punches map correctly
    const existing = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (existing) {
      await prisma.employee.update({
        where: { id: existing.id },
        data: {
          employeeId: e.employeeId,
          department: e.department,
          designation: e.designation || 'N/A',
          shift: e.shift || 'General',
          phone: e.phone ?? null,
          devicePin: e.employeeId,
          isActive: e.isActive ?? true,
        },
      });
      updated++;
    } else {
      try {
        await prisma.employee.create({
          data: {
            userId: user.id,
            employeeId: e.employeeId,
            department: e.department,
            designation: e.designation || 'N/A',
            shift: e.shift || 'General',
            joinDate: new Date(e.joinDate),
            phone: e.phone ?? null,
            devicePin: e.employeeId,
            isActive: e.isActive ?? true,
          },
        });
        created++;
      } catch (err) {
        console.warn(`  ⚠️  Skipped ${e.employeeId} (${email}): ${(err as Error).message}`);
      }
    }
  }

  console.log(`  ✅ ${created} created, ${updated} updated`);
}

async function main() {
  console.log('🌱  Importing local fixtures into PostgreSQL…');
  await importDevices();
  await importEmployees();
  console.log('\n✨  Done. The 1-minute cron will start pulling eSSL data on the next tick.\n');
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
