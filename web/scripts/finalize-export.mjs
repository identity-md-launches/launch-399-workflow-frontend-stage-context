// Runs after `vite build`. Copies the implementation-derived ABIs into dist/abi/, checks their
// canonical keccak hashes against the deployment handoff, and writes dist/imd-deployment.json,
// the runtime deployment configuration, with a SHA-256 for every other exported file.
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST_NAME,
  MAX_ASSETS,
  MAX_FILE_BYTES,
  canonicalJson,
  canonicalKeccak,
  deploymentDir,
  distDir,
  fail,
  fileSize,
  listFiles,
  readJson,
  sha256Hex,
} from './lib.mjs';

if (!existsSync(join(distDir, 'index.html'))) fail('dist/index.html is missing; run `vite build` first');

const handoff = readJson(join(deploymentDir, 'handoff.json'));
const networkFile = readJson(join(deploymentDir, 'network.json'));
if (!networkFile.network) fail('deployment/network.json has no `network` block');
if (networkFile.network.chainId !== handoff.chainId) fail('network chainId differs from the handoff chainId');

// 1. ABIs: one raw JSON array per contract, hash-checked against the handoff.
const abiDir = join(distDir, 'abi');
rmSync(abiDir, { recursive: true, force: true });
mkdirSync(abiDir, { recursive: true });
const contracts = handoff.contracts.map((contract) => {
  const source = join(deploymentDir, `abi-${contract.name}.json`);
  if (!existsSync(source)) fail(`missing ABI input ${source}`);
  const abi = readJson(source);
  if (!Array.isArray(abi)) fail(`${source} is not a JSON array`);
  const hash = canonicalKeccak(abi);
  if (hash !== contract.abiHash) fail(`${contract.name} ABI hash ${hash} != handoff ${contract.abiHash}`);
  const abiPath = `abi/${contract.name}.json`;
  writeFileSync(join(distDir, abiPath), canonicalJson(abi));
  return { name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath };
});

// 2. Asset inventory: every exported file except the manifest itself.
rmSync(join(distDir, MANIFEST_NAME), { force: true });
const files = listFiles(distDir).filter((path) => path !== MANIFEST_NAME);
if (files.length > MAX_ASSETS) fail(`${files.length} assets exceed the limit of ${MAX_ASSETS}`);
let total = 0;
const assets = files.map((path) => {
  const bytes = readFileSync(join(distDir, path));
  if (bytes.length > MAX_FILE_BYTES) fail(`${path} is larger than 8 MiB`);
  total += bytes.length;
  return { path, sha256: sha256Hex(bytes) };
});
if (!assets.some((asset) => asset.path === 'index.html')) fail('index.html is not in the asset list');

// 3. The manifest, in the schema's key order, with the network block copied from network.json.
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: networkFile.network,
};
writeFileSync(join(distDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`export: ${assets.length} assets, ${total} bytes, manifest ${fileSize(join(distDir, MANIFEST_NAME))} bytes`);
for (const asset of assets) console.log(`  ${asset.sha256}  ${asset.path}`);
