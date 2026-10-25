import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { JobFailure } from './errors.mjs';

// A Node-only implementation of infra-root/scripts/preplan-gate.py, which is
// written in Python but unavailable in the minimal Node runner image.
// Trusted manifests are read from the immutable infra-root main policy tarball,
// NEVER from the candidate source. Review changes to these manifests separately.
const SKIP = new Set(['.git', '.terraform', 'node_modules']);
const APPROVED = Object.freeze({
  infra: 'approved-infra-hcl.json',
  'infra-root': 'approved-hcl.json',
});
const HCL = /(?:\.tf(?:\.json)?|\.tfvars(?:\.json)?|^\.terraform\.lock\.hcl)$/;
const DIGEST = /^[0-9a-f]{64}$/;
const fail = () => { throw new JobFailure('hcl_not_approved', 'Candidate Terraform input differs from trusted reviewed HCL allowlist'); };

export function checkTrustedHcl(candidateRoot, policyRoot, stack) {
  const filename = APPROVED[stack];
  if (!filename) fail();
  const manifestPath = join(policyRoot, 'scripts', filename);
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) fail();
  if (!existsSync(candidateRoot) || !lstatSync(candidateRoot).isDirectory()) fail();
  let expected;
  try { expected = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { fail(); }
  if (expected === null || typeof expected !== 'object' || Array.isArray(expected)) fail();
  const keys = Object.keys(expected);
  if (keys.length < 1 || keys.length > 500 || keys.some(k => !k || k.split('/').some(s => !s || s === '.' || s === '..') || !DIGEST.test(expected[k]))) fail();

  const actual = new Map();
  const pending = [candidateRoot];
  while (pending.length > 0) {
    const dir = pending.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) fail();
      if (entry.isDirectory()) {
        pending.push(file);
      } else if (entry.isFile() && HCL.test(entry.name)) {
        const rel = relative(candidateRoot, file).split(sep).join('/');
        actual.set(rel, createHash('sha256').update(readFileSync(file)).digest('hex'));
      } else if (!entry.isFile()) {
        fail();
      }
    }
  }
  if (actual.size !== keys.length) fail();
  for (const key of keys) if (actual.get(key) !== expected[key]) fail();
  return true;
}
