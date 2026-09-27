import { describe, expect, it } from 'vitest';
import { applySlippage, formatAmount, formatRatio, invert, parseAmount, parsePercentToPips, token1PerToken0 } from './price';

describe('price arithmetic', () => {
  it('converts the launch sqrtPriceX96 (1000 × 2^96) to 1,000,000 NOSAND per ETH', () => {
    const sqrt = 1000n * (1n << 96n);
    const ratio = token1PerToken0(sqrt, 18, 18);
    expect(formatRatio(ratio, 7)).toBe('1,000,000');
    expect(formatRatio(invert(ratio), 4)).toBe('0.000001');
  });

  it('converts the live opening sqrtPriceX96 to 50,000,000 NOSAND per ETH', () => {
    const sqrt = 0x1b9f115c1e507f3671e7b7d2f216n;
    expect(formatRatio(token1PerToken0(sqrt, 18, 18), 7)).toBe('50,000,000');
    expect(formatRatio(invert(token1PerToken0(sqrt, 18, 18)), 4)).toBe('0.00000002');
  });

  it('adjusts for differing decimals', () => {
    const sqrt = 1n << 96n; // raw price 1
    expect(formatRatio(token1PerToken0(sqrt, 18, 6), 6)).toBe('1,000,000,000,000');
    expect(formatRatio(token1PerToken0(sqrt, 6, 18), 6)).toBe('0.000000000001');
  });

  it('rounds ratios half up at the last significant digit', () => {
    expect(formatRatio({ num: 2n, den: 3n }, 4)).toBe('0.6667');
    expect(formatRatio({ num: 123456789n, den: 1000n }, 6)).toBe('123,457');
    expect(formatRatio({ num: 0n, den: 5n })).toBe('0');
    expect(formatRatio({ num: 1n, den: 0n })).toBe('—');
  });

  it('formats and parses token amounts', () => {
    expect(formatAmount(1_500_000_000_000_000_000n, 18, 6)).toBe('1.5');
    expect(formatAmount(123_456_789_000_000_000_000_000n, 18, 4)).toBe('123,456.789');
    expect(formatAmount(1n, 18, 6)).toBe('0');
    expect(formatAmount(-2_000_000n, 6, 6)).toBe('-2');
    expect(parseAmount('0.001', 18)).toBe(1_000_000_000_000_000n);
    expect(parseAmount('1,000', 18)).toBe(1000n * 10n ** 18n);
    expect(parseAmount('.5', 18)).toBe(5n * 10n ** 17n);
    expect(parseAmount('abc', 18)).toBeNull();
    expect(parseAmount('', 18)).toBeNull();
    expect(parseAmount('1.1234567', 6)).toBeNull();
  });

  it('parses slippage percentages to pips and applies them', () => {
    expect(parsePercentToPips('1', 50)).toBe(10_000n);
    expect(parsePercentToPips('0.5', 50)).toBe(5_000n);
    expect(parsePercentToPips('51', 50)).toBeNull();
    expect(parsePercentToPips('-1', 50)).toBeNull();
    expect(parsePercentToPips('x', 50)).toBeNull();
    expect(applySlippage(1_000_000n, 10_000n)).toBe(990_000n);
    expect(applySlippage(1_000_000n, 0n)).toBe(1_000_000n);
  });
});
