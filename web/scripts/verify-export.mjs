// Independent re-check of the committed export: manifest schema, hashes, ABI binding, handoff
// agreement, network block equality, relative asset URLs and size budgets. Exits non-zero on
// the first discrepancy so it can gate a commit.
import { existsSync, readFileSync } from 'node:fs';
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
  listFiles,
  readJson,
  sha256Hex,
} from './lib.mjs';

const manifestPath = join(distDir, MANIFEST_NAME);
if (!existsSync(manifestPath)) fail(`${MANIFEST_NAME} is missing`);
const manifest = readJson(manifestPath);
const handoff = readJson(join(deploymentDir, 'handoff.json'));
const networkFile = readJson(join(deploymentDir, 'network.json'));
const hex64 = /^[0-9a-f]{64}$/;
const problems = [];
const check = (ok, message) => {
  if (!ok) problems.push(message);
};

check(manifest.version === 1, 'version must be 1');
check(manifest.launchId === handoff.launchId, 'launchId differs from the handoff');
check(manifest.chainId === handoff.chainId, 'chainId differs from the handoff');
check(manifest.sourceCommit === handoff.sourceCommit, 'sourceCommit differs from the handoff');
check(manifest.attestationHash === handoff.attestationHash, 'attestationHash differs from the handoff');
check(
  canonicalJson(manifest.network) === canonicalJson(networkFile.network),
  'network block differs from deployment/network.json',
);
check(
  JSON.stringify(Object.keys(manifest)) ===
    JSON.stringify(['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network']),
  'manifest keys are not the schema keys in order',
);

// Contracts: same set, names, addresses and ABI hashes as the handoff; ABI files bound by hash.
check(Array.isArray(manifest.contracts) && manifest.contracts.length === handoff.contracts.length, 'contract count differs');
for (const expected of handoff.contracts) {
  const actual = (manifest.contracts ?? []).find((c) => c.name === expected.name);
  if (!actual) {
    problems.push(`contract ${expected.name} missing`);
    continue;
  }
  check(actual.address === expected.address, `${expected.name} address differs`);
  check(actual.abiHash === expected.abiHash, `${expected.name} abiHash differs`);
  check(hex64.test(actual.abiHash), `${expected.name} abiHash is not 64 lowercase hex characters`);
  check(
    typeof actual.abiPath === 'string' && !actual.abiPath.includes('..') && !/^[a-z]+:/i.test(actual.abiPath) && !actual.abiPath.startsWith('/'),
    `${expected.name} abiPath must be relative to dist/`,
  );
  const abiFile = join(distDir, actual.abiPath);
  if (!existsSync(abiFile)) {
    problems.push(`${actual.abiPath} does not exist`);
    continue;
  }
  const abi = readJson(abiFile);
  check(Array.isArray(abi), `${actual.abiPath} is not a JSON array`);
  check(canonicalKeccak(abi) === expected.abiHash, `${actual.abiPath} canonical keccak differs from the handoff abiHash`);
  check((manifest.assets ?? []).some((a) => a.path === actual.abiPath), `${actual.abiPath} is not listed as an asset`);
}

// Assets: exactly the exported files minus the manifest, each with the right SHA-256.
const files = listFiles(distDir).filter((path) => path !== MANIFEST_NAME);
const listed = new Map((manifest.assets ?? []).map((a) => [a.path, a.sha256]));
check(listed.size <= MAX_ASSETS, `more than ${MAX_ASSETS} assets`);
check(listed.has('index.html'), 'index.html is not listed');
check(!listed.has(MANIFEST_NAME), 'manifest lists itself');
for (const path of files) {
  const sha = listed.get(path);
  if (sha === undefined) {
    problems.push(`${path} exported but not listed`);
    continue;
  }
  const bytes = readFileSync(join(distDir, path));
  check(bytes.length <= MAX_FILE_BYTES, `${path} exceeds 8 MiB`);
  check(hex64.test(sha) && sha === sha256Hex(bytes), `${path} sha256 mismatch`);
}
for (const path of listed.keys()) {
  check(files.includes(path), `${path} listed but not exported`);
  check(!path.includes('..') && !path.startsWith('/') && !/^[a-z]+:/i.test(path), `${path} is not a relative dist path`);
}

// index.html must reference its assets relatively so gateway subpaths and ENS names work.
const html = readFileSync(join(distDir, 'index.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  check(url.startsWith('./') || url.startsWith('#') || url.startsWith('data:'), `index.html references non-relative URL ${url}`);
}

const total = files.reduce((sum, path) => sum + readFileSync(join(distDir, path)).length, 0);
console.log(`verify-export: ${files.length} assets, ${total} bytes total (budget note: keep well under 32 MiB)`);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL ${p}`);
  process.exit(1);
}
console.log('verify-export: OK');
