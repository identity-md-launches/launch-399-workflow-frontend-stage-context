import { useId, useState, type FormEvent } from 'react';
import { getAddress, isAddress, type PublicClient } from 'viem';
import type { Deployment } from '../deployment';
import type { WalletState } from '../hooks/useWallet';
import { formatAmount, parseAmount } from '../lib/price';
import type { WalletSnapshot } from '../lib/reads';
import { runSteps, type Step } from '../lib/tx';
import { Steps } from './Steps';

interface Props {
  dep: Deployment;
  client: PublicClient;
  wallet: WalletState;
  walletData: WalletSnapshot | null;
  tokenSymbol: string;
  tokenDecimals: number;
  txAllowed: { ok: boolean; reason: string | null };
  onDone: () => void;
}

export function TransferForm({ dep, client, wallet, walletData, tokenSymbol, tokenDecimals, txAllowed, onDone }: Props) {
  const id = useId();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<{ to?: string; amount?: string }>({});
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: { to?: string; amount?: string } = {};
    if (!isAddress(to.trim(), { strict: false })) next.to = 'Enter a 0x address with 40 hex characters.';
    const value = parseAmount(amount, tokenDecimals);
    if (value === null || value <= 0n) next.amount = `Enter a positive ${tokenSymbol} amount with at most ${tokenDecimals} decimals.`;
    else if (walletData && value > walletData.token) next.amount = `Amount exceeds your balance of ${formatAmount(walletData.token, tokenDecimals, 4)} ${tokenSymbol}.`;
    setErrors(next);
    if (next.to || next.amount || !wallet.walletClient || !wallet.account || value === null) {
      const first = document.getElementById(next.to ? `${id}-to` : `${id}-amount`);
      first?.focus();
      return;
    }
    setRunning(true);
    try {
      const ok = await runSteps(
        { publicClient: client, walletClient: wallet.walletClient, account: wallet.account, chainId: dep.chainId, onUpdate: setSteps },
        [
          {
            id: 'transfer',
            label: `Transfer ${formatAmount(value, tokenDecimals, 4)} ${tokenSymbol}`,
            request: async () => ({ address: dep.token.address, abi: dep.token.abi, functionName: 'transfer', args: [getAddress(to.trim()), value] }),
          },
        ],
      );
      if (ok) {
        setAmount('');
        onDone();
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <details>
      <summary>Transfer {tokenSymbol}</summary>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <div className="field">
          <label htmlFor={`${id}-to`}>Recipient address</label>
          <input
            id={`${id}-to`}
            className="input mono"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={errors.to ? 'true' : undefined}
            aria-describedby={errors.to ? `${id}-to-error` : undefined}
          />
          {errors.to ? (
            <span id={`${id}-to-error`} className="error">
              {errors.to}
            </span>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor={`${id}-amount`}>Amount ({tokenSymbol})</label>
          <input
            id={`${id}-amount`}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-invalid={errors.amount ? 'true' : undefined}
            aria-describedby={errors.amount ? `${id}-amount-error` : `${id}-amount-hint`}
          />
          <span id={`${id}-amount-hint`} className="hint">
            {walletData ? `Balance ${formatAmount(walletData.token, tokenDecimals, 4)} ${tokenSymbol}` : 'Connect a wallet to see your balance.'}
          </span>
          {errors.amount ? (
            <span id={`${id}-amount-error`} className="error">
              {errors.amount}
            </span>
          ) : null}
        </div>
        <div className="btn-row">
          <button type="submit" className="btn" disabled={!txAllowed.ok || running}>
            {running ? 'Transferring…' : `Transfer ${tokenSymbol}`}
          </button>
          {!txAllowed.ok && txAllowed.reason ? <span className="caption">{txAllowed.reason}</span> : null}
        </div>
        <div role="status" aria-live="polite">
          <Steps steps={steps} explorer={dep.network.explorer} />
        </div>
      </form>
    </details>
  );
}
