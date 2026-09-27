import { describe, expect, it, vi } from 'vitest';
import { describeError, discoverWallets, isUnknownChainError, isUserRejection, switchOrAddChain, type Eip1193Provider } from './wallet';

const addChain = {
  chainId: '0xaa36a7' as const,
  chainName: 'Sepolia',
  rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

function providerWith(handler: (method: string, params: unknown) => unknown): Eip1193Provider & { calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    async request({ method, params }) {
      calls.push({ method, params });
      return handler(method, params);
    },
  };
}

describe('switchOrAddChain', () => {
  it('switches directly when the wallet knows the chain', async () => {
    const provider = providerWith(() => null);
    await switchOrAddChain(provider, addChain);
    expect(provider.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain']);
    expect(provider.calls[0]?.params).toEqual([{ chainId: '0xaa36a7' }]);
  });

  it('adds the chain with the network parameters after a 4902 and switches again', async () => {
    let known = false;
    const provider = providerWith((method) => {
      if (method === 'wallet_switchEthereumChain' && !known) throw { code: 4902, message: 'Unrecognized chain ID' };
      if (method === 'wallet_addEthereumChain') known = true;
      return null;
    });
    await switchOrAddChain(provider, addChain);
    expect(provider.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
    expect(provider.calls[1]?.params).toEqual([addChain]);
  });

  it('treats a nested MetaMask 4902 and message-only unknown-chain errors as add-chain cases', () => {
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true);
    expect(isUnknownChainError({ message: 'Unrecognized chain ID "0xaa36a7". Try adding the chain using wallet_addEthereumChain first.' })).toBe(true);
    expect(isUnknownChainError({ code: 4001, message: 'User rejected the request.' })).toBe(false);
  });

  it('propagates a rejection instead of adding the chain', async () => {
    const provider = providerWith((method) => {
      if (method === 'wallet_switchEthereumChain') throw { code: 4001, message: 'User rejected the request.' };
      return null;
    });
    await expect(switchOrAddChain(provider, addChain)).rejects.toMatchObject({ code: 4001 });
    expect(provider.calls.map((c) => c.method)).toEqual(['wallet_switchEthereumChain']);
  });
});

describe('error wording', () => {
  it('recognises user rejections and shortens other errors', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(describeError({ code: 4001, message: 'User rejected the request.' })).toBe('Request rejected in the wallet.');
    expect(describeError({ shortMessage: 'Execution reverted', message: 'long\nmultiline' })).toBe('Execution reverted');
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError(undefined)).toBe('Unknown error.');
  });
});

describe('discoverWallets', () => {
  it('collects EIP-6963 announcements and falls back to window.ethereum', async () => {
    vi.useFakeTimers();
    const win = window;
    const provider: Eip1193Provider = { request: async () => null };
    win.addEventListener('eip6963:requestProvider', () => {
      win.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: '1', name: 'Test Wallet', icon: '', rdns: 'test.wallet' }, provider } }));
    });
    const promise = discoverWallets(win, 10);
    vi.advanceTimersByTime(20);
    const found = await promise;
    expect(found.map((w) => w.name)).toEqual(['Test Wallet']);
    vi.useRealTimers();
  });
});
