import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { POOL } from '../config';

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/** The launch pool: paired currency (native ETH) and the token, sorted ascending when both are tokens. */
export function launchPoolKey(token: Address, hook: Address): PoolKey {
  const paired = POOL.pairedCurrency;
  let currency0 = paired;
  let currency1 = token;
  if (paired !== ZERO_ADDRESS && BigInt(paired) > BigInt(token)) {
    currency0 = token;
    currency1 = paired;
  }
  return { currency0, currency1, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: hook };
}

/** PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'uint24' },
        { type: 'int24' },
        { type: 'address' },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

/** Tuple form accepted by viem for `PoolKey` struct arguments. */
export function poolKeyTuple(key: PoolKey) {
  return {
    currency0: key.currency0,
    currency1: key.currency1,
    fee: key.fee,
    tickSpacing: key.tickSpacing,
    hooks: key.hooks,
  } as const;
}
