// build.mjs - bundles src/ into dist/ (override with STACKME_OUT). Exit 1 on any broken reference.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.env.STACKME_OUT || 'dist');
if (!out.startsWith(root) && !process.env.STACKME_OUT_ABS) throw new Error('output must stay inside the project folder');
const fail = (m) => { console.error('BUILD FAIL: ' + m); process.exit(1); };

// ---- register overrides (used to prove the stated branch; default build leaves everything absent)
const ov = {};
if (process.env.STACKME_CA) ov.ca = { state: 'stated', value: process.env.STACKME_CA };
if (process.env.STACKME_X) ov.x = { state: 'stated', url: process.env.STACKME_X };
if (process.env.STACKME_GITHUB) ov.github = { state: 'stated', url: process.env.STACKME_GITHUB };

// ---- guard: palette rule - colour literals live in tokens.css only
function walk(d) { return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const lit = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/;
for (const f of walk(join(root, 'src'))) {
  if (!/\.(css|js|html)$/.test(f) || f.endsWith('tokens.css')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (f.endsWith('index.html') && /theme-color/.test(l)) return; // meta tag mirrors --brand-outline
    if (lit.test(l.replace(/url\("data:[^"]*"\)/g, '').replace(/&#\d+;/g, ''))) fail(`colour literal outside tokens.css: ${relative(root, f)}:${i + 1}`);
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'assets'), { recursive: true });

await build({
  entryPoints: { app: join(root, 'src/js/main.js') },
  outdir: join(out, 'assets'), bundle: true, minify: true, format: 'esm', target: 'es2020',
  define: { __REGISTER_OVERRIDES__: JSON.stringify(ov) }, logLevel: 'warning',
});
await build({ entryPoints: { app: join(root, 'src/styles/main.css') }, outdir: join(out, 'assets'), bundle: true, minify: true, logLevel: 'warning' });

cpSync(join(root, 'src/index.html'), join(out, 'index.html'));
// logo + art are copied explicitly, by name
for (const f of ['logo-512.png', 'logo-192.png', 'banner.jpg', 'bg.jpg']) {
  const src = join(root, 'src/assets', f);
  if (!existsSync(src)) fail('missing asset ' + f);
  cpSync(src, join(out, 'assets', f));
}
cpSync(join(root, 'src/assets/favicon.svg'), join(out, 'favicon.svg'));
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(root, 'docs/whitepaper.md'), join(out, 'docs/whitepaper.md'));

// ---- verify: every local reference in dist/index.html resolves, and the logo is wired
const html = readFileSync(join(out, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]).filter((r) => r !== './');
for (const r of refs) if (!existsSync(join(out, r))) fail('index.html references missing file ' + r);
for (const need of ['./assets/logo-512.png', './assets/logo-192.png', './assets/bg.jpg', './favicon.svg', './assets/app.js', './assets/app.css'])
  if (!refs.includes(need)) fail('index.html does not reference ' + need);
const sz = statSync(join(out, 'assets/logo-512.png')).size;
if (sz < 1000) fail('logo-512.png too small');
console.log(`build ok -> ${relative(root, out) || '.'}  (${refs.length} local refs resolved, logo-512.png ${sz} bytes, register overrides: ${Object.keys(ov).join(',') || 'none'})`);
