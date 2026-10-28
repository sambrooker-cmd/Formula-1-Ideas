// Comparing drivers across eras: raw wins and titles mostly measure the car, so the fairest
// yardstick is the one driver with the same car, the team-mate. For every season of a career:
// how often they beat their team-mates in qualifying (grid) and in races (both classified), and
// their share of the team's points (a share is comparable whatever the points system).
import { jolpicaAll } from './history';
import type { Career } from './career';

export interface MateSeason {
  year: number;
  team: string;
  mates: string[];
  /** [driver ahead, team-mate ahead] */
  race: [number, number];
  quali: [number, number];
  /** This driver's share of the points the team's drivers scored, scaled so an equal share is 50 (null if none scored). */
  share: number | null;
}

export interface MateRecord {
  seasons: MateSeason[];
  race: [number, number];
  quali: [number, number];
  /** Average points share over seasons where the team scored. */
  share: number | null;
  /** One number: the average of race %, qualifying % and points share (50 = level with team-mates). */
  index: number | null;
}

type Row = { round: number; driver: string; name: string; grid: number; pos: number | null; points: number };

async function teamResults(year: number, team: string): Promise<Row[]> {
  const key = `pitwall.teamres.v1.${year}.${team}`;
  const finished = year < new Date().getFullYear();
  try {
    const hit = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (hit && (finished || Date.now() - hit.at < 86_400e3)) return hit.data;
  } catch {
    // ignore
  }
  const races = await jolpicaAll(`${year}/constructors/${team}/results.json`);
  const rows: Row[] = races.flatMap((race: any) =>
    (race.Results ?? []).map((r: any) => ({
      round: Number(race.round),
      driver: r.Driver.driverId,
      name: r.Driver.familyName,
      grid: Number(r.grid ?? 0),
      pos: /^\d+$/.test(r.positionText) ? Number(r.position) : null,
      points: Number(r.points ?? 0),
    })),
  );
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data: rows }));
  } catch {
    // ignore
  }
  return rows;
}

const pct = ([a, b]: [number, number]) => (a + b ? (a / (a + b)) * 100 : null);

export async function mateRecord(c: Career, onProgress?: (done: number, total: number) => void): Promise<MateRecord> {
  const id = c.driver.id;
  const stints = [...new Map(c.races.map((r) => [`${r[0]}|${r[3]}`, { year: r[0], team: r[3], teamName: r[4] }])).values()];
  const seasons: MateSeason[] = [];
  let done = 0;
  for (const s of stints) {
    const rows = await teamResults(s.year, s.team).catch(() => [] as Row[]);
    onProgress?.(++done, stints.length);
    const mine = rows.filter((r) => r.driver === id);
    const race: [number, number] = [0, 0];
    const quali: [number, number] = [0, 0];
    const mates = new Set<string>();
    let myPts = 0;
    let allPts = 0;
    let cars = 0;
    for (const me of mine) {
      myPts += me.points;
      allPts += me.points;
      const others = rows.filter((r) => r.round === me.round && r.driver !== id);
      cars += 1 + others.length;
      for (const o of others) {
        mates.add(o.name);
        allPts += o.points;
        if (me.grid > 0 && o.grid > 0) quali[me.grid < o.grid ? 0 : 1]++;
        if (me.pos != null && o.pos != null) race[me.pos < o.pos ? 0 : 1]++;
      }
    }
    if (!mates.size) continue;
    // In the 1950s teams often ran three or four cars: an equal share then is 25–33%, so scale to "equal = 50".
    const perRace = cars / mine.length;
    seasons.push({ year: s.year, team: s.teamName, mates: [...mates], race, quali, share: allPts > 0 ? Math.min(100, (myPts / allPts) * perRace * 50) : null });
  }
  const sum = (k: 'race' | 'quali'): [number, number] => seasons.reduce<[number, number]>((t, s) => [t[0] + s[k][0], t[1] + s[k][1]], [0, 0]);
  const shares = seasons.map((s) => s.share).filter((x): x is number => x != null);
  const share = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;
  const r = sum('race');
  const q = sum('quali');
  const parts = [pct(r), pct(q), share].filter((x): x is number => x != null);
  return { seasons: seasons.sort((a, b) => a.year - b.year), race: r, quali: q, share, index: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null };
}
