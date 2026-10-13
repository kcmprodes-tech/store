import { prisma } from './prisma.js';

/** Baca beberapa pengaturan (tabel settings) sekaligus; key yang tidak ada → undefined. */
export async function getSettings<K extends string>(keys: K[]): Promise<Partial<Record<K, unknown>>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Record<K, unknown>>;
}
