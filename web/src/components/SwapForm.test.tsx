import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type PublicClient } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { quoterAbi } from '../config';
import type { Deployment } from '../deployment';
import type { WalletState } from '../hooks/useWallet';
import { launchPoolKey } from '../lib/poolKey';
import type { PoolSnapshot, WalletSnapshot } from '../lib/reads';
import { SwapForm } from './SwapForm';
import { WalletPanel } from './WalletPanel';

const TOKEN = '0xa26a6de1daf41775daee351cf4bc10a35f7bf2b3';
const HOOK = '0xe0fd49f077d0b1251215ad1e15133b15e13a00c4';

const dep = {
  chainId: 11155111,
  chainIdHex: '0xaa36a7',
  network: {
    chainId: 11155111,
    name: 'Sepolia',
    testnet: true,
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    explorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    faucets: [],
    uniswapV4: {
      poolManager: '0xe03a1074c86cfedd5c142c4f04f1a1536e203543',
      universalRouter: '0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b',
      quoter: '0x61b3f2011a92d183c7dbadbda940a7555ccf9227',
      stateView: '0xe1dd9c3fa50edb962e442f60dfbc432e24537e4c',
      positionManager: '0x429ba70129df741b2ca2a85bc3a2a3328e5c09b4',
      permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    },
  },
  uniswap: {
    poolManager: '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543',
    universalRouter: '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
    quoter: '0x61B3f2011A92d183C7dbaDBdA940a7555Ccf9227',
    stateView: '0xE1Dd9c3fA50EDa962e442F60DfBc432e24537E4C',
    positionManager: '0x429ba70129df741B2cA2a85BC3A2a3328e5c09b4',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
  token: { name: 'NOSAND', address: TOKEN, abi: [], abiHash: '', abiPath: 'abi/NOSAND.json' },
  hook: { name: 'AntiSandwichHook', address: HOOK, abi: [], abiHash: '', abiPath: 'abi/AntiSandwichHook.json' },
  contracts: [],
  walletAddChain: { chainId: '0xaa36a7', chainName: 'Sepolia', rpcUrls: [], nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, blockExplorerUrls: [] },
  manifest: {} as never,
} as unknown as Deployment;

const snapshot: PoolSnapshot = {
  blockNumber: 11791760n,
  sqrtPriceX96: 0x1b9f115c1e507f3671e7b7d2f216n,
  tick: 177284,
  protocolFee: 0,
  lpFee: 3000,
  liquidity: 0n,
  checkpoint: { blockNumber: 0n, sqrtPriceX96: 0n, tick: 0, liquidity: 0n, ticksCopied: 0 },
  collectedEth: 0n,
  collectedToken: 0n,
  maxCheckpointTicks: 100n,
  fetchedAt: 0,
};

const walletData: WalletSnapshot = {
  eth: 10n ** 18n,
  token: 5000n * 10n ** 18n,
  tokenAllowanceToPermit2: 0n,
  permit2RouterAllowance: { amount: 0n, expiration: 0 },
  tokenAllowanceToPoolSwapTest: 0n,
  fetchedAt: 0,
};

function walletState(overrides: Partial<WalletState> = {}): WalletState {
  return {
    status: 'connected',
    options: [],
    selected: null,
    account: '0x09ec38170e94532eddb57c69dfc4f1fdcd0d4a60',
    chainId: 11155111,
    onExpectedChain: true,
    switching: false,
    error: null,
    walletClient: null,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(),
    switchChain: vi.fn(async () => {}),
    ...overrides,
  };
}

function quoterClient(behaviour: 'ok' | 'noLiquidity'): PublicClient {
  return {
    async simulateContract(args: { functionName: string; args: [{ zeroForOne: boolean; exactAmount: bigint }] }) {
      expect(args.functionName).toBe('quoteExactInputSingle');
      if (behaviour === 'noLiquidity') {
        // What the live Sepolia quoter returns for an unfillable sell: the pool's
        // NotEnoughLiquidity(poolId) revert wrapped in the quoter's UnexpectedRevertBytes(bytes).
        throw new BaseError('reverted', {
          cause: new ContractFunctionRevertedError({
            abi: quoterAbi,
            functionName: 'quoteExactInputSingle',
            data: encodeErrorResult({
              abi: quoterAbi,
              errorName: 'UnexpectedRevertBytes',
              args: ['0x7a5ed734d9bc858b2634a50ce407fd204d5963576337aae840f3a99156be92f1f3a0eba1'],
            }),
          }),
        });
      }
      const amountIn = args.args[0].exactAmount;
      // 50,000,000 NOSAND per ETH less 0.3 %.
      return { result: [(amountIn * 50_000_000n * 997n) / 1000n, 191258n] };
    },
  } as unknown as PublicClient;
}

const ok = { ok: true, reason: null };

describe('SwapForm', () => {
  it('quotes a buy, shows rate and minimum received, and keeps the submit control enabled', async () => {
    const user = userEvent.setup();
    render(
      <SwapForm dep={dep} client={quoterClient('ok')} poolKey={launchPoolKey(TOKEN, HOOK)} snapshot={snapshot} wallet={walletState()} walletData={walletData} routerCheck={{ ok: true, detail: '' }} tokenSymbol="NOSAND" tokenDecimals={18} txAllowed={ok} onDone={() => {}} />,
    );
    await user.type(screen.getByLabelText('You pay (ETH)'), '0.001');
    await waitFor(() => expect(screen.getByText('Expected output')).toBeInTheDocument());
    expect(screen.getByText('49,850 NOSAND')).toBeInTheDocument();
    expect(screen.getByText('49,850,000 NOSAND per ETH')).toBeInTheDocument();
    expect(screen.getByText('49,351.5 NOSAND')).toBeInTheDocument(); // 1 % slippage
    expect(screen.getByRole('button', { name: 'Buy NOSAND' })).toBeEnabled();
  });

  it('explains a sell the pool cannot fill and blocks submission with a focused error', async () => {
    const user = userEvent.setup();
    render(
      <SwapForm dep={dep} client={quoterClient('noLiquidity')} poolKey={launchPoolKey(TOKEN, HOOK)} snapshot={snapshot} wallet={walletState()} walletData={walletData} routerCheck={{ ok: true, detail: '' }} tokenSymbol="NOSAND" tokenDecimals={18} txAllowed={ok} onDone={() => {}} />,
    );
    await user.click(screen.getByLabelText('Sell NOSAND for ETH'));
    const amount = screen.getByLabelText('You pay (NOSAND)');
    await user.type(amount, '1000');
    await waitFor(() => expect(screen.getByText(/cannot fill this sell/)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Sell NOSAND' }));
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveFocus();
    expect(screen.getByText(/first swap of its block/)).toBeInTheDocument();
  });

  it('rejects an amount above the balance on submit', async () => {
    const user = userEvent.setup();
    render(
      <SwapForm dep={dep} client={quoterClient('ok')} poolKey={launchPoolKey(TOKEN, HOOK)} snapshot={snapshot} wallet={walletState()} walletData={walletData} routerCheck={{ ok: true, detail: '' }} tokenSymbol="NOSAND" tokenDecimals={18} txAllowed={ok} onDone={() => {}} />,
    );
    await user.type(screen.getByLabelText('You pay (ETH)'), '2');
    await waitFor(() => expect(screen.getByText('Expected output')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Buy NOSAND' }));
    expect(screen.getByText(/exceeds your balance of 1 ETH/)).toBeInTheDocument();
  });

  it('disables the swap control with a reason when transactions are not allowed', () => {
    render(
      <SwapForm dep={dep} client={quoterClient('ok')} poolKey={launchPoolKey(TOKEN, HOOK)} snapshot={snapshot} wallet={walletState({ status: 'disconnected', account: null, onExpectedChain: false })} walletData={null} routerCheck={null} tokenSymbol="NOSAND" tokenDecimals={18} txAllowed={{ ok: false, reason: 'Connect a wallet to send transactions.' }} onDone={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Buy NOSAND' })).toBeDisabled();
    expect(screen.getByText('Connect a wallet to send transactions.')).toBeInTheDocument();
    expect(screen.getByLabelText('PoolSwapTest router')).toBeDisabled();
  });

  it('shows the start-of-block bound for a sell when the pool has liquidity', async () => {
    const user = userEvent.setup();
    const liquid = { ...snapshot, liquidity: 10n ** 27n };
    render(
      <SwapForm dep={dep} client={quoterClient('ok')} poolKey={launchPoolKey(TOKEN, HOOK)} snapshot={liquid} wallet={walletState()} walletData={walletData} routerCheck={{ ok: true, detail: '' }} tokenSymbol="NOSAND" tokenDecimals={18} txAllowed={ok} onDone={() => {}} />,
    );
    await user.click(screen.getByLabelText('Sell NOSAND for ETH'));
    await user.type(screen.getByLabelText('You pay (NOSAND)'), '1000');
    await waitFor(() => expect(screen.getByText(/Start-of-block bound/)).toBeInTheDocument());
    expect(screen.getByText(/at most 0\.0000199/)).toBeInTheDocument();
  });
});

describe('WalletPanel', () => {
  it('offers a single switch control on the wrong network', async () => {
    const user = userEvent.setup();
    const wallet = walletState({ chainId: 1, onExpectedChain: false });
    render(<WalletPanel dep={dep} wallet={wallet} />);
    expect(screen.getByText(/Wrong network/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    expect(wallet.switchChain).toHaveBeenCalledTimes(1);
  });

  it('explains when no wallet exists and shows connect otherwise', () => {
    const { rerender } = render(<WalletPanel dep={dep} wallet={walletState({ status: 'none', account: null })} />);
    expect(screen.getByText(/No browser wallet found/)).toBeInTheDocument();
    rerender(<WalletPanel dep={dep} wallet={walletState({ status: 'disconnected', account: null })} />);
    expect(screen.getByRole('button', { name: 'Connect wallet' })).toBeEnabled();
  });
});
