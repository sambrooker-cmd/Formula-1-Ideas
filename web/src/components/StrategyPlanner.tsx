// Race strategy planner (practice sessions): the quickest way through the race from this
// session's long runs (data/strategyplan.ts), with pit windows.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { longRuns } from '../data/longruns';
import { compoundModels, planRace, type Plan } from '../data/strategyplan';
import { layout, meetingFor } from '../data/circuit';
import { jolpica, seasonHistory } from '../data/history';
import { Panel } from './Panel';

/** Race laps and pit loss for this weekend's circuit. */
async function raceFacts(data: SessionData): Promise<{ laps: number; pitLoss: number; lapsFrom: string; lossFrom: string }> {
  const year = data.meta.session.year;
  const date = new Date(data.meta.t0 + 2 * 3600e3).toISOString().slice(0, 10);
  let laps = 0;
  let lapsFrom = '';
  let pitLoss = 22;
  let lossFrom = 'a typical figure';
  const m = await meetingFor(year, date).catch(() => null);
  const l = m ? await layout(m.circuit_key, year).catch(() => null) : null;
  const loss = parseFloat(l?.pitLoss?.normal ?? '');
  if (Number.isFinite(loss) && loss > 10) {
    pitLoss = loss;
    lossFrom = 'MultiViewer';
  }
  try {
    const h = await seasonHistory(year);
    const race = h.races.find((r) => Math.abs(Date.parse(r.date) - Date.parse(date)) <= 4 * 86_400e3);
    if (race) {
      const page = await jolpica(`circuits/${race.circuitId}/results/1.json?limit=100`);
      const last = (page.RaceTable?.Races ?? []).filter((r: any) => Date.parse(r.date) < Date.parse(date)).at(-1);
      if (last?.Results?.[0]?.laps) {
        laps = Number(last.Results[0].laps);
        lapsFrom = `as in ${last.season}`;
      }
    }
  } catch {
    // fall back below
  }
  if (!laps && l?.length) {
    laps = Math.ceil(305_000 / l.length);
    lapsFrom = 'race distance ÷ lap length';
  }
  return { laps: laps || 57, pitLoss, lapsFrom: lapsFrom || 'a guess', lossFrom };
}

const short = (c: string) => c[0] + c.slice(1).toLowerCase();

export function StrategyPlanner({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const practice = /Practice/i.test(data.meta.session.name);
  const [facts, setFacts] = useState<Awaited<ReturnType<typeof raceFacts>> | null>(null);
  useEffect(() => {
    if (practice) raceFacts(data).then(setFacts, () => setFacts({ laps: 57, pitLoss: 22, lapsFrom: 'a guess', lossFrom: 'a typical figure' }));
  }, [data, practice]);
  const models = useMemo(() => (practice ? compoundModels(longRuns(data)) : []), [data, data.version, practice]);
  const plans = useMemo(() => {
    if (!facts || !models.length) return [];
    // Plans that differ only in the order of the same tyres come out equal: keep one (softer first, as you'd start).
    const seen = new Set<string>();
    const rank = (c: string) => ['SOFT', 'MEDIUM', 'HARD'].indexOf(c);
    const out: (Plan & { anyOrder: boolean })[] = [];
    for (const p of planRace(models, facts.laps, facts.pitLoss)) {
      const key = p.stints.map((s) => s.compound).sort().join('-');
      const ti = out.findIndex((o) => o.stints.map((s) => s.compound).sort().join('-') === key);
      if (ti >= 0) {
        const twin = out[ti];
        if (Math.abs(twin.delta - p.delta) < 0.2) {
          twin.anyOrder = true;
          // Same time either way: show the one starting on the softer tyre (with its own pit windows).
          if (rank(p.stints[0].compound) < rank(twin.stints[0].compound)) out[ti] = { ...p, delta: twin.delta, anyOrder: true };
        }
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...p, anyOrder: false });
    }
    return out.slice(0, 5);
  }, [models, facts]);

  return (
    <Panel title="Race strategy" lead={lead} area={area} popout="/strategy-plan" bodyClass="scroll">
      {!practice ? (
        <div className="center-msg">The strategy planner works from practice long runs: open a practice session.</div>
      ) : !models.length ? (
        <div className="center-msg">Not enough long runs in this session yet (it needs a few race-style runs on a tyre).</div>
      ) : !facts ? (
        <div className="center-msg">Working out the race…</div>
      ) : (
        <div style={{ padding: '8px 12px' }}>
          <p style={{ marginTop: 0 }}>
            <b>{facts.laps} laps</b> ({facts.lapsFrom}), a pit stop costs about <b>{facts.pitLoss.toFixed(1)} s</b> ({facts.lossFrom}).
          </p>
          <table className="lr-table">
            <thead>
              <tr>
                <th>Tyre</th>
                <th className="num">New-tyre pace</th>
                <th className="num">Wear per lap</th>
                <th className="num">Long runs</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.compound}>
                  <td>
                    <span className={`tyre tyre-${m.compound}`}>{m.compound[0]}</span> {short(m.compound)}
                  </td>
                  <td className="num">{m.pace === 0 ? 'quickest' : `+${m.pace.toFixed(2)} s`}</td>
                  <td className="num">{m.deg.toFixed(3)} s</td>
                  <td className={'num ' + (m.estimated ? 'dim' : '')}>{m.estimated ? 'estimated' : m.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="plan-head">Quickest plans</h3>
          <ul className="moments">
            {plans.map((p, i) => (
              <li key={i} className="moment no-icon">
                <span className="moment-text">
                  <span className="plan-stints">
                    {p.stints.map((s, j) => (
                      <span key={j} className={`plan-stint t-${s.compound}`} style={{ flex: s.laps }}>
                        {short(s.compound)} {s.laps}
                      </span>
                    ))}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {p.stops.length} stop{p.stops.length > 1 ? 's' : ''}: pit {p.windows.map(([a, b]) => (a === b ? `lap ${a}` : `laps ${a}–${b}`)).join(', then ')}
                    {p.anyOrder ? ' · either order' : ''}
                  </span>
                </span>
                <span className="rc-meta">{i === 0 ? 'quickest' : `+${p.delta.toFixed(1)} s`}</span>
              </li>
            ))}
          </ul>
          <p className="dim" style={{ fontSize: 11 }}>
            From this session's long runs: each tyre's pace on new tyres and how fast it wears (practice wear is scaled down to race levels). Pit windows keep a plan
            within a second of its best. Doesn't account for traffic, Safety Cars or a team saving tyres for Sunday, so it's a first guess, like the teams' own.
          </p>
        </div>
      )}
    </Panel>
  );
}
