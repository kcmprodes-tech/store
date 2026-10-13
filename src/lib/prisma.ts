import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/** Ubah DATABASE_URL (mysql://user:pass@host:port/db) jadi konfigurasi pool driver mariadb. */
export function poolConfigFromUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    // MySQL 8+ memakai caching_sha2_password; tanpa TLS lokal, kunci publik perlu diambil dari server.
    allowPublicKeyRetrieval: true,
  };
}

export function createPrisma(url = env.databaseUrl) {
  return new PrismaClient({ adapter: new PrismaMariaDb(poolConfigFromUrl(url)) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrisma();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
