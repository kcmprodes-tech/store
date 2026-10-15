/**
 * Isi data awal hanya kalau database masih kosong (belum ada produk).
 * Dipakai build Vercel produksi: deploy pertama ke database baru langsung berisi katalog,
 * deploy berikutnya tidak menimpa data. (Seed biasa `npm run db:seed` menghapus semua tabel.)
 */
import { execSync } from 'node:child_process';
import { createPrisma } from '../src/lib/prisma.js';

const prisma = createPrisma();
const products = await prisma.product.count();
await prisma.$disconnect();

if (products > 0) {
  console.log(`Database sudah berisi ${products} produk, seed dilewati.`);
} else {
  console.log('Database kosong, menjalankan seed data awal…');
  execSync('npx prisma db seed', { stdio: 'inherit' });
}
