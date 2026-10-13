/** Utilitas harga rupiah. Harga di database selalu Int rupiah. */

/** "162.000" → 162000, "29.000/bulan" → { amount: 29000, suffix: "/bulan" } */
export function parsePrice(text: string): { amount: number; suffix: string | null } {
  const trimmed = String(text ?? '').trim();
  const slash = trimmed.indexOf('/');
  const numberPart = slash >= 0 ? trimmed.slice(0, slash) : trimmed;
  const suffix = slash >= 0 ? trimmed.slice(slash) : null;
  const digits = numberPart.replace(/[^\d]/g, '');
  return { amount: digits ? Number(digits) : 0, suffix };
}

/** 162000 → "162.000" (tanpa "Rp", seperti format data prototipe) */
export function formatNumber(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 162000 → "Rp 162.000" dengan spasi tak terputus, sama seperti tampilan prototipe. */
export function formatRupiah(amount: number): string {
  return `Rp ${formatNumber(amount)}`;
}

/** Persen diskon dibulatkan, mis. (120000, 162000) → 26. 0 kalau tidak ada harga coret. */
export function discountPercent(price: number, original: number | null | undefined): number {
  if (!original || original <= price) return 0;
  return Math.round((1 - price / original) * 100);
}

/** 1900 → "1,9 rb", 250 → "250" — format jumlah terjual. */
export function formatSold(count: number): string {
  if (count >= 1000) {
    const value = Math.round((count / 1000) * 10) / 10;
    return `${value.toString().replace('.', ',')} rb`;
  }
  return String(count);
}

const MONTHS = [
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
];
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

/** "Rabu, 6 Mei 2026" → Date (UTC tengah malam). null kalau tidak bisa dibaca. */
export function parseIndonesianDate(text: string): Date | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text ?? '');
  if (!m) return null;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

/** Date → "Rabu, 6 Mei 2026" */
export function formatIndonesianDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  return `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${month[0].toUpperCase()}${month.slice(1)} ${date.getUTCFullYear()}`;
}
