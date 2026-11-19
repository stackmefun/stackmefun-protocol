import { register, isStated } from './register.js';
import { applyGates, renderSocials, scanAddresses, verifyAddress } from './gates.js';
import { startMarket } from './market.js';
import { parallax, progressBar, reveal, spotlight, reduced } from './motion.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// read-only snapshot so tests can read the live record at runtime
window.__STACKME__ = { get register() { return structuredClone(register); } };

/* ---------- copy to clipboard with feedback ---------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}
function wireCopy(el, label) {
  el.addEventListener('click', async () => {
    if (el.classList.contains('copied')) return;
    const ok = await copyText(register.ca.value);
    const tag = $('.ca-copy', el);
    el.classList.add('copied');
    tag.textContent = ok ? 'COPIED' : 'PRESS CTRL+C';
    announce(ok ? 'Token address copied' : 'Copy failed');
    setTimeout(() => {
      el.classList.remove('copied');
      tag.textContent = 'COPY';
    }, 1800);
  });
  el.setAttribute('aria-label', label);
}
function announce(msg) {
  const live = $('#sr-live') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'sr-live' }));
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  live.textContent = msg;
}

/* ---------- CA slots (top bar + stack tab) ---------- */
function caNode(variant) {
  const stated = isStated(register.ca);
  const el = document.createElement(stated ? 'button' : 'div');
  if (stated) el.type = 'button';
  el.className = variant === 'top' ? 'ca' : 'ca-mini';
  el.dataset.gate = 'ca-slot';
  el.dataset.state = register.ca.state;
  const text = stated ? register.ca.value : register.ca.state === 'unconfirmed' ? 'Address unconfirmed' : 'Address not stated yet';
  el.innerHTML = `<span><span class="ca-label">TOKEN ADDRESS</span><span class="ca-text" ${variant === 'top' ? '' : ''}></span></span><span class="ca-copy">${stated ? 'COPY' : 'SOON'}</span>`;
  const t = $('.ca-text', el);
  t.textContent = text;
  if (variant !== 'top') {
    el.innerHTML = `<div><span class="eyebrow">TOKEN ADDRESS</span><strong></strong></div><span class="ca-copy">${stated ? 'COPY' : 'SOON'}</span>`;
    $('strong', el).textContent = text;
  }
  el.setAttribute('data-gate-exempt', ''); // CA is exempt from the address scanner
  if (stated) wireCopy(el, 'Copy token address');
  else {
    el.setAttribute('aria-disabled', 'true');
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', 'Token address not available yet');
  }
  return el;
}

function renderCA() {
  $('#ca-slot').replaceChildren(caNode('top'));
  $('#stack-ca').replaceChildren(caNode('mini'));
  const slot = $('#trade-slot');
  slot.replaceChildren();
  slot.dataset.gate = 'ca-slot-trade';
  if (isStated(register.ca)) {
    const a = document.createElement('a');
    a.className = 'trade-btn';
    a.href = `https://jup.ag/swap/SOL-${register.ca.value}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'Swap on Jupiter';
    slot.append(a);
  } else {
    const s = document.createElement('span');
    s.className = 'trade-btn';
    s.setAttribute('aria-disabled', 'true');
    s.textContent = 'Opens when the address lands';
    slot.append(s);
  }
}

/* ---------- tabs ---------- */
function setupTabs() {
  const tabs = $$('[role="tab"]');
  const scroller = $('#screen');
  const go = (name, focus) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('.panel').forEach((p) => {
      const on = p.id === 'p-' + name;
      if (on && p.hidden) {
        p.hidden = false;
        p.style.animation = 'none';
        void p.offsetWidth;
        p.style.animation = '';
        scroller.scrollTop = 0;
        reveal(p, scroller);
      } else if (!on) p.hidden = true;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => go(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (k) {
        e.preventDefault();
        go(tabs[(i + k + tabs.length) % tabs.length].dataset.tab, true);
      }
    });
  });
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goto)));
  reveal($('#p-story'), scroller);
}

/* ---------- flow filter ---------- */
function setupFilter() {
  $$('.filter').forEach((b) => b.addEventListener('click', () => {
    $$('.filter').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $$('.flow-row').forEach((r) => (r.hidden = b.dataset.filter !== 'all' && r.dataset.kind !== b.dataset.filter));
  }));
}

/* ---------- address checker ---------- */
const MSG = {
  empty: 'Paste something to compare against the registry.',
  'not-address': 'That does not look like an address.',
  'no-registry': 'No address has been stated yet, so nothing is verifiable. Treat every address as unverified.',
  match: 'Match. Same string as the stated address.',
  mismatch: 'Mismatch. This string differs from our stated address. Keep your funds away from it.',
};
function setupVerify() {
  const input = $('#verify-input'), out = $('#verify-out');
  input.addEventListener('input', () => {
    const r = verifyAddress(input.value);
    out.dataset.v = r.verdict;
    out.textContent = MSG[r.verdict];
  });
}

/* ---------- boot ---------- */
renderSocials($('#socials'));
renderCA();
setupTabs();
setupFilter();
setupVerify();
applyGates();
progressBar($('#progress'));
spotlight(document);
parallax();
reveal([$('.banner')], null);
startMarket();
scanAddresses(document.body);
document.documentElement.dataset.ready = '1';
document.documentElement.dataset.motion = reduced() ? 'reduced' : 'full';
