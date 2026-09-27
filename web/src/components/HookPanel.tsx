import { useState } from 'react';
import type { PublicClient } from 'viem';
import type { Deployment } from '../deployment';
import type { WalletState } from '../hooks/useWallet';
import { explorerAddress, shortAddress } from '../lib/format';
import { poolKeyTuple, type PoolKey } from '../lib/poolKey';
import { formatAmount } from '../lib/price';
import type { PoolSnapshot, Statics } from '../lib/reads';
import { runSteps, type Step } from '../lib/tx';
import { Steps } from './Steps';

interface Props {
  dep: Deployment;
  client: PublicClient;
  poolKey: PoolKey;
  poolId: string;
  snapshot: PoolSnapshot | null;
  statics: Statics | null;
  wallet: WalletState;
  tokenSymbol: string;
  tokenDecimals: number;
  txAllowed: { ok: boolean; reason: string | null };
  onDone: () => void;
}

export function HookPanel({ dep, client, poolKey, poolId, snapshot, statics, wallet, tokenSymbol, tokenDecimals, txAllowed, onDone }: Props) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const native = dep.network.nativeCurrency.symbol;
  const nothingCollected = !!snapshot && snapshot.collectedEth === 0n && snapshot.collectedToken === 0n;

  async function donate() {
    if (!wallet.walletClient || !wallet.account) return;
    setRunning(true);
    try {
      const ok = await runSteps(
        { publicClient: client, walletClient: wallet.walletClient, account: wallet.account, chainId: dep.chainId, onUpdate: setSteps },
        [
          {
            id: 'donate',
            label: 'Donate collected claims to in-range LPs',
            request: async () => ({
              address: dep.hook.address,
              abi: dep.hook.abi,
              functionName: 'donateCollected',
              args: [poolKeyTuple(poolKey)],
            }),
          },
        ],
      );
      if (ok) onDone();
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="card" aria-labelledby="hook-heading">
      <h2 id="hook-heading">Anti-sandwich hook</h2>
      <dl className="stats">
        <div className="stat">
          <dt>Collected, not yet donated</dt>
          <dd>
            {snapshot ? `${formatAmount(snapshot.collectedEth, 18, 8)} ${native} · ${formatAmount(snapshot.collectedToken, tokenDecimals, 4)} ${tokenSymbol}` : '…'}
          </dd>
        </div>
        <div className="stat">
          <dt>Checkpoint loop cap</dt>
          <dd>{snapshot ? `${snapshot.maxCheckpointTicks.toString()} tick-spacing steps (MAX_CHECKPOINT_TICKS)` : '…'}</dd>
        </div>
        <div className="stat">
          <dt>Enabled permissions</dt>
          <dd>{statics ? statics.permissions.join(', ') : '…'}</dd>
        </div>
        <div className="stat">
          <dt>Pool manager bound at construction</dt>
          <dd>
            {statics ? (
              <a href={explorerAddress(dep.network.explorer, statics.hookPoolManager)} target="_blank" rel="noreferrer" title={statics.hookPoolManager}>
                <span className="mono">{shortAddress(statics.hookPoolManager)}</span>
              </a>
            ) : (
              '…'
            )}
            {statics && statics.hookPoolManager.toLowerCase() !== dep.uniswap.poolManager.toLowerCase() ? (
              <span className="badge err"> Differs from the network PoolManager</span>
            ) : null}
          </dd>
        </div>
        <div className="stat">
          <dt>Pool ID</dt>
          <dd>
            <code>{poolId}</code>
          </dd>
        </div>
      </dl>
      <p className="small muted" style={{ marginTop: 'var(--s-4)' }}>
        Clipped sell proceeds are held as claims and donated to LPs in range. Anyone may trigger the donation; when there is nothing to
        donate or no liquidity in range, the call does nothing.
      </p>
      <div className="btn-row" style={{ marginTop: 'var(--s-3)' }}>
        <button type="button" className="btn" disabled={!txAllowed.ok || running} onClick={() => void donate()}>
          {running ? 'Donating…' : 'Donate collected claims'}
        </button>
        {!txAllowed.ok && txAllowed.reason ? <span className="caption">{txAllowed.reason}</span> : null}
        {txAllowed.ok && nothingCollected ? <span className="caption">Nothing is collected right now; the call would be a no-op.</span> : null}
      </div>
      <div style={{ marginTop: 'var(--s-3)' }} role="status" aria-live="polite">
        <Steps steps={steps} explorer={dep.network.explorer} />
      </div>
    </section>
  );
}
