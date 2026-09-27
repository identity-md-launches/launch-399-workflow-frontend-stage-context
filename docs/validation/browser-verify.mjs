// Bounded browser verification of the built export: serves dist/ under a gateway-like subpath on
// an ephemeral port, drives headless Chromium (Playwright), records console/resource failures,
// overflow, keyboard focus, and walks the wallet flows with a mocked EIP-1193 provider. Reads,
// quotes and simulations hit the real Sepolia RPCs from the manifest; signing is mocked and
// eth_sendTransaction returns an existing Sepolia transaction hash, so nothing is broadcast.
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const repo = resolve(import.meta.dirname, '../../..');
const dist = join(repo, 'dist');
const shots = join(import.meta.dirname, 'shots');
mkdirSync(shots, { recursive: true });
const EXECUTABLE = process.env.CHROME || `${process.env.HOME}/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome`;
const ACCOUNT = '0x09ec38170e94532eddb57c69dfc4f1fdcd0d4a60'; // holds ETH and NOSAND on Sepolia (deployer EOA)
const REAL_TX = '0x456395a8fc937f6f06b958982aae1689511cc2dd3ea34da5c33e846a4c5239ca'; // deployment tx; receipt status = success
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/preview/')) {
    res.writeHead(404).end('not under /preview/');
    return;
  }
  let file = join(dist, decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/preview/`;

const report = { base, scenarios: [] };
const browser = await chromium.launch({ executablePath: EXECUTABLE, headless: true });

function mockProviderScript({ rejectSend = false } = {}) {
  return `(() => {
    const state = { chainId: '0x1', known: false, accounts: [], listeners: {}, addChainParams: null, sent: [], rejectSend: ${rejectSend} };
    const emit = (ev, ...a) => (state.listeners[ev] || []).forEach((l) => l(...a));
    const provider = {
      isMock: true,
      on(ev, l) { (state.listeners[ev] ||= []).push(l); },
      removeListener(ev, l) { state.listeners[ev] = (state.listeners[ev] || []).filter((x) => x !== l); },
      async request({ method, params }) {
        state.calls ||= []; state.calls.push(method);
        switch (method) {
          case 'eth_requestAccounts': state.accounts = ['${ACCOUNT}']; return state.accounts;
          case 'eth_accounts': return state.accounts;
          case 'eth_chainId': return state.chainId;
          case 'wallet_switchEthereumChain':
            if (!state.known && params[0].chainId !== '0x1') throw { code: 4902, message: 'Unrecognized chain ID' };
            state.chainId = params[0].chainId; emit('chainChanged', state.chainId); return null;
          case 'wallet_addEthereumChain': state.known = true; state.addChainParams = params[0]; return null;
          case 'eth_sendTransaction':
            if (state.rejectSend) throw { code: 4001, message: 'User rejected the request.' };
            state.sent.push(params[0]); return '${REAL_TX}';
          default: throw { code: 4200, message: 'unsupported in mock: ' + method };
        }
      },
    };
    window.__mock = state;
    window.ethereum = provider;
  })();`;
}

async function collect(page) {
  const consoleMessages = [];
  const failed = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && consoleMessages.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleMessages.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && r.url().startsWith(base) && failed.push(`${r.status()} ${r.url()}`));
  return { consoleMessages, failed };
}

const overflow = (page) => page.evaluate(() => ({ scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }));

async function a11yNames(page) {
  return page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, input, select, textarea, a[href]')) {
      let name = el.getAttribute('aria-label') || '';
      if (!name && el.labels && el.labels.length) name = [...el.labels].map((l) => l.textContent.trim()).join(' ');
      if (!name) name = (el.textContent || '').trim();
      if (!name && el.getAttribute('aria-labelledby')) name = document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim() || '';
      if (!name) name = el.getAttribute('title') || '';
      out.push({ tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), name: name.replace(/\s+/g, ' ').slice(0, 80), disabled: el.disabled === true });
    }
    return out;
  });
}

async function keyboardWalk(page, maxStops = 40) {
  const stops = [];
  await page.keyboard.press('Tab');
  for (let i = 0; i < maxStops; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const name = el.getAttribute('aria-label') || (el.labels && el.labels[0]?.textContent) || el.textContent || '';
      return { tag: el.tagName.toLowerCase(), name: name.trim().replace(/\s+/g, ' ').slice(0, 60), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor, focusVisible: el.matches(':focus-visible') };
    });
    if (!info) break;
    stops.push(info);
    await page.keyboard.press('Tab');
  }
  return stops;
}

async function scenarioNoWallet() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const logs = await collect(page);
  await page.goto(base + 'index.html');
  await page.getByText('Current price', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText(/NOSAND per ETH/).first().waitFor({ timeout: 60_000 });
  await page.getByText(/Scanned blocks/).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  const result = {
    name: 'desktop-no-wallet',
    viewport: '1280x900',
    h1Count: await page.locator('h1').count(),
    mainCount: await page.locator('main').count(),
    headings: await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 50)}`)),
    priceText: await page.locator('dd.value').allTextContents(),
    checkpointBadge: await page.locator('.badge').first().textContent(),
    swapButton: await page.getByRole('button', { name: /Buy NOSAND/ }).isDisabled(),
    swapReason: await page.getByText('Connect a wallet to send transactions.').first().isVisible(),
    walletText: await page.getByText(/No browser wallet found|Connect wallet/).first().textContent(),
    sellsText: await page.getByText(/No sells yet|Recent sells/).first().textContent(),
    codeBadges: await page.locator('.badge').filter({ hasText: /Code verified|No code/ }).allTextContents(),
    overflow: await overflow(page),
    a11y: await a11yNames(page),
    keyboard: await keyboardWalk(page, 30),
    console: logs.consoleMessages,
    failedRequests: logs.failed,
  };
  await page.mouse.click(0, 0);
  await page.screenshot({ path: join(shots, 'desktop-1280-no-wallet.png'), fullPage: true });
  // Focus ring evidence: tab to the Refresh button and capture the viewport.
  await page.getByRole('button', { name: 'Refresh' }).focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await page.screenshot({ path: join(shots, 'desktop-focus-ring.png'), clip: { x: 0, y: 0, width: 1280, height: 500 } });
  report.scenarios.push(result);
  await ctx.close();
}

async function scenarioViewport(width, height, label) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = await collect(page);
  await page.goto(base);
  await page.getByText('Current price', { exact: true }).waitFor({ timeout: 60_000 });
  await page.getByText(/NOSAND per ETH/).first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  const result = { name: label, viewport: `${width}x${height}`, overflow: await overflow(page), console: logs.consoleMessages, failedRequests: logs.failed };
  await page.screenshot({ path: join(shots, `${label}.png`), fullPage: true });
  report.scenarios.push(result);
  await ctx.close();
}

async function scenarioWallet() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(mockProviderScript());
  const page = await ctx.newPage();
  const logs = await collect(page);
  await page.goto(base);
  await page.getByText(/NOSAND per ETH/).first().waitFor({ timeout: 60_000 });
  const result = { name: 'desktop-mock-wallet', viewport: '1280x900', steps: [], console: logs.consoleMessages, failedRequests: logs.failed };
  report.scenarios.push(result);
  const note = (k, v) => result.steps.push({ [k]: v });

  // Connect: mock starts on chain 1 → wrong network.
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByText(/Wrong network/).waitFor({ timeout: 10_000 });
  note('afterConnect', await page.getByText(/Connected as/).textContent());
  note('swapDisabledOnWrongChain', await page.getByRole('button', { name: /Buy NOSAND/ }).isDisabled());
  await page.screenshot({ path: join(shots, 'wallet-wrong-network.png'), clip: { x: 0, y: 0, width: 1280, height: 400 } });
  // Switch → 4902 → add chain → switch.
  await page.getByRole('button', { name: 'Switch to Sepolia' }).click();
  await page.getByText('On Sepolia', { exact: true }).waitFor({ timeout: 10_000 });
  const mock = await page.evaluate(() => window.__mock);
  note('providerCalls', mock.calls);
  note('addChainParams', mock.addChainParams);
  await page.getByText(/Balance .* ETH/).waitFor({ timeout: 30_000 });
  note('balanceHint', await page.getByText(/Balance .* ETH/).textContent());

  // Buy quote + swap via Universal Router (simulated for real, signature mocked).
  await page.getByLabel('You pay (ETH)').fill('0.001');
  await page.getByText('Expected output').waitFor({ timeout: 30_000 });
  note('buyQuote', await page.locator('.summary').textContent());
  await page.screenshot({ path: join(shots, 'wallet-buy-quote.png'), fullPage: true });
  await page.getByRole('button', { name: 'Buy NOSAND' }).click();
  await page.getByText(/Swap confirmed|did not complete/).waitFor({ timeout: 120_000 });
  note('buyStepsUR', await page.locator('.steps').first().textContent());
  note('buyResultUR', await page.locator('.notice.ok, .notice.err').last().textContent());
  note('sentTx', (await page.evaluate(() => window.__mock.sent)).map((t) => ({ to: t.to, value: t.value, dataLen: (t.data || '').length })));
  await page.screenshot({ path: join(shots, 'wallet-buy-confirmed.png'), fullPage: true });

  // Buy via PoolSwapTest.
  await page.getByLabel('You pay (ETH)').fill('0.0005');
  await page.getByLabel('PoolSwapTest router').check();
  await page.getByText('Expected output').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Buy NOSAND' }).click();
  await page.getByText(/Swap confirmed|did not complete/).waitFor({ timeout: 120_000 });
  note('buyStepsPST', await page.locator('.steps').first().textContent());
  note('buyResultPST', await page.locator('.notice.ok, .notice.err').last().textContent());

  // Sell: quoter reports no liquidity above the price → explained, submit blocked.
  await page.getByLabel('Universal Router').check();
  await page.getByLabel('Sell NOSAND for ETH').check();
  await page.getByLabel('You pay (NOSAND)').fill('1000');
  await page.locator('.summary').getByText(/cannot fill this sell|Expected output|Quote failed/).waitFor({ timeout: 30_000 });
  note('sellQuote', await page.locator('.summary').textContent());
  await page.getByRole('button', { name: 'Sell NOSAND' }).click();
  await page.waitForTimeout(500);
  note('sellSubmit', { invalid: await page.getByLabel('You pay (NOSAND)').getAttribute('aria-invalid'), focused: await page.evaluate(() => document.activeElement?.id || null), error: await page.locator('.field .error').first().textContent().catch(() => null) });
  await page.screenshot({ path: join(shots, 'wallet-sell-no-liquidity.png'), fullPage: true });

  // Sell approval path: force a sell through with a tiny amount? Not fillable on the live pool, so
  // exercise the Permit2 steps via the transfer + donate controls instead, plus a rejected signature.
  await page.getByRole('button', { name: 'Donate collected claims' }).click();
  await page.locator('.steps').last().getByText(/Done|Failed/).waitFor({ timeout: 120_000 });
  note('donateSteps', await page.locator('section[aria-labelledby="hook-heading"] .steps').textContent());

  await page.locator('summary', { hasText: 'Transfer NOSAND' }).click();
  await page.getByLabel('Recipient address').fill('0x000000000000000000000000000000000000dEaD');
  await page.getByLabel('Amount (NOSAND)').fill('1');
  await page.evaluate(() => { window.__mock.rejectSend = true; });
  await page.getByRole('button', { name: 'Transfer NOSAND' }).click();
  await page.getByText('Request rejected in the wallet.').waitFor({ timeout: 120_000 });
  note('transferRejected', await page.locator('details .steps').textContent());
  await page.screenshot({ path: join(shots, 'wallet-transfer-rejected.png'), fullPage: true });

  await ctx.close();
}

async function scenarioMissingManifest() {
  // A broken deployment configuration must fail loudly, not render stale addresses.
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await ctx.route('**/imd-deployment.json', (route) => route.fulfill({ status: 404, body: 'nope' }));
  const page = await ctx.newPage();
  await page.goto(base);
  await page.getByRole('alert').waitFor({ timeout: 20_000 });
  report.scenarios.push({ name: 'manifest-404', alert: await page.getByRole('alert').textContent() });
  await page.screenshot({ path: join(shots, 'manifest-404.png') });
  await ctx.close();
}

try {
  await scenarioNoWallet();
  await scenarioViewport(320, 640, 'mobile-320');
  await scenarioViewport(390, 844, 'mobile-390');
  await scenarioViewport(820, 1000, 'tablet-820');
  await scenarioWallet();
  await scenarioMissingManifest();
} catch (error) {
  report.error = String(error?.stack || error);
} finally {
  await browser.close();
  server.close();
}
writeFileSync(join(import.meta.dirname, 'report.json'), JSON.stringify(report, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log(JSON.stringify(report, null, 2).slice(0, 20_000));
if (report.error) process.exit(1);
