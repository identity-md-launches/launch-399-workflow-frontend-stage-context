import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, Hex, PublicClient } from 'viem';
import { REFRESH_MS } from '../config';
import type { Deployment } from '../deployment';
import {
  checkDeployedCode,
  checkPoolSwapTestRouter,
  readPoolSnapshot,
  readStatics,
  readWalletSnapshot,
  scanPoolActivity,
  type ActivityScan,
  type CodeCheck,
  type PoolSnapshot,
  type Statics,
  type WalletSnapshot,
} from '../lib/reads';
import { describeError } from '../lib/wallet';

export interface PoolData {
  snapshot: PoolSnapshot | null;
  snapshotError: string | null;
  activity: ActivityScan | null;
  activityError: string | null;
  activityLoading: boolean;
  codeChecks: Record<string, CodeCheck> | null;
  routerCheck: CodeCheck | null;
  statics: Statics | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/** Pool, hook and activity reads with periodic refresh. */
export function usePoolData(client: PublicClient | null, dep: Deployment | null, poolId: Hex | null): PoolData {
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityScan | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [codeChecks, setCodeChecks] = useState<Record<string, CodeCheck> | null>(null);
  const [routerCheck, setRouterCheck] = useState<CodeCheck | null>(null);
  const [statics, setStatics] = useState<Statics | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastScannedBlock = useRef<bigint | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !dep || !poolId) return;
    setRefreshing(true);
    try {
      const next = await readPoolSnapshot(client, dep, poolId);
      setSnapshot(next);
      setSnapshotError(null);
      if (lastScannedBlock.current === null || next.blockNumber > lastScannedBlock.current) {
        setActivityLoading(true);
        try {
          const scan = await scanPoolActivity(client, dep, poolId, next.blockNumber);
          setActivity(scan);
          setActivityError(null);
          lastScannedBlock.current = next.blockNumber;
        } catch (e) {
          setActivityError(describeError(e));
        } finally {
          setActivityLoading(false);
        }
      }
    } catch (e) {
      setSnapshotError(describeError(e));
    } finally {
      setRefreshing(false);
    }
  }, [client, dep, poolId]);

  useEffect(() => {
    if (!client || !dep) return;
    let cancelled = false;
    void refresh();
    checkDeployedCode(client, dep).then((r) => !cancelled && setCodeChecks(r));
    checkPoolSwapTestRouter(client, dep).then((r) => !cancelled && setRouterCheck(r));
    readStatics(client, dep)
      .then((r) => !cancelled && setStatics(r))
      .catch((e) => !cancelled && setSnapshotError(describeError(e)));
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, dep, refresh]);

  return { snapshot, snapshotError, activity, activityError, activityLoading, codeChecks, routerCheck, statics, refreshing, refresh };
}

export interface WalletData {
  wallet: WalletSnapshot | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useWalletData(client: PublicClient | null, dep: Deployment | null, account: Address | null, tick: number): WalletData {
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!client || !dep || !account) {
      setWallet(null);
      return;
    }
    try {
      setWallet(await readWalletSnapshot(client, dep, account));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [client, dep, account]);
  useEffect(() => {
    void refresh();
  }, [refresh, tick]);
  return { wallet, error, refresh };
}
