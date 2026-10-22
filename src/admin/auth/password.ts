/**
 * Hash password akun CMS dengan scrypt (bawaan Node, tanpa dependensi native).
 * Format tersimpan: scrypt$N$r$p$salt$hash (salt & hash base64url), sehingga parameter bisa dinaikkan nanti
 * tanpa memutus hash lama.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

// OWASP Password Storage: scrypt N=2^14, r=8, p=5 (memori 16 MiB, biaya ×5 dibanding p=1)
const PARAMS = { N: 16384, r: 8, p: 5 };
const KEYLEN = 64;
export const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Hash lama dengan parameter lebih lemah → di-hash ulang saat login berhasil. */
export function needsRehash(stored: string) {
  const [algo, n, r, p] = stored.split('$');
  return algo !== 'scrypt' || Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

let dummyHash: Promise<string> | null = null;

/** Hash pembanding untuk email yang tidak terdaftar, supaya waktu respons login tidak membocorkan akun mana yang ada. */
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/**
 * Kata yang paling sering dipakai/ditebak penyerang (OWASP ASVS 2.1.7). Password yang isinya hampir hanya
 * kata ini + angka/simbol (mis. "Kompas2026!", "password123") ditolak.
 */
const WEAK_WORDS = [
  'password', 'passw0rd', 'katasandi', 'sandi', 'rahasia', 'admin', 'administrator', 'qwerty', 'qwertyuiop',
  'asdfgh', 'zxcvbn', 'letmein', 'welcome', 'selamat', 'iloveyou', 'sayang', 'indonesia', 'jakarta', 'bismillah',
  'kompas', 'kompascom', 'kgmedia', 'gramedia', 'store', 'toko', 'cms', 'login', 'user', 'abc', 'abcdef',
];

function isTrivial(password: string) {
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower)) return true; // aaaaaaaaaa
  const digitsOnly = /^\d+$/.test(lower);
  if (digitsOnly && ('01234567890123456789'.includes(lower) || '98765432109876543210'.includes(lower))) return true;
  // buang angka & simbol di tepi/tengah, sisanya hanya kata umum (boleh berulang) → lemah
  const letters = lower.replace(/[^a-z]/g, '');
  if (!letters) return digitsOnly && new Set(lower).size <= 3;
  return WEAK_WORDS.some((w) => letters.replaceAll(w, '') === '' || letters === w.split('').reverse().join(''));
}

/** Pesan kesalahan untuk password baru, atau null kalau sudah memenuhi syarat. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password minimal ${MIN_PASSWORD_LENGTH} karakter.`;
  if (password.length > 200) return 'Password terlalu panjang.';
  if (email && password.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Password tidak boleh memuat nama email.';
  if (isTrivial(password)) return 'Password terlalu mudah ditebak. Pakai gabungan kata yang tidak umum, misalnya kalimat pendek.';
  return null;
}

/** Password acak yang mudah diketik (untuk akun baru / reset); tanpa huruf yang mirip (O/0, I/l/1). */
export function generatePassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
