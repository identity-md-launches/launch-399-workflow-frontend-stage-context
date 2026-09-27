# Nosandwich (NOSAND) site

One static page for the NOSAND anti-sandwich pool on Sepolia. It reads the hook's views and
events and the pool price through Uniswap's Sepolia StateView, shows the start-of-block price,
the current price and recent sells with the amount each was clipped, and offers a buy/sell form
that swaps through the Universal Router (default) or Uniswap's published Sepolia `PoolSwapTest`
router (enabled only after the page verifies it has code and points at the same PoolManager).

Stack: Vite, React, TypeScript, viem. No backend, no server rewrites, relative asset URLs, so the
export works from an IPFS gateway subpath or an ENS name.

## Layout

| Path | Purpose |
| --- | --- |
| `web/src/config.ts` | The only hand-written configuration: pool parameters from the attested manifest, the `PoolSwapTest` address, scan/refresh settings and the periphery ABIs (StateView, quoter, Universal Router, Permit2, PoolSwapTest, PoolManager events). |
| `web/src/deployment.ts` | Loads and validates `imd-deployment.json` at runtime, fetches each ABI it names and re-checks the ABI's canonical keccak hash before use. Deployed addresses, chain id, RPC URLs, explorer and Uniswap v4 addresses come only from this file. |
| `web/deployment/` | Build inputs copied from the workflow handoff: `handoff.json` (deployment.json), `network.json`, and the two implementation-derived ABIs from `docs/abi/` at the pinned source commit. |
| `web/scripts/finalize-export.mjs` | Runs after `vite build`: writes `dist/abi/*.json`, checks ABI hashes against the handoff, hashes every exported file and writes `dist/imd-deployment.json`. |
| `web/scripts/verify-export.mjs` | Independent re-check of the committed export (schema, hashes, ABI binding, network block equality, relative URLs, size limits). |
| `dist/` | The committed static export, including `imd-deployment.json`. |
| `web/DESIGN.md` | Design tokens, typography, components and responsive behaviour of the final source. |
| `docs/FRONTEND.md` | Validation record: build, typecheck, tests, browser and interaction checks, Better Interface review, limitations. |

## Configuration

Runtime configuration is `dist/imd-deployment.json`. It is generated, never edited by hand:

- `launchId`, `chainId`, `sourceCommit`, `attestationHash` and the contract set (name, address,
  `abiHash`, `abiPath`) are copied from `web/deployment/handoff.json`;
- `network` is copied unchanged from `web/deployment/network.json` (public RPC URLs, explorer,
  native currency, faucets, Uniswap v4 `poolManager`, `universalRouter`, `quoter`, `stateView`,
  `positionManager`, `permit2`);
- `assets` lists every other exported file with its SHA-256.

The app derives `wallet_addEthereumChain` parameters from the `network` block (they equal the
handoff's `walletAddChain`). There are no private credentials anywhere: reads use the public RPC
URLs from the manifest with fallback in the listed order, and signing stays in the visitor's wallet.

No WalletConnect project id is configured; the page connects injected browser wallets found via
EIP-6963 (falling back to `window.ethereum`). Adding WalletConnect would be an optional extension in
`web/src/lib/wallet.ts`.

To point the site at a different deployment, replace the files in `web/deployment/` with the new
handoff, network block and ABIs and rebuild. The build refuses to proceed if an ABI's canonical
keccak differs from the handoff's `abiHash`.

## Commands

```sh
cd web
npm ci                # install dependencies from package-lock.json
npm run dev           # local dev server (reads live Sepolia state)
npm run typecheck     # tsc, app and node configs
npm test              # vitest unit and component tests (mocked RPC and wallet)
npm run build         # vite build → ../dist, then finalize-export (ABIs + imd-deployment.json)
npm run verify-export # re-check the committed export against the handoff
npm run preview       # serve the built export locally
npm run check         # typecheck + test + build + verify-export
```

After any change under `web/`, run `npm run build` again and commit `dist/` together with the
source: the manifest's asset hashes must describe the committed bytes.

## Swap routes

- **Universal Router** (from the network block): `execute(0x10, [abi.encode(0x060c0f, [ExactInputSingleParams, SETTLE_ALL, TAKE_ALL])], deadline)`.
  Buys send ETH as the transaction value. Sells first `approve(permit2, amount)` on NOSAND and then
  `Permit2.approve(NOSAND, universalRouter, amount, expiration)`, each shown as its own step. The
  router enforces the minimum output derived from the slippage tolerance, so a clipped sell that
  would pay less than the minimum reverts instead of paying less.
- **PoolSwapTest** (Uniswap's published Sepolia test router, `web/src/config.ts`): `swap(key, params, testSettings, hookData)`
  with exact input and a `sqrtPriceLimitX96` derived from the slippage tolerance. It has no
  minimum-output check, so a swap can partially fill and a clipped sell is not reverted; the page
  says so beside the route selector. Sells approve NOSAND for the router directly.

Every route simulates the call (`eth_call` with the visitor's account) before asking the wallet to
sign, and shows the decoded revert reason (including the quoter's `UnexpectedRevertBytes` wrapper
and the hook's `CheckpointCannotFillExactOutput`) when it fails.

## Reads shown on the page

- Start-of-block price: `AntiSandwichHook.checkpoint(poolId)` (block, sqrtPriceX96, tick, liquidity,
  ticks copied), labelled "Current block" when the checkpoint block equals the latest block.
- Current price: `StateView.getSlot0(poolId)` and `getLiquidity(poolId)`.
- Hook state: `collected(poolId, currency)`, `MAX_CHECKPOINT_TICKS()`, `getHookPermissions()`, `poolManager()`.
- Recent sells: PoolManager `Swap` events for the pool with `amount1 < 0`, joined by transaction
  hash with the hook's `Clipped` events; plus the latest `Clipped`/`Donated` events.
- Wallet: ETH and NOSAND balances, NOSAND→Permit2 and NOSAND→PoolSwapTest allowances, Permit2
  allowance for the Universal Router.

Prices are computed with exact bigint arithmetic (`sqrtPriceX96² / 2^192`, decimals-adjusted).
