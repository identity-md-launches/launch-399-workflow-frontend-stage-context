// Read-only chain access through the manifest's public RPC URLs (fallback order as listed).
import {
  createPublicClient,
  defineChain,
  fallback,
  getAbiItem,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from 'viem';
import { DEPLOYMENT_BLOCK, EVENT_SCAN, POOL_SWAP_TEST_ROUTER, permit2Abi, poolManagerAbi, poolSwapTestAbi, stateViewAbi } from '../config';
import type { Deployment } from '../deployment';
import { ZERO_ADDRESS } from './poolKey';

export function chainFromDeployment(dep: Deployment): Chain {
  return defineChain({
    id: dep.chainId,
    name: dep.network.name,
    testnet: dep.network.testnet,
    nativeCurrency: dep.network.nativeCurrency,
    rpcUrls: { default: { http: dep.network.rpcUrls } },
    blockExplorers: { default: { name: 'Explorer', url: dep.network.explorer } },
  });
}

export function makePublicClient(dep: Deployment): PublicClient {
  return createPublicClient({
    chain: chainFromDeployment(dep),
    transport: fallback(
      dep.network.rpcUrls.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  }) as PublicClient;
}

export interface Checkpoint {
  blockNumber: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  ticksCopied: number;
}

export interface PoolSnapshot {
  blockNumber: bigint;
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
  liquidity: bigint;
  checkpoint: Checkpoint;
  collectedEth: bigint;
  collectedToken: bigint;
  maxCheckpointTicks: bigint;
  fetchedAt: number;
}

export async function readPoolSnapshot(client: PublicClient, dep: Deployment, poolId: Hex): Promise<PoolSnapshot> {
  const [blockNumber, slot0, liquidity, checkpoint, collectedEth, collectedToken, maxCheckpointTicks] = await Promise.all([
    client.getBlockNumber({ cacheTime: 0 }),
    client.readContract({ address: dep.uniswap.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] }),
    client.readContract({ address: dep.uniswap.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] }),
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'checkpoint', args: [poolId] }) as Promise<
      readonly [bigint, bigint, number, bigint, number]
    >,
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'collected', args: [poolId, ZERO_ADDRESS] }) as Promise<bigint>,
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'collected', args: [poolId, dep.token.address] }) as Promise<bigint>,
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'MAX_CHECKPOINT_TICKS' }) as Promise<bigint>,
  ]);
  return {
    blockNumber,
    sqrtPriceX96: slot0[0],
    tick: slot0[1],
    protocolFee: slot0[2],
    lpFee: slot0[3],
    liquidity,
    checkpoint: {
      blockNumber: checkpoint[0],
      sqrtPriceX96: checkpoint[1],
      tick: checkpoint[2],
      liquidity: checkpoint[3],
      ticksCopied: checkpoint[4],
    },
    collectedEth,
    collectedToken,
    maxCheckpointTicks,
    fetchedAt: Date.now(),
  };
}

export interface Statics {
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  totalSupply: bigint;
  hookPoolManager: Address;
  /** Names of the hook permission flags that are true. */
  permissions: string[];
}

const PERMISSION_NAMES = [
  'beforeInitialize',
  'afterInitialize',
  'beforeAddLiquidity',
  'afterAddLiquidity',
  'beforeRemoveLiquidity',
  'afterRemoveLiquidity',
  'beforeSwap',
  'afterSwap',
  'beforeDonate',
  'afterDonate',
  'beforeSwapReturnDelta',
  'afterSwapReturnDelta',
  'afterAddLiquidityReturnDelta',
  'afterRemoveLiquidityReturnDelta',
] as const;

/** Values that never change: token metadata and the hook's declared permissions. */
export async function readStatics(client: PublicClient, dep: Deployment): Promise<Statics> {
  const token = { address: dep.token.address, abi: dep.token.abi } as const;
  const [tokenSymbol, tokenName, tokenDecimals, totalSupply, hookPoolManager, permissions] = await Promise.all([
    client.readContract({ ...token, functionName: 'symbol' }) as Promise<string>,
    client.readContract({ ...token, functionName: 'name' }) as Promise<string>,
    client.readContract({ ...token, functionName: 'decimals' }) as Promise<number>,
    client.readContract({ ...token, functionName: 'totalSupply' }) as Promise<bigint>,
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'poolManager' }) as Promise<Address>,
    client.readContract({ address: dep.hook.address, abi: dep.hook.abi, functionName: 'getHookPermissions' }) as Promise<Record<string, boolean>>,
  ]);
  return {
    tokenSymbol,
    tokenName,
    tokenDecimals: Number(tokenDecimals),
    totalSupply,
    hookPoolManager,
    permissions: PERMISSION_NAMES.filter((name) => permissions[name] === true),
  };
}

export interface WalletSnapshot {
  eth: bigint;
  token: bigint;
  tokenAllowanceToPermit2: bigint;
  permit2RouterAllowance: { amount: bigint; expiration: number };
  tokenAllowanceToPoolSwapTest: bigint;
  fetchedAt: number;
}

export async function readWalletSnapshot(client: PublicClient, dep: Deployment, account: Address): Promise<WalletSnapshot> {
  const [eth, token, tokenAllowanceToPermit2, permit2Allowance, tokenAllowanceToPoolSwapTest] = await Promise.all([
    client.getBalance({ address: account }),
    client.readContract({ address: dep.token.address, abi: dep.token.abi, functionName: 'balanceOf', args: [account] }) as Promise<bigint>,
    client.readContract({ address: dep.token.address, abi: dep.token.abi, functionName: 'allowance', args: [account, dep.uniswap.permit2] }) as Promise<bigint>,
    client.readContract({
      address: dep.uniswap.permit2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [account, dep.token.address, dep.uniswap.universalRouter],
    }),
    client.readContract({ address: dep.token.address, abi: dep.token.abi, functionName: 'allowance', args: [account, POOL_SWAP_TEST_ROUTER] }) as Promise<bigint>,
  ]);
  return {
    eth,
    token,
    tokenAllowanceToPermit2,
    permit2RouterAllowance: { amount: permit2Allowance[0], expiration: permit2Allowance[1] },
    tokenAllowanceToPoolSwapTest,
    fetchedAt: Date.now(),
  };
}

export interface CodeCheck {
  ok: boolean;
  detail: string;
}

/** The handoff asks to verify deployed code on the stated chain before enabling transactions. */
export async function checkDeployedCode(client: PublicClient, dep: Deployment): Promise<Record<string, CodeCheck>> {
  const targets: [string, Address][] = [
    [dep.token.name, dep.token.address],
    [dep.hook.name, dep.hook.address],
    ['PoolManager', dep.uniswap.poolManager],
    ['StateView', dep.uniswap.stateView],
    ['Quoter', dep.uniswap.quoter],
    ['UniversalRouter', dep.uniswap.universalRouter],
    ['Permit2', dep.uniswap.permit2],
  ];
  const results = await Promise.all(
    targets.map(async ([name, address]) => {
      try {
        const code = await client.getCode({ address });
        const ok = !!code && code !== '0x';
        return [name, { ok, detail: ok ? `${(code!.length - 2) / 2} bytes of code` : 'no code at this address' }] as const;
      } catch (error) {
        return [name, { ok: false, detail: `code check failed: ${(error as Error).message}` }] as const;
      }
    }),
  );
  return Object.fromEntries(results);
}

/** PoolSwapTest is not in the vetted network block: require code and the right manager. */
export async function checkPoolSwapTestRouter(client: PublicClient, dep: Deployment): Promise<CodeCheck> {
  try {
    const code = await client.getCode({ address: POOL_SWAP_TEST_ROUTER });
    if (!code || code === '0x') return { ok: false, detail: 'no code at the PoolSwapTest address' };
    const manager = await client.readContract({ address: POOL_SWAP_TEST_ROUTER, abi: poolSwapTestAbi, functionName: 'manager' });
    if (manager.toLowerCase() !== dep.uniswap.poolManager.toLowerCase()) {
      return { ok: false, detail: `PoolSwapTest.manager() is ${manager}, not the manifest PoolManager` };
    }
    return { ok: true, detail: `${(code.length - 2) / 2} bytes of code; manager() matches the PoolManager` };
  } catch (error) {
    return { ok: false, detail: `router check failed: ${(error as Error).message}` };
  }
}

export interface ClipRecord {
  currency: Address;
  amount: bigint;
  logIndex: number;
}

export interface SellRow {
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  sender: Address;
  /** NOSAND paid by the seller (positive). */
  tokenIn: bigint;
  /** ETH received by the seller (positive, after the hook's clip). */
  ethOut: bigint;
  sqrtPriceAfter: bigint;
  tick: number;
  clipped: ClipRecord[];
}

export interface SwapRow {
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  sender: Address;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceAfter: bigint;
  tick: number;
}

export interface HookEventRow {
  kind: 'Clipped' | 'Donated';
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  currency: Address;
  amount: bigint;
}

export interface ActivityScan {
  sells: SellRow[];
  swaps: SwapRow[];
  hookEvents: HookEventRow[];
  scannedFrom: bigint;
  scannedTo: bigint;
  complete: boolean;
}

const swapEvent = getAbiItem({ abi: poolManagerAbi, name: 'Swap' });

/**
 * Scan backwards from `latest` in windows for the pool's Swap events and the hook's Clipped /
 * Donated events, stopping once enough sells are found or the deployment block is reached.
 * Sells are swaps with a negative amount1 (the seller paid NOSAND); their Clipped events are
 * joined by transaction hash.
 */
export async function scanPoolActivity(client: PublicClient, dep: Deployment, poolId: Hex, latest: bigint): Promise<ActivityScan> {
  const clippedEvent = getAbiItem({ abi: dep.hook.abi, name: 'Clipped' } as never) as never;
  const donatedEvent = getAbiItem({ abi: dep.hook.abi, name: 'Donated' } as never) as never;
  const swaps: SwapRow[] = [];
  const hookEvents: HookEventRow[] = [];
  let to = latest;
  let from = latest;
  let windows = 0;
  let complete = false;
  while (windows < EVENT_SCAN.maxWindows) {
    from = to - EVENT_SCAN.windowBlocks + 1n;
    if (from < DEPLOYMENT_BLOCK) from = DEPLOYMENT_BLOCK;
    const [swapLogs, hookLogs] = await Promise.all([
      client.getLogs({ address: dep.uniswap.poolManager, event: swapEvent, args: { id: poolId }, fromBlock: from, toBlock: to }),
      client.getLogs({ address: dep.hook.address, events: [clippedEvent, donatedEvent], fromBlock: from, toBlock: to }),
    ]);
    for (const log of swapLogs) {
      const args = log.args;
      swaps.push({
        txHash: log.transactionHash!,
        blockNumber: log.blockNumber!,
        logIndex: log.logIndex!,
        sender: args.sender!,
        amount0: args.amount0!,
        amount1: args.amount1!,
        sqrtPriceAfter: args.sqrtPriceX96!,
        tick: args.tick!,
      });
    }
    for (const log of hookLogs as Array<{ eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint; logIndex: number }>) {
      if (String(log.args.poolId).toLowerCase() !== poolId.toLowerCase()) continue;
      hookEvents.push({
        kind: log.eventName as 'Clipped' | 'Donated',
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        currency: log.args.currency as Address,
        amount: log.args.amount as bigint,
      });
    }
    windows += 1;
    const sellCount = swaps.filter((s) => s.amount1 < 0n).length;
    if (from <= DEPLOYMENT_BLOCK) {
      complete = true;
      break;
    }
    if (sellCount >= EVENT_SCAN.maxSells && hookEvents.length >= EVENT_SCAN.maxHookEvents) break;
    to = from - 1n;
  }
  const byOrder = (a: { blockNumber: bigint; logIndex: number }, b: { blockNumber: bigint; logIndex: number }) =>
    a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber > b.blockNumber ? -1 : 1;
  swaps.sort(byOrder);
  hookEvents.sort(byOrder);
  const clippedByTx = new Map<string, ClipRecord[]>();
  for (const event of hookEvents) {
    if (event.kind !== 'Clipped') continue;
    const list = clippedByTx.get(event.txHash) ?? [];
    list.push({ currency: event.currency, amount: event.amount, logIndex: event.logIndex });
    clippedByTx.set(event.txHash, list);
  }
  const sells: SellRow[] = swaps
    .filter((s) => s.amount1 < 0n)
    .slice(0, EVENT_SCAN.maxSells)
    .map((s) => ({
      txHash: s.txHash,
      blockNumber: s.blockNumber,
      logIndex: s.logIndex,
      sender: s.sender,
      tokenIn: -s.amount1,
      ethOut: s.amount0,
      sqrtPriceAfter: s.sqrtPriceAfter,
      tick: s.tick,
      // A Clipped log precedes its Swap log in the same transaction (afterSwap runs inside swap).
      clipped: (clippedByTx.get(s.txHash) ?? []).filter((c) => c.logIndex < s.logIndex),
    }));
  return { sells, swaps, hookEvents: hookEvents.slice(0, EVENT_SCAN.maxHookEvents), scannedFrom: from, scannedTo: latest, complete };
}
