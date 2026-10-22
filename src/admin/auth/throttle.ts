/**
 * Pembatas percobaan login (di memori proses). Tiga batas dalam jendela 15 menit:
 * - IP + email: 5 percobaan (menebak password satu akun dari satu tempat)
 * - IP: 30 percobaan (menyemprot banyak akun dari satu tempat)
 * - email dari semua IP: 20 percobaan (menebak satu akun sambil berganti-ganti IP)
 * Percobaan dicatat SEBELUM password dicek; karena pencatatan sinkron, request paralel tidak bisa lolos
 * bersamaan. Login berhasil menghapus hitungan akun itu. Tidak ada kunci permanen.
 * Catatan: di hosting dengan banyak instance (mis. Vercel) hitungan ini per instance — pindahkan ke database/Redis.
 */
const WINDOW_MS = 15 * 60_000;
const LIMITS = { accountIp: 5, ip: 30, account: 20 } as const;

type Entry = { count: number; since: number };
const attempts = new Map<string, Entry>();

function current(key: string, now: number) {
  const entry = attempts.get(key);
  if (entry && now - entry.since > WINDOW_MS) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

const keys = (ip: string, email: string) => {
  const e = email.toLowerCase();
  return { accountIp: `a|${ip}|${e}`, ip: `i|${ip}`, account: `e|${e}` };
};

/** Sisa waktu tunggu (ms) kalau sedang dibatasi; 0 = boleh mencoba. */
export function loginBlockedFor(ip: string, email: string, now = Date.now()) {
  const k = keys(ip, email);
  let wait = 0;
  for (const name of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const entry = current(k[name], now);
    if (entry && entry.count >= LIMITS[name]) wait = Math.max(wait, entry.since + WINDOW_MS - now);
  }
  return wait;
}

/** Catat satu percobaan login (dipanggil sebelum password dicek). */
export function registerLoginAttempt(ip: string, email: string, now = Date.now()) {
  for (const key of Object.values(keys(ip, email))) {
    const entry = current(key, now);
    if (entry) entry.count += 1;
    else attempts.set(key, { count: 1, since: now });
  }
}

/** Login berhasil: hitungan untuk akun ini dihapus (batas per IP tetap berjalan). */
export function clearLoginFailures(ip: string, email: string) {
  const k = keys(ip, email);
  attempts.delete(k.accountIp);
  attempts.delete(k.account);
}

/** Bersihkan entri kedaluwarsa supaya peta tidak terus membesar saat diserang. */
function prune(now = Date.now()) {
  for (const [key, entry] of attempts) if (now - entry.since > WINDOW_MS) attempts.delete(key);
}
setInterval(prune, 5 * 60_000).unref();

/** Untuk tes. */
export function resetLoginThrottle() {
  attempts.clear();
}
