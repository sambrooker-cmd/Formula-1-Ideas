// "All views": one menu listing everything Pit Wall can show, grouped, searchable, with a line
// on what each view is for. Available from every page's top bar and the home page.
import { useEffect, useState } from 'react';
import { CATALOG, type View } from '../catalog';
import { getState } from '../sync/clock';

export function AllViewsButton({ label = '☰ All views' }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="icon-btn" onClick={() => setOpen(true)} title="Every view in Pit Wall, in one list">
        {label}
      </button>
      {open && <AllViews onClose={() => setOpen(false)} />}
    </>
  );
}

function AllViews({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const hasSession = getState().sessionKey != null || getState().source === 'live';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const query = q.trim().toLowerCase();
  const match = (v: View) => !query || v.title.toLowerCase().includes(query) || v.about.toLowerCase().includes(query);
  const needsNote = (v: View) =>
    v.needs === 'none' ? null : !hasSession ? 'open a session first' : v.needs === 'race' ? 'races' : v.needs === 'practice' ? 'practice sessions' : null;

  return (
    <div className="views-overlay" onClick={onClose}>
      <div className="views-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="All views">
        <div className="views-head">
          <h2 style={{ margin: 0 }}>All views</h2>
          <input className="search" autoFocus placeholder="Search (e.g. tyres, radio, 3D)" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {!hasSession && (
          <p className="muted" style={{ margin: '0 0 10px' }}>
            Replay views need a session: pick one on the home page first (Replay, or Open pit wall).
          </p>
        )}
        <div className="views-groups">
          {CATALOG.map((g) => {
            const views = g.views.filter(match);
            if (!views.length) return null;
            return (
              <section key={g.title}>
                <h3>{g.title}</h3>
                <div className="views-grid">
                  {views.map((v) => {
                    const note = needsNote(v);
                    const disabled = v.needs !== 'none' && !hasSession;
                    return (
                      <a key={v.path} className={'view-card' + (disabled ? ' disabled' : '')} href={disabled ? undefined : v.path}>
                        <b>{v.title}</b>
                        <span className="muted">{v.about}</span>
                        {note && <span className="dim" style={{ fontSize: 10 }}>{disabled ? note : `for ${note}`}</span>}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
