// market.js - live market board + ticker.
// The trending feed follows the marketSource register record ONLY. CA state never touches it.
// CA state only decides what sits in pinned row #1 (own token), fetched in its own lane.
import { register, isStated } from './register.js';
import { countTo, reveal, reduced } from './motion.js';

const MS = register.marketSource;
const BRAND_LOGO = './assets/logo-192.png';
const TOP_N = 10;

/* ---------------- formatting ---------------- */
const nf = (o) => new Intl.NumberFormat('en-US', o);
export function fmtPrice(p) {
  if (p == null || Number.isNaN(p)) return '—';
  if (p >= 1000) return '$' + nf({ maximumFractionDigits: 0 }).format(p);
  if (p >= 1) return '$' + nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p);
  if (p >= 0.01) return '$' + nf({ minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(p);
  if (p === 0) return '$0';
  return '$' + p.toPrecision(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}
export const fmtUsd = (n) =>
  n == null || Number.isNaN(n) ? '—' : '$' + nf({ notation: 'compact', maximumFractionDigits: 2 }).format(n);
export const fmtPct = (n) =>
  n == null || Number.isNaN(n) ? '—' : (n > 0 ? '+' : '') + nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + '%';

/* ---------------- fetch with exponential backoff ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function fetchJSON(url, { tries = 3, base = 700, timeout = 9000 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      clearTimeout(to);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      clearTimeout(to);
      err = e;
      if (i < tries - 1) await sleep(base * 2 ** i + Math.random() * 250); // 700, 1400, 2800 + jitter
    }
  }
  throw err;
}

/* ---------------- data shaping ---------------- */
const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

function bestPair(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return null;
  return [...pairs].sort((a, b) => (num(b?.volume?.h24) || 0) - (num(a?.volume?.h24) || 0))[0];
}

function rowFromPair(address, pair, extra = {}) {
  return {
    address,
    symbol: pair?.baseToken?.symbol || extra.symbol || null,
    name: pair?.baseToken?.name || extra.name || null,
    imgs: [extra.pumpImg, httpsUrl(pair?.info?.imageUrl), extra.boostIcon].filter(Boolean),
    price: num(pair?.priceUsd),
    chg: num(pair?.priceChange?.h24),
    vol: num(pair?.volume?.h24),
    liq: num(pair?.liquidity?.usd),
    url: httpsUrl(pair?.url) || `https://dexscreener.com/solana/${address}`,
  };
}

async function loadTrending(prev) {
  const boosts = await fetchJSON(MS.boosts);
  const best = new Map();
  for (const b of Array.isArray(boosts) ? boosts : []) {
    if (b?.chainId !== 'solana' || !b.tokenAddress) continue;
    const cur = best.get(b.tokenAddress);
    if (!cur || (num(b.totalAmount) || 0) > (num(cur.totalAmount) || 0)) best.set(b.tokenAddress, b);
  }
  const top = [...best.values()].sort((a, b) => (num(b.totalAmount) || 0) - (num(a.totalAmount) || 0)).slice(0, TOP_N);
  if (!top.length) throw new Error('no solana boosts');
  const settled = await Promise.allSettled(top.map((b) => fetchJSON(MS.tokens + b.tokenAddress, { tries: 2 })));
  return top.map((b, i) => {
    const boostIcon = httpsUrl(b.icon);
    const r = settled[i];
    const pair = r.status === 'fulfilled' ? bestPair(r.value) : null;
    if (pair) return rowFromPair(b.tokenAddress, pair, { boostIcon });
    const old = prev && prev.find((p) => p.address === b.tokenAddress);
    return old || { address: b.tokenAddress, symbol: null, name: null, imgs: [boostIcon].filter(Boolean), price: null, chg: null, vol: null, liq: null, url: `https://dexscreener.com/solana/${b.tokenAddress}` };
  });
}

/** own token row from whatever parts have arrived (DexScreener pair and/or pump.fun coin) */
function buildOwn(ca, parts) {
  const { pair, pump } = parts;
  if (!pair && !pump) return null;
  const row = rowFromPair(ca, pair, { symbol: pump?.symbol, name: pump?.name, pumpImg: httpsUrl(pump?.image_uri) });
  row.imgs.push(BRAND_LOGO); // pump.fun -> DexScreener -> brand folder -> letter tile
  row.url = httpsUrl(pair?.url) || `https://dexscreener.com/solana/${ca}`;
  return row;
}

/* ---------------- DOM ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const state = { trending: [], ownParts: { pair: null, pump: null }, ownFailed: false, status: 'loading', hadTrending: false, key: '' };

function tile(symbol, className = 'tile') {
  const t = document.createElement('span');
  t.className = className;
  t.textContent = (symbol || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 1).toUpperCase() || '?';
  return t;
}
/** logo with ordered fallbacks, final fallback = letter tile */
function logo(imgs, symbol, cls = 'coin') {
  const box = document.createElement('span');
  box.className = cls;
  const list = imgs.slice();
  const next = () => {
    const src = list.shift();
    if (!src) return box.replaceChildren(tile(symbol));
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onerror = next;
    img.onload = () => box.replaceChildren(img);
    img.src = src;
  };
  box.replaceChildren(tile(symbol));
  next();
  return box;
}

function rowShell(kind) {
  const li = document.createElement('li');
  li.className = 'row ' + kind;
  li.dataset.spot = '';
  return li;
}

function fillRow(li, d, rank) {
  const wrap = d.url ? Object.assign(document.createElement('a'), { href: d.url, target: '_blank', rel: 'noopener noreferrer' }) : document.createElement('div');
  wrap.className = 'row-in';
  const rk = Object.assign(document.createElement('span'), { className: 'rank', textContent: String(rank).padStart(2, '0') });
  const info = document.createElement('span');
  info.className = 'info';
  const sym = Object.assign(document.createElement('strong'), { className: 'sym', textContent: d.symbol || '—' });
  const nm = Object.assign(document.createElement('span'), { className: 'nm', textContent: d.name || '—' });
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.innerHTML = '<i>Vol</i><b class="vol">—</b><i>Liq</i><b class="liq">—</b>';
  info.append(sym, nm, meta);
  const px = document.createElement('span');
  px.className = 'px';
  px.innerHTML = '<b class="price">—</b><b class="chg">—</b>';
  wrap.append(rk, logo(d.imgs || [], d.symbol), info, px);
  li.replaceChildren(wrap);
  li.dataset.addr = d.address || '';
  updateRow(li, d);
}

function updateRow(li, d) {
  const set = (sel, v, f) => countTo($(sel, li), v, f);
  set('.price', d.price, fmtPrice);
  set('.vol', d.vol, fmtUsd);
  set('.liq', d.liq, fmtUsd);
  const chg = $('.chg', li);
  countTo(chg, d.chg, fmtPct, { flash: false });
  chg.classList.toggle('pos', d.chg > 0);
  chg.classList.toggle('neg', d.chg < 0);
}

function ownPlaceholder(li) {
  li.dataset.state = register.ca.state;
  li.dataset.filled = 'placeholder';
  const wrap = document.createElement('div');
  wrap.className = 'row-in';
  wrap.setAttribute('aria-disabled', 'true');
  const info = document.createElement('span');
  info.className = 'info';
  info.innerHTML = '<strong class="sym">StackMe</strong><span class="nm">Own token</span><span class="meta"><i>Vol</i><b>·····</b><i>Liq</i><b>·····</b></span>';
  const px = document.createElement('span');
  px.className = 'px';
  px.innerHTML = '<b class="price dots">· · · · ·</b><b class="chg dots">· · · · ·</b>';
  const img = new Image();
  img.src = BRAND_LOGO; // brand logo from the brand folder, never a letter tile
  img.alt = 'StackMe logo';
  img.className = 'brand-coin';
  img.width = 40;
  img.height = 40;
  wrap.append(Object.assign(document.createElement('span'), { className: 'rank', textContent: '01' }), img, info, px);
  li.replaceChildren(wrap);
}

function drawBoard() {
  const list = $('#board');
  if (!list) return;
  const caStated = isStated(register.ca);
  const own = caStated ? buildOwn(register.ca.value, state.ownParts) : null;
  const trending = state.trending.filter((t) => !(caStated && t.address === register.ca.value)).slice(0, TOP_N);

  // row #1
  let first = $('.row.own', list);
  if (!first) {
    first = rowShell('own');
    first.dataset.gate = 'own-row';
    list.prepend(first);
  }
  if (!caStated) {
    if (first.dataset.filled !== 'placeholder') ownPlaceholder(first);
  } else if (own) {
    first.dataset.state = 'stated';
    const sig = own.imgs.join('|');
    if (first.dataset.filled !== 'data' || first.dataset.imgs !== sig) {
      fillRow(first, own, 1);
      first.dataset.filled = 'data';
      first.dataset.imgs = sig;
    } else updateRow(first, own);
  } else {
    first.dataset.state = register.ca.state; // stated, waiting for data
    if (first.dataset.filled !== 'wait') {
      fillRow(first, { address: register.ca.value, symbol: 'StackMe', name: 'Own token', imgs: [BRAND_LOGO], url: null }, 1);
      $('.row-in', first).removeAttribute('href');
      first.dataset.filled = 'wait';
    }
  }

  // trending rows 2..
  const key = trending.map((t) => t.address).join(',');
  const firstReal = !state.hadTrending && trending.length;
  if (key !== state.key) {
    state.key = key;
    $$('.row:not(.own)', list).forEach((n) => n.remove());
    trending.forEach((t, i) => {
      const li = rowShell('trend');
      li.style.setProperty('--i', i);
      fillRow(li, t, i + 2);
      li.classList.add('enter');
      list.append(li);
    });
  } else {
    trending.forEach((t, i) => updateRow($$('.row:not(.own)', list)[i], t));
  }
  if (firstReal) state.hadTrending = true;
  if (!trending.length && !state.hadTrending) drawFallback(list);
  drawMarquee(caStated ? own : null, trending);
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function drawFallback(list) {
  // source down and nothing ever loaded: dash rows + error
  if ($('.row.dash', list) || state.status !== 'error') return;
  $$('.row:not(.own)', list).forEach((n) => n.remove());
  for (let i = 0; i < 4; i++) {
    const li = rowShell('dash');
    fillRow(li, { address: '', symbol: null, name: null, imgs: [], url: null }, i + 2);
    list.append(li);
  }
}

function drawMarquee(own, trending) {
  const track = $('#ticker-track');
  if (!track) return;
  const items = [...(own ? [own] : []), ...trending];
  const key = items.map((i) => i.address).join(',');
  if (!items.length) return;
  if (track.dataset.key === key) {
    items.forEach((d) => $$(`[data-t="${d.address}"]`, track).forEach((el) => {
      $('.t-px', el).textContent = fmtPrice(d.price);
      const c = $('.t-chg', el);
      c.textContent = fmtPct(d.chg);
      c.className = 't-chg ' + (d.chg > 0 ? 'pos' : d.chg < 0 ? 'neg' : '');
    }));
    return;
  }
  track.dataset.key = key;
  const make = (d, hidden) => {
    const el = document.createElement('span');
    el.className = 't-item' + (d === own ? ' own' : '');
    el.dataset.t = d.address;
    if (hidden) el.setAttribute('aria-hidden', 'true');
    el.append(logo(d.imgs || [], d.symbol, 't-coin'));
    el.append(Object.assign(document.createElement('b'), { className: 't-sym', textContent: d.symbol || '—' }));
    el.append(Object.assign(document.createElement('span'), { className: 't-px', textContent: fmtPrice(d.price) }));
    el.append(Object.assign(document.createElement('span'), { className: 't-chg ' + (d.chg > 0 ? 'pos' : d.chg < 0 ? 'neg' : ''), textContent: fmtPct(d.chg) }));
    return el;
  };
  const a = document.createElement('div');
  a.className = 't-run';
  items.forEach((d) => a.append(make(d, false)));
  const b = a.cloneNode(false);
  items.forEach((d) => b.append(make(d, true)));
  track.replaceChildren(a, b);
  track.closest('.ticker')?.classList.add('ready');
}

function setStatus(s) {
  state.status = s;
  $$('.market-pill').forEach((pill) => {
    pill.dataset.status = s;
    $('.pill-text', pill).textContent = { loading: 'Syncing', live: 'Live', retry: 'Retrying', error: 'Offline' }[s];
  });
  const err = $('#board-error');
  if (err) err.hidden = !(s === 'error' || s === 'retry');
  if (err) err.textContent = s === 'error' && !state.hadTrending ? 'Market feed unreachable. Retrying with backoff.' : 'Feed hiccup. Showing the last good snapshot.';
  const board = $('#board');
  if (board) board.setAttribute('aria-busy', String(s === 'loading'));
}

/* ---------------- polling ---------------- */
let inflight = false;
async function tick() {
  if (inflight) return;
  inflight = true;
  const jobs = [];
  jobs.push(
    loadTrending(state.trending)
      .then((rows) => {
        state.trending = rows;
        state.trendOk = true;
      })
      .catch(() => {
        state.trendOk = false;
      })
      .then(() => {
        setStatus(state.trendOk ? 'live' : state.trending.length ? 'retry' : 'error');
        drawBoard();
      }),
  );
  if (isStated(register.ca)) {
    const ca = register.ca.value;
    // DexScreener and pump.fun are separate lanes; neither waits on the other. Failure keeps the last good part.
    const lane = (url, key, pick) =>
      fetchJSON(url + ca, { tries: 2 })
        .then((v) => { const got = pick(v); if (got) state.ownParts[key] = got; })
        .catch(() => {})
        .then(drawBoard);
    jobs.push(lane(MS.ownDex, 'pair', (v) => bestPair(v?.pairs)), lane(MS.ownPump, 'pump', (v) => (v && typeof v === 'object' ? v : null)));
  }
  // draw as each lane settles; do not hold one for the other
  await Promise.all(jobs);
  setStatus(state.trendOk ? 'live' : state.trending.length ? 'retry' : 'error');
  drawBoard();
  inflight = false;
}

export function startMarket() {
  const list = $('#board');
  // skeleton rows until the first real data lands
  for (let i = 0; i < 5; i++) {
    const li = rowShell('skel');
    li.innerHTML = '<div class="row-in"><span class="rank skeleton"></span><span class="coin skeleton"></span><span class="info"><i class="skeleton w60"></i><i class="skeleton w40"></i></span><span class="px"><i class="skeleton w50"></i><i class="skeleton w30"></i></span></div>';
    list.append(li);
  }
  drawBoard();
  setStatus('loading');
  const clear = () => $$('.row.skel', list).forEach((n) => n.remove());
  const origDraw = drawBoard;
  const first = tick().then(() => { clear(); origDraw(); });
  let timer = 0;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!document.hidden) await tick();
      schedule();
    }, MS.pollMs);
  };
  first.then(schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer); // pause while the tab is hidden
    else tick().then(schedule); // fetch immediately on visible
  });
  return first;
}
export { reduced };
