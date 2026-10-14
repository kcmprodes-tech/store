import { scheduleJobs, stopJobs } from './admin/jobs.js';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`Store Kompas.com jalan di http://localhost:${env.port}`);
});
// Job pesanan (kedaluwarsa, otomatis selesai, pengingat) tiap 10 menit.
scheduleJobs();

async function shutdown() {
  stopJobs();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
