// Shared pieces for the season, driver and circuit pages.
import { useEffect, useState, type ReactNode } from 'react';
import { jolpicaProgress, seasonHistory, type SeasonHistory } from '../data/history';

/** Team colours by Jolpica constructor id (approximate; Jolpica has none). */
const TEAM_COLOUR: Record<string, string> = {
  mclaren: '#F47600',
  ferrari: '#ED1131',
  red_bull: '#4781D7',
  mercedes: '#00D7B6',
  aston_martin: '#229971',
  alpine: '#00A1E8',
  williams: '#1868DB',
  rb: '#6C98FF',
  alphatauri: '#6C98FF',
  sauber: '#01C00E',
  alfa: '#9B0000',
  audi: '#BB0A30',
  haas: '#9C9FA2',
  cadillac: '#AAAAAD',
};
export const teamColour = (id: string) => TEAM_COLOUR[id] ?? '#8a96a8';

export const FIRST_YEAR = 2023; // OpenF1 replays start here; Jolpica goes back further but the app sticks to these
export const thisYear = () => new Date().getFullYear();

export const links = {
  season: (year: number) => `/season-stats?year=${year}`,
  driver: (year: number, id: string) => `/driver-season?year=${year}&driver=${encodeURIComponent(id)}`,
  circuit: (year: number, round: number) => `/circuit?year=${year}&round=${round}`,
};

export function param(name: string) {
  return new URLSearchParams(location.search).get(name);
}

export function useHistory(year: number) {
  const [h, setH] = useState<SeasonHistory | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setH(null);
    setError('');
    seasonHistory(year).then(setH, (e) => setError(String(e.message ?? e)));
  }, [year]);
  return { h, error };
}

export function DocShell({ children, active }: { children: ReactNode; active?: 'season' | 'driver' | 'circuit' | 'h2h' | 'predictions' | 'history' }) {
  const year = Number(param('year')) || thisYear();
  return (
    <div className="page">
      <div className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" /> PIT WALL
        </a>
        <nav className="doc-nav">
          <a className={active === 'season' ? 'on' : ''} href={links.season(year)}>
            Season stats
          </a>
          <a className={active === 'driver' ? 'on' : ''} href={`/driver-season?year=${year}`}>
            Drivers
          </a>
          <a className={active === 'circuit' ? 'on' : ''} href={`/circuit?year=${year}`}>
            Circuits
          </a>
          <a className={active === 'h2h' ? 'on' : ''} href="/head-to-head">
            Head to head
          </a>
          <a className={active === 'predictions' ? 'on' : ''} href="/predictions">
            Predictions
          </a>
          <a className={active === 'history' ? 'on' : ''} href="/on-this-day">
            On this day
          </a>
        </nav>
        <span style={{ flex: 1 }} />
        <a className="icon-btn" href="/" style={{ textDecoration: 'none' }}>
          Sessions & layouts
        </a>
      </div>
      <div className="report-scroll">
        <div className="doc">{children}</div>
      </div>
    </div>
  );
}

export function YearSelect({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  return (
    <select className="lap-jump" value={year} onChange={(e) => onChange(Number(e.target.value))} aria-label="Season">
      {Array.from({ length: thisYear() - FIRST_YEAR + 1 }, (_, i) => thisYear() - i).map((y) => (
        <option key={y}>{y}</option>
      ))}
    </select>
  );
}

/** Change a query parameter and reload the page (each page reads its params once). */
export function go(params: Record<string, string | number>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) q.set(k, String(v));
  location.search = q.toString();
}

export function Loading({ h, error, what }: { h: unknown; error: string; what: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (h || error) return;
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [h, error]);
  if (error) return <div className="center-msg static">{error}</div>;
  if (!h)
    return (
      <div className="center-msg static">
        Loading {what}…{' '}
        <span className="dim">
          ({jolpicaProgress.done} of about 13 requests. The first time can take a minute: it's a whole season of results, then it's saved in this browser.)
        </span>
      </div>
    );
  return null;
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function H2HBar({ label, a, b, colourA, colourB }: { label: string; a: number; b: number; colourA: string; colourB: string }) {
  const total = a + b || 1;
  return (
    <div className="h2h">
      <span className="num h2h-a">{a}</span>
      <div className="h2h-bar">
        <i style={{ width: `${(a / total) * 100}%`, background: colourA }} />
        <i style={{ width: `${(b / total) * 100}%`, background: colourB, opacity: 0.55 }} />
        <span className="h2h-label">{label}</span>
      </div>
      <span className="num h2h-b">{b}</span>
    </div>
  );
}

export const ordinal = (n: number) => {
  if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
};
