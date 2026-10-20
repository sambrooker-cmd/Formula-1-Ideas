import { useEffect, useState } from 'react';
import { clock } from '../sync/clock';
import { useSynced } from '../hooks';
import { captureLayout, openLayout, PANEL_ROUTES, PRESETS, savedLayouts, saveLayouts, type Layout } from '../layouts';
import { Footer } from './Footer';

interface Cached {
  session_key: number;
  year: number;
  meeting_name: string;
  country_name: string;
  session_name: string;
  circuit_short_name: string;
  date_start: number;
  complete: boolean;
  size_mb: number;
}

interface Job {
  sessionKey: number;
  state: 'running' | 'done' | 'error';
  progress: { done: number; total: number; step: string } | null;
  error?: string;
}

const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText);
  return r.json();
};

export function Home() {
  const { sessionKey } = useSynced();
  const [cached, setCached] = useState<Cached[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const refresh = () => getJson<Cached[]>('/api/sessions').then(setCached).catch(() => setCached([]));

  useEffect(() => {
    refresh();
  }, []);

  // Poll ingest jobs while any are running.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const list = await getJson<Job[]>('/api/ingest').catch(() => []);
      if (stop) return;
      setJobs(list);
      if (list.some((j) => j.state === 'running')) setTimeout(poll, 1000);
      else refresh();
    };
    poll();
    return () => {
      stop = true;
    };
  }, [jobs.length]);

  const open = (key: number, path = '/wall') => {
    clock.setSession(key);
    location.href = path;
  };

  return (
    <div className="home">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="brand-mark" style={{ width: 14, height: 30 }} />
        <div>
          <h1>Pit Wall</h1>
          <div className="muted">Race replays from real timing and telemetry, across as many windows and screens as you like.</div>
        </div>
      </div>

      <section className="card">
        <h2>Cached sessions</h2>
        <div className="session-list">
          {cached.length === 0 && <div className="dim">Nothing cached yet. Download a session below, or run <code>npm run ingest</code>.</div>}
          {cached.map((s) => (
            <div className="session-row" key={s.session_key}>
              <div className="grow">
                <b>
                  {s.year} {s.meeting_name}
                </b>{' '}
                · {s.session_name}
                <div className="dim" style={{ fontSize: 12 }}>
                  {s.circuit_short_name} · {new Date(s.date_start).toLocaleDateString()} · {s.size_mb} MB
                  {!s.complete && ' · incomplete (re-download to resume)'}
                  {sessionKey === s.session_key && ' · currently loaded'}
                </div>
              </div>
              <button className="btn primary" disabled={!s.complete} onClick={() => open(s.session_key)}>
                Open pit wall
              </button>
            </div>
          ))}
        </div>
      </section>

      <IngestCard jobs={jobs} onStarted={(j) => setJobs((prev) => [...prev, j])} />

      <LayoutsCard hasSession={sessionKey != null} />

      <Footer />
    </div>
  );
}

function IngestCard({ jobs, onStarted }: { jobs: Job[]; onStarted: (j: Job) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear - 1);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [meeting, setMeeting] = useState<number | ''>('');
  const [sessions, setSessions] = useState<any[]>([]);
  const [session, setSession] = useState<number | ''>('');
  const [error, setError] = useState('');

  useEffect(() => {
    setMeetings([]);
    setMeeting('');
    setError('');
    getJson<any[]>(`/api/catalogue/meetings?year=${year}`)
      .then((m) => setMeetings(m.filter((x) => !/testing/i.test(x.meeting_name))))
      .catch((e) => setError(String(e.message ?? e)));
  }, [year]);

  useEffect(() => {
    setSessions([]);
    setSession('');
    if (meeting === '') return;
    getJson<any[]>(`/api/catalogue/sessions?meeting_key=${meeting}`)
      .then((s) => {
        const past = s.filter((x) => Date.parse(x.date_end) < Date.now() - 3600e3);
        setSessions(past);
        const race = past.find((x) => x.session_name === 'Race');
        if (race) setSession(race.session_key);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [meeting]);

  const start = async () => {
    if (session === '') return;
    const r = await fetch('/api/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: session }),
    });
    onStarted(await r.json());
  };

  const active = jobs.slice(-3);

  return (
    <section className="card">
      <h2>Download a session</h2>
      <div className="form-row">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {Array.from({ length: thisYear - 2022 }, (_, i) => 2023 + i).map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        <select value={meeting} onChange={(e) => setMeeting(e.target.value ? Number(e.target.value) : '')} style={{ minWidth: 220 }}>
          <option value="">{meetings.length ? 'Choose a Grand Prix…' : 'Loading…'}</option>
          {meetings.map((m) => (
            <option key={m.meeting_key} value={m.meeting_key}>
              {m.meeting_name}
            </option>
          ))}
        </select>
        <select value={session} onChange={(e) => setSession(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Session…</option>
          {sessions.map((s) => (
            <option key={s.session_key} value={s.session_key}>
              {s.session_name}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={session === ''} onClick={start}>
          Download
        </button>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
        About 55 requests and 2–4 minutes per session, kept under OpenF1's free limit of 30 requests a minute. Each session only ever downloads once.
      </div>
      {error && <div style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
      {active.map((j) => (
        <div key={j.sessionKey + j.state} style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span>
              Session {j.sessionKey}: {j.state === 'running' ? j.progress?.step ?? 'starting' : j.state === 'done' ? 'done ✓' : 'failed'}
            </span>
            <span className="num muted">{j.progress ? `${j.progress.done}/${j.progress.total}` : ''}</span>
          </div>
          <div className="progress">
            <i style={{ width: `${j.state === 'done' ? 100 : j.progress ? (100 * j.progress.done) / j.progress.total : 2}%` }} />
          </div>
          {j.error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{j.error}</div>}
        </div>
      ))}
    </section>
  );
}

function LayoutsCard({ hasSession }: { hasSession: boolean }) {
  const [saved, setSaved] = useState<Layout[]>(savedLayouts);
  const [note, setNote] = useState('');
  const launch = (l: Layout) => {
    const n = openLayout(l);
    setNote(
      n < l.windows.length
        ? `Your browser blocked ${l.windows.length - n} window(s). Allow pop-ups for this site, then try again.`
        : `Opened ${n} windows. Drag them to any screen, then "Save arrangement" to reuse it.`,
    );
  };
  const save = () => {
    const name = prompt('Name this layout', 'My pit wall');
    if (!name) return;
    const l = captureLayout(name);
    if (!l) {
      setNote('Open some panel windows from this page first, arrange them, then save.');
      return;
    }
    const next = [...saved, l];
    setSaved(next);
    saveLayouts(next);
    setNote(`Saved "${name}" with ${l.windows.length} windows.`);
  };
  const remove = (id: string) => {
    const next = saved.filter((l) => l.id !== id);
    setSaved(next);
    saveLayouts(next);
  };

  return (
    <section className="card">
      <h2>Multi-window layouts</h2>
      {!hasSession && <div className="dim" style={{ marginBottom: 10 }}>Open a session first; every window follows the same session and clock.</div>}
      <div className="layouts">
        {PRESETS.map((l) => (
          <button key={l.id} className="layout-card" onClick={() => launch(l)} disabled={!hasSession}>
            <MiniLayout layout={l} />
            {l.name}
          </button>
        ))}
        {saved.map((l) => (
          <div key={l.id} className="layout-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b>{l.name}</b>
              <button className="icon-btn" onClick={() => remove(l.id)} title="Delete layout">✕</button>
            </div>
            <div className="dim" style={{ fontSize: 12, margin: '4px 0 8px' }}>{l.windows.map((w) => w.path.slice(1)).join(', ')}</div>
            <button className="btn" onClick={() => launch(l)} disabled={!hasSession}>Open</button>
          </div>
        ))}
      </div>
      <div className="form-row" style={{ marginTop: 12 }}>
        <span className="muted">Single windows:</span>
        {PANEL_ROUTES.map((p) => (
          <a key={p.path} className="btn" href={p.path} target="_blank" rel="noreferrer">
            {p.title}
          </a>
        ))}
        <span className="spacer" style={{ flex: 1 }} />
        <button className="btn" onClick={save}>Save arrangement</button>
      </div>
      {note && <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>{note}</div>}
      <div className="dim" style={{ marginTop: 10, fontSize: 12 }}>
        Other devices on your Wi-Fi (TV, tablet, laptop) can join too: open <code>http://&lt;this computer's IP&gt;:5173/map</code> and they follow the same clock.
      </div>
    </section>
  );
}

function MiniLayout({ layout }: { layout: Layout }) {
  return (
    <div className="mini" style={{ position: 'relative', display: 'block' }}>
      {layout.windows.map((w, i) => (
        <i
          key={i}
          style={{
            position: 'absolute',
            left: `calc(${w.left * 100}% + 1px)`,
            top: `calc(${w.top * 100}% + 1px)`,
            width: `calc(${w.width * 100}% - 2px)`,
            height: `calc(${w.height * 100}% - 2px)`,
            display: 'grid',
            placeItems: 'center',
            fontSize: 9,
            fontStyle: 'normal',
            color: 'var(--muted)',
          }}
        >
          {w.path.slice(1)}
        </i>
      ))}
    </div>
  );
}
