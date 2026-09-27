// Shared helpers for the export scripts. Plain Node, no build step.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256 } from 'viem';

export const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoDir = resolve(webDir, '..');
export const distDir = resolve(repoDir, 'dist');
export const deploymentDir = resolve(webDir, 'deployment');
export const MANIFEST_NAME = 'imd-deployment.json';
export const MAX_ASSETS = 128;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Recursively sort object keys; arrays keep their order. */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** Canonical JSON: sorted keys, no whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/** Keccak-256 of the canonical JSON, as 64 lowercase hex characters without 0x. */
export function canonicalKeccak(value) {
  return keccak256(new TextEncoder().encode(canonicalJson(value))).slice(2);
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Every regular file under dir, as posix paths relative to dir, sorted. */
export function listFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export function fileSize(path) {
  return statSync(path).size;
}

export function fail(message) {
  console.error(`export: ${message}`);
  process.exit(1);
}
