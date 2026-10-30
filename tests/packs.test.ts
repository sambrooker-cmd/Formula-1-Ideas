// Checks on real races, using replays downloaded on this computer (skipped when there aren't any,
// e.g. on GitHub).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PACK_VERSION } from '../shared/pack.ts';

const have = (key: number) => fs.existsSync(`cache/session-${key}.v${PACK_VERSION}.meta.json.gz`);
const RACE = 9839; // Abu Dhabi 2025
const skip = !have(RACE) && 'no downloaded replay';

test('a real race: moments, commentary, ratings, predictor and the 3D track', { skip }, async () => {
  const { loadPack } = await import('../scripts/load-pack.ts');
  const { keyMoments } = await import('../web/src/data/moments.ts');
  const { commentary } = await import('../web/src/data/commentary.ts');
  const { raceRatings } = await import('../web/src/data/ratings.ts');
  const { predictFinish } = await import('../web/src/data/predictor.ts');
  const { track3d } = await import('../web/src/data/track3d.ts');
  const d = loadPack(RACE);
  const moments = keyMoments(d);
  assert.equal(moments.filter((x) => x.kind === 'finish').length, 1, 'one chequered flag');
  assert.ok(moments.some((x) => x.kind === 'start'));
  assert.ok(commentary(d).length > moments.length);
  const ratings = raceRatings(d);
  assert.equal(ratings[0].finish != null, true);
  for (const r of ratings) assert.ok(r.score >= 2 && r.score <= 10);
  const mid = d.lapStartTimes[30]!;
  const p = predictFinish(d, mid)!;
  assert.equal(p.rows.length, new Set(p.rows.map((r) => r.driver)).size);
  const t = track3d(d);
  assert.ok(t.pts.length > 800, 'outline smoothed into a fine curve');
  assert.ok(Math.abs(t.length - 5280) < 300, `lap length ${t.length}`);
});
