// Commentary: plain-English captions about the race as it plays (see data/commentary.ts),
// as a running feed, and the latest one as a caption line over the track map.
import { useMemo, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { commentary, type Caption } from '../data/commentary';
import { formatClock } from '../data/state';
import { clock } from '../sync/clock';
import { useNow } from '../hooks';
import { Panel } from './Panel';

export function Commentary({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(2);
  const [all, setAll] = useState(false);
  const list = commentary(data);
  const shown = useMemo(
    () => list.filter((c) => c.t <= t && (all || c.weight >= 2 || !/^(Fastest lap|.* pits )/.test(c.text))).reverse(),
    [list, all, Math.floor(t / 1000)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <Panel title="Commentary" lead={lead} area={area} popout="/commentary" bodyClass="scroll">
      <div className="moment-filters">
        <span className="dim" style={{ fontSize: 11 }}>Who's closing, who's in range, tyre offsets and the big moments</span>
        <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> every pit stop and fastest lap
        </label>
      </div>
      <ul className="moments">
        {shown.map((c) => (
          <li key={c.t + c.text} className={`moment no-icon w${c.weight}`} onClick={() => clock.seek(c.t - 8000)} title="Jump to this moment">
            <span className="moment-text">
              <CaptionDots data={data} c={c} />
              {c.text}
            </span>
            <span className="rc-meta">
              {c.lap != null ? `L${c.lap}` : ''} {formatClock(c.t - data.meta.raceStart)}
            </span>
          </li>
        ))}
        {shown.length === 0 && <li className="dim" style={{ padding: 12 }}>Commentary appears as the session plays.</li>}
      </ul>
    </Panel>
  );
}

function CaptionDots({ data, c }: { data: SessionData; c: Caption }) {
  if (!c.drivers.length) return null;
  return (
    <span className="moment-dots">
      {c.drivers.map((n) => (
        <i key={n} style={{ background: data.drivers.get(n)?.colour }} />
      ))}
    </span>
  );
}

/** The latest caption, for a line over the map (shown for 25 s of race time). */
export function CaptionLine({ data, t }: { data: SessionData; t: number }) {
  const list = commentary(data);
  let latest: Caption | null = null;
  for (const c of list) {
    if (c.t > t) break;
    if (t - c.t < 25_000) latest = c;
  }
  if (!latest) return null;
  return (
    <div className="caption-line" key={latest.t + latest.text}>
      <CaptionDots data={data} c={latest} />
      {latest.text}
    </div>
  );
}
