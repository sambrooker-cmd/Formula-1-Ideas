import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightReel, HIGHLIGHT_LENGTH, type Moment } from '../web/src/data/moments.ts';

const m = (t: number, kind: Moment['kind'], weight: 1 | 2 | 3, text = kind): Moment => ({ t, kind, weight, drivers: [1, 2], text, lap: 1 });

test('catch-up fits the time and always has the start, flags and finish', () => {
  const all: Moment[] = [m(0, 'start', 3), m(4000_000, 'finish', 3), m(2000_000, 'flag', 3, 'Safety Car deployed')];
  for (let i = 1; i < 200; i++) all.push(m(i * 20_000, 'overtake', (1 + (i % 3)) as 1 | 2 | 3, `A passes B for P${1 + (i % 15)}`));
  all.sort((a, b) => a.t - b.t);
  const reel = highlightReel(all, 0, 5);
  assert.ok(reel.length <= Math.floor((5 * 60_000) / HIGHLIGHT_LENGTH));
  for (const k of ['start', 'finish', 'flag']) assert.ok(reel.some((x) => x.kind === k), k);
  for (let i = 1; i < reel.length; i++) assert.ok(reel[i].t > reel[i - 1].t);
});

test('without a time limit only notable moments play', () => {
  const reel = highlightReel([m(0, 'start', 3), m(60_000, 'pit', 1), m(120_000, 'overtake', 2)], 0, null);
  assert.equal(reel.length, 2);
});
