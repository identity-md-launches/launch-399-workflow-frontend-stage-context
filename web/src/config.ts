// The single place for configuration that is NOT carried by the deployment manifest.
//
// Deployed contract addresses, the chain id, the ABI paths and the public RPC / Uniswap v4
// addresses come from `dist/imd-deployment.json`, which the app fetches at runtime
// (see deployment.ts). Nothing below duplicates a value from that file.
import { parseAbi, type Address } from 'viem';

/** Where the runtime deployment configuration lives, relative to the page. */
export const MANIFEST_PATH = 'imd-deployment.json';

/** Contract names expected in the manifest (they are the handoff's contract names). */
export const CONTRACT_NAMES = { token: 'NOSAND', hook: 'AntiSandwichHook' } as const;

/**
 * Pool parameters from the attested launch manifest (deployment handoff `manifest.pool`).
 * currency0 is native ETH (the zero address), currency1 the token; static fee 0.30 %, tick
 * spacing 60, hooks = the deployed hook from the manifest.
 */
export const POOL = {
  pairedCurrency: '0x0000000000000000000000000000000000000000' as Address,
  fee: 3000,
  tickSpacing: 60,
} as const;

/**
 * Uniswap's published Sepolia `PoolSwapTest` router (v4-core test router), from the Uniswap v4
 * deployments table for Sepolia. It is not part of the vetted network block, so the app checks
 * that it has code and that `manager()` equals the manifest's PoolManager before enabling it.
 */
export const POOL_SWAP_TEST_ROUTER: Address = '0x9b6b46e2c869aa39918db7f52f5557fe577b6eee';

/** First block that can hold pool events: the handoff's deployment block. */
export const DEPLOYMENT_BLOCK = 11791660n;

/** Event scanning: window size per eth_getLogs call, cap on windows, rows to show. */
export const EVENT_SCAN = { windowBlocks: 20_000n, maxWindows: 25, maxSells: 25, maxHookEvents: 25 } as const;

/** Read refresh cadence in milliseconds (Sepolia blocks are 12 s). */
export const REFRESH_MS = 15_000;

/** Slippage defaults for the swap form, in percent. */
export const SLIPPAGE = { defaultPercent: '1', maxPercent: 50 } as const;

/** Universal Router deadline offset in seconds. */
export const DEADLINE_SECONDS = 20 * 60;

/** Permit2 allowance expiration for the router, in seconds from now. */
export const PERMIT2_EXPIRATION_SECONDS = 30 * 24 * 60 * 60;

// --- Periphery ABIs (Uniswap v4 contracts named in the manifest's network block) ---

export const stateViewAbi = parseAbi([
  'function poolManager() view returns (address)',
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  'error NotEnoughLiquidity(bytes32 poolId)',
  'error UnexpectedRevertBytes(bytes revertData)',
]);

export const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);

export const permit2Abi = parseAbi([
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);

export const poolSwapTestAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }',
  'struct TestSettings { bool takeClaims; bool settleUsingBurn; }',
  'function manager() view returns (address)',
  'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)',
  'error NoSwapOccurred()',
]);

export const poolManagerAbi = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)',
  'error PriceLimitOutOfBounds(uint160 sqrtPriceLimitX96)',
  'error SwapAmountCannotBeZero()',
  'error CurrencyNotSettled()',
  'error HookDeltaExceedsSwapAmount()',
]);
