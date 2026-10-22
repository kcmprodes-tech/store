import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} belum diisi (lihat .env.example)`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  // tanpa NODE_ENV dianggap produksi (gagal-aman): stack trace, rute development & akun uji tertutup
  nodeEnv: process.env.NODE_ENV || 'production',
  databaseUrl: required('DATABASE_URL'),
  /** Nomor WhatsApp store (62...). Kosong = tombol WhatsApp disembunyikan. */
  whatsappNumber: (process.env.WHATSAPP_NUMBER ?? '').replace(/\D/g, ''),
  /** Alamat publik aplikasi tanpa "/" di akhir: link & gambar di email, QR pengambilan, passkey CMS.
   *  APP_ORIGIN (nama lama PUBLIC_BASE_URL juga dibaca); default localhost + PORT. */
  appOrigin: (process.env.APP_ORIGIN || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, ''),
};

export const isProd = env.nodeEnv === 'production' || process.env.VERCEL_ENV === 'production';

/**
 * Proxy yang dipercaya untuk X-Forwarded-For/Proto (Express "trust proxy"). Default "loopback": hanya
 * proxy di mesin yang sama (cloudflared, nginx lokal) — klien yang langsung ke port server tidak bisa
 * memalsukan IP. Di Vercel isi TRUST_PROXY=1.
 */
export const trustProxy: boolean | number | string = (() => {
  const v = (process.env.TRUST_PROXY ?? 'loopback').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return /^\d+$/.test(v) ? Number(v) : v;
})();
