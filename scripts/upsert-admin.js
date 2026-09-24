/**
 * upsert-admin.js
 *
 * Creates or updates an AdminAccount with the given credentials.
 * Safe to run multiple times — idempotent.
 *
 * Usage:
 *   node scripts/upsert-admin.js
 *
 * What it does:
 *   1. Hashes the target password with bcrypt (12 rounds — same as the service)
 *   2. If an AdminAccount with the target email exists:
 *        - Updates passwordHash, role → SUPER_ADMIN, isActive → true, clears deletedAt
 *   3. If no account exists:
 *        - Creates a new SUPER_ADMIN account
 *   4. Prints a clear confirmation of what happened
 *   5. Does NOT touch any other AdminAccount rows
 */

'use strict';

const bcrypt       = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma       = new PrismaClient();

// ── Target credentials ────────────────────────────────────────────────────────
const TARGET_EMAIL    = 'testadmin@gmail.com';
const TARGET_PASSWORD = 'testpassword';
const TARGET_NAME     = 'Youssif (Super Admin)';
const TARGET_ROLE     = 'SUPER_ADMIN';
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  Admin Account Upsert Script');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Email : ${TARGET_EMAIL}`);
  console.log(`  Role  : ${TARGET_ROLE}`);
  console.log('');

  // 1. Hash the password exactly as the service does
  console.log('Hashing password (bcrypt, 12 rounds)…');
  const passwordHash = await bcrypt.hash(TARGET_PASSWORD, 12);
  console.log('  Done.');

  // 2. Verify the hash is correct before saving (sanity check)
  const verified = await bcrypt.compare(TARGET_PASSWORD, passwordHash);
  if (!verified) {
    throw new Error('bcrypt verification failed — hash does not match the original password');
  }
  console.log('  Hash verified ✓');

  // 3. Check if account already exists (include soft-deleted)
  const existing = await prisma.adminAccount.findFirst({
    where: { email: TARGET_EMAIL.toLowerCase() },
  });

  if (existing) {
    // UPDATE — restore if soft-deleted, reset password, ensure SUPER_ADMIN
    await prisma.adminAccount.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name:      TARGET_NAME,
        role:      TARGET_ROLE,
        isActive:  true,
        deletedAt: null,
      },
    });
    console.log('');
    console.log('  ✅ UPDATED existing admin account');
    console.log(`     ID    : ${existing.id}`);
    console.log(`     Email : ${TARGET_EMAIL}`);
    console.log(`     Role  : ${TARGET_ROLE}`);
  } else {
    // CREATE — new account
    const created = await prisma.adminAccount.create({
      data: {
        email:        TARGET_EMAIL.toLowerCase(),
        passwordHash,
        name:         TARGET_NAME,
        role:         TARGET_ROLE,
        isActive:     true,
      },
    });
    console.log('');
    console.log('  ✅ CREATED new admin account');
    console.log(`     ID    : ${created.id}`);
    console.log(`     Email : ${TARGET_EMAIL}`);
    console.log(`     Role  : ${TARGET_ROLE}`);
  }

  // 4. Revoke any stale sessions for this account (force fresh login)
  const account = await prisma.adminAccount.findFirst({
    where: { email: TARGET_EMAIL.toLowerCase() },
  });
  if (account) {
    const revoked = await prisma.adminRefreshToken.deleteMany({
      where: { adminId: account.id },
    });
    if (revoked.count > 0) {
      console.log(`     Revoked ${revoked.count} stale session(s) ✓`);
    }
  }

  // 5. Final login verification — simulate exactly what the login endpoint does
  console.log('');
  console.log('Verifying login works…');
  const loginAccount = await prisma.adminAccount.findFirst({
    where: { email: TARGET_EMAIL.toLowerCase(), deletedAt: null },
  });
  if (!loginAccount || !loginAccount.isActive) {
    throw new Error('Account not found or inactive after upsert');
  }
  const loginOk = await bcrypt.compare(TARGET_PASSWORD, loginAccount.passwordHash);
  if (!loginOk) {
    throw new Error('Login verification FAILED — stored hash does not match password');
  }

  console.log('  Login verification PASSED ✓');
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  READY — use these credentials to log in:');
  console.log(`  Email    : ${TARGET_EMAIL}`);
  console.log(`  Password : ${TARGET_PASSWORD}`);
  console.log('══════════════════════════════════════════════════');
  console.log('');
}

main()
  .catch((err) => {
    console.error('\n❌ Script failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
