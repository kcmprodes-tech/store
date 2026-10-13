/**
 * Pembatas percobaan login (di memori proses). Akun tidak dikunci permanen, supaya orang lain tidak bisa
 * mengunci akun admin hanya dengan menebak password: yang dibatasi kombinasi IP + email, plus batas per IP.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_PER_ACCOUNT = 5;
const MAX_PER_IP = 30;

type Entry = { count: number; since: number };
const failures = new Map<string, Entry>();

function current(key: string, now: number) {
  const entry = failures.get(key);
  if (entry && now - entry.since > WINDOW_MS) {
    failures.delete(key);
    return undefined;
  }
  return entry;
}

const keys = (ip: string, email: string) => ({ account: `a|${ip}|${email.toLowerCase()}`, ip: `i|${ip}` });

/** Sisa waktu tunggu (ms) kalau sedang dibatasi; 0 = boleh mencoba. */
export function loginBlockedFor(ip: string, email: string, now = Date.now()) {
  const k = keys(ip, email);
  const blocked = [
    [current(k.account, now), MAX_PER_ACCOUNT],
    [current(k.ip, now), MAX_PER_IP],
  ] as const;
  let wait = 0;
  for (const [entry, max] of blocked) {
    if (entry && entry.count >= max) wait = Math.max(wait, entry.since + WINDOW_MS - now);
  }
  return wait;
}

export function recordLoginFailure(ip: string, email: string, now = Date.now()) {
  const k = keys(ip, email);
  for (const key of [k.account, k.ip]) {
    const entry = current(key, now);
    if (entry) entry.count += 1;
    else failures.set(key, { count: 1, since: now });
  }
}

export function clearLoginFailures(ip: string, email: string) {
  failures.delete(keys(ip, email).account);
}

/** Untuk tes. */
export function resetLoginThrottle() {
  failures.clear();
}
