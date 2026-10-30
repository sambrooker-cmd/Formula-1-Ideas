import test from 'node:test';
import assert from 'node:assert/strict';
import { titleMaths } from '../web/src/data/titlemaths.ts';
import { season } from './helpers.ts';

const order = ['ant', 'rus', 'ham', 'ver', 'lec', 'nor', 'pia', 'alo', 'str', 'gas', 'oco', 'alb'];

test('a big lead with few races left can be sealed at the next race', () => {
  // 18 of 23 races done, ANT won them all: 450 points against RUS's 324.
  const h = season(23, Array.from({ length: 18 }, () => order));
  const m = titleMaths(h, 'drivers');
  assert.equal(m.racesLeft, 5);
  assert.equal(m.maxLeft, 125);
  assert.equal(m.table[0].id, 'ant');
  // 126 ahead with 125 left: already champion.
  assert.equal(m.table.filter((c) => c.alive).length, 1);
});

test('a close fight lists every contender and what seals it', () => {
  // Alternate winners for 10 races of 12: level-ish.
  const swap = [order[1], order[0], ...order.slice(2)];
  const h = season(12, Array.from({ length: 10 }, (_, i) => (i % 2 ? order : swap)));
  const m = titleMaths(h, 'drivers');
  assert.ok(m.table.filter((c) => c.alive).length >= 2);
  // With 50 points left after two races and a 0-point gap, it can't be sealed at the next race.
  assert.ok(m.scenarios.every((s) => !s.possible) || m.clinchMargin! > m.next!.weekendMax);
});

test('scenarios: finishing worse never makes it easier', () => {
  const h = season(20, [...Array.from({ length: 16 }, () => order), ...Array.from({ length: 2 }, () => [order[1], order[0], ...order.slice(2)])]);
  const m = titleMaths(h, 'drivers');
  const possible = m.scenarios.map((s) => s.possible);
  // Once impossible for a finishing position, it stays impossible for every worse one (P0 = out of the points comes last).
  const firstBad = possible.indexOf(false);
  if (firstBad >= 0) assert.ok(possible.slice(firstBad).every((p) => !p));
});

test('constructors use both cars’ points', () => {
  const h = season(23, Array.from({ length: 18 }, () => order));
  const m = titleMaths(h, 'teams');
  assert.equal(m.maxLeft, 5 * (25 + 18));
  assert.equal(m.table[0].points, 18 * (25 + 18));
});
