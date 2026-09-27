import { useMemo, useState } from 'react';
import { ActivityPanel } from './components/ActivityPanel';
import { ContractsPanel } from './components/ContractsPanel';
import { HookPanel } from './components/HookPanel';
import { PricePanel } from './components/PricePanel';
import { SwapForm } from './components/SwapForm';
import { TransferForm } from './components/TransferForm';
import { WalletPanel } from './components/WalletPanel';
import { MANIFEST_PATH } from './config';
import type { Deployment } from './deployment';
import { useDeployment } from './hooks/useDeployment';
import { usePoolData, useWalletData } from './hooks/usePoolData';
import { useWallet } from './hooks/useWallet';
import { launchPoolKey, poolIdOf } from './lib/poolKey';
import { makePublicClient } from './lib/reads';

export function App() {
  const load = useDeployment();
  if (load.state === 'loading') {
    return (
      <main className="page" id="main">
        <h1>Nosandwich (NOSAND)</h1>
        <p className="muted">Loading deployment configuration…</p>
      </main>
    );
  }
  if (load.state === 'error') {
    return (
      <main className="page" id="main">
        <h1>Nosandwich (NOSAND)</h1>
        <p className="notice err" role="alert">
          Unable to load {MANIFEST_PATH}: {load.message}. The page cannot show pool data without it. Reload to try again.
        </p>
      </main>
    );
  }
  return <Ready dep={load.deployment} />;
}

function Ready({ dep }: { dep: Deployment }) {
  const client = useMemo(() => makePublicClient(dep), [dep]);
  const poolKey = useMemo(() => launchPoolKey(dep.token.address, dep.hook.address), [dep]);
  const poolId = useMemo(() => poolIdOf(poolKey), [poolKey]);
  const pool = usePoolData(client, dep, poolId);
  const wallet = useWallet(dep);
  const [walletTick, setWalletTick] = useState(0);
  const walletData = useWalletData(client, dep, wallet.account, walletTick + (pool.snapshot ? Number(pool.snapshot.blockNumber % 1000n) : 0));
  const tokenSymbol = pool.statics?.tokenSymbol ?? dep.token.name;
  const tokenDecimals = pool.statics?.tokenDecimals ?? 18;
  const native = dep.network.nativeCurrency.symbol;

  const codeOk = pool.codeChecks ? [dep.token.name, dep.hook.name, 'PoolManager'].every((name) => pool.codeChecks?.[name]?.ok) : null;
  const txAllowed = (() => {
    if (wallet.status === 'none') return { ok: false, reason: 'Install a browser wallet to send transactions.' };
    if (wallet.status !== 'connected' || !wallet.account) return { ok: false, reason: 'Connect a wallet to send transactions.' };
    if (!wallet.onExpectedChain) return { ok: false, reason: `Switch the wallet to ${dep.network.name} first.` };
    if (codeOk === null) return { ok: false, reason: 'Verifying deployed contract code…' };
    if (!codeOk) return { ok: false, reason: 'Deployed code could not be verified on this chain; transactions stay disabled.' };
    return { ok: true, reason: null };
  })();

  const afterTx = () => {
    void pool.refresh();
    setWalletTick((t) => t + 1);
  };

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <main className="page" id="main">
        <header className="page-header">
          <div>
            <h1>Nosandwich (NOSAND)</h1>
            <p className="lede">
              A Uniswap v4 pool on {dep.network.name} whose hook caps every sell after the first swap of a block at the block’s opening price.
              Read the start-of-block and current prices, see what each sell was clipped, and buy or sell {tokenSymbol} with {native}.
            </p>
          </div>
          <WalletPanel dep={dep} wallet={wallet} />
        </header>
        {walletData.error ? (
          <p className="notice warn" role="status">
            Unable to read wallet balances: {walletData.error}
          </p>
        ) : null}
        <div className="grid-2">
          <PricePanel
            dep={dep}
            snapshot={pool.snapshot}
            error={pool.snapshotError}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            refreshing={pool.refreshing}
            onRefresh={() => void pool.refresh()}
          />
          <SwapForm
            dep={dep}
            client={client}
            poolKey={poolKey}
            snapshot={pool.snapshot}
            wallet={wallet}
            walletData={walletData.wallet}
            routerCheck={pool.routerCheck}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            txAllowed={txAllowed}
            onDone={afterTx}
          />
          <div className="stack">
            <HookPanel
              dep={dep}
              client={client}
              poolKey={poolKey}
              poolId={poolId}
              snapshot={pool.snapshot}
              statics={pool.statics}
              wallet={wallet}
              tokenSymbol={tokenSymbol}
              tokenDecimals={tokenDecimals}
              txAllowed={txAllowed}
              onDone={afterTx}
            />
            <TransferForm
              dep={dep}
              client={client}
              wallet={wallet}
              walletData={walletData.wallet}
              tokenSymbol={tokenSymbol}
              tokenDecimals={tokenDecimals}
              txAllowed={txAllowed}
              onDone={afterTx}
            />
          </div>
          <ActivityPanel
            dep={dep}
            activity={pool.activity}
            loading={pool.activityLoading}
            error={pool.activityError}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
          />
          <div className="span-2">
            <ContractsPanel dep={dep} codeChecks={pool.codeChecks} routerCheck={pool.routerCheck} />
          </div>
        </div>
        <footer className="footer">
          <p>
            Test network only. Prices here can lag other markets because same-block arbitrage is dampened. The hook keeps clipped sell
            proceeds for LPs; it has no owner, fee switch or upgrade path. Reads go through the public RPC endpoints listed above; transactions
            are signed by your wallet.
          </p>
        </footer>
      </main>
    </>
  );
}
