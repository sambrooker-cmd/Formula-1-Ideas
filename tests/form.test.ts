import test from 'node:test';
import assert from 'node:assert/strict';
import { formGuide } from '../web/src/data/form.ts';
import { season } from './helpers.ts';

const order = ['ant', 'rus', 'ham', 'ver', 'lec', 'nor'];

test('the driver winning every race is top of the form guide', () => {
  const rows = formGuide(season(8, Array.from({ length: 8 }, () => order)));
  assert.equal(rows[0].id, 'ant');
  assert.ok(rows[0].recent > rows.at(-1)!.recent);
  for (const r of rows) for (const x of r.races) assert.ok(x.score >= 2 && x.score <= 10);
});

test('trend shows improvement', () => {
  const flipped = [...order].reverse();
  // Five races last, then five races first.
  const rows = formGuide(season(10, [...Array.from({ length: 5 }, () => order), ...Array.from({ length: 5 }, () => flipped)]));
  const nor = rows.find((r) => r.id === 'nor')!;
  assert.ok(nor.before != null && nor.recent > nor.before);
});
