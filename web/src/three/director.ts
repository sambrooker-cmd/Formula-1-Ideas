// The auto director: picks what's worth watching and cuts between cameras like a TV director.
// About once a second it scores the stories on track (a close fight, a pass about to happen, a
// pit stop, the start, the Safety Car, otherwise the leader), sticks with the current one unless
// something clearly better comes along, and changes shot every few seconds.
import type { SessionData } from '../data/session';
import { tower, trackStatusAt } from '../data/state';
import { keyMoments } from '../data/moments';

export type Shot = 'tv' | 'follow' | 'onboard' | 'heli';

interface Story {
  key: string;
  subject: number;
  score: number;
  caption: string;
  shots: Shot[];
}

export interface Direction {
  subject: number;
  shot: Shot;
  caption: string;
}

/** Shots per kind of story, used in turn. */
const BATTLE: Shot[] = ['follow', 'tv', 'heli', 'tv', 'onboard', 'tv'];
const LEADER: Shot[] = ['tv', 'heli', 'follow', 'tv', 'onboard'];
const PIT: Shot[] = ['tv', 'heli'];
const START: Shot[] = ['heli', 'tv', 'follow'];

export class Director {
  private story: Story | null = null;
  private storySince = 0;
  private shotIndex = 0;
  private shotUntil = 0;
  private evaluatedAt = -Infinity;
  current: Direction | null = null;

  constructor(private data: SessionData) {}

  /** Called every frame with the session time and the wall clock (ms). */
  update(t: number, wall: number): Direction | null {
    if (wall - this.evaluatedAt > 1000 || !this.story) {
      this.evaluatedAt = wall;
      const best = this.best(t);
      const cur = this.story;
      const stillThere = cur && best.find((s) => s.key === cur.key);
      const top = best[0];
      // Stay with the current story for at least 8 s, and longer unless something is clearly better.
      const switchTo =
        !cur || !stillThere
          ? top
          : top && top.key !== cur.key && wall - this.storySince > 8000 && top.score > stillThere.score + 6
            ? top
            : null;
      if (switchTo) {
        this.story = switchTo;
        this.storySince = wall;
        this.shotIndex = 0;
        this.shotUntil = wall + this.shotLength(switchTo.shots[0]);
      } else if (stillThere) this.story = { ...stillThere, shots: cur!.shots };
    }
    const story = this.story;
    if (!story) return (this.current = null);
    if (wall > this.shotUntil) {
      this.shotIndex = (this.shotIndex + 1) % story.shots.length;
      this.shotUntil = wall + this.shotLength(story.shots[this.shotIndex]);
    }
    this.current = { subject: story.subject, shot: story.shots[this.shotIndex], caption: story.caption };
    return this.current;
  }

  private shotLength(shot: Shot) {
    return shot === 'onboard' ? 5000 : shot === 'heli' ? 6000 : 7000 + Math.random() * 3000;
  }

  /** Every story worth showing now, best first. */
  private best(t: number): Story[] {
    const data = this.data;
    const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
    const rows = tower(data, t).filter((r) => !r.out && r.position < 99);
    const out: Story[] = [];
    const race = data.meta.session.type === 'Race';
    const leader = rows[0];
    if (!leader) return out;

    // The start: the whole field from above, then down to the front.
    if (race && t > data.meta.raceStart - 8000 && t < data.meta.raceStart + 45_000) {
      out.push({ key: 'start', subject: rows[Math.min(3, rows.length - 1)].driver, score: 100, caption: 'The start', shots: START });
      return out;
    }
    const status = trackStatusAt(data, t).status;
    if (status === 'SC' || status === 'VSC' || status === 'RED') {
      const label = status === 'SC' ? 'Safety Car' : status === 'VSC' ? 'Virtual Safety Car' : 'Red flag';
      out.push({ key: 'flag', subject: leader.driver, score: 30, caption: `${label}: ${code(leader.driver)} leads`, shots: LEADER });
    }

    // A pass about to happen (replays only: the director knows what's coming).
    if (!data.live)
      for (const m of keyMoments(data)) {
        if (m.kind !== 'overtake' || m.t < t || m.t > t + 7000) continue;
        const [a, b] = m.drivers;
        const pos = Number(/P(\d+)/.exec(m.text)?.[1] ?? 20);
        out.push({ key: `fight-${[a, b].sort().join('-')}`, subject: a, score: 26 - pos * 0.6, caption: `${code(a)} attacking ${code(b)} for P${pos}`, shots: BATTLE });
      }

    // Close fights (within 1.2 s), the higher up the better.
    if (race)
      for (let k = 1; k < rows.length; k++) {
        const r = rows[k];
        const ahead = rows[k - 1];
        if (r.inPit || ahead.inPit || r.intervalSecs == null || r.intervalSecs > 1.2) continue;
        out.push({
          key: `fight-${[r.driver, ahead.driver].sort().join('-')}`,
          subject: r.driver,
          score: 14 - r.position * 0.5 + (1.2 - r.intervalSecs) * 6,
          caption: `Battle for P${ahead.position}: ${code(r.driver)} ${r.intervalSecs.toFixed(1)} s behind ${code(ahead.driver)}`,
          shots: BATTLE,
        });
      }

    // Pit stops near the front.
    for (const r of rows)
      if (r.inPit && r.position <= 10)
        out.push({ key: `pit-${r.driver}`, subject: r.driver, score: 12 - r.position * 0.4, caption: `${code(r.driver)} in the pits (P${r.position})`, shots: PIT });

    out.push({ key: `lead-${leader.driver}`, subject: leader.driver, score: 5, caption: race ? `${code(leader.driver)} leads` : `${code(leader.driver)} on top`, shots: LEADER });

    // One story per pair (an upcoming pass and the fight it ends share a key): keep the best.
    const byKey = new Map<string, Story>();
    for (const s of out) if (!byKey.has(s.key) || byKey.get(s.key)!.score < s.score) byKey.set(s.key, s);
    return [...byKey.values()].sort((a, b) => b.score - a.score);
  }
}
