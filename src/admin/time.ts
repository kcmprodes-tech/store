/** Tanggal & jam di CMS selalu WIB (Asia/Jakarta, UTC+7, tanpa daylight saving). */
const WIB_OFFSET_MS = 7 * 3600_000;

const dateTimeFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFmt = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' });

export function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '';
  return dateTimeFmt.format(new Date(value)).replace(/\./g, ':') + ' WIB';
}

export function formatDate(value: Date | string | null | undefined) {
  return value ? dateFmt.format(new Date(value)) : '';
}

/** Date → nilai <input type="datetime-local"> (jam WIB). */
export function toDateTimeLocal(value: Date | string | null | undefined) {
  if (!value) return '';
  // Nilai form yang dikirim ulang (sudah format datetime-local) dipakai apa adanya.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  return new Date(new Date(value).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

/** Nilai <input type="datetime-local"> (jam WIB) → Date; kosong/tidak valid → null. */
export function fromDateTimeLocal(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+07:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}
