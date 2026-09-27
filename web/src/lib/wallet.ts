// Browser wallet discovery (EIP-6963 with a window.ethereum fallback) and chain switching with
// the wallet_addEthereumChain fallback. No WalletConnect project id is configured; injected
// wallets only.
import type { WalletAddChain } from '../deployment';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean };
  }
}

/** Collect EIP-6963 announced providers for a short window, then add a legacy fallback. */
export function discoverWallets(win: Window = window, waitMs = 300): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963Detail>).detail;
      if (!detail?.provider || !detail.info) return;
      found.set(detail.info.rdns || detail.info.uuid, {
        id: detail.info.rdns || detail.info.uuid,
        name: detail.info.name,
        icon: detail.info.icon,
        provider: detail.provider,
      });
    };
    win.addEventListener('eip6963:announceProvider', onAnnounce);
    win.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      win.removeEventListener('eip6963:announceProvider', onAnnounce);
      if (found.size === 0 && win.ethereum) {
        found.set('injected', {
          id: 'injected',
          name: win.ethereum.isMetaMask ? 'MetaMask' : 'Browser wallet',
          provider: win.ethereum,
        });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

export interface RpcErrorLike {
  code?: number;
  message?: string;
  data?: { originalError?: { code?: number } };
}

/** True when a switch failure means "this wallet does not know the chain". */
export function isUnknownChainError(error: unknown): boolean {
  const e = (error ?? {}) as RpcErrorLike;
  if (e.code === 4902 || e.data?.originalError?.code === 4902) return true;
  const message = (e.message ?? '').toLowerCase();
  return /unrecognized chain|unknown chain|not added|chain.*not (been )?added|could not find chain|no such chain/.test(message);
}

/** True when the visitor rejected a wallet prompt. */
export function isUserRejection(error: unknown): boolean {
  const e = (error ?? {}) as RpcErrorLike;
  return e.code === 4001 || /user rejected|user denied|rejected the request/i.test(e.message ?? '');
}

/**
 * Switch the wallet to the deployment chain; if the wallet reports an unknown chain, add it with
 * the network block's parameters and switch again. Throws the wallet's error otherwise.
 */
export async function switchOrAddChain(provider: Eip1193Provider, addChain: WalletAddChain): Promise<void> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: addChain.chainId }] });
    return;
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
  }
  await provider.request({ method: 'wallet_addEthereumChain', params: [addChain] });
  await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: addChain.chainId }] });
}

export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  return accounts ?? [];
}

export async function currentChainId(provider: Eip1193Provider): Promise<number> {
  const hex = (await provider.request({ method: 'eth_chainId' })) as string;
  return Number.parseInt(hex, 16);
}

/** Plain-language reason from a wallet / RPC / contract error. */
export function describeError(error: unknown): string {
  if (isUserRejection(error)) return 'Request rejected in the wallet.';
  const e = error as { shortMessage?: string; details?: string; message?: string; cause?: unknown } | undefined;
  const candidates = [e?.shortMessage, e?.details, e?.message];
  for (const text of candidates) {
    if (typeof text === 'string' && text.trim()) return text.split('\n')[0]!.slice(0, 240);
  }
  return 'Unknown error.';
}
