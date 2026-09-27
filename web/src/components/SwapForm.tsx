import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Abi, PublicClient } from 'viem';
import {
  DEADLINE_SECONDS,
  PERMIT2_EXPIRATION_SECONDS,
  POOL,
  POOL_SWAP_TEST_ROUTER,
  SLIPPAGE,
  permit2Abi,
  poolManagerAbi,
  poolSwapTestAbi,
  quoterAbi,
  universalRouterAbi,
} from '../config';
import type { Deployment } from '../deployment';
import type { WalletState } from '../hooks/useWallet';
import { formatAmount, formatRatio, parseAmount, parsePercentToPips, applySlippage } from '../lib/price';
import { poolKeyTuple, type PoolKey } from '../lib/poolKey';
import type { CodeCheck, PoolSnapshot, WalletSnapshot } from '../lib/reads';
import { encodeUniversalRouterSwap, poolSwapTestArgs } from '../lib/swapEncoding';
import { revertReason, runSteps, type Step } from '../lib/tx';
import { sqrtPriceLimitForTolerance, virtualSellQuote } from '../lib/virtualQuote';
import { Steps } from './Steps';

export type Direction = 'buy' | 'sell';
export type Route = 'universal' | 'poolSwapTest';

interface Props {
  dep: Deployment;
  client: PublicClient;
  poolKey: PoolKey;
  snapshot: PoolSnapshot | null;
  wallet: WalletState;
  walletData: WalletSnapshot | null;
  routerCheck: CodeCheck | null;
  tokenSymbol: string;
  tokenDecimals: number;
  txAllowed: { ok: boolean; reason: string | null };
  onDone: () => void;
}

type Quote = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; amountOut: bigint; gas: bigint } | { status: 'error'; message: string };

function quoteErrorMessage(error: unknown, direction: Direction, tokenSymbol: string, native: string, innerAbis: Abi[]): string {
  const reason = revertReason(error, innerAbis);
  if (/NotEnoughLiquidity/.test(reason)) {
    return direction === 'sell'
      ? `The pool cannot fill this sell: there is no ${native} liquidity above the current price.`
      : `The pool cannot fill this buy: not enough ${tokenSymbol} liquidity below the current price.`;
  }
  return `Quote failed: ${reason}`;
}

export function SwapForm({ dep, client, poolKey, snapshot, wallet, walletData, routerCheck, tokenSymbol, tokenDecimals, txAllowed, onDone }: Props) {
  const id = useId();
  const native = dep.network.nativeCurrency.symbol;
  const [direction, setDirection] = useState<Direction>('buy');
  const [route, setRoute] = useState<Route>('universal');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState<string>(SLIPPAGE.defaultPercent);
  const [quote, setQuote] = useState<Quote>({ status: 'idle' });
  const [errors, setErrors] = useState<{ amount?: string; slippage?: string }>({});
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const quoteSeq = useRef(0);

  // A new direction or route starts a new transaction story; drop the previous one's steps.
  function changeDirection(next: Direction) {
    setDirection(next);
    setSteps([]);
    setResult(null);
    setErrors({});
  }
  function changeRoute(next: Route) {
    setRoute(next);
    setSteps([]);
    setResult(null);
  }

  const inDecimals = direction === 'buy' ? 18 : tokenDecimals;
  const outDecimals = direction === 'buy' ? tokenDecimals : 18;
  const inSymbol = direction === 'buy' ? native : tokenSymbol;
  const outSymbol = direction === 'buy' ? tokenSymbol : native;
  const zeroForOne = direction === 'buy';
  const amountIn = useMemo(() => parseAmount(amountText, inDecimals), [amountText, inDecimals]);
  const slippagePips = useMemo(() => parsePercentToPips(slippageText, SLIPPAGE.maxPercent), [slippageText]);
  const balanceIn = walletData ? (direction === 'buy' ? walletData.eth : walletData.token) : null;

  // Quote through the quoter (simulated call) whenever the input changes.
  useEffect(() => {
    if (amountIn === null || amountIn <= 0n) {
      setQuote({ status: 'idle' });
      return;
    }
    if (amountIn >= 1n << 128n) {
      setQuote({ status: 'error', message: 'Amount is too large for a single swap.' });
      return;
    }
    const seq = (quoteSeq.current += 1);
    setQuote({ status: 'loading' });
    const timer = setTimeout(async () => {
      try {
        const { result: out } = await client.simulateContract({
          address: dep.uniswap.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey: poolKeyTuple(poolKey), zeroForOne, exactAmount: amountIn, hookData: '0x' }],
        });
        if (seq !== quoteSeq.current) return;
        setQuote({ status: 'ok', amountOut: out[0], gas: out[1] });
      } catch (error) {
        if (seq !== quoteSeq.current) return;
        setQuote({ status: 'error', message: quoteErrorMessage(error, direction, tokenSymbol, native, [quoterAbi, poolManagerAbi, dep.hook.abi]) });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [amountIn, zeroForOne, client, dep.uniswap.quoter, dep.hook.abi, poolKey, direction, tokenSymbol, native]);

  const minOut = quote.status === 'ok' && slippagePips !== null ? applySlippage(quote.amountOut, slippagePips) : null;
  const bound = useMemo(() => {
    if (direction !== 'sell' || amountIn === null || amountIn <= 0n || !snapshot) return null;
    return virtualSellQuote(snapshot.sqrtPriceX96, snapshot.liquidity, amountIn, POOL.fee);
  }, [direction, amountIn, snapshot]);
  const routerUsable = route === 'universal' || (routerCheck?.ok ?? false);

  function validate(): { amountIn: bigint; slippagePips: bigint; minOut: bigint; amountOut: bigint } | null {
    const next: { amount?: string; slippage?: string } = {};
    if (amountIn === null || amountIn <= 0n) next.amount = `Enter a positive ${inSymbol} amount with at most ${inDecimals} decimals.`;
    else if (balanceIn !== null && amountIn > balanceIn) next.amount = `Amount exceeds your balance of ${formatAmount(balanceIn, inDecimals, 6)} ${inSymbol}.`;
    if (slippagePips === null) next.slippage = `Enter a percentage between 0 and ${SLIPPAGE.maxPercent} with up to 4 decimals.`;
    if (!next.amount && quote.status !== 'ok') next.amount = quote.status === 'error' ? quote.message : 'Wait for the quote before swapping.';
    setErrors(next);
    if (next.amount || next.slippage) {
      document.getElementById(next.amount ? `${id}-amount` : `${id}-slippage`)?.focus();
      return null;
    }
    if (quote.status !== 'ok' || amountIn === null || slippagePips === null) return null;
    return { amountIn, slippagePips, minOut: applySlippage(quote.amountOut, slippagePips), amountOut: quote.amountOut };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    const checked = validate();
    if (!checked || !wallet.walletClient || !wallet.account || !walletData) return;
    const account = wallet.account;
    const ctx = { publicClient: client, walletClient: wallet.walletClient, account, chainId: dep.chainId, onUpdate: setSteps };
    const errorAbis = [poolManagerAbi, dep.hook.abi, quoterAbi];
    setRunning(true);
    try {
      let ok: boolean;
      if (route === 'universal') {
        const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
        const { commands, inputs } = encodeUniversalRouterSwap({ poolKey, zeroForOne, amountIn: checked.amountIn, amountOutMinimum: checked.minOut });
        ok = await runSteps(ctx, [
          ...(direction === 'sell'
            ? [
                {
                  id: 'approve-permit2',
                  label: `Approve ${tokenSymbol} for Permit2`,
                  request: async () =>
                    walletData.tokenAllowanceToPermit2 >= checked.amountIn
                      ? null
                      : { address: dep.token.address, abi: dep.token.abi, functionName: 'approve', args: [dep.uniswap.permit2, checked.amountIn] },
                },
                {
                  id: 'permit2-router',
                  label: 'Allow the Universal Router to use it (Permit2)',
                  request: async () => {
                    const now = Math.floor(Date.now() / 1000);
                    const current = walletData.permit2RouterAllowance;
                    if (current.amount >= checked.amountIn && current.expiration > now + 60) return null;
                    return {
                      address: dep.uniswap.permit2,
                      abi: permit2Abi,
                      functionName: 'approve',
                      args: [dep.token.address, dep.uniswap.universalRouter, checked.amountIn, now + PERMIT2_EXPIRATION_SECONDS],
                    };
                  },
                },
              ]
            : []),
          {
            id: 'swap',
            label: `${direction === 'buy' ? 'Buy' : 'Sell'} through the Universal Router`,
            request: async () => ({
              address: dep.uniswap.universalRouter,
              abi: universalRouterAbi,
              functionName: 'execute',
              args: [commands, inputs, deadline],
              value: direction === 'buy' ? checked.amountIn : 0n,
              errorAbis,
            }),
          },
        ]);
      } else {
        const limit = snapshot ? sqrtPriceLimitForTolerance(snapshot.sqrtPriceX96, zeroForOne, checked.slippagePips) : undefined;
        const args = poolSwapTestArgs({ poolKey, zeroForOne, amountIn: checked.amountIn, ...(limit !== undefined ? { sqrtPriceLimitX96: limit } : {}) });
        ok = await runSteps(ctx, [
          ...(direction === 'sell'
            ? [
                {
                  id: 'approve-router',
                  label: `Approve ${tokenSymbol} for PoolSwapTest`,
                  request: async () =>
                    walletData.tokenAllowanceToPoolSwapTest >= checked.amountIn
                      ? null
                      : { address: dep.token.address, abi: dep.token.abi, functionName: 'approve', args: [POOL_SWAP_TEST_ROUTER, checked.amountIn] },
                },
              ]
            : []),
          {
            id: 'swap',
            label: `${direction === 'buy' ? 'Buy' : 'Sell'} through PoolSwapTest`,
            request: async () => ({
              address: POOL_SWAP_TEST_ROUTER,
              abi: poolSwapTestAbi,
              functionName: 'swap',
              args: [args.key, args.params, args.testSettings, args.hookData],
              value: direction === 'buy' ? checked.amountIn : 0n,
              errorAbis,
            }),
          },
        ]);
      }
      setResult(
        ok
          ? { ok: true, text: `Swap confirmed. Balances and pool state are refreshing.` }
          : { ok: false, text: 'The swap did not complete. See the failed step above; nothing further was sent.' },
      );
      if (ok) {
        setAmountText('');
        onDone();
      }
    } finally {
      setRunning(false);
    }
  }

  const disabledReason = !txAllowed.ok ? txAllowed.reason : !routerUsable ? 'PoolSwapTest is unavailable: ' + (routerCheck?.detail ?? 'checking its code…') : null;

  return (
    <section className="card" aria-labelledby="swap-heading">
      <h2 id="swap-heading">Buy or sell {tokenSymbol}</h2>
      <form className="form" onSubmit={(e) => void submit(e)} noValidate>
        <fieldset>
          <legend>Direction</legend>
          <div className="choice-row">
            <label className="choice">
              <input type="radio" name={`${id}-direction`} value="buy" checked={direction === 'buy'} onChange={() => changeDirection('buy')} disabled={running} />
              Buy {tokenSymbol} with {native}
            </label>
            <label className="choice">
              <input type="radio" name={`${id}-direction`} value="sell" checked={direction === 'sell'} onChange={() => changeDirection('sell')} disabled={running} />
              Sell {tokenSymbol} for {native}
            </label>
          </div>
        </fieldset>

        <div className="form-row">
          <div className="field">
            <label htmlFor={`${id}-amount`}>You pay ({inSymbol})</label>
            <div className="input-row">
              <input
                id={`${id}-amount`}
                className="input"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                disabled={running}
                aria-invalid={errors.amount ? 'true' : undefined}
                aria-describedby={errors.amount ? `${id}-amount-error` : `${id}-amount-hint`}
              />
              <button
                type="button"
                className="btn small"
                disabled={running || balanceIn === null || balanceIn === 0n}
                onClick={() => balanceIn !== null && setAmountText(formatAmount(balanceIn, inDecimals, inDecimals).replace(/,/g, ''))}
              >
                Max
              </button>
            </div>
            <span id={`${id}-amount-hint`} className="hint">
              {balanceIn !== null ? `Balance ${formatAmount(balanceIn, inDecimals, 6)} ${inSymbol}` : 'Connect a wallet to see your balance.'}
              {direction === 'buy' ? ' Keep some ETH for gas.' : ''}
            </span>
            {errors.amount ? (
              <span id={`${id}-amount-error`} className="error">
                {errors.amount}
              </span>
            ) : null}
          </div>
          <div className="field">
            <label htmlFor={`${id}-slippage`}>Slippage tolerance (%)</label>
            <input
              id={`${id}-slippage`}
              className="input"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={slippageText}
              onChange={(e) => setSlippageText(e.target.value)}
              disabled={running}
              aria-invalid={errors.slippage ? 'true' : undefined}
              aria-describedby={errors.slippage ? `${id}-slippage-error` : `${id}-slippage-hint`}
            />
            <span id={`${id}-slippage-hint`} className="hint">
              Lowest output you accept, as a percentage below the quote.
            </span>
            {errors.slippage ? (
              <span id={`${id}-slippage-error`} className="error">
                {errors.slippage}
              </span>
            ) : null}
          </div>
        </div>

        <fieldset>
          <legend>Route</legend>
          <div className="choice-row">
            <label className="choice">
              <input type="radio" name={`${id}-route`} value="universal" checked={route === 'universal'} onChange={() => changeRoute('universal')} disabled={running} />
              Universal Router
            </label>
            <label className="choice">
              <input
                type="radio"
                name={`${id}-route`}
                value="poolSwapTest"
                checked={route === 'poolSwapTest'}
                onChange={() => changeRoute('poolSwapTest')}
                disabled={running || !(routerCheck?.ok ?? false)}
              />
              PoolSwapTest router
            </label>
          </div>
          <p className="caption" style={{ marginTop: 'var(--s-1)' }}>
            {route === 'universal'
              ? 'Enforces the minimum output: the swap reverts instead of paying less. Sells need a Permit2 allowance first.'
              : 'Uniswap’s test router. It has no minimum-output check; the slippage tolerance becomes a price limit, so a swap may fill partially, and a clipped sell is not reverted.'}
            {routerCheck && !routerCheck.ok ? ` PoolSwapTest is disabled: ${routerCheck.detail}.` : ''}
          </p>
        </fieldset>

        <div className="summary" aria-live="polite" aria-atomic="true">
          {quote.status === 'idle' ? <span className="muted">Enter an amount to see a quote.</span> : null}
          {quote.status === 'loading' ? <span className="muted">Getting a quote…</span> : null}
          {quote.status === 'error' ? <span className="error">{quote.message}</span> : null}
          {quote.status === 'ok' && amountIn !== null ? (
            <>
              <div className="row">
                <span>Expected output</span>
                <span>
                  {formatAmount(quote.amountOut, outDecimals, 8)} {outSymbol}
                </span>
              </div>
              <div className="row">
                <span>Rate</span>
                <span>
                  {direction === 'buy'
                    ? `${formatRatio({ num: quote.amountOut * 10n ** 18n, den: amountIn * 10n ** BigInt(tokenDecimals) }, 6)} ${tokenSymbol} per ${native}`
                    : `${formatRatio({ num: amountIn * 10n ** 18n, den: quote.amountOut * 10n ** BigInt(tokenDecimals) }, 6)} ${tokenSymbol} per ${native}`}
                </span>
              </div>
              <div className="row">
                <span>Minimum received ({slippageText || '?'} % slippage)</span>
                <span>{minOut !== null ? `${formatAmount(minOut, outDecimals, 8)} ${outSymbol}` : '—'}</span>
              </div>
              {direction === 'sell' && bound ? (
                <div className="row">
                  <span>Start-of-block bound if another swap lands first in your block</span>
                  <span>
                    {bound.amountOut === 0n ? `0 ${native} (fully clipped)` : `at most ${formatAmount(bound.amountOut, 18, 8)} ${native}`}
                  </span>
                </div>
              ) : null}
              <div className="row">
                <span>Estimated swap gas</span>
                <span>{quote.gas.toString()}</span>
              </div>
            </>
          ) : null}
        </div>

        {direction === 'sell' ? (
          <p className="caption">
            The quote assumes yours is the first swap of its block. If another swap comes first, the hook caps a sell at the block’s
            opening price and keeps the difference for LPs (a Clipped event). Buys are not capped.
          </p>
        ) : null}

        <div className="btn-row">
          <button type="submit" className="btn primary" disabled={!txAllowed.ok || !routerUsable || running}>
            {running ? 'Working…' : direction === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`}
          </button>
          {disabledReason ? <span className="caption">{disabledReason}</span> : null}
        </div>
        <div role="status" aria-live="polite">
          <Steps steps={steps} explorer={dep.network.explorer} />
          {result ? <p className={`notice ${result.ok ? 'ok' : 'err'}`}>{result.text}</p> : null}
        </div>
      </form>
    </section>
  );
}
