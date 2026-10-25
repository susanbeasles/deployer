import { fail, summarize } from '../lib/errors.ts';
import type { Json } from '../lib/json.ts';
import { sha256Hex } from '../lib/json.ts';
import { log, uuidv7, type Clock } from '../lib/runtime.ts';
import { PATTERNS } from '../lib/validate.ts';
import type { RunnerJobRequest, RunnerJobStatus } from './api.ts';
import { runnerStub, type RunnerNamespace } from './index.ts';
import { JOB_PROFILES } from './profiles.ts';
import { checkDeadline, parseJobRequest } from './request.ts';
import { parseTerraformSubject } from './subject.ts';

/** Infrastructure owned by infra, never by the application deployer. */
type ConsumeResult =
  | { ok: true; grant: { action: string; subjectDigest: string; sub: string; jti: string; expiresAt: number } }
  | { ok: false; error: 'unknown' | 'replay' | 'expired' | 'mismatch' };

export interface InfraDeps {
  authorizer: {
    consume(input: { tokenHash: string; action: string; subject: unknown }): Promise<ConsumeResult>;
  };
  runner: { RUNNER: RunnerNamespace };
  clock: Clock;
}

export type InfraRunResult = RunnerJobStatus | { state: 'rejected'; error: string };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Shape and repository checks precede grant consumption; a grant is spent exactly once. */
export async function infraRunJob(deps: InfraDeps, input: unknown): Promise<InfraRunResult> {
  try {
    const value = input as { token?: unknown; job?: { type?: unknown; subject?: unknown } } | null;
    const token = value?.token;
    const type = value?.job?.type;
    if (typeof token !== 'string' || !TOKEN.test(token)) fail('grant_malformed', 'bad grant format');
    if (type !== 'terraform.plan' && type !== 'terraform.apply') fail('bad_job_type', 'infra permits Terraform only');
    const operation = type === 'terraform.plan' ? 'plan' : 'apply';
    const subject = value?.job?.subject;
    parseTerraformSubject(subject, { stack: 'infra', operation });
    const action = operation === 'plan' ? 'infra.plan' : 'infra.apply';
    const tokenHash = await sha256Hex(token);
    const granted = await deps.authorizer.consume({ tokenHash, action, subject });
    if (!granted.ok) return { state: 'rejected', error: `grant_${granted.error}` };
    if (granted.grant.action !== action) return { state: 'rejected', error: 'grant_mismatch' };

    const now = deps.clock.now();
    const request: RunnerJobRequest = {
      jobId: uuidv7(now),
      type,
      deadlineAt: Math.floor(now / 1000) + JOB_PROFILES[type].defaultRuntimeSeconds,
      input: subject as Json,
      notify: null,
    };
    parseJobRequest(request, 'infra');
    checkDeadline(request, now);
    return await runnerStub(deps.runner, request.jobId).submit(request);
  } catch (error) {
    const failure = summarize(error);
    log('warn', 'infra.run_rejected', { code: failure.code });
    return { state: 'rejected', error: failure.code };
  }
}

export async function infraJobStatus(deps: Pick<InfraDeps, 'runner'>, input: unknown): Promise<RunnerJobStatus | null> {
  const jobId = typeof input === 'object' && input !== null ? (input as { jobId?: unknown }).jobId : undefined;
  if (typeof jobId !== 'string' || !PATTERNS.uuidv7.test(jobId)) return null;
  return runnerStub(deps.runner, jobId).status();
}
