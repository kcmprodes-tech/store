/**
 * Mapper data Prisma → bentuk data `storev2.*` yang dipakai template & store-v2.js prototipe.
 * Dengan begitu template hampir tidak perlu diubah.
 */
import { discountPercent, formatIndonesianDate, formatNumber, formatRupiah, formatSold } from '../lib/format.js';
import { availableStock, type ProductWithRelations } from '../modules/catalog/catalog.service.js';

export function productUrl(p: { slug: string; externalUrl?: string | null }) {
  return p.externalUrl || `/produk/${p.slug}`;
}

const CHECK_ICON =
  '<span class="pdp-description-check" aria-hidden="true"><svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg></span>';

/**
 * Deskripsi dari CMS disimpan semantik (<li>teks</li>); di store tiap poin daftar diberi ikon centang
 * seperti desain prototipe. Poin yang sudah berikon (data lama) dibiarkan.
 */
export function decorateDescription(html: string | null) {
  if (!html) return '';
  return html.replace(/<li>(?!<span class="pdp-description-check")([\s\S]*?)<\/li>/g, `<li>${CHECK_ICON}<span>$1</span></li>`);
}

/** Varian yang tampil di kartu & dipilih pertama di halaman detail. */
function primaryVariant(p: ProductWithRelations) {
  return p.variants[0];
}

function categoryKeys(p: ProductWithRelations) {
  if (!p.category) return { kcat: '', ksub: '' };
  return p.category.parent
    ? { kcat: p.category.parent.slug, ksub: p.category.slug }
    : { kcat: p.category.slug, ksub: '' };
}

/** Harga ala prototipe: `price` = harga coret kalau ada diskon, `price_disc` = harga jual. */
function priceStrings(price: number, original: number | null, suffix: string | null) {
  const sfx = suffix ?? '';
  const hasDisc = Boolean(original && original > price);
  return {
    price: hasDisc ? formatNumber(original!) : formatNumber(price) + sfx,
    price_disc: hasDisc ? formatNumber(price) + sfx : '',
    disc: hasDisc ? discountPercent(price, original) : '',
  };
}

export type CardVM = ReturnType<typeof toCardVM>;

export function toCardVM(p: ProductWithRelations, wishlisted = false) {
  const v = primaryVariant(p);
  return {
    id: p.slug,
    title: p.title,
    ...priceStrings(v?.price ?? 0, v?.priceOriginal ?? null, p.priceSuffix),
    image: p.images[0]?.url ?? '',
    category: p.label ?? p.category?.name ?? '',
    ...categoryKeys(p),
    url: productUrl(p),
    wishlisted,
  };
}

export function toCards(products: ProductWithRelations[], wishlistIds: Set<number> = new Set()) {
  return products.map((p) => toCardVM(p, wishlistIds.has(p.id)));
}

/** "Label: nilai" → { label, value }; baris tanpa label (mis. "Termasuk akses …") → { value }. */
function specRow(line: string) {
  const i = line.indexOf(': ');
  return i > 0 ? { label: line.slice(0, i), value: line.slice(i + 2) } : { label: '', value: line };
}

/** Judul di breadcrumb: maks 50 karakter, sisanya elipsis (sama dengan crumbTitle di store-v2.js). */
function crumbTitle(title: string) {
  return title.length > 50 ? `${title.slice(0, 49).trimEnd()}\u2026` : title;
}

/** Paragraf deskripsi polos (untuk meta description). */
function plainText(html: string | null) {
  return (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Nilai pilihan (Warna, Ukuran, …) suatu produk, urut sesuai CMS. */
function optionValues(p: ProductWithRelations, name: string) {
  return p.options.find((o) => o.name === name)?.values ?? [];
}

/** Warna → index foto pertama milik warna itu (foto ditandai lewat product_images.option_value_id). */
export function colorImages(p: ProductWithRelations): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of optionValues(p, 'Warna')) {
    const index = p.images.findIndex((img) => img.optionValueId === value.id);
    if (index >= 0) out[value.value] = index;
  }
  return out;
}

/**
 * Data inline untuk detail apparel & video (dibaca initApparelPdp / initCheckoutFlow).
 * `price_disc` selalu terisi karena JS membacanya sebagai harga jual.
 */
export function toPdpJson(p: ProductWithRelations) {
  const v = primaryVariant(p);
  const price = v?.price ?? 0;
  const original = v?.priceOriginal ?? null;
  const hasDisc = Boolean(original && original > price);
  const stock: Record<string, Record<string, number>> = {};
  for (const variant of p.variants) {
    const color = variant.optionValues.find((o) => o.optionValue.option.name === 'Warna')?.optionValue.value;
    const size = variant.optionValues.find((o) => o.optionValue.option.name === 'Ukuran')?.optionValue.value;
    if (color && size) (stock[color] ??= {})[size] = availableStock(variant) ?? 99;
  }
  return {
    id: p.slug,
    title: p.title,
    colorImages: colorImages(p),
    price: formatNumber(hasDisc ? original! : price),
    price_disc: formatNumber(price),
    disc: hasDisc ? discountPercent(price, original) : '',
    sku: p.sku ?? v?.sku ?? '',
    images: p.images.map((i) => i.url),
    desc: [] as string[],
    descHtml: decorateDescription(p.description),
    specs: (p.specs as string[] | null) ?? null,
    stock,
    playlist: p.video?.playlist ?? undefined,
    date: p.video?.videoDate ? formatIndonesianDate(p.video.videoDate) : undefined,
    access: (p.video?.accessPoints as string[] | null) ?? undefined,
  };
}

/** View model halaman detail umum (detail.hbs): satu sumbu "Varian" atau tanpa varian. */
export function toPdpVM(p: ProductWithRelations, wishlisted = false) {
  const v = primaryVariant(p);
  const price = v?.price ?? 0;
  const original = v?.priceOriginal ?? null;
  // Produk tanpa sumbu "Varian" tetap dapat satu chip (tersembunyi) supaya JS harga/stok/qty bekerja.
  const hasVariants = p.options.some((o) => o.name === 'Varian');
  const variants = p.variants.map((variant, i) => {
    const stock = availableStock(variant);
    return {
      name: variant.name ?? 'Standar',
      price: variant.price,
      priceOriginal: variant.priceOriginal && variant.priceOriginal > variant.price ? variant.priceOriginal : 0,
      discount: discountPercent(variant.price, variant.priceOriginal),
      tracked: stock !== null,
      stock: stock ?? 0,
      imageIndex: variant.imageIndex ?? 0,
      selected: i === 0,
    };
  });
  const stock = v ? availableStock(v) : null;
  const { kcat, ksub } = categoryKeys(p);
  return {
    id: p.slug,
    title: p.title,
    shortTitle: crumbTitle(p.title),
    images: p.images.map((i) => i.url),
    firstImage: p.images[v?.imageIndex ?? 0]?.url ?? p.images[0]?.url ?? '',
    sold: p.soldCount > 0 ? `${formatSold(p.soldCount)} terjual` : '',
    price: formatRupiah(price),
    priceOriginal: original && original > price ? formatRupiah(original) : '',
    discount: discountPercent(price, original),
    hasVariants,
    variantLabel: variants[0]?.name ?? '',
    colors: optionValues(p, 'Warna').map((v) => ({ value: v.value, swatch: v.swatch ?? '#FFFFFF' })),
    sizes: optionValues(p, 'Ukuran').map((v) => v.value),
    variants,
    stockTracked: stock !== null,
    stockLabel: stock === null ? '' : stock > 0 ? `Stok ${stock}` : 'Stock habis',
    descriptionHtml: decorateDescription(p.description),
    specRows: [...((p.specs as string[] | null) ?? [`Produk: ${p.title}`]), `SKU: ${p.sku ?? v?.sku ?? ''}`].map(specRow),
    sku: p.sku ?? v?.sku ?? '',
    category: p.category ? { name: p.label ?? p.category.parent?.name ?? p.category.name, href: `/produk?category=${kcat}${ksub ? `&sub=${ksub}` : ''}` } : null,
    /** Breadcrumb kategori → sub kategori produk. */
    crumbs: p.category
      ? [
          ...(p.category.parent ? [{ name: p.category.parent.name, href: `/produk?category=${kcat}` }] : []),
          { name: p.category.name, href: `/produk?category=${kcat}${ksub ? `&sub=${ksub}` : ''}` },
        ]
      : [],
    typeLabel: p.type === 'PHYSICAL' ? 'Fisik' : 'Digital',
    buyHref: `/checkout?product=${encodeURIComponent(p.slug)}&type=${encodeURIComponent(variants[0]?.name ?? '')}&qty=1&checkoutFlow=buy-now`,
    wishlisted,
    metaDescription: plainText(p.description).slice(0, 160),
  };
}
