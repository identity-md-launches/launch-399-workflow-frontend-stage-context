import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type PublicClient, type WalletClient } from 'viem';
import { describe, expect, it } from 'vitest';
import { revertReason, runSteps, type Step } from './tx';

const HASH = '0x4563950a8fc937f6f06b958982aae1689511cc2dd3ea34da5c33e846a4c5239c' as const;
const abi = [{ type: 'function', name: 'approve', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' }] as const;

function fakeClients(options: { simulateFails?: boolean; signFails?: boolean; receiptStatus?: 'success' | 'reverted' }) {
  const publicClient = {
    async simulateContract(args: unknown) {
      if (options.simulateFails) {
        const errorAbi = [{ type: 'error', name: 'CheckpointCannotFillExactOutput', inputs: [] }] as const;
        throw new BaseError('Execution reverted', {
          cause: new ContractFunctionRevertedError({ abi: errorAbi, functionName: 'approve', data: encodeErrorResult({ abi: errorAbi, errorName: 'CheckpointCannotFillExactOutput' }) }),
        });
      }
      return { request: args };
    },
    async waitForTransactionReceipt() {
      return { status: options.receiptStatus ?? 'success', blockNumber: 11791660n };
    },
  } as unknown as PublicClient;
  const walletClient = {
    chain: { id: 11155111 },
    async writeContract() {
      if (options.signFails) throw { code: 4001, message: 'User rejected the request.' };
      return HASH;
    },
  } as unknown as WalletClient;
  return { publicClient, walletClient };
}

describe('runSteps', () => {
  it('simulates, signs, waits and reports each step, skipping satisfied ones', async () => {
    const updates: Step[][] = [];
    const { publicClient, walletClient } = fakeClients({});
    const ok = await runSteps(
      { publicClient, walletClient, account: '0x0000000000000000000000000000000000000001', chainId: 11155111, onUpdate: (s) => updates.push(s) },
      [
        { id: 'approve', label: 'Approve', request: async () => null },
        { id: 'swap', label: 'Swap', request: async () => ({ address: '0x0000000000000000000000000000000000000002', abi, functionName: 'approve', args: [] }) },
      ],
    );
    expect(ok).toBe(true);
    const last = updates.at(-1)!;
    expect(last.map((s) => s.state)).toEqual(['skipped', 'done']);
    expect(last[1]?.hash).toBe(HASH);
    expect(last[1]?.detail).toContain('11791660');
  });

  it('stops with the decoded revert reason when simulation fails', async () => {
    const updates: Step[][] = [];
    const { publicClient, walletClient } = fakeClients({ simulateFails: true });
    const ok = await runSteps(
      { publicClient, walletClient, account: '0x0000000000000000000000000000000000000001', chainId: 11155111, onUpdate: (s) => updates.push(s) },
      [
        { id: 'swap', label: 'Swap', request: async () => ({ address: '0x0000000000000000000000000000000000000002', abi, functionName: 'approve', args: [] }) },
        { id: 'never', label: 'Never', request: async () => ({ address: '0x0000000000000000000000000000000000000002', abi, functionName: 'approve', args: [] }) },
      ],
    );
    expect(ok).toBe(false);
    const last = updates.at(-1)!;
    expect(last[0]?.state).toBe('failed');
    expect(last[0]?.detail).toContain('CheckpointCannotFillExactOutput');
    expect(last[1]?.state).toBe('pending');
  });

  it('reports a wallet rejection on the signing step', async () => {
    const updates: Step[][] = [];
    const { publicClient, walletClient } = fakeClients({ signFails: true });
    const ok = await runSteps(
      { publicClient, walletClient, account: '0x0000000000000000000000000000000000000001', chainId: 11155111, onUpdate: (s) => updates.push(s) },
      [{ id: 'swap', label: 'Swap', request: async () => ({ address: '0x0000000000000000000000000000000000000002', abi, functionName: 'approve', args: [] }) }],
    );
    expect(ok).toBe(false);
    expect(updates.at(-1)![0]?.detail).toBe('Request rejected in the wallet.');
  });

  it('marks an on-chain revert as failed', async () => {
    const updates: Step[][] = [];
    const { publicClient, walletClient } = fakeClients({ receiptStatus: 'reverted' });
    const ok = await runSteps(
      { publicClient, walletClient, account: '0x0000000000000000000000000000000000000001', chainId: 11155111, onUpdate: (s) => updates.push(s) },
      [{ id: 'swap', label: 'Swap', request: async () => ({ address: '0x0000000000000000000000000000000000000002', abi, functionName: 'approve', args: [] }) }],
    );
    expect(ok).toBe(false);
    expect(updates.at(-1)![0]?.detail).toBe('Transaction reverted on-chain.');
  });
});

describe('revertReason', () => {
  it('names an unknown selector when no ABI matches', () => {
    const error = new BaseError('Execution reverted', {
      cause: new ContractFunctionRevertedError({ abi: [], functionName: 'execute', data: '0xdeadbeef' }),
    });
    expect(revertReason(error)).toContain('0xdeadbeef');
  });
});
