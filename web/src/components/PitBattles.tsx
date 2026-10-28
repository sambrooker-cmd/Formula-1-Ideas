// Undercut checker panel: every pit-stop battle between close cars, and who came out on top.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { describeBattle, pitBattles, type BattleOutcome } from '../data/undercut';
import { pitLoss } from '../data/pitstop';
import { useNow, useSynced } from '../hooks';
import { clock } from '../sync/clock';
import { Panel } from './Panel';

const BADGE: Record<BattleOutcome, string> = {
  undercut: 'UNDERCUT',
  overcut: 'OVERCUT',
  held: 'HELD',
  failed: 'NO GAIN',
};

export function PitBattles({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(2);
  const { selected } = useSynced();
  const [spoilers, setSpoilers] = useState(false);
  const [mine, setMine] = useState(false);
  const all = pitBattles(data);
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const shown = useMemo(
    () =>
      all
        .filter((b) => spoilers || b.settled <= t)
        .filter((b) => !mine || selected.includes(b.first) || selected.includes(b.second))
        .slice()
        .reverse(),
    [all, spoilers, mine, selected, Math.floor(t / 2000)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const count = (o: BattleOutcome) => shown.filter((b) => b.outcome === o).length;

  if (data.meta.session.type !== 'Race')
    return (
      <Panel title="Pit battles" lead={lead} area={area} popout="/pit-battles">
        <div className="center-msg">Pit battles are for races.</div>
      </Panel>
    );

  return (
    <Panel title="Pit battles" lead={lead} area={area} popout="/pit-battles" bodyClass="scroll">
      <div className="moment-filters">
        <span className="muted" style={{ fontSize: 12 }}>
          A stop costs ~<b className="num">{pitLoss(data).toFixed(1)} s</b> here · {count('undercut')} undercuts · {count('overcut')} overcuts
        </span>
        <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={!selected.length} /> selected drivers
        </label>
        <label className="muted" style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} /> show what's ahead
        </label>
      </div>
      <ul className="moments">
        {shown.map((b) => (
          <li
            key={`${b.first}-${b.second}-${b.t}`}
            className={'moment battle' + (b.settled > t ? ' ahead' : '')}
            onClick={() => clock.seek(b.t - 8000)}
            title="Jump to the first stop"
          >
            <span className={'battle-badge o-' + b.outcome}>{BADGE[b.outcome]}</span>
            <span className="moment-text">
              <span className="moment-dots">
                {[b.first, b.second].map((n) => (
                  <i key={n} style={{ background: data.drivers.get(n)?.colour }} />
                ))}
              </span>
              {describeBattle(b, code)}
              {b.neutralised && <span className="battle-tag">SC/VSC</span>}
            </span>
            <span className="rc-meta">
              {b.swing != null && (
                <span className={'num ' + (b.swing >= 0 ? 'good' : 'bad')} title={`${code(b.first)} gained this much on ${code(b.second)} over the stops`}>
                  {b.swing >= 0 ? '+' : '−'}
                  {Math.abs(b.swing).toFixed(1)}s{' '}
                </span>
              )}
              L{b.firstLap}→{b.secondLap} · P{b.forPosition}
            </span>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="dim" style={{ padding: 12 }}>
            No pit battles yet. When two close cars stop a few laps apart, this shows whether stopping first (the undercut) or staying out (the
            overcut) won the place.
          </li>
        )}
      </ul>
    </Panel>
  );
}
