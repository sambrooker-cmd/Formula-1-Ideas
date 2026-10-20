import type { SessionData } from '../data/session';
import { formatLapTime, overallBestAt, tower } from '../data/state';
import { clock } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Panel } from './Panel';

export function Tyre({ compound, age }: { compound: string | null; age?: number | null }) {
  const letter = compound ? compound[0] : '?';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className={`tyre tyre-${compound ?? 'UNKNOWN'}`} title={compound ?? 'Unknown'}>
        <span>{letter}</span>
      </span>
      {age != null && <span className="num muted" style={{ minWidth: 16, textAlign: 'left' }}>{age}</span>}
    </span>
  );
}

export function TimingTower({ data, area }: { data: SessionData; area?: string }) {
  const t = useNow(8);
  const { selected } = useSynced();
  const rows = tower(data, t);
  const best = overallBestAt(data, t);
  const race = data.meta.session.type === 'Race';

  return (
    <Panel title="Timing" area={area} popout="/tower" bodyClass="scroll" extra={<span>{data.meta.session.name}</span>}>
      <table className="tower">
        <thead>
          <tr>
            <th className="l" style={{ textAlign: 'center' }}>P</th>
            <th className="l">Driver</th>
            {race && <th>Gap</th>}
            {race && <th>Int</th>}
            <th>Last</th>
            {!race && <th>Best</th>}
            <th className="l">Tyre</th>
            <th>Pit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = data.drivers.get(r.driver)!;
            const battle = race && r.intervalSecs != null && r.intervalSecs > 0 && r.intervalSecs < 1 && !r.inPit;
            const lastIsBest = best && r.lastLap === best.duration && best.driver === r.driver;
            return (
              <tr
                key={r.driver}
                className={(selected.includes(r.driver) ? 'sel ' : '') + (r.out ? 'out' : '')}
                onClick={() => clock.toggleSelected(r.driver)}
                title={`${d.name} · ${d.team}`}
              >
                <td className="pos num">{r.position < 99 ? r.position : '–'}</td>
                <td className="l">
                  <span className="drv">
                    <span className="team-bar" style={{ background: d.colour }} />
                    {d.code}
                    {r.inPit && <span className="tag pit">PIT</span>}
                    {r.out && <span className="tag out">OUT</span>}
                  </span>
                </td>
                {race && <td className="num muted">{r.gap}</td>}
                {race && <td className={'num ' + (battle ? 'green' : '')}>{r.interval}</td>}
                <td className={'num ' + (lastIsBest ? 'purple' : r.personalBestLast ? 'green' : '')}>{formatLapTime(r.lastLap)}</td>
                {!race && <td className={'num ' + (best?.driver === r.driver ? 'purple' : '')}>{formatLapTime(r.bestLap)}</td>}
                <td className="l">
                  <Tyre compound={r.compound} age={r.tyreAge} />
                </td>
                <td className="num muted">{r.pits || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
