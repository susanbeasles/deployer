import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepareJob } from '../../worker/runner/prepare.ts';
import { terraformRequest } from './builders.ts';
import { permitsWorkerJob } from '../../worker/runner/profiles.ts';

test('application deployer cannot be configured with Terraform credentials or plan bucket', () => {
  const config = readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8');
  const vars = config.split('"secrets_store_secrets":')[0];
  const secrets = config.slice(config.indexOf('"secrets_store_secrets":'));
  for (const name of ['CF_PLAN', 'CF_APPLY', 'R2_STATE_RO', 'R2_STATE_RW', 'TF_ENCRYPTION_INFRA']) {
    assert.doesNotMatch(secrets, new RegExp('"binding"\\s*:\\s*"'+name+'"'));
  }
  assert.doesNotMatch(vars, /"R2_STATE_(RO|RW)_TOKEN_ID"/);
  assert.doesNotMatch(config, /"binding"\s*:\s*"TF_PLANS"/);
  assert.match(config, /"RUNNER_ROLE"\s*:\s*"deployer"/);
});

test('unbound plan store cannot produce a Terraform plan or apply', async () => {
  const deps = {
    plans: null,
    staging: null,
    source: null,
    accountId: '1a799c6e699d2ef7e87398692ce3ad7b',
    passphrase: async () => null,
    hashes: () => { throw Error('should not hash'); },
  };
  for (const type of ['terraform.plan', 'terraform.apply'] as const) {
    await assert.rejects(
      prepareJob(terraformRequest(type), deps),
      { code: 'plans_unbound' },
    );
  }
});

test('application deployer explicitly refuses Terraform RPC before any grant is consumed', () => {
  const source = readFileSync(new URL('../../worker/entry.ts', import.meta.url), 'utf8');
  const runJob = source.slice(source.indexOf('async runJob('), source.indexOf('async jobStatus('));
  assert.match(runJob, /error: 'infra_owned'/);
  assert.doesNotMatch(runJob, /consumeGrant|submitTerraformJob|parseTerraformSubject/);
});

test('unknown, missing, or mistyped runner roles cannot execute Terraform', () => {
  for (const role of [undefined, null, '', 'DEPLOYER', 'infrastructure', 'deployr', 'deployer']) {
    assert.equal(permitsWorkerJob(role, 'release.verify'), true, String(role));
    for (const kind of ['terraform.plan', 'terraform.apply', 'root.plan', 'root.apply'] as const) {
      assert.equal(permitsWorkerJob(role, kind), false, String(role) + ' ' + kind);
    }
  }
  assert.equal(permitsWorkerJob('root', 'root.plan'), true);
  assert.equal(permitsWorkerJob('root', 'root.apply'), true);
  assert.equal(permitsWorkerJob('root', 'terraform.apply'), false);
  assert.equal(permitsWorkerJob('root', 'release.verify'), false);
});
