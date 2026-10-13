/**
 * Penyimpanan file upload CMS di disk lokal (public/uploads/YYYY/MM/<acak>.<ext>), disajikan di /uploads/….
 * Antarmuka saveImage() sengaja kecil supaya nanti bisa diganti storage/CDN tanpa mengubah pemanggilnya.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageType = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

/** Jenis gambar dari isi file (magic bytes), bukan dari nama/Content-Type kiriman browser. */
export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export const uploadsRoot = () => join(process.cwd(), 'public', 'uploads');

/** Simpan gambar; hasilnya URL publik, mis. /uploads/2026/10/k3j9…x.webp */
export async function saveImage(buf: Buffer, type: ImageType, now = new Date()) {
  const dir = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
  const name = `${randomBytes(12).toString('base64url')}.${type.ext}`;
  await mkdir(join(uploadsRoot(), dir), { recursive: true });
  await writeFile(join(uploadsRoot(), dir, name), buf, { flag: 'wx' });
  return `/uploads/${dir}/${name}`;
}
