import { describe, expect, it } from 'vitest';
import { Q96 } from './price';
import { MAX_SQRT_PRICE, MIN_SQRT_PRICE, amount0Delta, amount1Delta, isqrt, sqrtPriceLimitForTolerance, virtualSellQuote } from './virtualQuote';

describe('virtual start-of-block sell quote', () => {
  it('pays nothing when the checkpoint has no liquidity (fully clipped sell)', () => {
    const q = virtualSellQuote(1000n * Q96, 0n, 10n ** 21n, 3000);
    expect(q.amountOut).toBe(0n);
  });

  it('pays slightly less than the opening marginal price for a small sell', () => {
    // Price 1,000,000 NOSAND per ETH, deep liquidity: 1,000 NOSAND ≈ 0.001 ETH minus 0.3 % fee.
    const sqrt = 1000n * Q96;
    const liquidity = 10n ** 27n;
    const amountIn = 1000n * 10n ** 18n;
    const q = virtualSellQuote(sqrt, liquidity, amountIn, 3000);
    const marginal = amountIn / 1_000_000n; // 0.001 ETH
    const afterFee = (marginal * 997_000n) / 1_000_000n;
    expect(q.amountOut).toBeLessThanOrEqual(afterFee);
    expect(q.amountOut).toBeGreaterThan((afterFee * 9_999n) / 10_000n);
    expect(q.amountInUsed).toBe(amountIn);
    expect(q.sqrtPriceAfter).toBeGreaterThan(sqrt);
  });

  it('gives less output per unit as the sell grows (monotone, concave)', () => {
    const sqrt = 1000n * Q96;
    const liquidity = 10n ** 22n;
    const small = virtualSellQuote(sqrt, liquidity, 10n ** 21n, 3000).amountOut;
    const large = virtualSellQuote(sqrt, liquidity, 10n ** 22n, 3000).amountOut;
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThan(small * 10n);
  });

  it('caps at the pool price bound for an absurd sell', () => {
    const sqrt = 1000n * Q96;
    const liquidity = 1n;
    const q = virtualSellQuote(sqrt, liquidity, 10n ** 30n, 3000);
    expect(q.sqrtPriceAfter).toBe(MAX_SQRT_PRICE - 1n);
    expect(q.amountInUsed).toBeLessThan(10n ** 30n);
  });

  it('matches SqrtPriceMath deltas for a unit case', () => {
    // L = 2^96, from sqrtP = 1×Q96 to 2×Q96: amount0 = L(1/1 − 1/2) = 2^95, amount1 = L(2 − 1) = 2^96.
    expect(amount0Delta(Q96, 2n * Q96, Q96, false)).toBe(1n << 95n);
    expect(amount1Delta(Q96, 2n * Q96, Q96, false)).toBe(Q96);
    expect(amount1Delta(Q96, 2n * Q96, Q96, true)).toBe(Q96);
  });
});

describe('price limit for PoolSwapTest', () => {
  it('moves the sqrt limit by sqrt(1 ± tolerance)', () => {
    const sqrt = 1000n * Q96;
    const down = sqrtPriceLimitForTolerance(sqrt, true, 10_000n); // 1 % lower price
    const up = sqrtPriceLimitForTolerance(sqrt, false, 10_000n);
    // sqrt(0.99) ≈ 0.994987, sqrt(1.01) ≈ 1.004988
    expect(Number(down) / Number(sqrt)).toBeCloseTo(0.994987, 5);
    expect(Number(up) / Number(sqrt)).toBeCloseTo(1.004988, 5);
  });

  it('clamps to the valid bounds', () => {
    expect(sqrtPriceLimitForTolerance(MIN_SQRT_PRICE + 5n, true, 500_000n)).toBe(MIN_SQRT_PRICE + 1n);
    expect(sqrtPriceLimitForTolerance(MAX_SQRT_PRICE - 5n, false, 500_000n)).toBe(MAX_SQRT_PRICE - 1n);
  });

  it('integer square root is exact', () => {
    expect(isqrt(0n)).toBe(0n);
    expect(isqrt(15n)).toBe(3n);
    expect(isqrt(16n)).toBe(4n);
    const big = (1n << 200n) + 12345n;
    const r = isqrt(big);
    expect(r * r <= big && (r + 1n) * (r + 1n) > big).toBe(true);
  });
});
