// Automatic race report: a plain-English write-up of a session, built by rules from the data.
// Races and sprints get the story of the race; qualifying gets pole, gaps and knockouts.
import type { SessionData } from './session';
import { formatLapTime, lastAtOrBefore } from './state';
import { pitBattles, describeBattle } from './undercut';
import { phases, qualiAt } from './quali';

export interface ChampBefore {
  drivers: { code: string; name: string; team: string; points: number }[];
}

export interface Report {
  headline: string;
  standfirst: string;
  sections: { title: string; paragraphs: string[] }[];
  facts: { label: string; value: string }[];
}

/** "Max VERSTAPPEN" → "Verstappen". */
export function surname(full: string) {
  const parts = full.split(' ').filter((p) => p === p.toUpperCase() && /[A-Z]/.test(p));
  const s = (parts.length ? parts : full.split(' ').slice(-1)).join(' ');
  return s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
}

function ordinal(n: number) {
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const list = (items: string[]) => (items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items.at(-1));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);

export function buildReport(data: SessionData, champ?: ChampBefore | null): Report | null {
  const type = data.meta.session.type;
  if (type === 'Race') return raceReport(data, champ ?? null);
  if (type === 'Qualifying') return qualiReport(data);
  return null;
}

function helpers(data: SessionData) {
  const name = (n: number) => surname(data.drivers.get(n)?.name ?? String(n));
  const team = (n: number) => data.drivers.get(n)?.team ?? '';
  const positionAt = (n: number, t: number) => {
    const s = data.positions.get(n);
    if (!s) return null;
    const i = lastAtOrBefore(s.t, t);
    return i < 0 ? null : s.v[i];
  };
  return { name, team, positionAt };
}

function raceReport(data: SessionData, champ: ChampBefore | null): Report | null {
  const { meta } = data;
  const { name, team, positionAt } = helpers(data);
  const sprint = /sprint/i.test(meta.session.name);
  const event = sprint ? `${meta.session.meetingName} sprint` : meta.session.meetingName;
  const finishers = meta.results.filter((r) => r.position != null).sort((a, b) => a.position! - b.position!);
  if (finishers.length < 3) return null;
  const [p1, p2, p3] = finishers;
  const grid = new Map(meta.grid.map(([n, p]) => [n, p]));
  const sections: Report['sections'] = [];

  // Headline: winner, and where from.
  const winGrid = grid.get(p1.driver);
  const from = winGrid === 1 ? ' from pole' : winGrid && winGrid > 3 ? ` from ${ordinal(winGrid)} on the grid` : '';
  const headline = `${name(p1.driver)} wins the ${event}${from}`;
  const margin = Number(p2.gap);
  const marginText = Number.isFinite(margin) && margin > 0 ? `, ${margin.toFixed(margin < 1 ? 3 : 1)} seconds clear of ${name(p2.driver)}` : '';
  const standfirst = `${name(p1.driver)} (${team(p1.driver)}) took the chequered flag${marginText}. ${name(p2.driver)} and ${name(p3.driver)} completed the podium.`;

  // Laps led: whoever completed each lap first.
  const ledBy = new Map<number, number>();
  const leaderOfLap: number[] = [];
  const firstEnd = new Map<number, { n: number; end: number }>();
  for (const [n, laps] of data.laps)
    for (const l of laps) {
      if (l.duration == null) continue;
      const cur = firstEnd.get(l.lap);
      if (!cur || l.end < cur.end) firstEnd.set(l.lap, { n, end: l.end });
    }
  for (const [lap, { n }] of [...firstEnd].sort((a, b) => a[0] - b[0])) {
    ledBy.set(n, (ledBy.get(n) ?? 0) + 1);
    leaderOfLap[lap] = n;
  }
  let leadChanges = 0;
  for (let i = 2; i < leaderOfLap.length; i++) if (leaderOfLap[i] != null && leaderOfLap[i - 1] != null && leaderOfLap[i] !== leaderOfLap[i - 1]) leadChanges++;

  // The start: positions at the end of lap 1 against the grid.
  const start: string[] = [];
  const endLap1 = data.lapStartTimes[2];
  if (endLap1 != null && grid.size) {
    const pole = meta.grid.find(([, p]) => p === 1)?.[0];
    const lap1Leader = leaderOfLap[1];
    if (pole != null && lap1Leader != null) {
      start.push(
        lap1Leader === pole
          ? `${name(pole)} converted pole into the lead at the start.`
          : `${name(lap1Leader)} beat polesitter ${name(pole)} to lead the opening lap${grid.get(lap1Leader) ? ` from ${ordinal(grid.get(lap1Leader)!)}` : ''}.`,
      );
    }
    const moves = [...grid]
      .map(([n, g]) => ({ n, g, p: positionAt(n, endLap1 - 500) }))
      .filter((m): m is { n: number; g: number; p: number } => m.p != null);
    const gainers = moves.filter((m) => m.g - m.p >= 3).sort((a, b) => b.g - b.p - (a.g - a.p));
    const losers = moves.filter((m) => m.p - m.g >= 3).sort((a, b) => b.p - b.g - (a.p - a.g));
    if (gainers.length)
      start.push(`Best getaway: ${list(gainers.slice(0, 3).map((m) => `${name(m.n)} (${ordinal(m.g)} to ${ordinal(m.p)})`))}.`);
    if (losers.length) start.push(`Lap 1 went badly for ${list(losers.slice(0, 3).map((m) => `${name(m.n)} (${ordinal(m.g)} to ${ordinal(m.p)})`))}.`);
  }
  if (start.length) sections.push({ title: 'The start', paragraphs: [start.join(' ')] });

  // How the race unfolded: leaders, Safety Cars, red flags.
  const story: string[] = [];
  const leaders = [...ledBy].sort((a, b) => b[1] - a[1]);
  if (leaders.length === 1) story.push(`${name(leaders[0][0])} led every lap.`);
  else if (leaders.length > 1)
    story.push(
      `The lead changed hands ${times(leadChanges)}: ${list(leaders.map(([n, laps]) => `${name(n)} led ${plural(laps, 'lap')}`))}.`,
    );
  const lapAt = (t: number) => {
    let lap = 0;
    data.lapStartTimes.forEach((s, n) => s != null && s <= t && (lap = n));
    return lap;
  };
  const neutral: { kind: string; lap: number; t: number }[] = [];
  let inNeutral = false;
  for (const s of data.trackStatus) {
    const kind = s.status === 'SC' ? 'Safety Car' : s.status === 'VSC' ? 'Virtual Safety Car' : s.status === 'RED' ? 'red flag' : null;
    if (kind && (!inNeutral || kind === 'red flag')) {
      if (!(kind === 'red flag' && neutral.at(-1)?.kind === 'red flag')) neutral.push({ kind, lap: lapAt(s.t), t: s.t });
      inNeutral = true;
    } else if (s.status === 'GREEN' || s.status === 'CHEQUERED') inNeutral = false;
  }
  const retiredAround = (t: number) =>
    meta.results.find((r) => {
      if (r.status === 'FINISHED' || r.status === 'DNS') return false;
      const last = data.laps.get(r.driver)?.at(-1);
      if (!last) return false;
      const stopped = last.duration != null ? last.end : last.t + 60_000;
      return Math.abs(stopped - t) < 150_000;
    });
  if (neutral.length === 0) story.push('It was a clean race with no Safety Car.');
  for (const nEvt of neutral) {
    const who = retiredAround(nEvt.t);
    story.push(`${nEvt.kind === 'red flag' ? 'A red flag' : `The ${nEvt.kind}`} came out on lap ${nEvt.lap}${who ? ` after ${name(who.driver)} stopped` : ''}.`);
  }
  if (story.length) sections.push({ title: 'How it unfolded', paragraphs: [story.join(' ')] });

  // Strategy.
  const strat: string[] = [];
  const stopsOf = (n: number) => (data.pits.get(n) ?? []).filter((p) => p.t > meta.raceStart).length;
  const stintText = (n: number) =>
    (data.stints.get(n) ?? [])
      .map((s) => (s.compound ?? '?').toLowerCase())
      .join(' → ');
  const winStops = (data.pits.get(p1.driver) ?? []).filter((p) => p.t > meta.raceStart && p.lap != null).map((p) => p.lap!);
  if (data.stints.get(p1.driver)?.length)
    strat.push(
      `${name(p1.driver)} ran ${stintText(p1.driver)}${winStops.length ? `, stopping on lap${winStops.length > 1 ? 's' : ''} ${list(winStops.map(String))}` : ' without stopping'}.`,
    );
  const counts = new Map<number, number>();
  for (const r of finishers) counts.set(stopsOf(r.driver), (counts.get(stopsOf(r.driver)) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (common) strat.push(`Most of the finishers (${common[1]} of ${finishers.length}) made ${word(common[0])} stop${common[0] === 1 ? '' : 's'}.`);
  const battles = pitBattles(data).filter((b) => (b.outcome === 'undercut' || b.outcome === 'overcut') && b.forPosition <= 10);
  const code = (n: number) => name(n);
  if (battles.length) strat.push(`In the pits: ${battles.slice(0, 3).map((b) => describeBattle(b, code).replace(/^(Undercut|Overcut): /, '') + ` (for ${ordinal(b.forPosition)})`).join('; ')}.`);
  const fastestStop = [...data.pits]
    .flatMap(([n, ps]) => ps.filter((p) => p.stopDuration != null && p.stopDuration > 1.5).map((p) => ({ n, s: p.stopDuration! })))
    .sort((a, b) => a.s - b.s)[0];
  if (fastestStop) strat.push(`Fastest stop: ${team(fastestStop.n)} for ${name(fastestStop.n)}, ${fastestStop.s.toFixed(1)} s.`);
  if (strat.length) sections.push({ title: 'Strategy', paragraphs: [strat.join(' ')] });

  // Up and down the order.
  const movers: string[] = [];
  const delta = finishers.filter((r) => r.status === 'FINISHED' && grid.has(r.driver)).map((r) => ({ n: r.driver, g: grid.get(r.driver)!, p: r.position! }));
  const up = delta.filter((d) => d.g - d.p >= 4).sort((a, b) => b.g - b.p - (a.g - a.p));
  const down = delta.filter((d) => d.p - d.g >= 4).sort((a, b) => b.p - b.g - (a.p - a.g));
  if (up.length) movers.push(`Climbers: ${list(up.slice(0, 3).map((d) => `${name(d.n)} (${ordinal(d.g)} to ${ordinal(d.p)})`))}.`);
  if (down.length) movers.push(`It went backwards for ${list(down.slice(0, 3).map((d) => `${name(d.n)} (${ordinal(d.g)} to ${ordinal(d.p)})`))}.`);
  const out = meta.results.filter((r) => r.status !== 'FINISHED');
  const dnf = out.filter((r) => r.status === 'DNF');
  if (dnf.length)
    movers.push(
      `${cap(word(dnf.length))} driver${dnf.length > 1 ? 's' : ''} didn't finish: ${list(
        dnf.map((r) => {
          const last = data.laps.get(r.driver)?.at(-1)?.lap;
          return `${name(r.driver)}${last ? ` (lap ${last})` : ''}`;
        }),
      )}.`,
    );
  const dsq = out.filter((r) => r.status === 'DSQ');
  if (dsq.length) movers.push(`Disqualified after the race: ${list(dsq.map((r) => name(r.driver)))}.`);
  const penalties = meta.raceControl.filter(([, , , , , , , m]) => /\d+ SECOND TIME PENALTY|DRIVE THROUGH|STOP AND GO/.test(m) && !/SERVED/.test(m));
  if (penalties.length) {
    const per = new Map<number, number>();
    for (const r of penalties) {
      const n = r[6] ?? Number(/CAR (\d+)/.exec(r[7])?.[1]);
      if (n) per.set(n, (per.get(n) ?? 0) + 1);
    }
    const who = [...per].map(([n, c]) => name(n) + (c > 1 ? ` (${c})` : ''));
    movers.push(`The stewards handed out ${penalties.length} ${penalties.length === 1 ? 'penalty' : 'penalties'}: ${list(who)}.`);
  }
  const best = data.bestLap;
  if (best?.lap.duration) movers.push(`Fastest lap: ${name(best.driver)}, ${formatLapTime(best.lap.duration)} on lap ${best.lap.lap}.`);
  if (movers.length) sections.push({ title: 'Up and down the order', paragraphs: [movers.join(' ')] });

  // Championship.
  if (champ?.drivers.length) {
    const codeOf = (n: number) => data.drivers.get(n)?.code ?? '';
    const pts = new Map(meta.results.map((r) => [codeOf(r.driver), r.points ?? 0]));
    const before = [...champ.drivers].sort((a, b) => b.points - a.points);
    const after = champ.drivers.map((d) => ({ ...d, total: d.points + (pts.get(d.code) ?? 0) })).sort((a, b) => b.total - a.total);
    const [l1, l2] = after;
    const nm = (d: { name: string }) => surname(d.name);
    const ch: string[] = [];
    if (l1 && l2) {
      const lead = l1.total - l2.total;
      if (before[0].code !== l1.code) ch.push(`${nm(l1)} takes the championship lead from ${nm(before[0])}, now ${plural(lead, 'point')} ahead of ${nm(l2)}.`);
      else {
        const was = before[0].points - before[1].points;
        ch.push(
          `${nm(l1)} ${lead > was ? 'extends' : lead < was ? 'still leads, but' : 'keeps'} the championship lead${lead < was ? ` the gap to ${nm(l2)} is down to ${plural(lead, 'point')}` : ` to ${plural(lead, 'point')} over ${nm(l2)}`}.`,
        );
      }
    }
    if (ch.length) sections.push({ title: 'The championship', paragraphs: ch });
  }

  // Weather.
  const w = meta.weather.filter((r) => r[2] > 0 && r[1] > 0); // the feed sometimes sends zeros
  if (w.length) {
    const rain = w.some((r) => r[5] > 0);
    const track = w.map((r) => r[2]);
    sections.push({
      title: 'Conditions',
      paragraphs: [
        `${rain ? 'Rain fell during the race.' : 'It stayed dry.'} Track temperature ranged from ${Math.min(...track).toFixed(0)}° to ${Math.max(...track).toFixed(0)}°C, air ${Math.min(...w.map((r) => r[1])).toFixed(0)}–${Math.max(...w.map((r) => r[1])).toFixed(0)}°C.`,
      ],
    });
  }

  const facts = [
    { label: 'Winner', value: `${name(p1.driver)} · ${team(p1.driver)}` },
    { label: 'Podium', value: [p1, p2, p3].map((r) => data.drivers.get(r.driver)?.code).join(' · ') },
    { label: 'Laps', value: String(meta.totalLaps || p1.laps || '') },
    { label: 'Lead changes', value: String(leadChanges) },
    { label: 'Safety Cars', value: String(neutral.filter((n) => n.kind === 'Safety Car').length) },
    { label: 'Finishers', value: `${finishers.filter((r) => r.status === 'FINISHED').length} of ${meta.results.length}` },
  ];
  return { headline, standfirst, sections, facts };
}

function qualiReport(data: SessionData): Report | null {
  const { meta } = data;
  const { name, team } = helpers(data);
  if (!phases(data).length) return null;
  const q = qualiAt(data, meta.end);
  const rows = q.rows.filter((r) => r.best?.duration != null);
  if (rows.length < 3) return null;
  const [p1, p2, p3] = rows;
  const t = (r: (typeof rows)[number]) => r.best!.duration!;
  const gap = (a: number, b: number) => (b - a).toFixed(3);
  const sprint = /sprint/i.test(meta.session.name);
  const headline = `${name(p1.driver)} takes ${sprint ? 'sprint ' : ''}pole for the ${meta.session.meetingName}`;
  const standfirst = `${name(p1.driver)} (${team(p1.driver)}) set ${formatLapTime(t(p1))}, ${gap(t(p1), t(p2))} s faster than ${name(p2.driver)}. ${name(p3.driver)} was third.`;
  const sections: Report['sections'] = [];

  const front: string[] = [];
  const sameTeamFront = team(p1.driver) === team(p2.driver);
  if (sameTeamFront) front.push(`It's a ${team(p1.driver)} front-row lockout.`);
  const top10 = q.rows.filter((r) => r.outIn == null).slice(0, 10);
  const spread = top10.length === 10 && top10[9].best?.duration ? top10[9].best.duration - t(p1) : null;
  if (spread != null) front.push(`The top ten were covered by ${spread.toFixed(3)} s.`);
  if (front.length) sections.push({ title: 'The front', paragraphs: [front.join(' ')] });

  const outs: string[] = [];
  const out2 = q.rows.filter((r) => r.outIn === 2).map((r) => name(r.driver));
  const out1 = q.rows.filter((r) => r.outIn === 1).map((r) => name(r.driver));
  if (out1.length) outs.push(`Out in Q1: ${list(out1)}.`);
  if (out2.length) outs.push(`Out in Q2: ${list(out2)}.`);
  if (outs.length) sections.push({ title: 'Knocked out', paragraphs: [outs.join(' ')] });

  // Team-mate head-to-heads (by final classification).
  const order = q.rows.map((r) => r.driver);
  const teams = new Map<string, number[]>();
  for (const n of order) teams.set(team(n), [...(teams.get(team(n)) ?? []), n]);
  const h2h = [...teams]
    .filter(([, ns]) => ns.length === 2)
    .map(([tm, [a, b]]) => `${tm}: ${name(a)} ahead of ${name(b)}`);
  if (h2h.length) sections.push({ title: 'Team-mates', paragraphs: [h2h.join('. ') + '.'] });

  const deleted = meta.raceControl.filter((r) => /DELETED/.test(r[7]) && /TRACK LIMITS/.test(r[7])).length;
  const red = data.trackStatus.filter((s) => s.status === 'RED').length;
  const misc: string[] = [];
  if (red) misc.push(`The session was red-flagged ${times(red)}.`);
  if (deleted) misc.push(`${cap(plural(deleted, 'lap time'))} ${deleted === 1 ? 'was' : 'were'} deleted for track limits.`);
  if (misc.length) sections.push({ title: 'Also', paragraphs: [misc.join(' ')] });

  const facts = [
    { label: 'Pole', value: `${name(p1.driver)} · ${formatLapTime(t(p1))}` },
    { label: 'Front row', value: `${data.drivers.get(p1.driver)?.code} · ${data.drivers.get(p2.driver)?.code}` },
    { label: 'Gap to P2', value: `${gap(t(p1), t(p2))} s` },
  ];
  return { headline, standfirst, sections, facts };
}
