import type { Address, Hex } from 'viem';

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function explorerAddress(explorer: string, address: Address): string {
  return `${explorer.replace(/\/$/, '')}/address/${address}`;
}

export function explorerTx(explorer: string, hash: Hex): string {
  return `${explorer.replace(/\/$/, '')}/tx/${hash}`;
}

export function explorerBlock(explorer: string, block: bigint): string {
  return `${explorer.replace(/\/$/, '')}/block/${block.toString()}`;
}

/** Locale-independent integer grouping for block numbers etc. */
export function groupInt(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function relativeAge(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
