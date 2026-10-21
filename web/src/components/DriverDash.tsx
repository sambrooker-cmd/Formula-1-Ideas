// One driver, big and clear: made to sit next to the TV's onboard camera.
import type { SessionData } from '../data/session';
import { carSampleIndex, formatLapTime, lastCompletedLap, overallBestAt, tower } from '../data/state';
import { isQualifying, qualiAt } from '../data/quali';
import { predictPit } from '../data/pitstop';
import { keyMoments, type Moment } from '../data/moments';
import { clock } from '../sync/clock';
import { useNow, useSynced } from '../hooks';
import { Tyre } from './TimingTower';
import { MiniSectors } from './QualiTower';
import { PitSummary } from './TrackMap';
import { MOMENT_ICON } from './KeyMoments';

export function DriverDash({ data }: { data: SessionData }) {
  const t = useNow(8);
  const { selected } = useSynced();
  const rows = tower(data, t);
  const n = selected[0] ?? rows[0]?.driver;
  const d = n != null ? data.drivers.get(n) : undefined;
  if (n == null || !d) return <div className="center-msg">No drivers in this session yet.</div>;

  const idx = rows.findIndex((r) => r.driver === n);
  const row = rows[idx];
  const ahead = idx > 0 ? rows[idx - 1] : null;
  const behind = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  const race = data.meta.session.type === 'Race';
  const quali = isQualifying(data) ? qualiAt(data, t) : null;
  const qPos = quali ? quali.rows.findIndex((r) => r.driver === n) + 1 : null;
  const qRow = quali?.rows.find((r) => r.driver === n);
  const position = qPos ?? row?.position;

  const last = lastCompletedLap(data, n, t);
  const best = overallBestAt(data, t);
  const s = data.samples.get(n);
  const i = s ? carSampleIndex(s, t) : -1;
  const pit = race ? predictPit(data, n, t) : null;
  const recent: Moment[] = keyMoments(data).filter((m) => m.t <= t && m.drivers.includes(n)).slice(-4).reverse();
  const code = (x: number) => data.drivers.get(x)?.code ?? '';

  return (
    <div className="dash">
      <header className="dash-head" style={{ borderColor: d.colour }}>
        <div className="dash-pos num">{position && position < 99 ? `P${position}` : '–'}</div>
        <div style={{ minWidth: 0 }}>
          <div className="dash-name">{d.name}</div>
          <div className="muted">{d.team}{row?.out ? ' · out of the race' : ''}</div>
        </div>
        <select className="lap-jump" value={n} onChange={(e) => clock.setSelected([Number(e.target.value)])} aria-label="Driver">
          {data.driverOrder.map((x) => (
            <option key={x} value={x}>{code(x)}</option>
          ))}
        </select>
      </header>

      <div className="dash-grid">
        {race && (
          <>
            <Stat label={ahead ? `Gap to ${code(ahead.driver)} ahead` : 'Leading'} value={ahead ? row?.interval || '–' : '🏁'} accent={row?.intervalSecs != null && row.intervalSecs < 1 ? 'var(--green)' : undefined} />
            <Stat label={behind ? `${code(behind.driver)} behind` : 'Nobody behind'} value={behind?.interval || '–'} accent={behind?.intervalSecs != null && behind.intervalSecs < 1 ? 'var(--red)' : undefined} />
            <Stat label="Gap to leader" value={row?.gap || '–'} />
          </>
        )}
        {quali && (
          <>
            <Stat label="Best lap" value={formatLapTime(qRow?.best?.duration) || '–'} accent={qRow?.best?.duration === quali.fastest ? 'var(--purple)' : undefined} />
            <Stat label="Gap to P1" value={qRow?.best && quali.fastest ? (qRow.best.duration! - quali.fastest === 0 ? 'P1' : '+' + (qRow.best.duration! - quali.fastest).toFixed(3)) : '–'} />
            <Stat label="Status" value={qRow?.outIn ? `Out in Q${qRow.outIn}` : qRow?.onLap ? 'On a lap' : qRow?.inPit ? 'In the pits' : 'Running'} />
          </>
        )}
        <Stat
          label="Last lap"
          value={formatLapTime(last?.duration) || '–'}
          accent={last && best && last.duration === best.duration && best.driver === n ? 'var(--purple)' : row?.personalBestLast ? 'var(--green)' : undefined}
          sub={last ? `${[last.s1, last.s2, last.s3].map((x) => x?.toFixed(3) ?? '–').join(' · ')}` : undefined}
          extra={<MiniSectors segments={last?.segments ?? null} />}
        />
        <Stat label="Best lap" value={formatLapTime(row?.bestLap) || '–'} />
        <Stat
          label="Tyres"
          value={<Tyre compound={row?.compound ?? null} age={row?.tyreAge} />}
          sub={`${row?.pits ?? 0} pit stop${row?.pits === 1 ? '' : 's'}${row?.inPit ? ' · in the pit lane now' : ''}`}
        />
      </div>

      {s && i >= 0 && (
        <div className="dash-live">
          <div>
            <div className="dash-speed num">{s.speed[i]}</div>
            <div className="muted">km/h</div>
          </div>
          <div>
            <div className="dash-gear num">{s.gear[i] || 'N'}</div>
            <div className="muted">gear</div>
          </div>
          <div className="dash-bars">
            <Bar label="Throttle" value={Math.min(100, s.throttle[i])} colour="var(--green)" />
            <Bar label="Brake" value={s.brake[i] > 0 ? 100 : 0} colour="var(--red)" />
            <div className="muted num" style={{ fontSize: 13 }}>
              {s.rpm[i].toLocaleString()} rpm
              {s.drs[i] !== 255 && <b style={{ marginLeft: 10, color: s.drs[i] >= 10 ? 'var(--green)' : 'var(--dim)' }}>DRS</b>}
            </div>
          </div>
        </div>
      )}

      <div className="dash-bottom">
        {pit && (
          <div className="dash-card">
            <div className="dash-label">Pit stop predictor</div>
            <PitSummary data={data} p={pit} />
          </div>
        )}
        <div className="dash-card">
          <div className="dash-label">Latest for {d.code}</div>
          {recent.length === 0 && <div className="dim">Nothing yet.</div>}
          {recent.map((m) => (
            <div key={m.t + m.text} className="dash-moment">
              <span>{MOMENT_ICON[m.kind]}</span> {m.text}
              <span className="dim num"> {m.lap != null ? `L${m.lap}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: React.ReactNode; sub?: string; accent?: string; extra?: React.ReactNode }) {
  return (
    <div className="dash-card">
      <div className="dash-label">{props.label}</div>
      <div className="dash-value num" style={{ color: props.accent }}>{props.value}</div>
      {props.extra}
      {props.sub && <div className="muted num" style={{ fontSize: 12 }}>{props.sub}</div>}
    </div>
  );
}

function Bar({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="bar" style={{ height: 10 }}>
        <i style={{ width: value + '%', background: colour }} />
      </div>
    </div>
  );
}
