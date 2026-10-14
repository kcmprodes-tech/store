import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} belum diisi (lihat .env.example)`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  /** Nomor WhatsApp store (62...). Kosong = tombol WhatsApp disembunyikan. */
  whatsappNumber: (process.env.WHATSAPP_NUMBER ?? '').replace(/\D/g, ''),
  /** Alamat publik store tanpa "/" di akhir; dipakai untuk link & gambar di email. */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, ''),
};

export const isProd = env.nodeEnv === 'production';
