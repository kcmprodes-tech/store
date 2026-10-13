import { env } from '../config/env.js';
import { prisma } from './prisma.js';

/** Baca beberapa pengaturan (tabel settings) sekaligus; key yang tidak ada → undefined. */
export async function getSettings<K extends string>(keys: K[]): Promise<Partial<Record<K, unknown>>> {
  const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Record<K, unknown>>;
}

let waCache: { value: string; at: number } | null = null;

/** Nomor WhatsApp store: pengaturan `whatsapp_number` (diisi dari CMS) atau WHATSAPP_NUMBER di .env. Cache 60 detik. */
export async function getWhatsappNumber(): Promise<string> {
  if (waCache && Date.now() - waCache.at < 60_000) return waCache.value;
  const { whatsapp_number: fromSettings } = await getSettings(['whatsapp_number']);
  const value = String(fromSettings ?? '').replace(/\D/g, '') || env.whatsappNumber;
  waCache = { value, at: Date.now() };
  return value;
}

/** Kosongkan cache nomor WhatsApp (dipakai setelah pengaturan diubah, mis. dari CMS atau tes). */
export function resetWhatsappCache() {
  waCache = null;
}
