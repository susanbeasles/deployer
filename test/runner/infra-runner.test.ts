import { test } from 'node:test';
import assert from 'node:assert/strict';
import { infraJobStatus, infraRunJob, type InfraDeps } from '../../worker/runner/infra.ts';
import type { RunnerJobRequest } from '../../worker/runner/api.ts';
import { NOW_MS, subject } from './builders.ts';
import { FakeClock, sha256 } from './fakes.ts';

const TOKEN = 'A'.repeat(43);

function harness(result: { ok: boolean; grant?: { action: string }; error?: string }) {
  const consumed: Array<{ tokenHash: string; action: string; subject: unknown }> = [];
  const submitted: RunnerJobRequest[] = [];
  const deps: InfraDeps = {
    authorizer: {
      consume: async input => {
        consumed.push(input);
        return result.ok
          ? { ok: true, grant: { action: result.grant!.action, subjectDigest: 'x', sub: 's', jti: 'j', expiresAt: 0 } }
          : { ok: false, error: result.error as 'mismatch' };
      },
    },
    runner: {
      RUNNER: {
        getByName: () => ({
          submit: async (r: RunnerJobRequest) => {
            submitted.push(r);
            return { jobId: r.jobId, type: r.type, state: 'queued', result: null, error: null, logKey: null, submittedAt: '', finishedAt: null };
          },
          status: async () => null,
        }),
      },
    },
    clock: new FakeClock(NOW_MS),
  };
  return { deps, consumed, submitted };
}

test('infra runner executes only a validated infra plan after matching one-use grant', async () => {
  const h = harness({ ok: true, grant: { action: 'infra.plan' } });
  const input = subject('plan', 'infra');
  const reply = await infraRunJob(h.deps, { token: TOKEN, job: { type: 'terraform.plan', subject: input } });
  assert.equal(reply.state, 'queued');
  assert.deepEqual(h.consumed, [{ tokenHash: sha256(TOKEN), action: 'infra.plan', subject: input }]);
  assert.equal(h.submitted.length, 1);
  assert.equal(h.submitted[0]?.type, 'terraform.plan');
  assert.equal(h.submitted[0]?.input, input);
  assert.equal(h.submitted[0]?.notify, null);
});

test('infra runner applies only the infra stack with an infra.apply grant', async () => {
  const h = harness({ ok: true, grant: { action: 'infra.apply' } });
  const reply = await infraRunJob(h.deps, { token: TOKEN, job: { type: 'terraform.apply', subject: subject('apply') } });
  assert.equal(reply.state, 'queued');
  assert.equal(h.submitted[0]?.type, 'terraform.apply');
});

test('root stack, bad job type, bad token or malformed subject never consumes grant', async () => {
  const h = harness({ ok: true, grant: { action: 'infra.plan' } });
  for (const job of [
    { type: 'terraform.plan', subject: subject('plan', 'infra-root') },
    { type: 'root.plan', subject: subject('plan') },
    { type: 'terraform.apply', subject: subject('plan') },
  ]) {
    const r = await infraRunJob(h.deps, { token: TOKEN, job });
    assert.equal(r.state, 'rejected');
  }
  assert.equal((await infraRunJob(h.deps, { token: 'bad', job: { type: 'terraform.plan', subject: subject('plan') } })).state, 'rejected');
  assert.equal(h.consumed.length, 0);
  assert.equal(h.submitted.length, 0);
});

test('replayed or mismatched grants never submit Terraform', async () => {
  const replay = harness({ ok: false, error: 'replay' });
  assert.deepEqual(
    await infraRunJob(replay.deps, { token: TOKEN, job: { type: 'terraform.plan', subject: subject('plan') } }),
    { state: 'rejected', error: 'grant_replay' },
  );
  const mismatch = harness({ ok: true, grant: { action: 'infra.apply' } });
  assert.deepEqual(
    await infraRunJob(mismatch.deps, { token: TOKEN, job: { type: 'terraform.plan', subject: subject('plan') } }),
    { state: 'rejected', error: 'grant_mismatch' },
  );
  assert.equal(replay.submitted.length + mismatch.submitted.length, 0);
  assert.equal(await infraJobStatus(replay.deps, { jobId: 'invalid' }), null);
});
