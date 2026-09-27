// Loads and validates `imd-deployment.json`, the app's only source of deployed addresses,
// chain id, ABI locations and the vetted network block (public RPCs, explorer, Uniswap v4
// addresses). ABIs are fetched from the paths it declares and re-hashed before use.
import { getAddress, isAddress, keccak256, stringToBytes, type Abi, type Address } from 'viem';
import { CONTRACT_NAMES, MANIFEST_PATH } from './config';

export interface ManifestContract {
  name: string;
  address: string;
  abiHash: string;
  abiPath: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: string;
    universalRouter: string;
    quoter: string;
    stateView: string;
    positionManager: string;
    permit2: string;
  };
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: { path: string; sha256: string }[];
  network: NetworkBlock;
}

/** `wallet_addEthereumChain` parameters, derived from the network block. */
export interface WalletAddChain {
  chainId: `0x${string}`;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export interface BoundContract {
  name: string;
  address: Address;
  abi: Abi;
  abiHash: string;
  abiPath: string;
}

export interface Deployment {
  manifest: DeploymentManifest;
  chainId: number;
  chainIdHex: `0x${string}`;
  network: NetworkBlock;
  uniswap: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
  walletAddChain: WalletAddChain;
  token: BoundContract;
  hook: BoundContract;
  contracts: BoundContract[];
}

export class DeploymentError extends Error {}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Keccak-256 of canonical JSON (sorted keys, no whitespace), 64 lowercase hex, no 0x. */
export function canonicalKeccak(value: unknown): string {
  return keccak256(stringToBytes(JSON.stringify(canonicalize(value)))).slice(2);
}

const HEX64 = /^[0-9a-f]{64}$/;

function isRelativePath(path: string): boolean {
  return path.length > 0 && !path.startsWith('/') && !path.includes('..') && !/^[a-z]+:/i.test(path);
}

function expectString(obj: Record<string, unknown>, key: string, where: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) throw new DeploymentError(`${where}.${key} must be a non-empty string`);
  return value;
}

function checkedAddress(value: string, where: string): Address {
  if (!isAddress(value, { strict: false })) throw new DeploymentError(`${where} is not an address: ${value}`);
  return getAddress(value);
}

/** Structural validation of the manifest document. Throws DeploymentError with a plain reason. */
export function validateManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') throw new DeploymentError('manifest is not an object');
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) throw new DeploymentError('manifest version must be 1');
  expectString(m, 'launchId', 'manifest');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) {
    throw new DeploymentError('manifest.chainId must be a positive integer');
  }
  expectString(m, 'sourceCommit', 'manifest');
  expectString(m, 'attestationHash', 'manifest');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) throw new DeploymentError('manifest.contracts must be a non-empty array');
  for (const [i, c] of (m.contracts as unknown[]).entries()) {
    if (!c || typeof c !== 'object') throw new DeploymentError(`contracts[${i}] is not an object`);
    const contract = c as Record<string, unknown>;
    const where = `contracts[${i}]`;
    expectString(contract, 'name', where);
    checkedAddress(expectString(contract, 'address', where), `${where}.address`);
    if (!HEX64.test(expectString(contract, 'abiHash', where))) throw new DeploymentError(`${where}.abiHash must be 64 lowercase hex characters`);
    if (!isRelativePath(expectString(contract, 'abiPath', where))) throw new DeploymentError(`${where}.abiPath must be a relative path`);
  }
  if (!Array.isArray(m.assets)) throw new DeploymentError('manifest.assets must be an array');
  const network = m.network as Record<string, unknown> | undefined;
  if (!network || typeof network !== 'object') throw new DeploymentError('manifest.network is missing');
  if (network.chainId !== m.chainId) throw new DeploymentError('manifest.network.chainId differs from manifest.chainId');
  expectString(network, 'name', 'network');
  if (!Array.isArray(network.rpcUrls) || network.rpcUrls.length === 0) throw new DeploymentError('network.rpcUrls must be non-empty');
  expectString(network, 'explorer', 'network');
  const uni = network.uniswapV4 as Record<string, unknown> | undefined;
  if (!uni || typeof uni !== 'object') throw new DeploymentError('network.uniswapV4 is missing');
  for (const key of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2']) {
    checkedAddress(expectString(uni, key, 'network.uniswapV4'), `network.uniswapV4.${key}`);
  }
  const native = network.nativeCurrency as Record<string, unknown> | undefined;
  if (!native || typeof native.symbol !== 'string' || typeof native.decimals !== 'number') {
    throw new DeploymentError('network.nativeCurrency is incomplete');
  }
  return raw as DeploymentManifest;
}

export function walletAddChainFrom(network: NetworkBlock): WalletAddChain {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    rpcUrls: [...network.rpcUrls],
    nativeCurrency: { ...network.nativeCurrency },
    blockExplorerUrls: [network.explorer],
  };
}

export interface LoadOptions {
  /** Base URL the manifest and ABI paths are resolved against; defaults to the document. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

async function fetchJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
  const response = await fetchFn(url, { cache: 'no-cache' });
  if (!response.ok) throw new DeploymentError(`Unable to load ${url} (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch {
    throw new DeploymentError(`${url} is not valid JSON`);
  }
}

/** Fetch the manifest, validate it, fetch each ABI and bind the named contracts. */
export async function loadDeployment(options: LoadOptions = {}): Promise<Deployment> {
  const fetchFn = options.fetchFn ?? fetch;
  const baseUrl = options.baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  const manifestUrl = new URL(MANIFEST_PATH, baseUrl).toString();
  const manifest = validateManifest(await fetchJson(manifestUrl, fetchFn));

  const contracts: BoundContract[] = [];
  for (const contract of manifest.contracts) {
    const abi = await fetchJson(new URL(contract.abiPath, baseUrl).toString(), fetchFn);
    if (!Array.isArray(abi)) throw new DeploymentError(`${contract.abiPath} is not an ABI array`);
    const hash = canonicalKeccak(abi);
    if (hash !== contract.abiHash) {
      throw new DeploymentError(`ABI for ${contract.name} does not match its attested hash (${hash} vs ${contract.abiHash})`);
    }
    contracts.push({
      name: contract.name,
      address: getAddress(contract.address),
      abi: abi as Abi,
      abiHash: contract.abiHash,
      abiPath: contract.abiPath,
    });
  }

  const token = contracts.find((c) => c.name === CONTRACT_NAMES.token);
  const hook = contracts.find((c) => c.name === CONTRACT_NAMES.hook);
  if (!token) throw new DeploymentError(`manifest has no ${CONTRACT_NAMES.token} contract`);
  if (!hook) throw new DeploymentError(`manifest has no ${CONTRACT_NAMES.hook} contract`);

  const uni = manifest.network.uniswapV4;
  return {
    manifest,
    chainId: manifest.chainId,
    chainIdHex: `0x${manifest.chainId.toString(16)}`,
    network: manifest.network,
    uniswap: {
      poolManager: getAddress(uni.poolManager),
      universalRouter: getAddress(uni.universalRouter),
      quoter: getAddress(uni.quoter),
      stateView: getAddress(uni.stateView),
      positionManager: getAddress(uni.positionManager),
      permit2: getAddress(uni.permit2),
    },
    walletAddChain: walletAddChainFrom(manifest.network),
    token,
    hook,
    contracts,
  };
}
