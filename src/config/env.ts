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
  /** Alamat publik aplikasi tanpa "/" di akhir: link & gambar di email, QR pengambilan, passkey CMS.
   *  APP_ORIGIN (nama lama PUBLIC_BASE_URL juga dibaca); default localhost + PORT. */
  appOrigin: (process.env.APP_ORIGIN || process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, ''),
};

export const isProd = env.nodeEnv === 'production';
