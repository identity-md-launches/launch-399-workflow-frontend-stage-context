import { POOL_SWAP_TEST_ROUTER } from '../config';
import type { Deployment } from '../deployment';
import { explorerAddress } from '../lib/format';
import type { CodeCheck } from '../lib/reads';

interface Props {
  dep: Deployment;
  codeChecks: Record<string, CodeCheck> | null;
  routerCheck: CodeCheck | null;
}

function CodeBadge({ check }: { check: CodeCheck | undefined | null }) {
  if (!check) return <span className="badge">Checking code…</span>;
  return <span className={`badge ${check.ok ? 'ok' : 'err'}`}>{check.ok ? 'Code verified' : 'No code'}</span>;
}

export function ContractsPanel({ dep, codeChecks, routerCheck }: Props) {
  const explorer = dep.network.explorer;
  const rows: { name: string; address: `0x${string}`; role: string; check: CodeCheck | null | undefined; abi?: { path: string; hash: string } }[] = [
    ...dep.contracts.map((c) => ({
      name: c.name,
      address: c.address,
      role: c.name === dep.token.name ? 'Launch token (ERC-20, fixed supply)' : 'Uniswap v4 hook on the pool',
      check: codeChecks?.[c.name],
      abi: { path: c.abiPath, hash: c.abiHash },
    })),
    { name: 'PoolManager', address: dep.uniswap.poolManager, role: 'Uniswap v4 core; emits Swap events', check: codeChecks?.PoolManager },
    { name: 'StateView', address: dep.uniswap.stateView, role: 'Read-only pool state (price, liquidity)', check: codeChecks?.StateView },
    { name: 'Quoter', address: dep.uniswap.quoter, role: 'Swap quotes (simulated, never a transaction)', check: codeChecks?.Quoter },
    { name: 'UniversalRouter', address: dep.uniswap.universalRouter, role: 'Default swap route', check: codeChecks?.UniversalRouter },
    { name: 'Permit2', address: dep.uniswap.permit2, role: 'Token allowances for the Universal Router', check: codeChecks?.Permit2 },
    { name: 'PositionManager', address: dep.uniswap.positionManager, role: 'Liquidity positions (not used by this page)', check: undefined },
    { name: 'PoolSwapTest', address: POOL_SWAP_TEST_ROUTER, role: 'Uniswap test router, alternative swap route', check: routerCheck },
  ];
  return (
    <section className="card" aria-labelledby="contracts-heading">
      <h2 id="contracts-heading">Contracts and deployment</h2>
      <dl className="stats" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="stat">
          <dt>Network</dt>
          <dd>
            {dep.network.name} (chain {dep.chainId}){dep.network.testnet ? ', testnet' : ''}
          </dd>
        </div>
        <div className="stat">
          <dt>Launch ID</dt>
          <dd>
            <code>{dep.manifest.launchId}</code>
          </dd>
        </div>
        <div className="stat">
          <dt>Source commit</dt>
          <dd>
            <code>{dep.manifest.sourceCommit}</code>
          </dd>
        </div>
        <div className="stat">
          <dt>Attestation hash</dt>
          <dd>
            <code>{dep.manifest.attestationHash}</code>
          </dd>
        </div>
      </dl>
      <ul className="contract-list">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="btn-row" style={{ gap: 'var(--s-2)' }}>
              <span className="name">{row.name}</span>
              {row.name === 'PositionManager' ? null : <CodeBadge check={row.check} />}
            </div>
            <span className="small muted">{row.role}</span>
            <a href={explorerAddress(explorer, row.address)} target="_blank" rel="noreferrer">
              <span className="mono">{row.address}</span>
            </a>
            {row.abi ? (
              <span className="caption">
                ABI:{' '}
                <a href={`./${row.abi.path}`} target="_blank" rel="noreferrer">
                  {row.abi.path}
                </a>{' '}
                · keccak <code>{row.abi.hash.slice(0, 16)}…</code>
              </span>
            ) : null}
            {row.check && !row.check.ok ? <span className="caption">{row.check.detail}</span> : null}
          </li>
        ))}
      </ul>
      <p className="caption" style={{ marginTop: 'var(--s-4)' }}>
        Public RPC endpoints: {dep.network.rpcUrls.join(', ')}. Faucets:{' '}
        {dep.network.faucets.map((url, i) => (
          <span key={url}>
            {i > 0 ? ', ' : ''}
            <a href={url} target="_blank" rel="noreferrer">
              {new URL(url).hostname}
            </a>
          </span>
        ))}
        .
      </p>
    </section>
  );
}
