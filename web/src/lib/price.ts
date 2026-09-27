// Exact price arithmetic on sqrtPriceX96 values. Everything is bigint; no Number squaring.

export const Q96 = 1n << 96n;
export const Q192 = 1n << 192n;

/** A non-negative rational number. */
export interface Ratio {
  num: bigint;
  den: bigint;
}

/**
 * Price of currency0 in currency1 (currency1 units per currency0 unit), as a ratio, adjusted
 * for decimals so the result is in whole-token terms.
 */
export function token1PerToken0(sqrtPriceX96: bigint, decimals0: number, decimals1: number): Ratio {
  let num = sqrtPriceX96 * sqrtPriceX96;
  let den = Q192;
  const shift = decimals0 - decimals1;
  if (shift > 0) num *= 10n ** BigInt(shift);
  else if (shift < 0) den *= 10n ** BigInt(-shift);
  return { num, den };
}

export function invert(ratio: Ratio): Ratio {
  return { num: ratio.den, den: ratio.num };
}

function groupThousands(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Render a ratio as a decimal string with `significant` significant digits (trailing zeros
 * of the fraction removed), grouping the integer part. Zero denominators render as "—".
 */
export function formatRatio(ratio: Ratio, significant = 6): string {
  if (ratio.den === 0n) return '—';
  if (ratio.num === 0n) return '0';
  const integer = ratio.num / ratio.den;
  const intDigits = integer === 0n ? 0 : integer.toString().length;
  // Fraction digits needed to reach `significant` digits overall; find leading zeros first.
  let fractionDigits = Math.max(0, significant - intDigits);
  if (integer === 0n) {
    let scaled = ratio.num * 10n;
    let leadingZeros = 0;
    while (scaled / ratio.den === 0n && leadingZeros < 60) {
      scaled *= 10n;
      leadingZeros += 1;
    }
    fractionDigits = leadingZeros + significant;
  }
  const scale = 10n ** BigInt(fractionDigits);
  // Round half up at the last kept digit.
  const scaledValue = (ratio.num * scale * 2n + ratio.den) / (ratio.den * 2n);
  const intPart = scaledValue / scale;
  let fracPart = (scaledValue % scale).toString().padStart(fractionDigits, '0').replace(/0+$/, '');
  const head = groupThousands(intPart.toString());
  return fracPart.length ? `${head}.${fracPart}` : head;
}

/** Fixed-point token amount → decimal string with at most `maxFraction` fraction digits. */
export function formatAmount(value: bigint, decimals: number, maxFraction = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const intPart = abs / base;
  let frac = (abs % base).toString().padStart(decimals, '0');
  if (maxFraction < decimals) {
    // Truncate rather than round so a displayed balance never exceeds the real one.
    frac = frac.slice(0, maxFraction);
  }
  frac = frac.replace(/0+$/, '');
  const head = groupThousands(intPart.toString());
  const text = frac.length ? `${head}.${frac}` : head;
  return negative ? `-${text}` : text;
}

/** Parse a decimal string typed by a visitor into fixed-point units. Returns null if invalid. */
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.') return null;
  const [intText = '0', fracText = ''] = trimmed.split('.');
  if (fracText.length > decimals) return null;
  const whole = BigInt(intText || '0');
  const frac = BigInt((fracText + '0'.repeat(decimals)).slice(0, decimals) || '0');
  return whole * 10n ** BigInt(decimals) + frac;
}

/** Percent string ("0.5") → parts per million as bigint, or null if invalid / out of range. */
export function parsePercentToPips(text: string, maxPercent: number): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null;
  const [intText = '0', fracText = ''] = trimmed.split('.');
  const pips = BigInt(intText) * 10_000n + BigInt((fracText + '0000').slice(0, 4));
  if (pips > BigInt(maxPercent) * 10_000n) return null;
  return pips;
}

/** Apply a slippage tolerance (parts per million) to a quoted output: floor(out × (1 − tol)). */
export function applySlippage(amountOut: bigint, tolerancePips: bigint): bigint {
  return (amountOut * (1_000_000n - tolerancePips)) / 1_000_000n;
}
