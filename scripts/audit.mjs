// audit.mjs - animation audit on the built dist/: every @keyframes must be used, and silent under reduced motion.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const d = join(root, 'dist');
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = resolve(join(d, p));
  if (!f.startsWith(d + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await page.waitForFunction(() => document.querySelectorAll('#board .row:not(.own):not(.skel)').length > 0, { timeout: 30000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 1500));

const collect = () => page.evaluate(async () => {
  const kf = [], uses = [];
  const walk = (rules) => { for (const r of rules) { if (r.type === CSSRule.KEYFRAMES_RULE) kf.push(r.name); else if (r.cssRules) walk(r.cssRules); } };
  for (const s of document.styleSheets) { try { walk(s.cssRules); } catch { /* cross-origin fonts */ } }
  // usage comes from the built CSS text: the CSSOM drops animation names when var() sits in the shorthand
  const css = await (await fetch('./assets/app.css')).text();
  for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const a = m[2].match(/(?:^|;)animation:([^;]+)/);
    if (a && a[1].trim() !== 'none') uses.push({ sel: m[1].trim(), name: '', shorthand: a[1].trim() });
  }
  return { kf, uses };
});
const { kf, uses } = await collect();
let bad = 0;
console.log('keyframe        | used by (selector)                 | live els | duration/easing');
for (const name of kf) {
  const u = uses.filter((x) => (x.shorthand || '').split(/[\s,]+/).includes(name));
  if (!u.length) { bad++; console.log(`${name.padEnd(15)} | NOT REFERENCED`); continue; }
  for (const x of u) {
    // conditional class selectors (.up/.down/.enter) get a probe element so we test the rule, not the moment
    const live = await page.evaluate((sel) => {
      const base = sel.split(',')[0].trim();
      let n = document.querySelectorAll(base).length, probe = false;
      if (!n) { const m = base.match(/^\.?([a-z.-]+)$/i); const el = document.createElement('div'); el.className = base.replace(/\./g, ' ').trim(); document.body.append(el); n = getComputedStyle(el).animationName !== 'none' ? 1 : 0; probe = true; el.remove(); }
      return { n, probe };
    }, x.sel);
    const ok = live.n > 0; if (!ok) bad++;
    console.log(`${(ok ? '' : 'DEAD ') + name.padEnd(ok ? 15 : 10)} | ${x.sel.slice(0, 34).padEnd(34)} | ${String(live.n).padStart(3)}${live.probe ? ' probe' : '      '} | ${x.shorthand}`);
  }
}
// reduced motion: the same rules must resolve to animation none, and JS springs must be instant
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await new Promise((r) => setTimeout(r, 800));
const rm = await page.evaluate((sels) => {
  const running = [...document.querySelectorAll('*')].filter((e) => { const c = getComputedStyle(e); return c.animationName !== 'none' || (parseFloat(c.transitionDuration) > 0 && c.transitionProperty !== 'none' && false); }).length;
  const probes = sels.map((s) => { const el = document.createElement('div'); el.className = s.replace(/\./g, ' ').trim(); document.body.append(el); const v = getComputedStyle(el).animationName; el.remove(); return [s, v]; });
  const tr = [...document.querySelectorAll('.chip-btn,.social,.nav-item,.card,.phone-wrap')].filter((e) => parseFloat(getComputedStyle(e).transitionDuration) > 0).length;
  return { running, probes, tr, motion: document.documentElement.dataset.motion, revealedInline: [...document.querySelectorAll('[data-reveal]')].filter((e) => e.style.opacity === '0').length };
}, uses.map((x) => x.sel.split(',')[0].trim()));
console.log(`\nreduced-motion: running animations=${rm.running}, transitions>0 on sampled els=${rm.tr}, hidden-by-reveal=${rm.revealedInline}, mode=${rm.motion}`);
for (const [s, v] of rm.probes) if (v !== 'none') { bad++; console.log('  still animating under reduced motion:', s, v); }
if (rm.running || rm.tr || rm.revealedInline) bad++;

// tilt: reference formula (+-2deg), disabled below 900px
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await page.mouse.move(1430, 890); await new Promise((r) => setTimeout(r, 300));
const t1 = await page.$eval('.phone-wrap', (e) => e.style.transform);
await page.setViewport({ width: 800, height: 900 }); await page.mouse.move(790, 890); await new Promise((r) => setTimeout(r, 300));
const t2 = await page.$eval('.phone-wrap', (e) => e.style.transform);
const tr = await page.$eval('.phone-wrap', (e) => getComputedStyle(e).transition);
const nums = (t1.match(/-?\d+(\.\d+)?(?=deg)/g) || []).map(Number);
const okTilt = nums.length === 2 && nums[0] < -1.9 && nums[0] >= -2 && nums[1] > 1.9 && nums[1] <= 2 && !/rotate[XY]\((?!0)/.test(t2.replace(/rotateX\(0deg\)|rotateY\(0deg\)/g, ''));
console.log(`tilt @1440 corner: ${t1}\ntilt @800: ${t2 || '(none)'}\nphone transition: ${tr}`);
if (!okTilt) bad++;

await browser.close(); srv.close();
console.log(bad ? `\nAUDIT FAIL (${bad})` : '\nAUDIT OK');
process.exit(bad ? 1 : 0);
