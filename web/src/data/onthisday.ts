// "On this day": every Grand Prix winner since 1950 with its date (about 12 requests, kept in
// the browser and topped up monthly), plus drivers born on the day.
import { jolpica, jolpicaAll } from './history';
import { allDrivers, type CareerDriver } from './career';

/** [date YYYY-MM-DD, season, round, raceName, circuit, country, driverId, driverName, team, grid] */
export type Winner = [string, number, number, string, string, string, string, string, string, number];

const KEY = 'pitwall.winners.v1';

export async function allWinners(): Promise<Winner[]> {
  try {
    const hit = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (hit && Date.now() - hit.at < 30 * 86_400e3) return hit.data as Winner[];
  } catch {
    // ignore
  }
  const races = await jolpicaAll('results/1.json');
  const data: Winner[] = races
    .filter((r) => r.Results?.[0])
    .map((r) => {
      const w = r.Results[0];
      return [
        r.date,
        Number(r.season),
        Number(r.round),
        r.raceName,
        r.Circuit.circuitName,
        r.Circuit.Location.country,
        w.Driver.driverId,
        `${w.Driver.givenName} ${w.Driver.familyName}`,
        w.Constructor.name,
        Number(w.grid ?? 0),
      ];
    });
  try {
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // ignore
  }
  return data;
}

export function onDay(winners: Winner[], month: number, day: number) {
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return winners.filter((w) => w[0].slice(5) === md).sort((a, b) => b[1] - a[1]);
}

/** Races within ±n days of the date (any year), nearest first, for days with no race. */
export function nearDay(winners: Winner[], month: number, day: number, n = 3) {
  const target = Date.UTC(2000, month - 1, day);
  const dist = (w: Winner) => {
    const [, m, d] = w[0].split('-').map(Number);
    const t = Date.UTC(2000, m - 1, d);
    const diff = Math.abs(t - target) / 86_400e3;
    return Math.min(diff, 366 - diff);
  };
  return winners
    .map((w) => ({ w, d: dist(w) }))
    .filter((x) => x.d > 0 && x.d <= n)
    .sort((a, b) => a.d - b.d || b.w[1] - a.w[1])
    .map((x) => x.w);
}

export async function bornOn(month: number, day: number): Promise<CareerDriver[]> {
  const md = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return (await allDrivers()).filter((d) => d.dob.slice(5) === md).sort((a, b) => a.dob.localeCompare(b.dob));
}

/** The top three of one race (cached). */
export async function podium(season: number, round: number): Promise<{ name: string; team: string }[]> {
  const key = `pitwall.podium.${season}.${round}`;
  try {
    const hit = localStorage.getItem(key);
    if (hit) return JSON.parse(hit);
  } catch {
    // ignore
  }
  const page = await jolpica(`${season}/${round}/results.json?limit=3`);
  const out = (page.RaceTable.Races[0]?.Results ?? []).map((r: any) => ({ name: `${r.Driver.givenName} ${r.Driver.familyName}`, team: r.Constructor.name }));
  try {
    localStorage.setItem(key, JSON.stringify(out));
  } catch {
    // ignore
  }
  return out;
}
