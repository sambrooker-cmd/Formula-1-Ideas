import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition } from '../web/src/three/environment.ts';

const deg = (r: number) => (r * 180) / Math.PI;

test('the sun is high at midday in the tropics and down at midnight', () => {
  // Singapore (1.3°N, 103.8°E): local noon is about 05:00 UTC.
  const noon = sunPosition(Date.parse('2026-10-11T05:00:00Z'), 1.29, 103.86);
  const night = sunPosition(Date.parse('2026-10-11T17:00:00Z'), 1.29, 103.86);
  assert.ok(deg(noon.altitude) > 70);
  assert.ok(deg(night.altitude) < -20);
});

test('Abu Dhabi race start (17:00 local) is just before sunset', () => {
  const p = sunPosition(Date.parse('2025-12-07T13:00:00Z'), 24.47, 54.6);
  assert.ok(deg(p.altitude) > -2 && deg(p.altitude) < 12, `altitude ${deg(p.altitude)}`);
});
