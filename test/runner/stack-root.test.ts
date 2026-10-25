import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pinnedStackRoot } from '../../container/agent/terraform.mjs';

test('infra Terraform runs only stack/; infra-root runs only the repository root', () => {
  const root = mkdtempSync(join(tmpdir(), 'infra-stack-root-'));
  try {
    mkdirSync(join(root, 'stack'));
    assert.equal(pinnedStackRoot(root, 'infra'), join(root, 'stack'));
    assert.equal(pinnedStackRoot(root, 'infra-root'), root);
    assert.throws(() => pinnedStackRoot(root, 'unexpected'), { code: 'stack_invalid' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing or symlinked infra stack cannot redirect privileged tofu execution', () => {
  const root = mkdtempSync(join(tmpdir(), 'infra-root-symlink-'));
  try {
    assert.throws(() => pinnedStackRoot(root, 'infra'), { code: 'stack_root_missing' });
    mkdirSync(join(root, 'other'));
    symlinkSync('other', join(root, 'stack'));
    assert.throws(() => pinnedStackRoot(root, 'infra'), { code: 'stack_root_missing' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
