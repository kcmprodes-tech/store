/**
 * Akun CMS: Admin pertama + akun uji per peran (development). Tidak menghapus data apa pun.
 * Dipanggil oleh seed.ts, atau sendiri lewat `npm run db:seed-admin` (aman untuk database yang sudah berisi).
 */
import { appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePassword, hashPassword } from '../src/admin/auth/password.js';
import { createPrisma } from '../src/lib/prisma.js';

type Db = ReturnType<typeof createPrisma>;

/** Nilai rahasia dari .env; kalau belum ada, dibuat acak lalu ditulis ke .env (hanya di mesin ini, tidak di-commit). */
function envSecret(name: string) {
  const existing = process.env[name]?.trim();
  if (existing) return existing;
  const value = generatePassword(16);
  appendFileSync(join(process.cwd(), '.env'), `\n# Dibuat otomatis oleh seed akun CMS — jangan di-commit.\n${name}=${value}\n`);
  process.env[name] = value;
  return value;
}

/** Akun uji per peran untuk mencoba hak akses CMS (development saja). */
const TEST_ACCOUNTS: [string, 'ADMIN' | 'EDITOR' | 'MARKETING' | 'CS' | 'GUDANG' | 'FINANCE', string][] = [
  ['admin', 'ADMIN', 'Admin Uji'],
  ['editor', 'EDITOR', 'Editor Uji'],
  ['marketing', 'MARKETING', 'Marketing Uji'],
  ['cs', 'CS', 'CS Uji'],
  ['gudang', 'GUDANG', 'Gudang Uji'],
  ['finance', 'FINANCE', 'Finance Uji'],
];

export async function seedAdmins(prisma: Db) {
  const email = (process.env.ADMIN_EMAIL?.trim() || 'ardi.suhanda@kompas.com').toLowerCase();
  if (!(await prisma.adminUser.findUnique({ where: { email } }))) {
    await prisma.adminUser.create({
      data: {
        email,
        name: process.env.ADMIN_NAME?.trim() || 'Ardi Suhanda',
        passwordHash: await hashPassword(envSecret('ADMIN_INITIAL_PASSWORD')),
        mustChangePassword: true,
        roles: { create: [{ role: 'ADMIN' }] },
      },
    });
    console.log(`✔ Admin CMS ${email} dibuat. Password awal ada di .env (ADMIN_INITIAL_PASSWORD), wajib diganti saat login pertama.`);
  }

  // akun uji hanya dibuat saat development/tes (atau SEED_TEST_ACCOUNTS=1), tidak pernah di Production Vercel
  const devLike = ['development', 'test'].includes(process.env.NODE_ENV ?? '') || process.env.SEED_TEST_ACCOUNTS === '1';
  if (!devLike || process.env.VERCEL_ENV === 'production') return;
  const testHash = await hashPassword(envSecret('CMS_TEST_PASSWORD'));
  for (const [local, role, name] of TEST_ACCOUNTS) {
    // Akun yang sudah ada tidak diubah (password & peran tetap).
    await prisma.adminUser.upsert({
      where: { email: `${local}@cms.test` },
      create: { email: `${local}@cms.test`, name, passwordHash: testHash, roles: { create: [{ role }] } },
      update: {},
    });
  }
  console.log('✔ Akun uji CMS (dev): admin|editor|marketing|cs|gudang|finance@cms.test, password = CMS_TEST_PASSWORD di .env.');
}

// Dijalankan langsung: npm run db:seed-admin
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const prisma = createPrisma();
  seedAdmins(prisma)
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
