/**
 * Reset / set a user's password and mark them as verified.
 * Usage:
 *   npx ts-node --transpile-only scripts/reset-password.ts <email> <newPassword>
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: reset-password.ts <email> <newPassword>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User ${email} not found.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      isEmailVerified: true,
      refreshToken: null,
      passwordResetToken: null,
      passwordResetExpiry: null,
    },
  });

  console.log(`✓ Password reset for ${email}. User is verified and can log in.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
