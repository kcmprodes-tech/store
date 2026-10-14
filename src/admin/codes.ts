/** QR & barcode sebagai SVG (dibuat di server dengan bwip-js) untuk QR ambil, label kirim, dan label SKU. */
import bwipjs from 'bwip-js';
import { env } from '../config/env.js';

/** SVG QR code; ukuran mengikuti CSS (viewBox tanpa width/height). */
export function qrSvg(text: string) {
  return bwipjs.toSVG({ bcid: 'qrcode', text, scale: 2 }) // eclevel default BWIPP = M;
}

/** SVG barcode Code128 tanpa teks (teksnya dicetak terpisah, lebih besar & terbaca). */
export function code128Svg(text: string) {
  return bwipjs.toSVG({ bcid: 'code128', text, height: 12 });
}

/**
 * URL QR pengambilan: APP_ORIGIN/admin/ambil/<token>. Dipindai kamera HP biasa langsung membuka layar serah terima
 * di CMS; scanner CMS juga mengenalinya. Origin diambil dari konfigurasi, bukan dari header Host.
 */
export function pickupUrl(token: string) {
  return `${env.appOrigin}/admin/ambil/${token}`;
}
