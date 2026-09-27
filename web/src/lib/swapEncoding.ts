// Calldata shapes for the two swap routes. Pure functions, unit-tested against reference
// encodings produced with `cast` in the validation record.
import { encodeAbiParameters, type Address, type Hex } from 'viem';
import type { PoolKey } from './poolKey';
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE } from './virtualQuote';

/** Universal Router command byte for V4_SWAP. */
export const V4_SWAP_COMMAND: Hex = '0x10';
/** v4 router actions: SWAP_EXACT_IN_SINGLE (0x06), SETTLE_ALL (0x0c), TAKE_ALL (0x0f). */
export const V4_ACTIONS: Hex = '0x060c0f';

export interface ExactInSwap {
  poolKey: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
}

const poolKeyComponents = [
  { name: 'currency0', type: 'address' },
  { name: 'currency1', type: 'address' },
  { name: 'fee', type: 'uint24' },
  { name: 'tickSpacing', type: 'int24' },
  { name: 'hooks', type: 'address' },
] as const;

/**
 * `execute(bytes commands, bytes[] inputs, uint256 deadline)` arguments for one exact-input
 * single-pool v4 swap: commands 0x10, inputs[0] = abi.encode(actions, params[]) with
 * SWAP_EXACT_IN_SINGLE, SETTLE_ALL(inputCurrency, amountIn), TAKE_ALL(outputCurrency, minOut).
 */
export function encodeUniversalRouterSwap(swap: ExactInSwap): { commands: Hex; inputs: Hex[] } {
  const inputCurrency: Address = swap.zeroForOne ? swap.poolKey.currency0 : swap.poolKey.currency1;
  const outputCurrency: Address = swap.zeroForOne ? swap.poolKey.currency1 : swap.poolKey.currency0;
  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', type: 'tuple', components: poolKeyComponents },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [
      {
        poolKey: swap.poolKey,
        zeroForOne: swap.zeroForOne,
        amountIn: swap.amountIn,
        amountOutMinimum: swap.amountOutMinimum,
        hookData: '0x',
      },
    ],
  );
  const settleAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, swap.amountIn]);
  const takeAll = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputCurrency, swap.amountOutMinimum]);
  const v4Input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [V4_ACTIONS, [swapParams, settleAll, takeAll]]);
  return { commands: V4_SWAP_COMMAND, inputs: [v4Input] };
}

export interface PoolSwapTestArgs {
  key: PoolKey;
  params: { zeroForOne: boolean; amountSpecified: bigint; sqrtPriceLimitX96: bigint };
  testSettings: { takeClaims: boolean; settleUsingBurn: boolean };
  hookData: Hex;
}

/**
 * `PoolSwapTest.swap(key, params, testSettings, hookData)` arguments for an exact-input swap.
 * amountSpecified is negative for exact input; the price limit is the caller's slippage bound
 * (or the pool's extreme bound when none is given).
 */
export function poolSwapTestArgs(swap: { poolKey: PoolKey; zeroForOne: boolean; amountIn: bigint; sqrtPriceLimitX96?: bigint }): PoolSwapTestArgs {
  const fallback = swap.zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n;
  return {
    key: swap.poolKey,
    params: {
      zeroForOne: swap.zeroForOne,
      amountSpecified: -swap.amountIn,
      sqrtPriceLimitX96: swap.sqrtPriceLimitX96 ?? fallback,
    },
    testSettings: { takeClaims: false, settleUsingBurn: false },
    hookData: '0x',
  };
}
