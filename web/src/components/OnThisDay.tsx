// On this day: Grands Prix held on today's date in past years, and drivers born on it.
import { useEffect, useState } from 'react';
import { allWinners, bornOn, nearDay, onDay, podium, type Winner } from '../data/onthisday';
import type { CareerDriver } from '../data/career';
import { jolpicaProgress } from '../data/history';
import { DocShell, ordinal, param } from './Explore';

function useDate() {
  const q = param('date'); // MM-DD
  const now = new Date();
  const [m, d] = q && /^\d{2}-\d{2}$/.test(q) ? q.split('-').map(Number) : [now.getMonth() + 1, now.getDate()];
  return { month: m, day: d };
}

const label = (m: number, d: number) => new Date(2000, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });

function shift(m: number, d: number, by: number) {
  const t = new Date(2000, m - 1, d + by);
  return `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

export function OnThisDayPage() {
  const { month, day } = useDate();
  const [winners, setWinners] = useState<Winner[] | null>(null);
  const [born, setBorn] = useState<CareerDriver[]>([]);
  const [error, setError] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    allWinners().then(setWinners, (e) => setError(String(e.message ?? e)));
    bornOn(month, day).then(setBorn, () => {});
  }, [month, day]);
  useEffect(() => {
    if (winners) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [winners]);

  const today = winners ? onDay(winners, month, day) : [];
  const near = winners && !today.length ? nearDay(winners, month, day).slice(0, 6) : [];
  const thisYear = new Date().getFullYear();

  return (
    <DocShell active="history">
      <div className="doc-head">
        <a className="icon-btn" href={`/on-this-day?date=${shift(month, day, -1)}`} style={{ textDecoration: 'none' }}>
          ←
        </a>
        <h1>On {label(month, day)}</h1>
        <a className="icon-btn" href={`/on-this-day?date=${shift(month, day, 1)}`} style={{ textDecoration: 'none' }}>
          →
        </a>
        <a className="icon-btn" href="/on-this-day" style={{ textDecoration: 'none' }}>
          Today
        </a>
      </div>
      {error && <div className="center-msg static">{error}</div>}
      {!winners && !error && (
        <div className="center-msg static">
          Loading every Grand Prix since 1950… <span className="dim">({jolpicaProgress.done} of about 12 requests, only the first time)</span>
        </div>
      )}
      {winners && today.length === 0 && (
        <p className="muted">
          No world championship race has been held on {label(month, day)}.{near.length > 0 && ' Close by:'}
        </p>
      )}
      <div className="otd-list">
        {(today.length ? today : near).map((w) => (
          <RaceCard key={`${w[1]}-${w[2]}`} w={w} years={thisYear - w[1]} showDate={!today.length} />
        ))}
      </div>
      {born.length > 0 && (
        <section className="doc-section">
          <h2>Born on {label(month, day)}</h2>
          <div className="otd-born">
            {born.map((d) => (
              <a key={d.id} href={`/head-to-head?a=${d.id}`} className="otd-chip">
                <b>{d.name}</b> <span className="dim">{d.dob.slice(0, 4)} · {d.nationality}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <p className="dim" style={{ fontSize: 11, marginTop: 24 }}>
        From Jolpica (the Ergast database). Click a driver to see their career.
      </p>
    </DocShell>
  );
}

function RaceCard({ w, years, showDate }: { w: Winner; years: number; showDate: boolean }) {
  const [pod, setPod] = useState<{ name: string; team: string }[] | null>(null);
  useEffect(() => {
    podium(w[1], w[2]).then(setPod, () => setPod(null));
  }, [w]);
  return (
    <div className="otd-card">
      <div className="otd-year num">{w[1]}</div>
      <div style={{ minWidth: 0 }}>
        <div className="otd-race">
          {w[3]} <span className="dim">· {w[4]}, {w[5]}</span>
        </div>
        <div>
          🏆 <a href={`/head-to-head?a=${w[6]}`}>{w[7]}</a> <span className="muted">({w[8]})</span>
          {w[9] > 1 && <span className="dim"> from {ordinal(w[9])} on the grid</span>}
          {w[9] === 1 && <span className="dim"> from pole</span>}
        </div>
        {pod && pod.length > 1 && (
          <div className="dim" style={{ fontSize: 12 }}>
            then {pod.slice(1).map((p) => p.name).join(', ')}
          </div>
        )}
      </div>
      <div className="dim otd-ago">
        {showDate ? new Date(w[0]).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' : ''}
        {years === 0 ? 'this year' : `${years} year${years === 1 ? '' : 's'} ago`}
      </div>
    </div>
  );
}
