/** Urutan item (tombol naik/turun di CMS). */
export type Direction = 'naik' | 'turun';

export function direction(value: unknown): Direction | null {
  return value === 'naik' || value === 'turun' ? value : null;
}

/**
 * Urutan baru setelah item `id` digeser satu langkah. Hasilnya sortOrder 0..n-1 untuk semua item
 * (sekaligus merapikan nilai ganda). null = tidak bisa digeser (sudah paling atas/bawah).
 */
export function moveStep<T extends { id: number }>(items: T[], id: number, dir: Direction) {
  const index = items.findIndex((i) => i.id === id);
  const target = dir === 'naik' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= items.length) return null;
  const order = [...items];
  [order[index], order[target]] = [order[target]!, order[index]!];
  return order.map((item, sortOrder) => ({ id: item.id, sortOrder }));
}
