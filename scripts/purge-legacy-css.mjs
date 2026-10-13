/**
 * Bangun ulang CSS chrome kompas.com (footer, popup login kgOneTap, base) dari repo prototipe.
 *
 * CSS lama yang dimuat prototipe ±5 MB per platform. Skrip ini menyaring hanya selector yang
 * dipakai template (views/**) dan store-v2.js, lalu menyalin gambar yang dirujuk CSS tersebut.
 *
 * Pakai:  node scripts/purge-legacy-css.mjs ../dummy-kompascom-product
 * Hasil:  public/vendor/kompas/legacy-{desktop,mobile}.css + public/vendor/kompas/{desktop,mobile}/images/…
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PurgeCSS } from 'purgecss';

const proto = resolve(process.argv[2] ?? '../dummy-kompascom-product');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/vendor/kompas');

// Urutan sama dengan <head> prototipe supaya cascade tidak berubah.
const SOURCES = {
  desktop: ['kcm-d-foundation.css', 'kcm-d-iconpack.css', 'kcm2017-article.css', 'kcm2019-photo-article.css', 'style-store.css'],
  mobile: ['kcm-m-foundation.css', 'kcm-m-iconpack.css', 'style-above-fold.css', 'style-kanal.css', 'style-store.css'],
};
// Popup login kgOneTap: desktop memuatnya dari dummy-kgmedia, mobile punya salinan lokal yang sama.
const KGM_VERIFY = join(proto, 'build/mobile/asset/css/kgm-verify.css');

const content = [join(root, 'views/**/*.hbs'), join(root, 'public/js/store-v2.js')];

const safelist = {
  standard: ['html', 'body', /^is-/, /^has-/, 'active', 'show', 'open', 'hidden'],
  greedy: [/kgm/, /sso__/],
};

let copied = 0;
const missing = new Set();

/** Ubah url(...) relatif ke path publik dan salin file gambarnya. */
function rewriteUrls(css, cssDir, platform) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, raw) => {
    const url = raw.trim();
    if (/^(data:|https?:|\/\/|#|%23)/.test(url)) return match;
    const clean = url.split(/[?#]/)[0];
    const abs = resolve(cssDir, clean);
    const assetRoot = join(proto, 'build', platform, 'asset');
    if (!abs.startsWith(assetRoot)) {
      missing.add(url);
      return match;
    }
    const rel = abs.slice(assetRoot.length + 1).split('\\').join('/');
    const target = join(outDir, platform, rel);
    if (existsSync(abs)) {
      if (!existsSync(target)) {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(abs, target);
        copied++;
      }
    } else {
      missing.add(rel);
    }
    return `url("/vendor/kompas/${posix.join(platform, rel)}")`;
  });
}

for (const [platform, files] of Object.entries(SOURCES)) {
  const cssDir = join(proto, 'build', platform, 'asset/css');
  const raw = [...files.map((f) => join(cssDir, f)), KGM_VERIFY].map((file) => {
    let css = readFileSync(file, 'utf8');
    // @import (font Google) tidak valid di tengah file gabungan; font dimuat di layout.
    css = css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/g, '');
    css = rewriteUrls(css, dirname(file), platform);
    return `/* ${file.split('/').pop()} */\n${css}`;
  });

  const [result] = await new PurgeCSS().purge({
    content,
    css: [{ raw: raw.join('\n') }],
    safelist,
    fontFace: true,
    keyframes: true,
    variables: false,
  });
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `legacy-${platform}.css`);
  const header = `/* Dihasilkan oleh scripts/purge-legacy-css.mjs dari CSS kompas.com prototipe. Jangan edit manual. */\n`;
  writeFileSync(out, header + result.css);
  const before = raw.reduce((n, s) => n + s.length, 0);
  console.log(`${platform}: ${(before / 1024).toFixed(0)} KB → ${(result.css.length / 1024).toFixed(0)} KB (${out})`);
}

console.log(`Gambar disalin: ${copied}`);
if (missing.size) console.warn('URL tidak ditemukan:', [...missing].slice(0, 20));
