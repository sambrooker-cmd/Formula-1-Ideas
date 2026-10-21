import type { ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { qualiAt } from '../data/quali';
import { formatClock, formatLapTime, stintForLap } from '../data/state';
import { clock } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Panel } from './Panel';
import { Tyre } from './TimingTower';

const SEGMENT_CLASS: Record<number, string> = { 2048: 'y', 2049: 'g', 2051: 'p', 2064: 'pit' };

/** The lap's mini-sectors as coloured ticks: purple = fastest overall, green = personal best, yellow = slower. */
export function MiniSectors({ segments }: { segments: (number | null)[][] | null }) {
  if (!segments) return null;
  return (
    <span className="minis">
      {segments.map((sector, i) => (
        <span key={i} className="minis-sector">
          {sector.map((code, j) => (
            <i key={j} className={SEGMENT_CLASS[code ?? 0] ?? 'none'} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Qualifying timing: running order for the current Q session, the drop zone, and who's already out. */
export function QualiTower({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(6);
  const { selected } = useSynced();
  const q = qualiAt(data, t);
  const remaining = q.phase && q.phase.end !== Infinity ? q.phase.end - t : null;
  const label = data.meta.session.name.toLowerCase().includes('sprint') ? 'SQ' : 'Q';
  const cutTime = q.cutoff != null ? q.rows[q.cutoff - 1]?.best?.duration ?? null : null;

  return (
    <Panel
      title="Qualifying"
      lead={lead}
      area={area}
      popout="/tower"
      bodyClass="scroll"
      extra={
        <span style={{ display: 'flex', gap: 8, alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
          {[1, 2, 3].map((n) => (
            <span key={n} className={'q-pill' + (q.shown === n ? ' on' : q.shown > n ? ' done' : '')}>
              {label}
              {n}
            </span>
          ))}
          {remaining != null && remaining > 0 && <span className="num muted">{formatClock(remaining)} left</span>}
        </span>
      }
    >
      <table className="tower">
        <thead>
          <tr>
            <th className="l" style={{ textAlign: 'center' }}>P</th>
            <th className="l">Driver</th>
            <th>Best</th>
            <th>Gap</th>
            <th className="l" title="Mini-sectors of the latest flying lap: purple fastest overall, green personal best, yellow slower">Mini-sectors</th>
            <th className="l">Tyre</th>
            <th>Laps</th>
          </tr>
        </thead>
        <tbody>
          {q.rows.map((r, i) => {
            const d = data.drivers.get(r.driver)!;
            const pos = i + 1;
            const out = r.outIn != null;
            const danger = !out && q.cutoff != null && pos > q.cutoff;
            const leader = q.rows[0]?.best?.duration;
            const gap = r.best && leader && !out ? r.best.duration! - leader : null;
            const lapNo = r.last?.lap ?? 1;
            const stint = stintForLap(data, r.driver, lapNo);
            const tyreAge = stint ? (stint.ageAtStart ?? 0) + (lapNo - stint.lapStart) : null;
            // The last flying lap (not the slow lap back to the pits); knocked-out drivers show their best.
            const shownLap = out
              ? r.best
              : r.last && r.best && r.last.duration! <= r.best.duration! * 1.03
                ? r.last
                : r.best ?? r.last;
            const firstOut = out && (i === 0 || q.rows[i - 1].outIn == null || q.rows[i - 1].outIn !== r.outIn);
            return (
              <tr
                key={r.driver}
                className={(selected.includes(r.driver) ? 'sel ' : '') + (out ? 'out ' : '') + (danger ? 'danger ' : '') + (pos === q.cutoff ? 'cut ' : '') + (firstOut ? 'first-out' : '')}
                onClick={() => clock.toggleSelected(r.driver)}
                title={out ? `${d.name}: knocked out in ${label}${r.outIn}` : d.name}
              >
                <td className="pos num">{pos}</td>
                <td className="l">
                  <span className="drv">
                    <span className="team-bar" style={{ background: d.colour }} />
                    {d.code}
                    {r.onLap && !out && <span className="tag battle" title="On a timed lap">⏱</span>}
                    {r.inPit && !out && <span className="tag pit">PIT</span>}
                    {out && <span className="tag out">{label}{r.outIn}</span>}
                  </span>
                </td>
                <td className={'num ' + (r.best && r.best.duration === q.fastest && !out ? 'purple' : '')}>{formatLapTime(r.best?.duration)}</td>
                <td className="num muted">{gap != null ? (gap === 0 ? '' : '+' + gap.toFixed(3)) : ''}</td>
                <td className="l">
                  <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                    <MiniSectors segments={shownLap?.segments ?? null} />
                    <span className="num muted" style={{ fontSize: 12 }}>{shownLap?.duration ? formatLapTime(shownLap.duration) : ''}</span>
                  </span>
                </td>
                <td className="l">{stint && <Tyre compound={stint.compound} age={tyreAge} />}</td>
                <td className="num muted">{r.lapsInPhase || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {cutTime != null && (
        <div className="dim" style={{ fontSize: 11, padding: '6px 10px' }}>
          Drop zone: below P{q.cutoff}. Cut-off time {formatLapTime(cutTime)}.
        </div>
      )}
    </Panel>
  );
}
