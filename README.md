# StackMe

**Layer by layer on Solana.**

[![Live site](https://img.shields.io/badge/live%20site-StackMe.fun-c379fc?style=for-the-badge&labelColor=240131)](https://StackMe.fun)

| | |
| --- | --- |
| Chain | Solana mainnet (`https://solana-rpc.publicnode.com`) |
| Contract address | `TBA` (not stated yet) |
| Site | https://StackMe.fun |

## Overview

StackMe is the front door for a Solana community token: one page, one purple glyph, a live market board and honest gates. Anything the project has not stated yet stays visibly inert, and anything stated is wired in from a single record.

## Features

- **Live market board.** Top boosted Solana pairs from DexScreener with logo, symbol, price, 24h move, volume and liquidity. Skeleton loaders, count-up numbers, exponential backoff, last good data kept on failure, 60 second polling that pauses while the tab is hidden.
- **Ticker.** The same live data, looping across the top.
- **Pinned row #1.** Placeholder with the brand logo until the contract address is stated; then a live row fed by DexScreener and pump.fun in parallel.
- **Register pattern.** Every external fact (contract address, X, GitHub, market source) is one record with a state: `stated`, `absent` or `unconfirmed`. Unstated records render inert and carry no link.
- **Address checker.** Compares any pasted address, Solana or `0x`, against the stated registry. It never blanket-rejects a shape.
- **Motion.** Spring-driven reveals, pointer and scroll parallax, spotlight hovers, scroll progress. Full `prefers-reduced-motion` fallback.

## Develop

```bash
npm install
npm run build     # outputs dist/
npm run serve     # serves dist/ on http://127.0.0.1:4173
npm run verify    # builds both register branches and measures five breakpoints
```

Stating a record means editing `src/js/register.js` (or passing `STACKME_CA`, `STACKME_X`, `STACKME_GITHUB` to the build).

## Links

- Site: https://StackMe.fun
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)
- X: not stated yet
- GitHub: not stated yet

## License

MIT. See [LICENSE](LICENSE).
