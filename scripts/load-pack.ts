// Dev helper: load a cached replay pack in Node, for checking the analysis code against real races.
// Usage: import { loadPack } from '../scripts/load-pack.ts'; const data = loadPack(9839);
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { index } from '../web/src/data/session.ts';
import { PACK_VERSION } from '../shared/pack.ts';

export function loadPack(key: number, dir = path.join(import.meta.dirname, '..', 'cache')) {
  const meta = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, `session-${key}.v${PACK_VERSION}.meta.json.gz`))).toString());
  const bin = zlib.gunzipSync(fs.readFileSync(path.join(dir, `session-${key}.v${PACK_VERSION}.samples.bin.gz`)));
  return index(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
}
