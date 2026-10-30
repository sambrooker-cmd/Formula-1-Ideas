import test from 'node:test';
import assert from 'node:assert/strict';
import { compoundModels, planRace } from '../web/src/data/strategyplan.ts';
import type { LongRun } from '../web/src/data/longruns.ts';

const run = (compound: string, average: number, slope: number, n = 10): LongRun => ({
  driver: Math.floor(Math.random() * 99),
  compound,
  tyreAge: 1,
  start: 0,
  end: 1,
  laps: [],
  average,
  slope,
  clean: n,
});

test('models: softer is quicker and wears faster', () => {
  const m = compoundModels([run('SOFT', 90, 0.15), run('SOFT', 90.1, 0.14), run('MEDIUM', 90.4, 0.08), run('MEDIUM', 90.5, 0.09), run('HARD', 90.8, 0.04), run('HARD', 90.9, 0.05)]);
  const by = Object.fromEntries(m.map((x) => [x.compound, x]));
  assert.equal(by.SOFT.pace, 0);
  assert.ok(by.MEDIUM.pace > by.SOFT.pace && by.HARD.pace > by.MEDIUM.pace);
  assert.ok(by.SOFT.deg > by.MEDIUM.deg && by.MEDIUM.deg > by.HARD.deg);
});

test('a missing compound is estimated', () => {
  const m = compoundModels([run('SOFT', 90, 0.15), run('SOFT', 90.1, 0.14), run('MEDIUM', 90.4, 0.08), run('MEDIUM', 90.5, 0.09)]);
  const hard = m.find((x) => x.compound === 'HARD');
  assert.ok(hard?.estimated);
});

test('plans use two compounds, add up to the race distance, and the best comes first', () => {
  const m = compoundModels([run('SOFT', 90, 0.15), run('SOFT', 90.1, 0.14), run('MEDIUM', 90.4, 0.08), run('MEDIUM', 90.5, 0.09), run('HARD', 90.8, 0.04), run('HARD', 90.9, 0.05)]);
  const plans = planRace(m, 57, 21);
  assert.ok(plans.length > 0);
  assert.equal(plans[0].delta, 0);
  for (const p of plans) {
    assert.equal(p.stints.reduce((s, x) => s + x.laps, 0), 57);
    assert.ok(new Set(p.stints.map((x) => x.compound)).size >= 2);
    for (let i = 1; i < plans.length; i++) assert.ok(plans[i].delta >= plans[i - 1].delta);
    p.windows.forEach(([a, b], i) => assert.ok(a <= p.stops[i] && p.stops[i] <= b));
  }
});

test('expensive stops favour fewer stops', () => {
  const m = compoundModels([run('SOFT', 90, 0.1), run('SOFT', 90.1, 0.1), run('MEDIUM', 90.4, 0.06), run('MEDIUM', 90.5, 0.06)]);
  assert.equal(planRace(m, 57, 40)[0].stops.length, 1);
});
