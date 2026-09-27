// Transaction sequencing: each contract write is one visible step (approve, Permit2 approve,
// swap), simulated first so a revert reason is shown before the wallet is asked to sign.
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { describeError } from './wallet';

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface Step {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
  hash?: Hex;
}

export interface WriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
  /** Extra ABIs whose errors should be decoded from a revert. */
  errorAbis?: Abi[];
}

export interface StepSpec {
  id: string;
  label: string;
  /** Return null to skip the step (e.g. allowance already sufficient). */
  request: () => Promise<WriteRequest | null>;
}

export interface RunnerContext {
  publicClient: PublicClient;
  walletClient: WalletClient;
  account: Address;
  chainId: number;
  onUpdate: (steps: Step[]) => void;
}

/**
 * Human-readable revert reason, naming the custom error when it is known. The v4 quoter wraps
 * the pool's revert as `UnexpectedRevertBytes(bytes)`; `innerAbis` lets that payload be decoded.
 */
export function revertReason(error: unknown, innerAbis: Abi[] = []): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName ?? reverted.reason;
      const rawArgs = reverted.data?.args ?? [];
      if (name === 'UnexpectedRevertBytes' && typeof rawArgs[0] === 'string' && innerAbis.length) {
        const inner = decodeInner(rawArgs[0] as Hex, innerAbis);
        if (inner) return inner;
      }
      const args = rawArgs.map((a) => String(a)).join(', ');
      if (name) return args ? `${name}(${args})` : name;
      if (reverted.signature) return `unknown error selector ${reverted.signature}`;
    }
    return error.shortMessage;
  }
  return describeError(error);
}

function decodeInner(data: Hex, abis: Abi[]): string | null {
  const errors = abis.flatMap((abi) => abi.filter((item) => item.type === 'error'));
  try {
    const decoded = decodeErrorResult({ abi: errors, data });
    const args = (decoded.args ?? []).map((a) => String(a)).join(', ');
    return args ? `${decoded.errorName}(${args})` : decoded.errorName;
  } catch {
    return null;
  }
}

/** Run steps in order; stops at the first failure. Returns true when all steps completed. */
export async function runSteps(ctx: RunnerContext, specs: StepSpec[]): Promise<boolean> {
  const steps: Step[] = specs.map((s) => ({ id: s.id, label: s.label, state: 'pending' }));
  const publish = () => ctx.onUpdate(steps.map((s) => ({ ...s })));
  publish();
  for (let i = 0; i < specs.length; i += 1) {
    const step = steps[i]!;
    const spec = specs[i]!;
    step.state = 'active';
    step.detail = 'Preparing…';
    publish();
    let request: WriteRequest | null;
    try {
      request = await spec.request();
    } catch (e) {
      step.state = 'failed';
      step.detail = describeError(e);
      publish();
      return false;
    }
    if (request === null) {
      step.state = 'skipped';
      step.detail = 'Already satisfied';
      publish();
      continue;
    }
    // 1. Simulate so a revert is explained before signing.
    step.detail = 'Simulating…';
    publish();
    const abi = [...request.abi, ...(request.errorAbis ?? []).flatMap((a) => a.filter((item) => item.type === 'error'))] as Abi;
    let simulated: { request: unknown };
    try {
      simulated = await ctx.publicClient.simulateContract({
        account: ctx.account,
        address: request.address,
        abi,
        functionName: request.functionName,
        args: request.args as never,
        value: request.value,
        chain: ctx.walletClient.chain,
      } as never);
    } catch (e) {
      step.state = 'failed';
      step.detail = `Simulation reverted: ${revertReason(e)}`;
      publish();
      return false;
    }
    // 2. Ask the wallet to sign.
    step.detail = 'Confirm in your wallet…';
    publish();
    let hash: Hex;
    try {
      hash = await ctx.walletClient.writeContract(simulated.request as never);
    } catch (e) {
      step.state = 'failed';
      step.detail = describeError(e);
      publish();
      return false;
    }
    step.hash = hash;
    step.detail = 'Waiting for confirmation…';
    publish();
    // 3. Wait for the receipt.
    try {
      const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== 'success') {
        step.state = 'failed';
        step.detail = 'Transaction reverted on-chain.';
        publish();
        return false;
      }
      step.state = 'done';
      step.detail = `Confirmed in block ${receipt.blockNumber.toString()}`;
      publish();
    } catch (e) {
      step.state = 'failed';
      step.detail = `Confirmation not received: ${describeError(e)}`;
      publish();
      return false;
    }
  }
  return true;
}
