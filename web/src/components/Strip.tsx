// Timing strip: just positions and gaps, big and simple. For a small always-on-top window
// (picture-in-picture), a TV browser, or AirPlay. `?layout=row` gives a one-line ticker.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionData } from '../data/session';
import { formatLapTime, leaderLap, tower, trackStatusAt } from '../data/state';
import { isQualifying, qualiAt } from '../data/quali';
import { now } from '../sync/clock';
import { STATUS_LABEL } from './PlaybackBar';

/** A timer instead of animation frames: keeps ticking in a picture-in-picture window. */
function useTick(ms = 500) {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    const id = setInterval(() => setT(now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}

export function Strip({ data, row = false }: { data: SessionData; row?: boolean }) {
  const t = useTick();
  const status = trackStatusAt(data, t).status;
  const lap = leaderLap(data, t);
  const quali = isQualifying(data) ? qualiAt(data, t) : null;
  const items = quali
    ? quali.rows.map((r, i) => ({
        n: r.driver,
        pos: i + 1,
        main: r.best?.duration != null ? (i === 0 ? formatLapTime(r.best.duration) : `+${(r.best.duration - (quali.fastest ?? r.best.duration)).toFixed(3)}`) : '',
        out: r.outIn != null,
        compound: null as string | null,
      }))
    : tower(data, t)
        .filter((r) => r.position < 99)
        .map((r) => ({
          n: r.driver,
          pos: r.position,
          main: r.out ? 'OUT' : r.inPit ? 'PIT' : r.position === 1 ? (data.meta.session.type === 'Race' ? `L${r.lap}` : formatLapTime(r.bestLap)) : r.interval || r.gap,
          out: r.out,
          compound: r.compound,
        }));

  return (
    <div className={'strip' + (row ? ' row' : '')}>
      <div className={`strip-head st-${status}`}>
        <span>{STATUS_LABEL[status]}</span>
        <span className="num">
          {quali ? (quali.phase ? `Q${quali.phase.n}` : '') : data.meta.totalLaps ? `LAP ${Math.min(lap, data.meta.totalLaps)}/${data.meta.totalLaps}` : ''}
        </span>
      </div>
      <div className="strip-list">
        {items.map((it) => {
          const d = data.drivers.get(it.n);
          return (
            <div key={it.n} className={'strip-item' + (it.out ? ' out' : '')}>
              <span className="strip-pos num">{it.pos}</span>
              <i style={{ background: d?.colour }} />
              <b>{d?.code}</b>
              {it.compound && <span className={`strip-tyre tyre-${it.compound}`}>{it.compound[0]}</span>}
              <span className="strip-gap num">{it.main}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Float the strip above other apps (Chrome/Edge picture-in-picture), or open a small window. */
export async function openMiniWindow(data: SessionData) {
  const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } }).documentPictureInPicture;
  if (!dpip) {
    window.open('/strip', 'pitwall-strip', 'popup,width=300,height=640');
    return;
  }
  const pip = await dpip.requestWindow({ width: 300, height: 640 });
  // Bring the page's styles along.
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
      pip.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = pip.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pip.document.head.appendChild(link);
      }
    }
  }
  pip.document.body.className = 'pip-body';
  const host = pip.document.createElement('div');
  host.style.height = '100%';
  pip.document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Strip data={data} />);
  pip.addEventListener('pagehide', () => root.unmount());
}
