# Frontend validation record

Worker-side validation of the NOSAND site (`web/` source, `dist/` export). This is the worker's
report, not an independent network certification. Date: 2026-09-27. Source commit of the
contracts: `c284f54fd0a8f4f03053033ecb084e2ed65a6f91` (the handoff's `sourceCommit`, equal to the
repository HEAD this frontend was added on).

## 1. Scope and assumptions

- Pages/flows: the single page `dist/index.html`. Flows: reading pool price, start-of-block
  checkpoint, hook state and events without a wallet; connecting an injected wallet; switching /
  adding the Sepolia chain; quoting and swapping (buy and sell) through the Universal Router and
  through Uniswap's Sepolia `PoolSwapTest` router; `donateCollected`; NOSAND transfer; error and
  rejection states; missing deployment configuration.
- Build/export: `web/` (Vite 8, React 19, TypeScript 5.9, viem 2.56) → `dist/` with `base: './'`,
  6 assets, 590,694 bytes total, plus `dist/imd-deployment.json` (2,534 bytes).
- Inferred choices: the workflow names `PoolSwapTest` as the swap router while the acceptance
  criteria require every swap, quote and approval to use the network block's Uniswap addresses.
  Both are implemented as selectable routes; the Universal Router is the default because it
  enforces a minimum output, which matters for a hook that can clip sell proceeds. `PoolSwapTest`
  is enabled only after the page confirms it has code and its `manager()` equals the manifest's
  PoolManager. Its address is the published Sepolia v4 deployment
  `0x9b6b46e2c869aa39918db7f52f5557fe577b6eee` (`web/src/config.ts`).
- The acceptance criteria ask for `DESIGN.md` at the repository root; the assignment's write scope
  is `web/**`, `dist/**`, `docs/**`, so the design document is `web/DESIGN.md`.
- The launch pool key is (ETH, NOSAND, 3000, 60, hook) from the handoff's `manifest.pool`; its id
  `0xd9bc858b…0eba1` matches the on-chain `Initialize` event.
- Supported variants: light theme only, English, LTR. No dark theme, localisation or routing exist.
- Live pool state during validation: initialised at 50,000,000 NOSAND per ETH (tick 177,284),
  one-sided NOSAND liquidity below the price, no swaps yet, no checkpoint, no hook events. The
  "recent sells" table and "current block" checkpoint badge were therefore exercised with unit
  tests and code review only (see limitations).

## 2. Handoff and manifest binding

| Check | Result |
| --- | --- |
| Handoff `abiHash` vs canonical keccak (sorted keys, no whitespace) of `docs/abi/*.json` | NOSAND `38880b8e…37bee` and AntiSandwichHook `3a52b128…595f` both match |
| `dist/abi/*.json` bytes vs hashes | match (checked by `finalize-export.mjs`, `verify-export.mjs`, `deployment.test.ts`, and again by the app at runtime before any call) |
| `network` block in `dist/imd-deployment.json` vs `.imd/reads/network.json` | identical (deep-equal, key order preserved) |
| Contract set / addresses / ids | copied from the handoff; `verify-export` re-compares |
| Deployed code on Sepolia (keyed RPC, `cast code`) | NOSAND 3,449 hex chars, hook 29,709, PoolSwapTest 13,903, quoter, router, Permit2 all non-empty; hook `poolManager()`, StateView `poolManager()` and PoolSwapTest `manager()` all return `0xE03A…3543` |
| Live quote (`cast call` on the quoter) | buy 0.001 ETH → 49,627.085 NOSAND; sell reverts `UnexpectedRevertBytes(NotEnoughLiquidity(poolId))` |

## 3. Commands and outcomes

Run in `web/` on the worker:

| Command | Outcome |
| --- | --- |
| `npm ci` equivalent (`npm install`, lockfile committed) | 118 packages, no audit run |
| `npm run typecheck` | exit 0 (app and node tsconfigs) |
| `npm test` (vitest, jsdom) | 7 files, 45 tests passed |
| `npm run build` | vite build + finalize-export: 6 assets, manifest written |
| `npm run verify-export` | OK |
| `node test/scratch/browser/verify.mjs` (copy at `docs/validation/browser-verify.mjs`) | exit 0, report at `docs/validation/browser-report.json` |

Unit and component tests (`web/src/**/*.test.ts(x)`):

- `price.test.ts`: sqrtPriceX96 → price for the manifest's initial price and the live opening
  price, decimals adjustment, rounding, amount formatting/parsing, slippage.
- `virtualQuote.test.ts`: the client-side reproduction of the hook's constant-liquidity
  start-of-block bound (zero-liquidity checkpoint → fully clipped; small sell ≈ marginal price
  minus fee; monotone/concave; price-bound cap; SqrtPriceMath unit identities), PoolSwapTest
  price-limit derivation, integer sqrt.
- `swapEncoding.test.ts`: pool key/id equal the on-chain values; Universal Router `inputs[0]` for a
  buy and a sell byte-equal to encodings produced by Foundry `cast abi-encode`; PoolSwapTest args.
- `deployment.test.ts`: ABI hashes equal the handoff; manifest validation (chain mismatch, parent
  traversal, absolute paths, bad address/hash); wallet-add-chain derivation equals the handoff's
  `walletAddChain`; loading relative to a gateway subpath; tampered ABI refused; 404 reported.
- `wallet.test.ts`: switch → 4902 → `wallet_addEthereumChain` with the exact parameters → switch;
  nested MetaMask 4902 and message-only variants; rejection propagates; EIP-6963 discovery.
- `tx.test.ts`: step runner simulate → sign → receipt, skip of satisfied steps, decoded custom
  error on simulation failure, wallet rejection, on-chain revert, unknown selector.
- `SwapForm.test.tsx` / `WalletPanel`: buy quote, rate and minimum received; unfillable sell
  explained and blocked with `aria-invalid` + focus; over-balance rejected on submit; disabled
  reason when transactions are not allowed; start-of-block bound row for a sell; wrong-network
  single switch control; no-wallet and disconnected states.

## 4. Browser and interaction validation

The IMD-managed preview (`test/scratch/browser/preview.json`) does not exist on this worker and
the MCP browser is a plain headless Playwright with no preview server, so rendered checks were run
by one bounded foreground script (`docs/validation/browser-verify.mjs`) that serves `dist/` under a
gateway-like `/preview/` subpath on an ephemeral port, drives the installed headless Chromium
(Playwright chromium-1246) and exits. Reads, quotes and simulations went to the real Sepolia RPCs
listed in the manifest. Wallet signing was mocked: an injected EIP-1193 provider returns the
deployer EOA (`0x09ec…4a60`, which holds ETH and NOSAND) and answers `eth_sendTransaction` with an
existing Sepolia transaction hash so that receipts resolve. **No transaction was broadcast.**

Scenarios and observations (`docs/validation/browser-report.json`):

| Scenario | Evidence |
| --- | --- |
| Desktop 1280×900, no wallet | Price 50,000,000 NOSAND per ETH read live; "No checkpoint yet"; all 8 code badges "Code verified"; swap and donate disabled with the reason "Install a browser wallet…"; "No sells yet" empty state with scanned range since deployment; 1 `h1`, 1 `main`, headings in order; 29 interactive elements all with accessible names; 22 Tab stops each with a visible 2 px focus ring (`:focus-visible` matched, outline solid, `rgb(31, 86, 214)`); no console errors; no failed requests; no horizontal overflow. `docs/validation/desktop-1280-no-wallet.png` |
| 320×640, 390×844, 820×1000 | Live read succeeded; scrollWidth equals viewport width at each size; no console errors. `docs/validation/mobile-320.png` |
| Mock wallet: connect | Connected badge, "Wrong network (chain 1)", swap disabled, single "Switch to Sepolia" control. `docs/validation/wallet-wrong-network.png` |
| Switch / add chain | Provider calls in order: `wallet_switchEthereumChain` (4902) → `wallet_addEthereumChain` with parameters equal to the handoff's `walletAddChain` → `wallet_switchEthereumChain` → "On Sepolia"; balances shown (0.923416 ETH) |
| Buy via Universal Router | Real quote 0.001 ETH → 49,627.085 NOSAND, rate, minimum received at 1 %, gas 191,258; `execute` simulated for real against Sepolia (no revert); mocked signature; receipt confirmed; success notice; the transaction handed to the wallet targeted the Universal Router with value 0.001 ETH. `docs/validation/wallet-buy-confirmed-mocked-signing.png` |
| Buy via PoolSwapTest | Route enabled after the router check; `swap` simulated for real; confirmed |
| Sell 1000 NOSAND | Quoter revert decoded to "The pool cannot fill this sell: there is no ETH liquidity above the current price."; submit blocked, field `aria-invalid`, focus moved to the field. `docs/validation/wallet-sell-unfillable.png` |
| Donate collected claims | `donateCollected(poolKey)` simulated for real (no-op on chain), confirmed |
| Transfer with rejected signature | Step shows "Failed — Request rejected in the wallet." |
| Manifest 404 | `role="alert"` explains the missing `imd-deployment.json`; no stale addresses rendered |

Not performed / not verifiable here:

- A real broadcast swap, approval, Permit2 approval, donate or transfer (the assignment does not
  authorise broadcasting; signing was mocked). The Permit2 approval steps for sells could not be
  simulated end to end because the live pool currently has no liquidity above the price, so a
  sell cannot be filled; their encoding and allowance logic are covered by unit tests only.
- The "Recent sells" table with rows, the `Clipped` join and the "Current block" checkpoint badge
  were not observed live (no swaps exist yet); covered by unit tests of the pure logic and code review.
- Screen-reader sessions, browser-native 200 % zoom, physical devices, forced-colors mode, RTL.
- Behaviour of a real wallet extension's EIP-6963 announcement and prompts.

## 5. Better Interface review

Coverage by domain (Checked = source checks plus the headless-browser observations above):

| Domain | Status | Notes |
| --- | --- | --- |
| Accessibility | Checked | Native elements only; labels bound; `aria-describedby` hints/errors; `aria-invalid` + focus on submit; `role="status"` live regions for steps and quote, `role="alert"` for blocking errors; skip link; one `h1`, one `main`; focus ring verified on all 22 stops; hit areas ≥ 2 rem × content. Not verified: screen reader, 200 % zoom, forced colors. |
| Layout | Checked | Space-first grouping; shared edges; logical properties; breakpoints at 40/56 rem from content; no overflow at 320/390/820/1280. Not verified: RTL mirror, 200 % zoom. |
| Writing | Checked | Sentence case throughout; verb-first buttons ("Connect wallet", "Switch to Sepolia", "Buy NOSAND", "Donate collected claims"); errors say how to fix beside the field; empty states point forward; links describe destinations ("View transaction …"). |
| Typography | Checked | System stack, scale with semantic tokens, headings descend, tabular numbers on values, 16 px inputs, wrap rules, `overflow-wrap` on identifiers. Rendered wrapping checked at four widths. |
| Colors | Checked | Ramps by role, semantic tokens only in components; every declared pair measured (see `web/DESIGN.md`). Rendered-background measurement was done from declared tokens; no alpha or image backgrounds exist. |
| UI | Checked | Flat surfaces, 6/10 px radii, press scale 0.96, 120 ms colour transitions with named properties, hover gated by `(hover: hover)`, no motion to review under reduced motion (no animations exist). Animations panel replay: not applicable. |

Findings and fixes (all rechecked in the final browser run):

1. MEDIUM, `web/src/components/SwapForm.tsx` (quote error path): the live quoter wraps the pool's
   `NotEnoughLiquidity` in `UnexpectedRevertBytes(bytes)`, so the friendly "cannot fill" copy never
   showed and a raw selector was displayed. Fix: `revertReason` in `web/src/lib/tx.ts` decodes the
   inner bytes against the quoter/PoolManager/hook ABIs. Recheck: browser run shows the plain message.
2. MEDIUM (colors/accessibility), `web/src/styles.css` `--n-300`: input/button border `#b5bcc7` on
   white measured 1.91:1, under the 3:1 non-text boundary target. Fix: `#848d9b` (3.35:1 on
   surface, 3.13:1 on page). Recheck: recomputed.
3. LOW (UI), `web/index.html`: browsers requested `/favicon.ico`, producing a console 404 on static
   hosts. Fix: `<link rel="icon" href="data:,">`. Recheck: no console errors in the final run.
4. LOW (accessibility), `SwapForm.tsx`: redundant `role="radiogroup"`/`aria-label` on `div`s already
   inside `fieldset`/`legend`. Fix: removed the ARIA. Recheck: names still resolve via legends.
5. LOW (UI/writing), `SwapForm.tsx`: a previous transaction's steps stayed visible after switching
   direction or route, which read as belonging to the new form. Fix: changing direction or route
   clears steps and result. Recheck: covered by the final build; not re-observed in the browser
   script (it does not toggle direction after a completed swap).

Deliberate choices kept: teal single accent, flat cards, sentence case, `PoolSwapTest` as an
opt-in route with an explicit warning about missing minimum-output checks.

## 6. Completion

Complete for the stated scope, with these limitations: no transaction was broadcast (mocked
signing over real simulations); sell approval/Permit2 steps, the populated sells table and the
current-block checkpoint state were validated by unit tests and code review only because the live
pool has no swaps and no sell-side liquidity yet; screen-reader, native zoom, RTL and real-wallet
prompts were not exercised; the design document is at `web/DESIGN.md` rather than the repository
root because of the assignment's write scope. Publication checks (CID, named entrypoint, asset
hashes, configured-RPC chain id and code) run after submission and are not claimed here.
