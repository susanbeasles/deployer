import { WorkerEntrypoint } from 'cloudflare:workers';
import { systemClock } from './lib/runtime.ts';
import type { RunnerJobStatus } from './runner/api.ts';
import type { RunnerEnv } from './runner/env.ts';
import { infraJobStatus, infraRunJob, type InfraRunResult } from './runner/infra.ts';

/** Independent infra-owned Terraform execution endpoint.
 * Deployed and credentialed by infra, never by the application deployer.
 * No public HTTP route or workers.dev URL is permitted.
 */
export { RunnerJob, EgressGate } from './runner/platform.ts';

interface InfraRunnerEnv extends RunnerEnv {
  AUTHORIZER: Fetcher;
}

export class InfraRunner extends WorkerEntrypoint<InfraRunnerEnv> {
  async runJob(input: unknown): Promise<InfraRunResult> {
    return infraRunJob({
      authorizer: this.env.AUTHORIZER as unknown as Parameters<typeof infraRunJob>[0]['authorizer'],
      runner: this.env,
      clock: systemClock,
    }, input);
  }

  async jobStatus(input: unknown): Promise<RunnerJobStatus | null> {
    return infraJobStatus({ runner: this.env }, input);
  }

  override async fetch(): Promise<Response> {
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}

export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: 'not_found' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  },
};
