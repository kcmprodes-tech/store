import { randomInt } from 'node:crypto';

/** Huruf besar + angka tanpa O, 0, I, 1 supaya mudah dieja ke CS. */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const INVOICE_PATTERN = /^SKC-\d{6}-[A-HJ-NP-Z2-9]{6}$/;

/**
 * Nomor invoice `SKC-YYMMDD-XXXXXX`: tanggal pesanan (WIB) + 6 karakter acak.
 * Unik, terurut per tanggal, dan tidak membuka jumlah pesanan harian.
 */
export function generateInvoiceNo(date = new Date(), pick: (max: number) => number = randomInt): string {
  const wib = new Date(date.getTime() + 7 * 3600_000);
  const ymd =
    String(wib.getUTCFullYear()).slice(2) +
    String(wib.getUTCMonth() + 1).padStart(2, '0') +
    String(wib.getUTCDate()).padStart(2, '0');
  let code = '';
  for (let i = 0; i < 6; i++) code += CHARS[pick(CHARS.length)];
  return `SKC-${ymd}-${code}`;
}
