import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalKeccak, loadDeployment, validateManifest, walletAddChainFrom } from './deployment';

const here = resolve(__dirname, '..');
const handoff = JSON.parse(readFileSync(resolve(here, 'deployment/handoff.json'), 'utf8'));
const networkFile = JSON.parse(readFileSync(resolve(here, 'deployment/network.json'), 'utf8'));
const abis: Record<string, unknown> = {
  'abi/NOSAND.json': JSON.parse(readFileSync(resolve(here, 'deployment/abi-NOSAND.json'), 'utf8')),
  'abi/AntiSandwichHook.json': JSON.parse(readFileSync(resolve(here, 'deployment/abi-AntiSandwichHook.json'), 'utf8')),
};

function manifestFixture() {
  return {
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c: { name: string; address: string; abiHash: string }) => ({
      name: c.name,
      address: c.address,
      abiHash: c.abiHash,
      abiPath: `abi/${c.name}.json`,
    })),
    assets: [{ path: 'index.html', sha256: 'a'.repeat(64) }],
    network: networkFile.network,
  };
}

function fakeFetch(files: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/site\//, '');
    if (!(path in files)) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

describe('ABI hashing', () => {
  it('matches the handoff abiHash for both implementation-derived ABIs', () => {
    for (const contract of handoff.contracts) {
      expect(canonicalKeccak(abis[`abi/${contract.name}.json`])).toBe(contract.abiHash);
    }
  });
});

describe('manifest validation', () => {
  it('accepts the real manifest shape', () => {
    expect(() => validateManifest(manifestFixture())).not.toThrow();
  });

  it('rejects a chain mismatch between the manifest and its network block', () => {
    const m = manifestFixture();
    m.network = { ...m.network, chainId: 1 };
    expect(() => validateManifest(m)).toThrow(/network.chainId/);
  });

  it('rejects parent traversal and absolute ABI paths', () => {
    const m = manifestFixture();
    m.contracts[0].abiPath = '../abi/NOSAND.json';
    expect(() => validateManifest(m)).toThrow(/relative/);
    m.contracts[0].abiPath = 'https://example.com/abi.json';
    expect(() => validateManifest(m)).toThrow(/relative/);
  });

  it('rejects an invalid address or hash', () => {
    const m = manifestFixture();
    m.contracts[1].address = '0x1234';
    expect(() => validateManifest(m)).toThrow(/address/);
    const m2 = manifestFixture();
    m2.contracts[1].abiHash = 'ABC';
    expect(() => validateManifest(m2)).toThrow(/abiHash/);
  });

  it('derives wallet_addEthereumChain parameters from the network block', () => {
    expect(walletAddChainFrom(networkFile.network)).toEqual(networkFile.walletAddChain);
  });
});

describe('loadDeployment', () => {
  it('loads the manifest and ABIs relative to the page and binds both contracts', async () => {
    const dep = await loadDeployment({ baseUrl: 'https://gateway.example/site/index.html', fetchFn: fakeFetch({ 'imd-deployment.json': manifestFixture(), ...abis }) });
    expect(dep.chainId).toBe(11155111);
    expect(dep.chainIdHex).toBe('0xaa36a7');
    expect(dep.token.address.toLowerCase()).toBe('0xa26a6de1daf41775daee351cf4bc10a35f7bf2b3');
    expect(dep.hook.address.toLowerCase()).toBe('0xe0fd49f077d0b1251215ad1e15133b15e13a00c4');
    expect(dep.hook.abi.some((item) => item.type === 'event' && item.name === 'Clipped')).toBe(true);
    expect(dep.uniswap.stateView.toLowerCase()).toBe(networkFile.network.uniswapV4.stateView);
    expect(dep.walletAddChain.chainId).toBe('0xaa36a7');
  });

  it('refuses an ABI whose hash does not match the manifest', async () => {
    const tampered = { ...abis, 'abi/NOSAND.json': [...(abis['abi/NOSAND.json'] as unknown[]), { type: 'function', name: 'mint', inputs: [], outputs: [], stateMutability: 'nonpayable' }] };
    await expect(loadDeployment({ baseUrl: 'https://gateway.example/site/', fetchFn: fakeFetch({ 'imd-deployment.json': manifestFixture(), ...tampered }) })).rejects.toThrow(
      /does not match its attested hash/,
    );
  });

  it('reports a missing manifest plainly', async () => {
    await expect(loadDeployment({ baseUrl: 'https://gateway.example/site/', fetchFn: fakeFetch({}) })).rejects.toThrow(/HTTP 404/);
  });
});
