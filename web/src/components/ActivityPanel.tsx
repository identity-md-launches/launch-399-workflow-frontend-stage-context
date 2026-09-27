import type { Deployment } from '../deployment';
import { explorerAddress, explorerBlock, explorerTx, groupInt, shortAddress, shortHash } from '../lib/format';
import { ZERO_ADDRESS } from '../lib/poolKey';
import { formatAmount, formatRatio, token1PerToken0 } from '../lib/price';
import type { ActivityScan } from '../lib/reads';

interface Props {
  dep: Deployment;
  activity: ActivityScan | null;
  loading: boolean;
  error: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
}

export function ActivityPanel({ dep, activity, loading, error, tokenSymbol, tokenDecimals }: Props) {
  const explorer = dep.network.explorer;
  const native = dep.network.nativeCurrency.symbol;
  const unit = (currency: string) => (currency.toLowerCase() === ZERO_ADDRESS ? native : tokenSymbol);
  const decimals = (currency: string) => (currency.toLowerCase() === ZERO_ADDRESS ? 18 : tokenDecimals);
  return (
    <section className="card span-2" aria-labelledby="sells-heading">
      <div className="card-head">
        <h2 id="sells-heading">Recent sells and clipped amounts</h2>
        {activity ? (
          <span className="caption num">
            Scanned blocks {groupInt(activity.scannedFrom)}–{groupInt(activity.scannedTo)}
            {activity.complete ? ' (since deployment)' : ' (most recent window)'}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="notice err" role="alert">
          Unable to load events: {error}. Refresh to try again.
        </p>
      ) : null}
      {loading && !activity ? <p className="muted">Scanning swap and hook events…</p> : null}
      {activity && activity.sells.length === 0 ? (
        <div>
          <p>
            <strong>No sells yet</strong>
          </p>
          <p className="small muted">
            Sells ({tokenSymbol} to {native}) appear here with the amount the hook clipped from each one.
            {activity.swaps.length > 0 ? ` ${activity.swaps.length} buy${activity.swaps.length === 1 ? '' : 's'} found in the scanned range.` : ''}
          </p>
        </div>
      ) : null}
      {activity && activity.sells.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Transaction</th>
                <th scope="col">Router</th>
                <th scope="col" className="num">
                  {tokenSymbol} sold
                </th>
                <th scope="col" className="num">
                  {native} received
                </th>
                <th scope="col" className="num">
                  Clipped
                </th>
                <th scope="col" className="num">
                  Price after ({tokenSymbol}/{native})
                </th>
              </tr>
            </thead>
            <tbody>
              {activity.sells.map((sell) => (
                <tr key={`${sell.txHash}-${sell.logIndex}`}>
                  <td className="num">
                    <a href={explorerBlock(explorer, sell.blockNumber)} target="_blank" rel="noreferrer">
                      {groupInt(sell.blockNumber)}
                    </a>
                  </td>
                  <td>
                    <a href={explorerTx(explorer, sell.txHash)} target="_blank" rel="noreferrer" title={sell.txHash}>
                      <span className="mono">{shortHash(sell.txHash)}</span>
                    </a>
                  </td>
                  <td>
                    <a href={explorerAddress(explorer, sell.sender)} target="_blank" rel="noreferrer" title={sell.sender}>
                      <span className="mono">{shortAddress(sell.sender)}</span>
                    </a>
                  </td>
                  <td className="num">{formatAmount(sell.tokenIn, tokenDecimals, 4)}</td>
                  <td className="num">{formatAmount(sell.ethOut, 18, 8)}</td>
                  <td className="num">
                    {sell.clipped.length === 0
                      ? 'Not clipped'
                      : sell.clipped.map((c, i) => (
                          <span key={i}>
                            {i > 0 ? ', ' : ''}
                            {formatAmount(c.amount, decimals(c.currency), 8)} {unit(c.currency)}
                          </span>
                        ))}
                  </td>
                  <td className="num">{formatRatio(token1PerToken0(sell.sqrtPriceAfter, 18, tokenDecimals), 6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h3 style={{ marginTop: 'var(--s-6)', marginBottom: 'var(--s-2)' }}>Hook events</h3>
      {activity && activity.hookEvents.length === 0 ? (
        <p className="small muted">No Clipped or Donated events in the scanned range.</p>
      ) : null}
      {activity && activity.hookEvents.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Block</th>
                <th scope="col">Transaction</th>
                <th scope="col" className="num">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {activity.hookEvents.map((event) => (
                <tr key={`${event.txHash}-${event.logIndex}`}>
                  <td>{event.kind}</td>
                  <td className="num">
                    <a href={explorerBlock(explorer, event.blockNumber)} target="_blank" rel="noreferrer">
                      {groupInt(event.blockNumber)}
                    </a>
                  </td>
                  <td>
                    <a href={explorerTx(explorer, event.txHash)} target="_blank" rel="noreferrer" title={event.txHash}>
                      <span className="mono">{shortHash(event.txHash)}</span>
                    </a>
                  </td>
                  <td className="num">
                    {formatAmount(event.amount, decimals(event.currency), 8)} {unit(event.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
