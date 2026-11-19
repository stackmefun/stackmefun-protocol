// register.js - every external fact is exactly one record with a state:
//   stated | absent | unconfirmed
// Absent and unconfirmed records render inert. No href exists for an unstated record.

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const base = {
  chain: {
    state: 'stated',
    name: 'Solana',
    cluster: 'mainnet',
    rpc: 'https://solana-rpc.publicnode.com',
  },
  ca: { state: 'absent', value: null },
  x: { state: 'absent', url: null },
  github: { state: 'absent', url: null },
  marketSource: {
    state: 'stated',
    boosts: 'https://api.dexscreener.com/token-boosts/top/v1',
    tokens: 'https://api.dexscreener.com/tokens/v1/solana/',
    ownDex: 'https://api.dexscreener.com/latest/dex/tokens/',
    ownPump: 'https://frontend-api.pump.fun/coins/',
    pollMs: 60000,
  },
};

// Build-time overrides (STACKME_CA / STACKME_X / STACKME_GITHUB) are injected by scripts/build.mjs.
/* global __REGISTER_OVERRIDES__ */
const overrides = typeof __REGISTER_OVERRIDES__ === 'undefined' ? {} : __REGISTER_OVERRIDES__;

function merge() {
  const r = structuredClone(base);
  for (const k of Object.keys(overrides)) if (r[k]) Object.assign(r[k], overrides[k]);
  // shape check: a record that claims "stated" but is malformed is only "unconfirmed"
  if (r.ca.state === 'stated' && !BASE58.test(r.ca.value || '')) r.ca.state = 'unconfirmed';
  for (const k of ['x', 'github']) {
    if (r[k].state === 'stated') {
      try {
        const u = new URL(r[k].url);
        if (u.protocol !== 'https:') throw new Error('scheme');
      } catch {
        r[k].state = 'unconfirmed';
      }
    }
  }
  return r;
}

export const register = merge();

export const isStated = (rec) => rec.state === 'stated';

/** derive a handle from a stored URL; never stored separately */
export function handleOf(rec) {
  if (!isStated(rec)) return null;
  try {
    const parts = new URL(rec.url).pathname.split('/').filter(Boolean);
    return parts[0] ? '@' + parts[0].replace(/^@/, '') : new URL(rec.url).hostname;
  } catch {
    return null;
  }
}

/** every address the page is allowed to talk about */
export function statedAddresses() {
  return isStated(register.ca) ? [register.ca.value] : [];
}

export { BASE58 };
