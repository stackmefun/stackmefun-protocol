// gates.js - state-driven gates. Each gate reads the live register record at runtime
// and stamps data-state on every anchor, so tests never hard-code a state.
import { register, isStated, handleOf, statedAddresses, BASE58 } from './register.js';

export const GATES = ['ca-slot', 'own-row', 'social-x', 'social-github', 'verify', 'scanner'];

const HEX = /^0x[a-fA-F0-9]{40}$/;
const SCAN_RE = /0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/** classify a string against the stated registry. Never a blanket reject of any shape. */
export function verifyAddress(raw) {
  const s = (raw || '').trim();
  if (!s) return { verdict: 'empty' };
  const shape = HEX.test(s) ? 'hex' : BASE58.test(s) ? 'base58' : null;
  if (!shape) return { verdict: 'not-address' };
  const known = statedAddresses();
  if (!known.length) return { verdict: 'no-registry', shape };
  const hit = known.some((a) => (shape === 'hex' ? a.toLowerCase() === s.toLowerCase() : a === s));
  return { verdict: hit ? 'match' : 'mismatch', shape };
}

const looksReal = (s) => /\d/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s));

/** address scanner: flags address-shaped strings that are not in the stated registry.
 *  The CA slot and the live market board are exempt (marked data-gate-exempt). */
export function scanAddresses(root = document.body) {
  let flagged = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || n.nodeValue.length < 32) return NodeFilter.FILTER_REJECT;
      if (n.parentElement.closest('[data-gate-exempt],script,style,mark.gate-warn')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const bad = [...text.matchAll(SCAN_RE)].filter((m) => looksReal(m[0]) && verifyAddress(m[0]).verdict !== 'match');
    if (!bad.length) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of bad) {
      frag.append(text.slice(last, m.index));
      const mark = document.createElement('mark');
      mark.className = 'gate-warn';
      mark.title = 'Looks like an address but the registry does not list it';
      mark.textContent = m[0];
      frag.append(mark);
      last = m.index + m[0].length;
      flagged++;
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  document.documentElement.dataset.scanFlagged = String(flagged);
  return flagged;
}

/** stamp each gate anchor with the record state read right now */
export function applyGates() {
  const set = (sel, state) => document.querySelectorAll(sel).forEach((el) => (el.dataset.state = state));
  set('[data-gate="ca-slot"]', register.ca.state);
  set('[data-gate="own-row"]', register.ca.state);
  set('[data-gate="verify"]', register.ca.state);
  set('[data-gate="ca-slot-trade"]', register.ca.state);
  set('[data-gate="social-x"]', register.x.state);
  set('[data-gate="social-github"]', register.github.state);
  set('[data-gate="scanner"]', 'live');
  document.documentElement.dataset.caState = register.ca.state;
}

/* ---------- social icons: official X mark and GitHub Octicon mark-github ---------- */
const ICON = {
  x: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>',
  github:
    '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>',
};
const NAME = { x: 'X', github: 'GitHub' };

export function renderSocials(host) {
  host.replaceChildren();
  for (const key of ['x', 'github']) {
    const rec = register[key];
    const stated = isStated(rec);
    const el = document.createElement(stated ? 'a' : 'span');
    el.className = 'social' + (stated ? '' : ' inert');
    el.dataset.gate = 'social-' + key;
    el.dataset.state = rec.state;
    if (stated) {
      el.href = rec.url; // link rule: href exists only for a stated record
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
      el.setAttribute('aria-label', `${NAME[key]} ${handleOf(rec) || ''}`.trim());
    } else {
      el.setAttribute('role', 'img');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('aria-label', `${NAME[key]} (not available yet)`);
    }
    el.innerHTML = ICON[key];
    host.append(el);
  }
}
