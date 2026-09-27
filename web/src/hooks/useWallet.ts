import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, getAddress, type Address, type WalletClient } from 'viem';
import type { Deployment } from '../deployment';
import { chainFromDeployment } from '../lib/reads';
import {
  currentChainId,
  describeError,
  discoverWallets,
  isUserRejection,
  requestAccounts,
  switchOrAddChain,
  type Eip1193Provider,
  type WalletOption,
} from '../lib/wallet';

export type WalletStatus = 'discovering' | 'none' | 'disconnected' | 'connecting' | 'connected';

export interface WalletState {
  status: WalletStatus;
  options: WalletOption[];
  selected: WalletOption | null;
  account: Address | null;
  chainId: number | null;
  onExpectedChain: boolean;
  switching: boolean;
  error: string | null;
  walletClient: WalletClient | null;
  connect: (option?: WalletOption) => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
}

/** Injected wallet lifecycle: discovery, connection, chain tracking and switching. */
export function useWallet(dep: Deployment | null, win: Window | undefined = typeof window === 'undefined' ? undefined : window): WalletState {
  const [status, setStatus] = useState<WalletStatus>('discovering');
  const [options, setOptions] = useState<WalletOption[]>([]);
  const [selected, setSelected] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);

  useEffect(() => {
    if (!win) {
      setStatus('none');
      return;
    }
    let cancelled = false;
    discoverWallets(win).then((found) => {
      if (cancelled) return;
      setOptions(found);
      setStatus(found.length ? 'disconnected' : 'none');
    });
    return () => {
      cancelled = true;
    };
  }, [win]);

  // Track account and chain changes from the selected provider.
  useEffect(() => {
    const provider = selected?.provider;
    if (!provider?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = (args[0] as string[]) ?? [];
      if (accounts.length === 0) {
        setAccount(null);
        setStatus('disconnected');
      } else {
        setAccount(getAddress(accounts[0]!));
      }
    };
    const onChain = (...args: unknown[]) => {
      setChainId(Number.parseInt(String(args[0]), 16));
    };
    provider.on('accountsChanged', onAccounts);
    provider.on('chainChanged', onChain);
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
    };
  }, [selected]);

  const connect = useCallback(
    async (option?: WalletOption) => {
      const chosen = option ?? options[0];
      if (!chosen) {
        setError('No browser wallet was found. Install a wallet extension and reload.');
        return;
      }
      setError(null);
      setStatus('connecting');
      try {
        const accounts = await requestAccounts(chosen.provider);
        if (accounts.length === 0) throw new Error('The wallet returned no account.');
        providerRef.current = chosen.provider;
        setSelected(chosen);
        setAccount(getAddress(accounts[0]!));
        setChainId(await currentChainId(chosen.provider));
        setStatus('connected');
      } catch (e) {
        setStatus('disconnected');
        setError(isUserRejection(e) ? 'Connection request rejected in the wallet.' : describeError(e));
      }
    },
    [options],
  );

  const disconnect = useCallback(() => {
    providerRef.current = null;
    setSelected(null);
    setAccount(null);
    setChainId(null);
    setStatus(options.length ? 'disconnected' : 'none');
    setError(null);
  }, [options.length]);

  const switchChain = useCallback(async () => {
    const provider = providerRef.current;
    if (!provider || !dep) return;
    setSwitching(true);
    setError(null);
    try {
      await switchOrAddChain(provider, dep.walletAddChain);
      setChainId(await currentChainId(provider));
    } catch (e) {
      setError(isUserRejection(e) ? 'Network switch rejected in the wallet.' : `Unable to switch network: ${describeError(e)}`);
    } finally {
      setSwitching(false);
    }
  }, [dep]);

  const walletClient = useMemo(() => {
    if (!dep || !selected || !account) return null;
    return createWalletClient({ account, chain: chainFromDeployment(dep), transport: custom(selected.provider) });
  }, [dep, selected, account]);

  return {
    status,
    options,
    selected,
    account,
    chainId,
    onExpectedChain: dep !== null && chainId === dep.chainId,
    switching,
    error,
    walletClient,
    connect,
    disconnect,
    switchChain,
  };
}
