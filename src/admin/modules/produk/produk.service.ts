/**
 * Form produk CMS ⇄ database. Bentuk opsi mengikuti template store:
 * - NONE    : tanpa opsi, satu SKU (halaman detail umum)
 * - VARIAN  : satu sumbu "Varian" (chip di halaman detail umum, mis. Bundling Pesta Bola)
 * - APPAREL : sumbu "Warna" × "Ukuran" (halaman detail apparel, matriks stok per warna & ukuran)
 * SKU yang sudah punya riwayat stok/pesanan tidak pernah dihapus, hanya dinonaktifkan.
 */
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';
import { prisma } from '../../../lib/prisma.js';
import { Prisma, type Product, type ProductType } from '../../../generated/prisma/client.js';
import { isSafeUrl, optionalInt, optionalText, requiredText, safeUrl, slug } from '../../http.js';
import { fromDateTimeLocal } from '../../time.js';

export const TYPE_LABELS: Record<ProductType, string> = {
  PHYSICAL: 'Fisik',
  DIGITAL_VIDEO: 'Video premium',
  DIGITAL_CONTENT: 'Konten digital (VIK)',
  MEMBERSHIP: 'Membership',
  EVENT: 'Event',
};

export type OptionMode = 'NONE' | 'VARIAN' | 'APPAREL';

const AXES: Record<OptionMode, string[]> = { NONE: [], VARIAN: ['Varian'], APPAREL: ['Warna', 'Ukuran'] };

/**
 * Deskripsi dari editor teks → HTML aman dengan kosakata deskripsi store:
 * subjudul = h2.pdp-description-heading, daftar = ul > li (ikon centang ditambahkan saat dirender,
 * lihat decorateDescription di src/view/mappers.ts), paragraf, tebal/miring, link aman.
 */
export function sanitizeDescription(html: string) {
  const heading = () => ({ tagName: 'h2', attribs: { class: 'pdp-description-heading' } });
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 'h2', 'ul', 'li', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'], h2: ['class'] },
    allowedClasses: { h2: ['pdp-description-heading'] },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      b: 'strong',
      i: 'em',
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      ol: 'ul',
      // Link tidak aman (javascript:, http:, …) dibuang, teksnya tetap.
      a: (tagName, attribs) =>
        isSafeUrl(attribs.href ?? '')
          ? { tagName, attribs: { href: attribs.href!, ...(attribs.href!.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {}) } }
          : { tagName: 'span', attribs: {} },
    },
  }).trim();
}

// ───────────── Bentuk data form (sama untuk render & submit) ─────────────

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : v && typeof v === 'object' ? (Object.values(v) as Record<string, unknown>[]) : [];

const coreSchema = z.object({
  title: requiredText(255, 'Judul'),
  slug: slug(191),
  type: z.enum(['PHYSICAL', 'DIGITAL_VIDEO', 'DIGITAL_CONTENT', 'MEMBERSHIP', 'EVENT']),
  categoryId: optionalInt(1),
  label: optionalText(80),
  sku: optionalText(80),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  publishedAt: z.preprocess(fromDateTimeLocal, z.date().nullable()),
  externalUrl: safeUrl(500),
  priceSuffix: optionalText(20),
  weightGram: optionalInt(0, 1_000_000),
});

export type ProductForm = {
  core: z.infer<typeof coreSchema>;
  description: string | null;
  specs: string[];
  images: { url: string; alt: string | null; color: string | null }[];
  mode: OptionMode;
  varian: string[];
  warna: { value: string; swatch: string | null }[];
  ukuran: string[];
  variants: {
    id: number | null;
    sku: string;
    price: number;
    priceOriginal: number | null;
    isActive: boolean;
    trackStock: boolean;
    lowStockThreshold: number | null;
    imageIndex: number | null;
    values: { Varian?: string; Warna?: string; Ukuran?: string };
  }[];
  video: { playlist: string | null; videoDate: Date | null; accessPoints: string[]; mediaUrl: string | null } | null;
};

const toInt = (v: unknown) => {
  const s = text(v).replace(/[.\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
};

const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

/** Body form → ProductForm + pesan error per field (kunci seperti "variants.2.sku"). */
export async function parseProductForm(body: Record<string, unknown>, productId?: number) {
  const errors: Record<string, string> = {};
  const core = coreSchema.safeParse(body);
  if (!core.success) for (const i of core.error.issues) errors[i.path.join('.')] ??= i.message;

  const mode: OptionMode = body.optionMode === 'VARIAN' || body.optionMode === 'APPAREL' ? body.optionMode : 'NONE';

  const specs = list(body.specs)
    .map((s) => ({ label: text(s.label).slice(0, 80), value: text(s.value).slice(0, 300) }))
    .filter((s) => s.value)
    .map((s) => (s.label ? `${s.label}: ${s.value}` : s.value));

  const images = list(body.images)
    .map((img) => ({ url: text(img.url), alt: text(img.alt).slice(0, 255) || null, color: text(img.color) || null }))
    .filter((img) => img.url);
  images.forEach((img, i) => {
    if (!isSafeUrl(img.url) || img.url.length > 500) errors[`images.${i}.url`] = 'Alamat foto tidak valid.';
  });

  const uniq = (values: string[], key: string, label: string) => {
    const seen = new Set<string>();
    values.forEach((v, i) => {
      const k = v.toLowerCase();
      if (seen.has(k)) errors[`${key}.${i}`] = `${label} "${v}" dobel.`;
      seen.add(k);
    });
    return values;
  };
  const varian = mode === 'VARIAN' ? uniq(list(body.optVarian).map((o) => text(o.value).slice(0, 80)).filter(Boolean), 'optVarian', 'Varian') : [];
  const warna =
    mode === 'APPAREL'
      ? list(body.optWarna)
          .map((o) => ({ value: text(o.value).slice(0, 80), swatch: isHex(text(o.swatch)) ? text(o.swatch).toUpperCase() : null }))
          .filter((o) => o.value)
      : [];
  if (mode === 'APPAREL') uniq(warna.map((w) => w.value), 'optWarna', 'Warna');
  const ukuran = mode === 'APPAREL' ? uniq(list(body.optUkuran).map((o) => text(o.value).slice(0, 80)).filter(Boolean), 'optUkuran', 'Ukuran') : [];
  if (mode === 'VARIAN' && !varian.length) errors.optVarian = 'Isi minimal satu varian.';
  if (mode === 'APPAREL' && !warna.length) errors.optWarna = 'Isi minimal satu warna.';
  if (mode === 'APPAREL' && !ukuran.length) errors.optUkuran = 'Isi minimal satu ukuran.';

  const physical = core.success ? core.data.type === 'PHYSICAL' : true;
  const variants: ProductForm['variants'] = list(body.variants).map((row, i) => {
    const price = toInt(row.price);
    const priceOriginal = toInt(row.priceOriginal);
    const threshold = toInt(row.lowStockThreshold);
    const imageIndex = toInt(row.imageIndex);
    const sku = text(row.sku).toUpperCase().slice(0, 120);
    if (!sku) errors[`variants.${i}.sku`] = 'SKU wajib diisi.';
    else if (!/^[A-Z0-9][A-Z0-9 ._-]*$/.test(sku)) errors[`variants.${i}.sku`] = 'SKU hanya huruf, angka, spasi, titik, - dan _.';
    if (price === null || Number.isNaN(price) || price < 0) errors[`variants.${i}.price`] = 'Harga wajib diisi (angka).';
    if (priceOriginal !== null && (Number.isNaN(priceOriginal) || (price !== null && priceOriginal <= price))) {
      errors[`variants.${i}.priceOriginal`] = 'Harga coret harus lebih besar dari harga jual.';
    }
    if (threshold !== null && (Number.isNaN(threshold) || threshold < 0)) errors[`variants.${i}.lowStockThreshold`] = 'Ambang harus angka ≥ 0.';
    const values = {
      Varian: mode === 'VARIAN' ? text(row.varian) : undefined,
      Warna: mode === 'APPAREL' ? text(row.warna) : undefined,
      Ukuran: mode === 'APPAREL' ? text(row.ukuran) : undefined,
    };
    if (mode === 'VARIAN' && !varian.includes(values.Varian!)) errors[`variants.${i}.varian`] = 'Varian tidak ada di daftar opsi.';
    if (mode === 'APPAREL' && (!warna.some((w) => w.value === values.Warna) || !ukuran.includes(values.Ukuran!))) {
      errors[`variants.${i}.warna`] = 'Warna/ukuran tidak ada di daftar opsi.';
    }
    return {
      id: Number(row.id) > 0 ? Number(row.id) : null,
      sku,
      price: price ?? 0,
      priceOriginal: priceOriginal && !Number.isNaN(priceOriginal) ? priceOriginal : null,
      isActive: row.isActive === 'on' || row.isActive === 'true' || row.isActive === true,
      trackStock: physical ? row.trackStock === 'on' || row.trackStock === 'true' || row.trackStock === true : false,
      lowStockThreshold: threshold !== null && !Number.isNaN(threshold) ? threshold : null,
      imageIndex: imageIndex !== null && !Number.isNaN(imageIndex) && imageIndex >= 0 ? imageIndex : null,
      values,
    };
  });
  if (!variants.length) errors.variants = 'Produk butuh minimal satu SKU.';
  if (mode === 'NONE' && variants.length > 1) errors.variants = 'Produk tanpa opsi hanya punya satu SKU. Pilih opsi Varian atau Warna × Ukuran.';

  // SKU & kombinasi tidak boleh dobel
  const skuSeen = new Map<string, number>();
  const comboSeen = new Set<string>();
  variants.forEach((v, i) => {
    if (v.sku && skuSeen.has(v.sku)) errors[`variants.${i}.sku`] = `SKU ${v.sku} dobel.`;
    skuSeen.set(v.sku, i);
    const combo = [v.values.Varian, v.values.Warna, v.values.Ukuran].join('|');
    if (mode !== 'NONE' && comboSeen.has(combo)) errors[`variants.${i}.varian`] = 'Kombinasi opsi dobel.';
    comboSeen.add(combo);
  });
  if (variants.length && !variants.some((v) => v.isActive)) errors.variants = 'Minimal satu SKU harus aktif.';
  const skus = variants.map((v) => v.sku).filter(Boolean);
  if (skus.length) {
    const taken = await prisma.productVariant.findMany({
      where: { sku: { in: skus }, ...(productId ? { productId: { not: productId } } : {}) },
      select: { sku: true, product: { select: { title: true } } },
    });
    for (const t of taken) errors[`variants.${skuSeen.get(t.sku)}.sku`] = `SKU ${t.sku} sudah dipakai "${t.product.title}".`;
  }

  if (core.success) {
    const d = core.data;
    const dupSlug = await prisma.product.findUnique({ where: { slug: d.slug }, select: { id: true, title: true } });
    if (dupSlug && dupSlug.id !== productId) errors.slug = `Slug sudah dipakai "${dupSlug.title}".`;
    if (d.sku) {
      const dupSku = await prisma.product.findUnique({ where: { sku: d.sku }, select: { id: true, title: true } });
      if (dupSku && dupSku.id !== productId) errors.sku = `Kode produk sudah dipakai "${dupSku.title}".`;
    }
    if (d.status === 'PUBLISHED' && !images.length && !d.externalUrl) errors.images = 'Produk tayang butuh minimal satu foto.';
    if (d.categoryId && !(await prisma.category.count({ where: { id: d.categoryId } }))) errors.categoryId = 'Kategori tidak ditemukan.';
  }
  images.forEach((img, i) => {
    if (img.color && !warna.some((w) => w.value === img.color)) images[i]!.color = null;
  });

  const description = sanitizeDescription(text(body.description)) || null;
  const videoBody = (body.video ?? {}) as Record<string, unknown>;
  const video =
    core.success && core.data.type === 'DIGITAL_VIDEO'
      ? {
          playlist: text(videoBody.playlist).slice(0, 120) || null,
          videoDate: /^\d{4}-\d{2}-\d{2}$/.test(text(videoBody.videoDate)) ? new Date(`${text(videoBody.videoDate)}T00:00:00Z`) : null,
          accessPoints: text(videoBody.accessPoints)
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 20),
          mediaUrl: text(videoBody.mediaUrl) || null,
        }
      : null;
  if (video?.mediaUrl && !isSafeUrl(video.mediaUrl)) errors['video.mediaUrl'] = 'Link video harus https:// atau diawali "/".';

  const form: ProductForm | null = core.success ? { core: core.data, description, specs, images, mode, varian, warna, ukuran, variants, video } : null;
  return { form, errors };
}

// ───────────── Muat produk untuk form ─────────────

export const editInclude = {
  category: { include: { parent: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  options: { orderBy: { sortOrder: 'asc' }, include: { values: { orderBy: { sortOrder: 'asc' } } } },
  variants: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      optionValues: { include: { optionValue: { include: { option: true } } } },
      inventory: true,
      _count: { select: { movements: true, orderItems: true, cartItems: true } },
    },
  },
  video: true,
} satisfies Prisma.ProductInclude;

export type EditableProduct = Prisma.ProductGetPayload<{ include: typeof editInclude }>;

export function optionMode(p: { options: { name: string }[] }): OptionMode {
  const names = p.options.map((o) => o.name);
  if (names.includes('Warna') || names.includes('Ukuran')) return 'APPAREL';
  if (names.includes('Varian')) return 'VARIAN';
  return 'NONE';
}

const valueOf = (v: EditableProduct['variants'][number], option: string) =>
  v.optionValues.find((o) => o.optionValue.option.name === option)?.optionValue.value ?? '';

/**
 * SKU yang tampil di form: SKU "pensiun" (nonaktif dan tidak cocok lagi dengan opsi sekarang, mis. warnanya
 * sudah dihapus) disembunyikan — tetap ada di database untuk riwayat stok/pesanan.
 */
function formVariants(p: EditableProduct) {
  const mode = optionMode(p);
  if (mode === 'NONE') {
    const first = p.variants.find((v) => v.isActive) ?? p.variants[0];
    return first ? [first] : [];
  }
  return p.variants.filter((v) => v.isActive || AXES[mode].every((axis) => valueOf(v, axis)));
}

/** Produk → nilai form (bentuk sama dengan body yang dikirim). */
export function toFormValues(p: EditableProduct) {
  const opt = (name: string) => p.options.find((o) => o.name === name)?.values ?? [];
  const colorById = new Map(opt('Warna').map((v) => [v.id, v.value]));
  return {
    ...p,
    optionMode: optionMode(p),
    specs: ((p.specs as string[] | null) ?? []).map((line) => {
      const i = line.indexOf(': ');
      return i > 0 ? { label: line.slice(0, i), value: line.slice(i + 2) } : { label: '', value: line };
    }),
    images: p.images.map((img) => ({ url: img.url, alt: img.alt ?? '', color: img.optionValueId ? (colorById.get(img.optionValueId) ?? '') : '' })),
    optVarian: opt('Varian').map((v) => ({ value: v.value })),
    optWarna: opt('Warna').map((v) => ({ value: v.value, swatch: v.swatch ?? '' })),
    optUkuran: opt('Ukuran').map((v) => ({ value: v.value })),
    variants: formVariants(p).map((v) => ({
      id: v.id,
      sku: v.sku,
      price: v.price,
      priceOriginal: v.priceOriginal ?? '',
      isActive: v.isActive,
      trackStock: v.trackStock,
      lowStockThreshold: v.lowStockThreshold ?? '',
      imageIndex: v.imageIndex ?? '',
      varian: valueOf(v, 'Varian'),
      warna: valueOf(v, 'Warna'),
      ukuran: valueOf(v, 'Ukuran'),
      stock: v.trackStock ? v.inventory.reduce((n, l) => n + l.onHand - l.reserved, 0) : null,
      hasHistory: v._count.movements + v._count.orderItems + v._count.cartItems > 0,
    })),
    video: p.video
      ? {
          playlist: p.video.playlist ?? '',
          videoDate: p.video.videoDate ? p.video.videoDate.toISOString().slice(0, 10) : '',
          accessPoints: ((p.video.accessPoints as string[] | null) ?? []).join('\n'),
          mediaUrl: p.video.mediaUrl ?? '',
        }
      : { playlist: '', videoDate: '', accessPoints: '', mediaUrl: '' },
  };
}

/** Ringkasan yang dicatat di log perubahan. */
export function auditSnapshot(p: EditableProduct | null) {
  if (!p) return null;
  const { images, options, variants, video, category, ...core } = p;
  return {
    ...core,
    images: images.map((i) => i.url),
    options: options.map((o) => `${o.name}: ${o.values.map((v) => v.value).join(', ')}`),
    variants: variants.map((v) => `${v.sku} · ${v.price}${v.priceOriginal ? ` (coret ${v.priceOriginal})` : ''}${v.isActive ? '' : ' · nonaktif'}`),
    video: video ? { playlist: video.playlist, videoDate: video.videoDate, mediaUrl: video.mediaUrl } : null,
  };
}

// ───────────── Simpan ─────────────

export async function saveProduct(tx: Prisma.TransactionClient, form: ProductForm, before: EditableProduct | null): Promise<Product> {
  const c = form.core;
  const now = new Date();
  // Pertama kali tayang tanpa jadwal → waktu tayang = sekarang (urutan "terbaru").
  const publishedAt = c.publishedAt ?? (c.status === 'PUBLISHED' ? (before?.publishedAt ?? now) : (before?.publishedAt ?? null));
  const data = {
    title: c.title,
    slug: c.slug,
    type: c.type,
    categoryId: c.categoryId,
    label: c.label,
    sku: c.sku,
    status: c.status,
    publishedAt,
    externalUrl: c.externalUrl,
    priceSuffix: c.priceSuffix,
    weightGram: c.type === 'PHYSICAL' ? c.weightGram : null,
    description: form.description,
    specs: form.specs.length ? form.specs : Prisma.DbNull,
  };
  const product = before ? await tx.product.update({ where: { id: before.id }, data }) : await tx.product.create({ data });

  // Opsi & nilainya
  const axes = AXES[form.mode];
  await tx.productOption.deleteMany({ where: { productId: product.id, name: { notIn: axes } } });
  const valueIds = new Map<string, number>(); // "Warna|Hitam" → id
  for (const [i, name] of axes.entries()) {
    const values =
      name === 'Varian'
        ? form.varian.map((value) => ({ value, swatch: null as string | null }))
        : name === 'Warna'
          ? form.warna
          : form.ukuran.map((value) => ({ value, swatch: null as string | null }));
    const option = await tx.productOption.upsert({
      where: { productId_name: { productId: product.id, name } },
      create: { productId: product.id, name, sortOrder: i },
      update: { sortOrder: i },
    });
    await tx.productOptionValue.deleteMany({ where: { optionId: option.id, value: { notIn: values.map((v) => v.value) } } });
    for (const [j, v] of values.entries()) {
      const saved = await tx.productOptionValue.upsert({
        where: { optionId_value: { optionId: option.id, value: v.value } },
        create: { optionId: option.id, value: v.value, swatch: v.swatch, sortOrder: j },
        update: { swatch: v.swatch, sortOrder: j },
      });
      valueIds.set(`${name}|${v.value}`, saved.id);
    }
  }

  // Foto (urutan = urutan di form), ditautkan ke warna kalau dipilih
  await tx.productImage.deleteMany({ where: { productId: product.id } });
  if (form.images.length) {
    await tx.productImage.createMany({
      data: form.images.map((img, i) => ({
        productId: product.id,
        url: img.url,
        alt: img.alt,
        sortOrder: i,
        optionValueId: img.color ? (valueIds.get(`Warna|${img.color}`) ?? null) : null,
      })),
    });
  }

  // SKU (yang berganti kode dipindah dulu ke kode sementara supaya bisa bertukar kode tanpa bentrok)
  const existing = new Map((before?.variants ?? []).map((v) => [v.id, v]));
  for (const v of form.variants) {
    const old = v.id ? existing.get(v.id) : undefined;
    if (old && old.sku !== v.sku) await tx.productVariant.update({ where: { id: old.id }, data: { sku: `TMP-${old.id}-${Date.now()}` } });
  }
  const kept = new Set<number>();
  for (const [i, v] of form.variants.entries()) {
    const name = form.mode === 'NONE' ? null : form.mode === 'VARIAN' ? v.values.Varian! : `${v.values.Warna}, ${v.values.Ukuran}`;
    const fields = {
      sku: v.sku,
      name,
      price: v.price,
      priceOriginal: v.priceOriginal,
      isActive: v.isActive,
      trackStock: v.trackStock,
      lowStockThreshold: v.lowStockThreshold,
      imageIndex: v.imageIndex,
      sortOrder: i,
    };
    const old = v.id ? existing.get(v.id) : undefined;
    const variant = old
      ? await tx.productVariant.update({ where: { id: old.id }, data: fields })
      : await tx.productVariant.create({ data: { ...fields, productId: product.id } });
    kept.add(variant.id);
    const links = axes.map((axis) => valueIds.get(`${axis}|${v.values[axis as keyof typeof v.values]}`)).filter((id): id is number => Boolean(id));
    await tx.variantOptionValue.deleteMany({ where: { variantId: variant.id } });
    if (links.length) await tx.variantOptionValue.createMany({ data: links.map((optionValueId) => ({ variantId: variant.id, optionValueId })) });
  }
  // SKU yang dihapus dari form: punya riwayat → nonaktif; belum pernah dipakai → dihapus.
  for (const old of existing.values()) {
    if (kept.has(old.id)) continue;
    const used = old._count.movements + old._count.orderItems + old._count.cartItems > 0;
    if (used) await tx.productVariant.update({ where: { id: old.id }, data: { isActive: false, sortOrder: 1000 + old.sortOrder } });
    else await tx.productVariant.delete({ where: { id: old.id } });
  }

  // Data video
  if (form.video) {
    const video = { ...form.video, accessPoints: form.video.accessPoints.length ? form.video.accessPoints : Prisma.DbNull };
    await tx.productVideo.upsert({ where: { productId: product.id }, create: { productId: product.id, ...video }, update: video });
  } else {
    await tx.productVideo.deleteMany({ where: { productId: product.id } });
  }
  return product;
}

/** Status tampilan (termasuk "Terjadwal" untuk tayang di masa depan). */
export function displayStatus(p: { status: string; publishedAt: Date | null }, now = new Date()) {
  if (p.status === 'PUBLISHED') return p.publishedAt && p.publishedAt > now ? { label: 'Terjadwal', tone: 'info' } : { label: 'Tayang', tone: 'success' };
  if (p.status === 'DRAFT') return { label: 'Draft', tone: '' };
  return { label: 'Arsip', tone: 'warning' };
}
