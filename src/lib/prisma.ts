import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/**
 * TLS untuk MySQL di cloud, dibaca dari parameter DATABASE_URL:
 * - `sslaccept=accept_invalid_certs` (format Prisma) atau `ssl-mode=REQUIRED`: koneksi terenkripsi tanpa cek sertifikat
 * - `sslaccept=strict` atau `ssl-mode=VERIFY_CA|VERIFY_IDENTITY`: sertifikat dicek (CA dari env DATABASE_CA_CERT bila ada)
 * Tanpa parameter itu (MySQL lokal) → tanpa TLS.
 */
function sslFromUrl(u: URL) {
  const accept = u.searchParams.get('sslaccept');
  const mode = (u.searchParams.get('ssl-mode') ?? u.searchParams.get('sslmode') ?? '').toUpperCase();
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (accept === 'strict' || mode.startsWith('VERIFY')) return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  if (accept === 'accept_invalid_certs' || mode === 'REQUIRED') return { rejectUnauthorized: false };
  return undefined;
}

/** Ubah DATABASE_URL (mysql://user:pass@host:port/db) jadi konfigurasi pool driver mariadb. */
export function poolConfigFromUrl(url: string) {
  const u = new URL(url);
  const ssl = sslFromUrl(u);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    // di Vercel tiap instance fungsi punya pool sendiri → kecilkan lewat DATABASE_POOL_SIZE
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE) || 10,
    ...(ssl
      ? { ssl }
      : // MySQL 8+ memakai caching_sha2_password; tanpa TLS lokal, kunci publik perlu diambil dari server.
        { allowPublicKeyRetrieval: true }),
  };
}

export function createPrisma(url = env.databaseUrl) {
  return new PrismaClient({ adapter: new PrismaMariaDb(poolConfigFromUrl(url)) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
