/**
 * Build untuk Vercel (Build Output API v3) → .vercel/output
 *   static/                 isi public/ + CSS hasil sass, dilayani CDN Vercel
 *   functions/index.func/   satu fungsi Node berisi bundel Express + views/ (template Handlebars & email)
 *   config.json             file statis dulu, sisanya ke fungsi
 * Di deploy Production: `prisma migrate deploy`, lalu seed kalau database masih kosong.
 *
 * Pakai: npm run vercel-build   (otomatis dijalankan Vercel lewat vercel.json)
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel/output');
const funcDir = join(out, 'functions/index.func');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

// 1. CSS store (public/css di-gitignore, jadi dibangun di sini)
run('npm run css');

// 2. Database: hanya untuk deploy Production supaya Preview tidak mengubah skema
if (process.env.VERCEL_ENV === 'production') {
  run('npx prisma migrate deploy');
  run('npx tsx scripts/seed-if-empty.ts');
}

// 3. Susun .vercel/output
rmSync(out, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });
cpSync(join(root, 'public'), join(out, 'static'), { recursive: true });
cpSync(join(root, 'views'), join(funcDir, 'views'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/vercel-handler.ts')],
  outfile: join(funcDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'warning',
  // paket CommonJS di dalam bundel ESM butuh require/__dirname
  banner: {
    js: [
      "import { createRequire as __vcRequire } from 'node:module';",
      "import { fileURLToPath as __vcPath } from 'node:url';",
      "import { dirname as __vcDir } from 'node:path';",
      'const require = __vcRequire(import.meta.url);',
      'const __filename = __vcPath(import.meta.url);',
      'const __dirname = __vcDir(__filename);',
    ].join('\n'),
  },
});

writeFileSync(
  join(funcDir, '.vc-config.json'),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // Singapura: paling dekat ke pembeli di Indonesia (taruh database di region yang sama)
      regions: ['sin1'],
      maxDuration: 30,
    },
    null,
    2,
  ),
);

writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        // file statis dilayani CDN tanpa lewat Express → header keamanan dasar dipasang di sini
        {
          src: '/(.*)',
          headers: {
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
          },
          continue: true,
        },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index' },
      ],
    },
    null,
    2,
  ),
);

console.log('Build Vercel selesai → .vercel/output');
