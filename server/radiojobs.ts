// Team radio transcripts on the Mac, on request (Team radio panel → "Transcribe"). The first
// time, the speech recognition packages are installed (about 1 GB, once); then the session's
// clips are transcribed one by one (a few seconds each), saved as they go.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHE_DIR } from './db.ts';
import { ensurePack } from './pack.ts';
import { canTranscribe, SPEECH_PACKAGES, transcribeAll, type RadioTranscripts } from './transcribe.ts';

export const RADIO_DIR = path.join(CACHE_DIR, 'radio');

export interface RadioJob {
  key: number;
  stage: 'installing' | 'transcribing' | 'done' | 'failed';
  done: number;
  total: number;
  error?: string;
}

let job: RadioJob | null = null;
export const radioJob = () => job;

function install() {
  return new Promise<void>((resolve, reject) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const p = spawn(npm, ['install', '--no-save', '--no-audit', '--no-fund', ...SPEECH_PACKAGES], { cwd: path.join(import.meta.dirname, '..'), stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`installing speech recognition failed (npm exited with ${code})`))));
  });
}

export function startRadioJob(key: number) {
  if (job && (job.stage === 'installing' || job.stage === 'transcribing')) return job;
  const pack = ensurePack(key);
  if (!pack) throw new Error('This session isn’t downloaded.');
  const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(pack.meta)).toString());
  const urls: string[] = meta.radio.map((r: [number, number, string]) => r[2]);
  const current: RadioJob = (job = { key, stage: 'installing', done: 0, total: urls.length });
  const file = path.join(RADIO_DIR, `${key}.json`);
  void (async () => {
    try {
      if (!(await canTranscribe())) await install();
      current.stage = 'transcribing';
      fs.mkdirSync(RADIO_DIR, { recursive: true });
      let have: RadioTranscripts | null = null;
      try {
        have = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // none yet
      }
      const out = await transcribeAll(urls, have, Infinity, () => {}, (done, _total, sofar) => {
        current.done = done;
        fs.writeFileSync(file, JSON.stringify(sofar));
      });
      fs.writeFileSync(file, JSON.stringify(out));
      current.done = urls.length;
      current.stage = 'done';
    } catch (err) {
      current.stage = 'failed';
      current.error = (err as Error).message;
    }
  })();
  return current;
}
