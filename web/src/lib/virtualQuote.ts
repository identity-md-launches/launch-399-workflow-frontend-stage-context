// The hook's start-of-block bound for an exact-input sell (currency1 → currency0), reproduced
// client-side: OpenZeppelin's AntiSandwichHook simulates the sell on a constant-liquidity
// virtual curve that starts at the block's opening slot0 with the opening in-range liquidity
// (no tick bitmap). Any ETH beyond that simulated output is clipped. This mirrors v4-core's
// SwapMath/SqrtPriceMath for the oneForZero exact-input case with no initialized ticks.
import { Q96 } from './price';

export const MIN_SQRT_PRICE = 4295128739n;
export const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342n;
const FEE_PIPS = 1_000_000n;

function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  return (a * b) / d;
}

function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  const q = (a * b) / d;
  return (a * b) % d === 0n ? q : q + 1n;
}

/** SqrtPriceMath.getAmount0Delta(sqrtA, sqrtB, liquidity, roundUp) with sqrtA < sqrtB. */
export function amount0Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtB - sqrtA;
  if (roundUp) return mulDivCeil(mulDivCeil(numerator1, numerator2, sqrtB), 1n, sqrtA);
  return mulDivFloor(numerator1, numerator2, sqrtB) / sqrtA;
}

/** SqrtPriceMath.getAmount1Delta(sqrtA, sqrtB, liquidity, roundUp). */
export function amount1Delta(sqrtA: bigint, sqrtB: bigint, liquidity: bigint, roundUp: boolean): bigint {
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
  return roundUp ? mulDivCeil(liquidity, sqrtB - sqrtA, Q96) : mulDivFloor(liquidity, sqrtB - sqrtA, Q96);
}

export interface VirtualSellQuote {
  /** ETH the checkpoint curve would pay for the whole input (0 when the checkpoint has no liquidity). */
  amountOut: bigint;
  /** Input the virtual curve actually consumed (less than amountIn only at the price bound). */
  amountInUsed: bigint;
  /** Sqrt price after the virtual fill. */
  sqrtPriceAfter: bigint;
}

/**
 * Exact-input oneForZero sell of `amountIn` currency1 against a constant-liquidity curve at
 * `sqrtPriceX96` with `liquidity`, charging `feePips` (e.g. 3000 = 0.30 %).
 */
export function virtualSellQuote(sqrtPriceX96: bigint, liquidity: bigint, amountIn: bigint, feePips: number): VirtualSellQuote {
  if (amountIn <= 0n || liquidity === 0n || sqrtPriceX96 === 0n) {
    return { amountOut: 0n, amountInUsed: 0n, sqrtPriceAfter: sqrtPriceX96 };
  }
  const limit = MAX_SQRT_PRICE - 1n;
  const amountRemainingLessFee = (amountIn * (FEE_PIPS - BigInt(feePips))) / FEE_PIPS;
  // Amount of currency1 needed to reach the limit price.
  const amountToLimit = amount1Delta(sqrtPriceX96, limit, liquidity, true);
  let sqrtPriceNext: bigint;
  let amountInUsed: bigint;
  if (amountRemainingLessFee >= amountToLimit) {
    sqrtPriceNext = limit;
    amountInUsed = amountToLimit;
  } else {
    // getNextSqrtPriceFromAmount1RoundingDown: sqrtP + amount * Q96 / L (floor).
    sqrtPriceNext = sqrtPriceX96 + mulDivFloor(amountRemainingLessFee, Q96, liquidity);
    amountInUsed = amountRemainingLessFee;
  }
  const amountOut = amount0Delta(sqrtPriceX96, sqrtPriceNext, liquidity, false);
  // Report gross input consumed (fee included) for display.
  const grossUsed = amountInUsed === amountRemainingLessFee ? amountIn : mulDivCeil(amountInUsed, FEE_PIPS, FEE_PIPS - BigInt(feePips));
  return { amountOut, amountInUsed: grossUsed, sqrtPriceAfter: sqrtPriceNext };
}

/**
 * Sqrt price limit for a PoolSwapTest swap at `tolerancePips` (parts per million) away from the
 * current price: sqrtP × sqrt(1 ∓ tol). Clamped to the pool's valid bounds.
 */
export function sqrtPriceLimitForTolerance(sqrtPriceX96: bigint, zeroForOne: boolean, tolerancePips: bigint): bigint {
  const factor = zeroForOne ? FEE_PIPS - tolerancePips : FEE_PIPS + tolerancePips;
  // sqrt(factor / 1e6) scaled by 1e6: isqrt(factor * 1e6).
  const scaled = isqrt(factor * FEE_PIPS);
  const limit = (sqrtPriceX96 * scaled) / FEE_PIPS;
  if (zeroForOne) return limit <= MIN_SQRT_PRICE ? MIN_SQRT_PRICE + 1n : limit;
  return limit >= MAX_SQRT_PRICE ? MAX_SQRT_PRICE - 1n : limit;
}

export function isqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError('negative');
  if (value < 2n) return value;
  let x = BigInt(Math.floor(Math.sqrt(Number(value))));
  // Newton refinement to correct floating error for large values.
  for (;;) {
    const y = (x + value / x) >> 1n;
    if (y >= x) {
      // Ensure floor.
      while (x * x > value) x -= 1n;
      while ((x + 1n) * (x + 1n) <= value) x += 1n;
      return x;
    }
    x = y;
  }
}
