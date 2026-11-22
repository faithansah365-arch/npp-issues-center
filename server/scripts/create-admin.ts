import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { UserRecord } from '../../shared/types.ts';
import { store } from '../db/store.ts';
import { logAuditEvent } from '../security/audit.ts';
import {
  buildOtpAuthUri,
  encryptText,
  generateBackupCodes,
  generateTotpSecret,
  hashPassword,
  validatePasswordStrength,
  verifyTotpCode,
} from '../security/crypto.ts';

async function main() {
  await store.init();
  const users = await store.listUsers();
  if (users.some((u) => u.role === 'SUPER_ADMIN' && u.status === 'ACTIVE')) {
    console.error('A Super Admin account already exists. Aborting bootstrap.');
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log('\n=== NPP Issue Portal — First Super Admin CLI Bootstrap ===\n');
    const fullName = (await rl.question('Full Name: ')).trim();
    const email = (await rl.question('Admin Email: ')).trim().toLowerCase();
    const password = await rl.question('Strong Password (min 12 chars, upper/lower/digit/symbol): ');

    const pwdErr = validatePasswordStrength(password);
    if (pwdErr) {
      console.error(`Error: ${pwdErr}`);
      process.exit(1);
    }

    const totpSecret = generateTotpSecret();
    const uri = buildOtpAuthUri(email, totpSecret, 'NPP Portal Admin');
    console.log('\nAdd this TOTP secret to your Authenticator app (Google Authenticator / Authy / 1Password):');
    console.log(`Manual Secret: ${totpSecret}`);
    console.log(`OTPAuth URI:   ${uri}\n`);

    const code = (await rl.question('Enter 6-digit code from Authenticator app to verify: ')).trim();
    const check = verifyTotpCode(totpSecret, code, null);
    if (!check.valid) {
      console.error('Invalid authenticator code. Setup cancelled.');
      process.exit(1);
    }

    const backup = generateBackupCodes(8);
    const now = new Date().toISOString();
    const adminId = crypto.randomUUID();
    const adminUser: UserRecord = {
      id: adminId,
      fullName,
      email,
      titleOrOffice: 'Platform Super Administrator',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      regionId: null,
      constituencyId: null,
      pollingStationId: null,
      passwordHash: await hashPassword(password),
      mfaEnabled: true,
      mfaSecretEncrypted: encryptText(totpSecret),
      mfaBackupCodeHashes: backup.hashes,
      lastTotpStepUsed: check.matchedStep,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      invitedByUserId: null,
      approvedByUserId: adminId,
      approvedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await store.saveUser(adminUser);
    await logAuditEvent({
      actorUserId: adminId,
      actorName: fullName,
      actorRole: 'SUPER_ADMIN',
      action: 'FIRST_SUPER_ADMIN_CLI_CREATED',
      targetType: 'USER',
      targetId: adminId,
      severity: 'CRITICAL',
      details: `First Super Admin (${email}) created via server CLI bootstrap.`,
    });

    console.log('\nSuper Admin account created successfully.');
    console.log('Save these one-time MFA recovery backup codes in a secure vault:');
    for (const c of backup.plain) console.log(`  - ${c}`);
    console.log('');
  } finally {
    rl.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
