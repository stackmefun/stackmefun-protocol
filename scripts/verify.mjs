// verify.mjs - builds BOTH register branches, drives them in headless Edge, measures 5 breakpoints.
// Every mutation anchor reads the live record from window.__STACKME__ at runtime (state-independent).
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.STACKME_SHOTS || join(root, '.verify-shots');
mkdirSync(shots, { recursive: true });
const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const TEST_CA = 'So11111111111111111111111111111111111111112';
const TEST_X = 'https://x.com/stackme_test';
const TEST_GH = 'https://github.com/stackme-test/stackme';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

let pass = 0, failed = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`); };

function build(out, env) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], { env: { ...process.env, STACKME_OUT: out, ...env }, encoding: 'utf8' });
  process.stdout.write(r.stdout);
  check(`build exit 0 (${out})`, r.status === 0, r.stderr.trim());
  return r.status === 0;
}
function serve(dir) {
  const d = resolve(root, dir);
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
      const f = resolve(join(d, p));
      if (!f.startsWith(d + sep) || !existsSync(f) || !statSync(f).isFile()) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' }); createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => ok({ s, url: `http://127.0.0.1:${s.address().port}/` }));
  });
}

const BPS = [[360, 800], [390, 844], [430, 932], [1366, 768], [1440, 900]];

async function runBranch(browser, label, dir) {
  console.log(`\n=== branch: ${label} ===`);
  const { s, url } = await serve(dir);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', { timeout: 10000 });
  // wait for live market (or give the failure path its due)
  await page.waitForFunction(() => document.querySelectorAll('#board .row:not(.own):not(.skel):not(.dash)').length > 0 || document.querySelector('#board .row.dash'), { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => { const R = window.__STACKME__.register; return R.ca.state !== 'stated' || document.querySelector('#board .row.own[data-filled="data"] .price')?.dataset.v !== undefined; }, { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));

  const reg = await page.evaluate(() => window.__STACKME__.register); // runtime read, never hard-coded
  console.log(`runtime register: ca=${reg.ca.state} x=${reg.x.state} github=${reg.github.state} market=${reg.marketSource.state}`);

  // --- gate anchors: data-state must equal the record read at runtime
  const anchors = await page.evaluate(() => {
    const R = window.__STACKME__.register;
    const map = { 'ca-slot': R.ca.state, 'own-row': R.ca.state, verify: R.ca.state, 'ca-slot-trade': R.ca.state, 'social-x': R.x.state, 'social-github': R.github.state };
    return Object.entries(map).map(([g, want]) => {
      const els = [...document.querySelectorAll(`[data-gate="${g}"]`)];
      return { g, want, n: els.length, bad: els.filter((e) => e.dataset.state !== want).length };
    });
  });
  for (const a of anchors) check(`gate ${a.g} anchored to record (${a.want})`, a.n > 0 && a.bad === 0, `${a.n} anchor(s)`);

  // --- link rule
  const links = await page.evaluate(() => {
    const R = window.__STACKME__.register;
    return ['x', 'github'].map((k) => {
      const el = document.querySelector(`[data-gate="social-${k}"]`);
      return { k, state: R[k].state, tag: el.tagName, href: el.getAttribute('href'), url: R[k].url, svg: !!el.querySelector('svg'), text: el.textContent.trim() };
    });
  });
  for (const l of links) {
    check(`social ${l.k}: icon only, no text label`, l.svg && l.text === '');
    check(`social ${l.k}: link rule`, l.state === 'stated' ? l.tag === 'A' && l.href === l.url : l.tag === 'SPAN' && l.href === null, `${l.state} ${l.tag} ${l.href}`);
  }

  // --- CA slot
  const ca = await page.evaluate(() => {
    const R = window.__STACKME__.register; const el = document.querySelector('#ca-slot .ca');
    const t = el.querySelector('.ca-text'); const r = el.getBoundingClientRect(); const fs = parseFloat(getComputedStyle(t).fontSize);
    return { state: R.ca.state, value: R.ca.value, tag: el.tagName, text: t.textContent, top: r.top, fs, clipped: t.scrollWidth > t.clientWidth + 1 };
  });
  check('CA slot at top of page, large font', ca.top < 200 && ca.fs >= 14, `top=${ca.top | 0} font=${ca.fs}px`);
  if (ca.state === 'stated') {
    check('CA shows full address', ca.text === ca.value && !ca.clipped);
    await page.evaluate(() => document.querySelector('#ca-slot .ca').click());
    await new Promise((r) => setTimeout(r, 250));
    const fb = await page.evaluate(() => ({ cls: document.querySelector('#ca-slot .ca').classList.contains('copied'), txt: document.querySelector('#ca-slot .ca-copy').textContent }));
    check('CA click gives copy feedback', fb.cls && /COPIED|CTRL/.test(fb.txt), fb.txt);
  } else {
    check('CA slot inert until stated', ca.tag === 'DIV', `${ca.tag} "${ca.text}"`);
  }

  // --- own row #1
  const own = await page.evaluate(() => {
    const R = window.__STACKME__.register; const li = document.querySelector('#board .row.own');
    const first = document.querySelector('#board').firstElementChild === li;
    const cs = getComputedStyle(li);
    const img = li.querySelector('img');
    return { state: R.ca.state, ca: R.ca.value, first, border: cs.borderLeftWidth + ' ' + cs.borderLeftStyle, anim: cs.animationName, addr: li.dataset.addr || '', clickable: !!li.querySelector('a'), brandImg: img ? img.getAttribute('src') : null, dots: !!li.querySelector('.dots'), sym: li.querySelector('.sym')?.textContent, price: li.querySelector('.price')?.textContent, logoLoaded: img ? img.complete && img.naturalWidth > 0 : !!li.querySelector('.tile') };
  });
  check('own row is #1, 2px left accent, ownPulse animation', own.first && own.border === '2px solid' && own.anim === 'ownPulse', `${own.border} ${own.anim}`);
  if (own.state === 'stated') {
    check('own row bound to CA, clickable', own.addr === own.ca && own.clickable);
    console.log(`   own row data: ${own.sym} price=${own.price} logoLoaded=${own.logoLoaded}`);
    const dup = await page.evaluate((c) => document.querySelectorAll(`#board .row[data-addr="${c}"]`).length, own.ca);
    check('dedup: CA appears exactly once', dup === 1, `count=${dup}`);
  } else {
    check('own row placeholder: brand logo (not letter tile), dots, non-clickable', /logo-192\.png$/.test(own.brandImg || '') && own.logoLoaded && own.dots && !own.clickable, `${own.brandImg}`);
  }

  // --- market independent of CA state
  const mk = await page.evaluate(() => ({ rows: document.querySelectorAll('#board .row:not(.own):not(.skel):not(.dash)').length, dash: document.querySelectorAll('#board .row.dash').length, tick: document.querySelectorAll('#ticker-track .t-item:not(.skeleton-t)').length, status: document.querySelector('.market-pill').dataset.status, skeletons: document.querySelectorAll('#board .row.skel').length }));
  console.log(`   market: rows=${mk.rows} ticker=${mk.tick} status=${mk.status} dashRows=${mk.dash}`);
  check('market board rendered from market-source only', mk.rows >= 1 || mk.dash > 0, `status=${mk.status}`);
  check('skeletons cleared after first load', mk.skeletons === 0);

  // --- address gate (verify tool): both branches, never blanket reject 0x
  await page.click('#t-stack');
  await new Promise((r) => setTimeout(r, 400));
  const probe = async (v) => { await page.$eval('#verify-input', (i) => { i.value = ''; }); await page.type('#verify-input', v, { delay: 0 }); return page.$eval('#verify-out', (o) => o.dataset.v); };
  const hex = '0x' + 'ab12'.repeat(10);
  const vHex = await probe(hex), vGar = await probe('hello'), vCa = await probe(TEST_CA), vOther = await probe('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
  if (reg.ca.state === 'stated') {
    check('gate: stated CA matches', vCa === 'match', vCa);
    check('gate: other base58 mismatches', vOther === 'mismatch', vOther);
    check('gate: 0x hex judged against registry (not blanket reject)', vHex === 'mismatch', vHex);
  } else {
    check('gate: no registry -> unverifiable (CA not treated as matching)', vCa === 'no-registry', vCa);
    check('gate: 0x hex gets registry verdict, not blanket reject', vHex === 'no-registry', vHex);
  }
  check('gate: non-address string flagged not-address', vGar === 'not-address', vGar);
  const scan = await page.evaluate(() => document.documentElement.dataset.scanFlagged);
  check('address scanner ran, CA slot exempt (no flags on clean page)', scan === '0', 'flagged=' + scan);

  // --- no dates / timestamps / clocks anywhere in visible or hidden text
  const dates = await page.evaluate(() => {
    const t = document.documentElement.textContent;
    const re = /\b(19|20)\d{2}\b|\b\d{1,2}:\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b|\bas of\b|\bchecked\b|\b\d+\s?(sec|min|hour|day)s? ago\b|\bupdated\b/i;
    const m = t.match(re); return m ? m[0] : null;
  });
  check('no dates, timestamps, as-of or clock strings', dates === null, String(dates));

  // --- breakpoints
  for (const [w, h] of BPS) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
    await new Promise((r) => setTimeout(r, 2500));
    const m = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: r.width, h: r.height }; };
      const soc = ['x', 'github'].map((k) => rect(`[data-gate="social-${k}"]`));
      const caEl = document.querySelector('#ca-slot .ca-text');
      const logos = [...document.querySelectorAll('img[src*="logo-"]')].filter((i) => i.offsetParent !== null);
      const interactive = [...document.querySelectorAll('a[href],button,input,[role="tab"]')].filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('[hidden]') && !e.closest('.ticker'); });
      const small = interactive.filter((e) => { const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map((e) => `${e.tagName.toLowerCase()}.${(e.className || e.id || e.dataset.tab || '').toString().slice(0, 20)} ${e.getBoundingClientRect().width | 0}x${e.getBoundingClientRect().height | 0}`);
      const hdr = document.querySelector('.site-header').getBoundingClientRect(); return { hdrR: hdr.right, vw, overflowX: document.documentElement.scrollWidth - vw, soc, caFs: parseFloat(getComputedStyle(caEl).fontSize), caClip: caEl.scrollWidth > caEl.clientWidth + 1, caVisible: caEl.getBoundingClientRect().right <= vw + 0.5 && caEl.getBoundingClientRect().left >= -0.5, logos: logos.map((i) => i.complete && i.naturalWidth > 0), small, nav: [...document.querySelectorAll('.nav-item')].map((e) => e.getBoundingClientRect().width | 0), phone: rect('.phone-wrap') };
    });
    check(`[${w}] no horizontal overflow`, m.overflowX <= 0, `overflow=${m.overflowX}`);
    check(`[${w}] both social icons present, top-right`, m.soc.every((r) => r && r.w >= 43.5 && r.h >= 43.5 && r.t < 120) && Math.max(...m.soc.map((r) => r.r)) >= m.hdrR - 2, JSON.stringify(m.soc.map((r) => r && [r.l | 0, r.t | 0, r.w | 0, r.h | 0])));
    check(`[${w}] CA fully visible, unclipped`, m.caVisible && !m.caClip, `font=${m.caFs}px`);
    check(`[${w}] logo images render`, m.logos.length > 0 && m.logos.every(Boolean), `${m.logos.length} imgs`);
    check(`[${w}] tap targets >= 44x44`, m.small.length === 0, m.small.slice(0, 6).join('; '));
    if (w <= 430) check(`[${w}] phone fits viewport`, m.phone.w <= m.vw && m.phone.l >= 0, `${m.phone.w | 0}px`);
    if (label.startsWith('absent')) await page.screenshot({ path: join(shots, `${label.split(' ')[0]}-${w}.png`) });
    else await page.screenshot({ path: join(shots, `stated-${w}.png`) });
  }

  // --- reduced motion: zero animation
  await page.setViewport({ width: 1440, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
  await new Promise((r) => setTimeout(r, 800));
  const rm = await page.evaluate(() => {
    const names = [...document.querySelectorAll('*')].map((e) => getComputedStyle(e).animationName).filter((n) => n && n !== 'none');
    return { running: names.length, own: getComputedStyle(document.querySelector('#board .row.own')).animationName, motion: document.documentElement.dataset.motion };
  });
  check('prefers-reduced-motion: no CSS animation anywhere', rm.running === 0 && rm.own === 'none' && rm.motion === 'reduced', `running=${rm.running} own=${rm.own}`);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

  check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  await page.close();
  s.close();
}

// ---- static checks
const css = readFileSync(join(root, 'src/styles/main.css'), 'utf8') + readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
check('no ch units in CSS', !/\d(\.\d+)?ch\b/.test(css));
check('no CLAUDE.md / .claude/ in repo', !existsSync(join(root, 'CLAUDE.md')) && !existsSync(join(root, '.claude')));

const okA = build('dist', {});
const okB = build('.verify-stated', { STACKME_CA: TEST_CA, STACKME_X: TEST_X, STACKME_GITHUB: TEST_GH });
if (okA && okB) {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
  try {
    await runBranch(browser, 'absent (dist/)', 'dist');
    await runBranch(browser, 'stated (test CA, test socials)', '.verify-stated');
  } finally { await browser.close(); }
}
rmSync(join(root, '.verify-stated'), { recursive: true, force: true });
console.log(`\nRESULT: ${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
