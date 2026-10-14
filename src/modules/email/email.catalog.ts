/**
 * Daftar email yang dikirim ke pembeli. `subject` & `preheader` adalah template Handlebars
 * (data sama dengan isi email). Template isi ada di views/emails/<name>.hbs.
 */
export type EmailGroup = 'Transaksi' | 'Refund' | 'Setelah rilis';

export interface EmailDef {
  name: string;
  group: EmailGroup;
  title: string;
  /** Kapan email dikirim (untuk dokumentasi & halaman pratinjau). */
  trigger: string;
  subject: string;
  /** Teks pratinjau di kotak masuk (tampil setelah subjek). */
  preheader: string;
}

export const EMAILS: EmailDef[] = [
  {
    name: 'menunggu-pembayaran',
    group: 'Transaksi',
    title: 'Menunggu pembayaran',
    trigger: 'Pesanan dibuat dengan Virtual account BCA atau QRIS',
    subject: 'Selesaikan pembayaran {{order.invoiceNo}}',
    preheader: 'Bayar {{rupiah order.total}} sebelum {{payment.deadline}} supaya pesananmu tidak dibatalkan.',
  },
  {
    name: 'pembayaran-berhasil',
    group: 'Transaksi',
    title: 'Pembayaran berhasil (bukti pembelian)',
    trigger: 'Pembayaran diterima, atau langsung setelah bayar instan (kartu kredit, e-wallet)',
    subject: 'Pembayaran berhasil · {{order.invoiceNo}}',
    preheader: 'Terima kasih! Pesananmu sedang kami siapkan.',
  },
  {
    name: 'pesanan-dikirim',
    group: 'Transaksi',
    title: 'Pesanan dikirim',
    trigger: 'Admin mengisi nomor resi di CMS',
    subject: 'Pesananmu sedang dikirim · {{order.invoiceNo}}',
    preheader: '{{order.courier}} · No. resi {{order.trackingNo}}',
  },
  {
    name: 'siap-diambil',
    group: 'Transaksi',
    title: 'Pesanan siap diambil',
    trigger: 'Gudang menandai pesanan ambil sendiri siap diambil',
    subject: 'Pesananmu siap diambil · {{order.invoiceNo}}',
    preheader: 'Ambil di {{order.pickup.name}}, {{order.pickup.hours}}.',
  },
  {
    name: 'akses-video',
    group: 'Transaksi',
    title: 'Akses video aktif',
    trigger: 'Pesanan video premium dibayar (sekaligus jadi bukti pembelian)',
    subject: 'Video premium siap ditonton · {{order.invoiceNo}}',
    preheader: '{{video.title}}',
  },
  {
    name: 'pesanan-kedaluwarsa',
    group: 'Transaksi',
    title: 'Pesanan kedaluwarsa',
    trigger: '24 jam tidak dibayar, pesanan batal otomatis',
    subject: 'Pesanan {{order.invoiceNo}} dibatalkan otomatis',
    preheader: 'Pembayaran tidak kami terima sampai {{payment.deadline}}.',
  },
  {
    name: 'pesanan-dibatalkan',
    group: 'Transaksi',
    title: 'Pesanan dibatalkan',
    trigger: 'Dibatalkan pembeli atau CS',
    subject: 'Pesanan {{order.invoiceNo}} dibatalkan',
    preheader: '{{#if refund}}Dana {{rupiah refund.amount}} akan dikembalikan ke {{refund.destination}}.{{else}}{{cancel.reason}}{{/if}}',
  },
  {
    name: 'refund-diproses',
    group: 'Refund',
    title: 'Refund diproses',
    trigger: 'CS mengajukan refund',
    subject: 'Refund {{order.invoiceNo}} sedang diproses',
    preheader: '{{rupiah refund.amount}} ke {{refund.destination}}, paling lambat {{refund.eta}}.',
  },
  {
    name: 'refund-selesai',
    group: 'Refund',
    title: 'Refund selesai',
    trigger: 'Finance menyetujui dan dana dikirim',
    subject: 'Refund {{order.invoiceNo}} sudah dikirim',
    preheader: '{{rupiah refund.amount}} sudah dikembalikan ke {{refund.destination}}.',
  },
  {
    name: 'pengingat-bayar',
    group: 'Setelah rilis',
    title: 'Pengingat bayar',
    trigger: '±3 jam sebelum batas bayar VA/QRIS',
    subject: 'Batas bayar {{order.invoiceNo}} tinggal 3 jam lagi',
    preheader: 'Bayar {{rupiah order.total}} sebelum {{payment.deadline}}.',
  },
  {
    name: 'pesanan-selesai',
    group: 'Setelah rilis',
    title: 'Pesanan selesai',
    trigger: 'Pesanan sudah diambil, atau otomatis selesai 7 hari setelah dikirim',
    subject: 'Pesanan {{order.invoiceNo}} selesai. Terima kasih!',
    preheader: 'Semoga kamu suka dengan pesananmu.',
  },
];

export function findEmail(name: string) {
  return EMAILS.find((e) => e.name === name);
}
