import type { Deployment } from '../deployment';
import type { WalletState } from '../hooks/useWallet';
import { explorerAddress, shortAddress } from '../lib/format';

export function WalletPanel({ dep, wallet }: { dep: Deployment; wallet: WalletState }) {
  const { status, options, account, chainId, onExpectedChain, switching, error } = wallet;
  return (
    <div className="wallet-panel" aria-labelledby="wallet-heading">
      <h2 id="wallet-heading" className="visually-hidden">
        Wallet
      </h2>
      {status === 'discovering' ? <p className="small muted">Looking for a browser wallet…</p> : null}
      {status === 'none' ? (
        <p className="small muted" style={{ maxWidth: '32ch' }}>
          No browser wallet found. Install a wallet extension to buy or sell; reads work without one.
        </p>
      ) : null}
      {status === 'disconnected' || status === 'connecting' ? (
        <div className="btn-row">
          {options.length > 1 ? (
            options.map((option) => (
              <button key={option.id} type="button" className="btn primary" disabled={status === 'connecting'} onClick={() => void wallet.connect(option)}>
                Connect {option.name}
              </button>
            ))
          ) : (
            <button type="button" className="btn primary" disabled={status === 'connecting'} onClick={() => void wallet.connect()}>
              {status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      ) : null}
      {status === 'connected' && account ? (
        <>
          <p className="small">
            Connected as{' '}
            <a href={explorerAddress(dep.network.explorer, account)} target="_blank" rel="noreferrer" title={account}>
              <span className="mono">{shortAddress(account)}</span>
            </a>{' '}
            {onExpectedChain ? (
              <span className="badge ok">On {dep.network.name}</span>
            ) : (
              <span className="badge warn">Wrong network{chainId !== null ? ` (chain ${chainId})` : ''}</span>
            )}
          </p>
          <div className="btn-row">
            {!onExpectedChain ? (
              <button type="button" className="btn primary" disabled={switching} onClick={() => void wallet.switchChain()}>
                {switching ? 'Switching…' : `Switch to ${dep.network.name}`}
              </button>
            ) : null}
            <button type="button" className="btn small" onClick={wallet.disconnect}>
              Disconnect
            </button>
          </div>
        </>
      ) : null}
      <p className="small" role="status" aria-live="polite">
        {error ? <span className="notice err">{error}</span> : null}
      </p>
    </div>
  );
}
