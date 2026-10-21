// Download jobs run one at a time, so the OpenF1 rate limit is never shared.
import { ingestSession, type Progress } from './ingest.ts';

export interface Job {
  sessionKey: number;
  state: 'queued' | 'running' | 'done' | 'error';
  progress: Progress | null;
  error?: string;
  /** 'auto' when started by auto-download rather than a person. */
  origin: 'manual' | 'auto';
}

const jobs: Job[] = [];
let chain: Promise<void> = Promise.resolve();

export function enqueueIngest(sessionKey: number, origin: Job['origin'] = 'manual') {
  const existing = jobs.find((j) => j.sessionKey === sessionKey && (j.state === 'running' || j.state === 'queued'));
  if (existing) return existing;
  const job: Job = { sessionKey, state: 'queued', progress: null, origin };
  jobs.push(job);
  chain = chain.then(async () => {
    job.state = 'running';
    try {
      await ingestSession(sessionKey, (p) => (job.progress = p));
      job.state = 'done';
    } catch (err) {
      job.state = 'error';
      job.error = (err as Error).message;
    }
  });
  return job;
}

export const recentJobs = () => jobs.slice(-10);
export const busy = () => jobs.some((j) => j.state === 'running' || j.state === 'queued');
