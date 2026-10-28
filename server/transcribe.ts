// Team radio transcripts: each clip turned into text with Whisper (OpenAI's open speech model,
// run locally through transformers.js), so radio can be read and searched.
//
// The speech model is big (a ~250 MB download plus ~700 MB of libraries), so it isn't part of
// the app. The GitHub publish job installs it and transcribes each published session; the Mac
// app then fetches the transcripts from the site. To run it yourself:
//   npm i --no-save @huggingface/transformers@4 mpg123-decoder
//   npx tsx server/transcribe.ts <session key>...      (writes cache/radio/<key>.json)
import fs from 'node:fs';
import path from 'node:path';

export const MODEL = 'onnx-community/whisper-small.en';

/** Saved transcripts: clip address → text. */
export interface RadioTranscripts {
  model: string;
  texts: Record<string, string>;
}

type Asr = (audio: Float32Array, opts: object) => Promise<{ text: string }>;
let asr: Promise<Asr> | null = null;
let Decoder: (new () => { ready: Promise<void>; decode(b: Uint8Array): { channelData: Float32Array[]; sampleRate: number }; free(): void }) | null = null;

/** Can this machine transcribe (are the optional packages installed)? */
export async function canTranscribe() {
  try {
    const names = ['@huggingface/transformers', 'mpg123-decoder'];
    for (const n of names) await import(n);
    return true;
  } catch {
    return false;
  }
}

async function load() {
  asr ??= (async () => {
    const tf: any = await import('@huggingface/transformers' as string);
    Decoder = (await import('mpg123-decoder' as string)).MPEGDecoder;
    return tf.pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' });
  })();
  return asr;
}

/** Whisper wants 16 kHz mono. */
function to16k(mono: Float32Array, rate: number) {
  const ratio = rate / 16000;
  const out = new Float32Array(Math.floor(mono.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = mono[j] * (1 - f) + (mono[j + 1] ?? 0) * f;
  }
  return out;
}

/** Whisper sometimes "hears" these in silence or engine noise. */
const JUNK = /^\s*(\[.*\]|\(.*\)|you|thank you\.?|thanks for watching!?|\.+)\s*$/i;

export async function transcribeClip(url: string): Promise<string> {
  const run = await load();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`radio clip ${res.status}`);
  const dec = new Decoder!();
  await dec.ready;
  const { channelData, sampleRate } = dec.decode(new Uint8Array(await res.arrayBuffer()));
  dec.free();
  if (!channelData[0]?.length) return '';
  const { text } = await run(to16k(channelData[0], sampleRate), { chunk_length_s: 30 });
  const clean = text.trim().replace(/\s+/g, ' ');
  return JUNK.test(clean) ? '' : clean;
}

/** Transcribe a session's clips (skipping ones already done), until the deadline. */
export async function transcribeAll(urls: string[], have: RadioTranscripts | null, deadline = Infinity, log = console.log): Promise<RadioTranscripts> {
  const out: RadioTranscripts = { model: MODEL, texts: { ...(have?.model === MODEL ? have.texts : {}) } };
  for (const url of urls) {
    if (url in out.texts) continue;
    if (Date.now() > deadline) break;
    try {
      out.texts[url] = await transcribeClip(url);
    } catch (err) {
      log(`  couldn't transcribe a clip: ${(err as Error).message}`);
    }
  }
  return out;
}

// Command line: transcribe cached sessions on this computer.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { ensurePack } = await import('./pack.ts');
  const zlib = await import('node:zlib');
  const { CACHE_DIR } = await import('./db.ts');
  const dir = path.join(CACHE_DIR, 'radio');
  fs.mkdirSync(dir, { recursive: true });
  for (const key of process.argv.slice(2).map(Number)) {
    const pack = ensurePack(key);
    if (!pack) {
      console.log(`Session ${key} isn't downloaded`);
      continue;
    }
    const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(pack.meta)).toString());
    const urls: string[] = meta.radio.map((r: [number, number, string]) => r[2]);
    console.log(`Session ${key}: ${urls.length} clips`);
    const file = path.join(dir, `${key}.json`);
    const have = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    fs.writeFileSync(file, JSON.stringify(await transcribeAll(urls, have)));
  }
}
