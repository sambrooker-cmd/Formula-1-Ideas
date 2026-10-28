// Commentary captions: short plain-English lines about what's going on, worked out from the
// timing (who's closing on whom, who's in overtaking range, tyre offsets, the lead) plus the
// key moments. Built once per data version for the whole session; the panel shows the ones
// up to the replay time.
import type { SessionData } from './session';
import { keyMoments } from './moments';
import { tower } from './state';

export interface Caption {
  t: number;
  lap: number | null;
  text: string;
  /** Drivers it's about (for colour dots and selecting them). */
  drivers: number[];
  /** 1 = colour, 2 = worth a look, 3 = big moment. */
  weight: 1 | 2 | 3;
}

const cache = new WeakMap<SessionData, { version: number; list: Caption[] }>();

export function commentary(data: SessionData): Caption[] {
  const hit = cache.get(data);
  if (hit && hit.version === data.version) return hit.list;
  const list = build(data);
  cache.set(data, { version: data.version, list });
  return list;
}

const ordinal = (n: number) => `P${n}`;

function build(data: SessionData): Caption[] {
  const out: Caption[] = [];
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const race = data.meta.session.type === 'Race';

  // Key moments, as they are (they're already written as captions).
  for (const m of keyMoments(data)) out.push({ t: m.t, lap: m.lap, text: m.text, drivers: m.drivers, weight: m.weight });
  if (!race) return out.sort((a, b) => a.t - b.t);

  const total = data.meta.totalLaps;
  // Once per lap, read the order and the gaps at the moment the leader starts the lap.
  const snapshots: { lap: number; t: number; rows: ReturnType<typeof tower> }[] = [];
  data.lapStartTimes.forEach((t, lap) => {
    if (t != null && lap >= 2) snapshots.push({ lap, t: t + 4000, rows: tower(data, t + 4000).filter((r) => !r.out && r.position < 99) });
  });
  const lastSaid = new Map<string, number>(); // topic → lap it was last mentioned
  const say = (topic: string, everyLaps: number, c: Caption) => {
    const prev = lastSaid.get(topic);
    if (prev != null && c.lap! - prev < everyLaps) return;
    lastSaid.set(topic, c.lap!);
    out.push(c);
  };

  for (let i = 3; i < snapshots.length; i++) {
    const { lap, t, rows } = snapshots[i];
    const earlier = snapshots[i - 3].rows;
    const before = new Map(earlier.map((r) => [r.driver, r]));
    // Gaps mean nothing just after a Safety Car or VSC.
    const from = snapshots[i - 3].t;
    const neutral = data.trackStatus.some((s, j) => ['SC', 'VSC', 'RED'].includes(s.status) && s.t <= t && (data.trackStatus[j + 1]?.t ?? Infinity) > from);

    // The lead, every 10 laps and on the last lap.
    const leader = rows[0];
    const second = rows[1];
    if (leader && second && (lap % 10 === 0 || lap === total)) {
      const gap = second.intervalSecs;
      say('lead', 1, {
        t,
        lap,
        text: lap === total ? `Last lap: ${code(leader.driver)} leads${gap != null ? ` by ${gap.toFixed(1)} s` : ''}.` : `Lap ${lap}${total ? ` of ${total}` : ''}: ${code(leader.driver)} leads ${code(second.driver)}${gap != null ? ` by ${gap.toFixed(1)} s` : ''}.`,
        drivers: [leader.driver, second.driver],
        weight: 1,
      });
    }

    if (neutral) continue;
    for (let k = 1; k < Math.min(rows.length, 12); k++) {
      const chaser = rows[k];
      const ahead = rows[k - 1];
      const gap = chaser.intervalSecs;
      const prevChaser = before.get(chaser.driver);
      const prevAhead = before.get(ahead.driver);
      // Skip pairs where either has pitted since (the gaps aren't comparable).
      if (gap == null || chaser.inPit || ahead.inPit || !prevChaser || !prevAhead || prevChaser.pits !== chaser.pits || prevAhead.pits !== ahead.pits) continue;
      const pair = `${chaser.driver}-${ahead.driver}`;
      // Same pair, same order three laps ago: how fast is the gap closing?
      const prevGap = prevChaser.position === chaser.position && prevAhead.position === ahead.position ? prevChaser.intervalSecs : null;
      const rate = prevGap != null ? (prevGap - gap) / 3 : 0;
      const tyres =
        chaser.tyreAge != null && ahead.tyreAge != null && ahead.tyreAge - chaser.tyreAge >= 8
          ? ` on tyres ${ahead.tyreAge - chaser.tyreAge} laps fresher`
          : chaser.compound && ahead.compound && chaser.compound !== ahead.compound
            ? ` (${chaser.compound.toLowerCase()}s against ${ahead.compound.toLowerCase()}s)`
            : '';
      const forPlace = `for ${ordinal(ahead.position)}`;
      if (gap < 1 && prevGap != null && prevGap >= 1) {
        say(`range-${pair}`, 4, {
          t,
          lap,
          text: `${code(chaser.driver)} is within a second of ${code(ahead.driver)} ${forPlace}${tyres}: in overtaking range.`,
          drivers: [chaser.driver, ahead.driver],
          weight: ahead.position <= 3 ? 3 : 2,
        });
      } else if (gap < 4 && rate >= 0.3) {
        const lapsToCatch = Math.ceil((gap - 1) / rate);
        say(`closing-${pair}`, 6, {
          t,
          lap,
          text: `${code(chaser.driver)} is closing on ${code(ahead.driver)} ${forPlace}: ${gap.toFixed(1)} s behind, gaining ${rate.toFixed(1)} s a lap${tyres}${lapsToCatch > 0 && lapsToCatch < 15 ? `. In range in about ${lapsToCatch} lap${lapsToCatch > 1 ? 's' : ''}` : ''}.`,
          drivers: [chaser.driver, ahead.driver],
          weight: ahead.position <= 3 ? 2 : 1,
        });
      } else if (lap >= 8 && gap < 1 && prevGap != null && prevGap < 1 && Math.abs(rate) < 0.1 && ahead.position <= 10) {
        say(`stuck-${pair}`, 8, {
          t,
          lap,
          text: `${code(chaser.driver)} has been stuck behind ${code(ahead.driver)} ${forPlace} for a few laps now.`,
          drivers: [chaser.driver, ahead.driver],
          weight: 1,
        });
      } else if (gap > 1 && gap < 3 && prevGap != null && prevGap < 1 && rate < 0) {
        say(`dropped-${pair}`, 6, {
          t,
          lap,
          text: `${code(ahead.driver)} has pulled out of range of ${code(chaser.driver)}: ${gap.toFixed(1)} s now.`,
          drivers: [ahead.driver, chaser.driver],
          weight: 1,
        });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
