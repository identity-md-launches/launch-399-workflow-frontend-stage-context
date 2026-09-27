import type { Deployment } from '../deployment';
import { explorerBlock, groupInt } from '../lib/format';
import { formatAmount, formatRatio, invert, token1PerToken0 } from '../lib/price';
import type { PoolSnapshot } from '../lib/reads';

interface Props {
  dep: Deployment;
  snapshot: PoolSnapshot | null;
  error: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  refreshing: boolean;
  onRefresh: () => void;
}

function PriceFigure({ sqrtPriceX96, tokenSymbol, tokenDecimals, native }: { sqrtPriceX96: bigint; tokenSymbol: string; tokenDecimals: number; native: string }) {
  const perEth = token1PerToken0(sqrtPriceX96, 18, tokenDecimals);
  return (
    <>
      <dd className="value">
        {formatRatio(perEth, 7)} {tokenSymbol} per {native}
      </dd>
      <dd className="small muted">
        {formatRatio(invert(perEth), 4)} {native} per {tokenSymbol}
      </dd>
    </>
  );
}

export function PricePanel({ dep, snapshot, error, tokenSymbol, tokenDecimals, refreshing, onRefresh }: Props) {
  const native = dep.network.nativeCurrency.symbol;
  const explorer = dep.network.explorer;
  const checkpoint = snapshot?.checkpoint;
  const hasCheckpoint = !!checkpoint && checkpoint.blockNumber !== 0n;
  const checkpointCurrent = hasCheckpoint && snapshot !== null && checkpoint.blockNumber === snapshot.blockNumber;
  return (
    <section className="card span-2" aria-labelledby="price-heading">
      <div className="card-head">
        <h2 id="price-heading">Pool price</h2>
        <div className="btn-row">
          {snapshot ? (
            <span className="caption num">
              Read at block{' '}
              <a href={explorerBlock(explorer, snapshot.blockNumber)} target="_blank" rel="noreferrer">
                {groupInt(snapshot.blockNumber)}
              </a>
            </span>
          ) : null}
          <button type="button" className="btn small" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error ? (
        <p className="notice err" role="alert">
          Unable to read the pool: {error}. Check your connection and refresh.
        </p>
      ) : null}
      {!snapshot && !error ? <p className="muted">Reading the pool from {dep.network.name}…</p> : null}
      {snapshot ? (
        <div className="price-pair">
          <dl className="stats">
            <div className="stat">
              <dt>
                Start-of-block price{' '}
                {hasCheckpoint ? (
                  checkpointCurrent ? (
                    <span className="badge ok">Current block</span>
                  ) : (
                    <span className="badge">Last swap block</span>
                  )
                ) : (
                  <span className="badge">No checkpoint yet</span>
                )}
              </dt>
              {hasCheckpoint ? (
                <PriceFigure sqrtPriceX96={checkpoint.sqrtPriceX96} tokenSymbol={tokenSymbol} tokenDecimals={tokenDecimals} native={native} />
              ) : (
                <dd className="muted">The hook has not checkpointed this pool: no swap has happened yet.</dd>
              )}
              {hasCheckpoint ? (
                <dd className="caption">
                  Captured before the first swap of block{' '}
                  <a href={explorerBlock(explorer, checkpoint.blockNumber)} target="_blank" rel="noreferrer">
                    {groupInt(checkpoint.blockNumber)}
                  </a>
                  ; tick {groupInt(checkpoint.tick)}, liquidity {formatAmount(checkpoint.liquidity, 0, 0)}, {checkpoint.ticksCopied} tick
                  {checkpoint.ticksCopied === 1 ? '' : 's'} copied.
                  {!checkpointCurrent ? ' A new block starts a new checkpoint at the first swap.' : ' Sells in this block are capped at this price.'}
                </dd>
              ) : null}
            </div>
          </dl>
          <dl className="stats">
            <div className="stat">
              <dt>Current price</dt>
              <PriceFigure sqrtPriceX96={snapshot.sqrtPriceX96} tokenSymbol={tokenSymbol} tokenDecimals={tokenDecimals} native={native} />
              <dd className="caption">
                Tick {groupInt(snapshot.tick)}, in-range liquidity {formatAmount(snapshot.liquidity, 0, 0)}, LP fee {(snapshot.lpFee / 10_000).toFixed(2)} %.
                {snapshot.liquidity === 0n ? ' No liquidity is in range at this price, so a sell cannot fill right now.' : ''}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </section>
  );
}
