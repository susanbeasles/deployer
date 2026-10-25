import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTrustedHcl } from '../../container/agent/hcl-approval.mjs';

function fixture(stack: 'infra' | 'infra-root') {
  const root = mkdtempSync(join(tmpdir(), 'reviewed-hcl-'));
  const source = join(root, 'candidate');
  const policy = join(root, 'policy');
  mkdirSync(source); mkdirSync(join(policy, 'scripts'), { recursive: true });
  const file = join(source, 'main.tf');
  const approved = 'terraform { required_version = "= 1.10.6" }\n';
  writeFileSync(file, approved);
  const digest = createHash('sha256').update(approved).digest('hex');
  const manifest = join(policy, 'scripts', stack === 'infra' ? 'approved-infra-hcl.json' : 'approved-hcl.json');
  writeFileSync(manifest, JSON.stringify({ 'main.tf': digest }));
  return { root, source, policy, file };
}

for (const stack of ['infra', 'infra-root'] as const) {
  test('trusted '+stack+' HCL allowlist accepts only matching candidate bytes', () => {
    const f = fixture(stack);
    try {
      assert.equal(checkTrustedHcl(f.source, f.policy, stack), true);
      writeFileSync(f.file, 'terraform { required_version = "= 1.10.5" }\n');
      assert.throws(() => checkTrustedHcl(f.source, f.policy, stack), { code: 'hcl_not_approved' });
      writeFileSync(f.file, 'terraform { required_version = "= 1.10.6" }\n');
      writeFileSync(join(f.source, 'extra.tf'), 'resource "terraform_data" "danger" {}\n');
      assert.throws(() => checkTrustedHcl(f.source, f.policy, stack), { code: 'hcl_not_approved' });
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('untrusted manifest, symlinks and unknown stack fail closed before Tofu', () => {
  const f = fixture('infra');
  try {
    assert.throws(() => checkTrustedHcl(f.source, f.policy, 'unknown'), { code: 'hcl_not_approved' });
    symlinkSync('main.tf', join(f.source, 'linked.tf'));
    assert.throws(() => checkTrustedHcl(f.source, f.policy, 'infra'), { code: 'hcl_not_approved' });
    rmSync(join(f.source, 'linked.tf'));
    rmSync(join(f.policy, 'scripts', 'approved-infra-hcl.json'));
    assert.throws(() => checkTrustedHcl(f.source, f.policy, 'infra'), { code: 'hcl_not_approved' });
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
