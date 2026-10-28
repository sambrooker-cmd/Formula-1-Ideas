import { useEffect, useState } from 'react';
import { clock } from '../sync/clock';
import { useSynced } from '../hooks';
import { captureLayout, openLayout, PANEL_ROUTES, PRESETS, savedLayouts, saveLayouts, type Layout } from '../layouts';
import { Footer } from './Footer';
import { HOSTED } from '../env';
import { listSessions, season as loadSeason } from '../api';
import { AccountLine } from './SignInGate';

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
  lite?: boolean;
  keep?: boolean;
}

interface Job {
  sessionKey: number;
  state: 'queued' | 'running' | 'done' | 'error';
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
  const refresh = () => listSessions().then(setCached).catch(() => setCached([]));

  useEffect(() => {
    refresh();
  }, []);

  // Poll ingest jobs while any are running.
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (HOSTED) return; // no download jobs: races are published by the site itself
      const list = await getJson<Job[]>('/api/ingest').catch(() => []);
      if (stop) return;
      setJobs(list);
      if (list.some((j) => j.state === 'running' || j.state === 'queued')) setTimeout(poll, 1000);
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

      <SeasonCard
        jobs={jobs}
        onOpen={(key) => open(key)}
        onDownload={async (sessionKey) => {
          const r = await fetch('/api/ingest', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionKey }),
          });
          const job = await r.json();
          setJobs((prev) => [...prev, job]);
        }}
      />

      <ExploreCard />

      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Cached sessions</h2>
          <span style={{ flex: 1 }} />
          {!HOSTED && <StorageLine cached={cached} onChange={refresh} />}
        </div>
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
              {!HOSTED && (
                <>
                  <button
                    className={'icon-btn' + (s.keep ? ' active' : '')}
                    title={s.keep ? 'Kept: never deleted automatically' : 'Keep this one (never delete it automatically)'}
                    onClick={async () => {
                      await fetch(`/api/sessions/${s.session_key}/keep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keep: !s.keep }) });
                      refresh();
                    }}
                  >
                    {s.keep ? '★' : '☆'}
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete this download"
                    onClick={async () => {
                      if (!confirm(`Delete ${s.year} ${s.meeting_name} · ${s.session_name}? You can download it again later.`)) return;
                      await fetch(`/api/sessions/${s.session_key}`, { method: 'DELETE' });
                      refresh();
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
              {/Practice/.test(s.session_name) && (
                <button className="btn" disabled={!s.complete} onClick={() => open(s.session_key, '/long-runs')}>
                  Long runs
                </button>
              )}
              {!s.lite && (
                <button className="btn primary" disabled={!s.complete} onClick={() => open(s.session_key)}>
                  Open pit wall
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {!HOSTED && <LiveCard cached={cached} />}

      {!HOSTED && <IngestCard jobs={jobs} onStarted={(j) => setJobs((prev) => [...prev, j])} />}

      <LayoutsCard hasSession={sessionKey != null} />

      <AccountLine />
      <Footer />
    </div>
  );
}

interface LiveStatus {
  source: 'none' | 'openf1' | 'f1' | 'simulation';
  configured: boolean;
  freeLive?: boolean;
  connected: boolean;
  error: string | null;
  simulating: { sessionKey: number; label: string } | null;
  session: { key: number; name: string; dateStart: string; dateEnd: string } | null;
  lastMessageAt: number | null;
}

interface SeasonRace {
  round: number;
  name: string;
  circuit: string;
  locality: string;
  country: string;
  start: string;
  sprint: boolean;
  winner: { code: string; name: string; team: string } | null;
  sessionKey: number | null;
  cached: boolean;
}

interface Season {
  year: number;
  afterRound: number;
  races: SeasonRace[];
  drivers: { id: string; position: number; code: string; name: string; team: string; points: number; wins: number }[];
  constructors: { position: number; name: string; points: number; wins: number }[];
}

function countdown(ms: number) {
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** The season at a glance: next race, calendar with winners (and one-click replays), and both championships. */
function SeasonCard({ jobs, onOpen, onDownload }: { jobs: Job[]; onOpen: (key: number) => void; onDownload: (key: number) => void }) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [season, setSeason] = useState<Season | null>(null);
  const [error, setError] = useState('');
  const [allDrivers, setAllDrivers] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    setSeason(null);
    setError('');
    loadSeason(year).then((x) => setSeason(x as Season), (e) => setError(String(e.message ?? e)));
  }, [year, jobs.filter((j) => j.state === 'done').length]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = season?.races.find((r) => Date.parse(r.start) + 3 * 3600e3 > now);
  const downloading = new Set(jobs.filter((j) => j.state === 'running' || j.state === 'queued').map((j) => j.sessionKey));
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const fmtWhen = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Season</h2>
        <select className="lap-jump" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Season">
          {Array.from({ length: thisYear - 2022 }, (_, i) => thisYear - i).map((y) => (
            <option key={y}>{y}</option>
          ))}
        </select>
        {season && season.afterRound > 0 && <span className="dim" style={{ fontSize: 12 }}>Standings after round {season.afterRound}</span>}
        <span style={{ flex: 1 }} />
        <a className="icon-btn" href={`/season-stats?year=${year}`} style={{ textDecoration: 'none' }}>
          📊 Season stats
        </a>
        <a className="icon-btn" href={`/circuit?year=${year}`} style={{ textDecoration: 'none' }}>
          🗺 Circuit guide
        </a>
      </div>
      {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
      {!season && !error && <div className="dim">Loading the {year} season…</div>}
      {season && (
        <>
          {next && (
            <div className="next-race">
              <div>
                <div className="dim" style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Next · Round {next.round}
                  {next.sprint && ' · Sprint weekend'}
                </div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{next.name}</div>
                <div className="muted">
                  {next.circuit}, {next.locality} · lights out {fmtWhen(next.start)}
                </div>
                <a className="plain-link muted" style={{ fontSize: 12 }} href={`/circuit?year=${year}&round=${next.round}`}>
                  Circuit guide, weather and rain radar →
                </a>
              </div>
              <div className="next-count num">{countdown(Date.parse(next.start) - now)}</div>
            </div>
          )}
          <div className="season-grid">
            <div className="calendar">
              {season.races.map((r) => {
                const past = Date.parse(r.start) + 3 * 3600e3 < now;
                const isNext = r === next;
                return (
                  <div key={r.round} className={'cal-row' + (isNext ? ' next' : '') + (past ? '' : ' future')}>
                    <span className="num dim cal-round">{r.round}</span>
                    <span className="cal-name">
                      <a href={`/circuit?year=${year}&round=${r.round}`} className="plain-link" title="Circuit guide">
                        {r.name.replace(' Grand Prix', ' GP')}
                      </a>
                      {r.sprint && <span className="tag out" style={{ marginLeft: 6 }}>SPRINT</span>}
                      <span className="dim cal-date"> · {fmtDate(r.start)}</span>
                    </span>
                    <span className="cal-winner" title={r.winner ? `${r.winner.name} · ${r.winner.team}` : undefined}>
                      {r.winner ? <b>🏆 {r.winner.code}</b> : isNext ? <span className="green">Next</span> : ''}
                    </span>
                    <span className="cal-action">
                      {r.cached && r.sessionKey ? (
                        <button className="btn primary small" onClick={() => onOpen(r.sessionKey!)}>Replay</button>
                      ) : past && r.sessionKey && HOSTED ? (
                        <span className="dim" style={{ fontSize: 11 }} title="Races are added to the site automatically a few hours after they finish">
                          Not added yet
                        </span>
                      ) : past && r.sessionKey ? (
                        downloading.has(r.sessionKey) ? (
                          <span className="dim" style={{ fontSize: 11 }}>Downloading…</span>
                        ) : (
                          <button className="btn small" onClick={() => onDownload(r.sessionKey!)} title="Download this race for replay (2–4 minutes)">
                            Download
                          </button>
                        )
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="standings">
              <table className="tower">
                <thead>
                  <tr>
                    <th className="l" style={{ textAlign: 'center' }}>P</th>
                    <th className="l">Driver</th>
                    <th className="l">Team</th>
                    <th>Wins</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {(allDrivers ? season.drivers : season.drivers.slice(0, 10)).map((d) => (
                    <tr key={d.code + d.name} title={`${d.name}: season page`} onClick={() => (location.href = `/driver-season?year=${year}&driver=${d.id}`)}>
                      <td className="pos num">{d.position}</td>
                      <td className="l"><b>{d.code}</b></td>
                      <td className="l muted">{d.team}</td>
                      <td className="num muted">{d.wins || ''}</td>
                      <td className="num"><b>{d.points}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {season.drivers.length > 10 && (
                <button className="icon-btn" style={{ margin: '6px 0 12px' }} onClick={() => setAllDrivers(!allDrivers)}>
                  {allDrivers ? 'Show top 10' : `Show all ${season.drivers.length}`}
                </button>
              )}
              <table className="tower">
                <thead>
                  <tr>
                    <th className="l" style={{ textAlign: 'center' }}>P</th>
                    <th className="l">Team</th>
                    <th>Wins</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {season.constructors.map((c) => (
                    <tr key={c.name} style={{ cursor: 'default' }}>
                      <td className="pos num">{c.position}</td>
                      <td className="l"><b>{c.name}</b></td>
                      <td className="num muted">{c.wins || ''}</td>
                      <td className="num"><b>{c.points}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {!HOSTED && <AutoDownloadToggle />}
          <div className="dim" style={{ fontSize: 11, marginTop: 10 }}>
            Calendar, results and standings from Jolpica (free). Times shown in your local time zone.
          </div>
        </>
      )}
    </section>
  );
}

/** Switch for downloading each race automatically once it has finished. */
function AutoDownloadToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    getJson<{ autoDownload: boolean }>('/api/settings').then((s) => setOn(s.autoDownload), () => setOn(false));
  }, []);
  const set = async (next: boolean) => {
    setOn(next);
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autoDownload: next }) });
  };
  if (on == null) return null;
  return (
    <label className="auto-dl">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span>
        <b>Download new races automatically</b>
        <span className="muted"> · each new race is fetched about 2 hours after it finishes, while Pit Wall is running (earlier races: use their Download buttons)</span>
      </span>
    </label>
  );
}

function LiveCard({ cached }: { cached: Cached[] }) {
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [simKey, setSimKey] = useState<number | ''>('');
  const [fromLap, setFromLap] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const s = await getJson<LiveStatus>('/api/live').catch(() => null);
      if (stop) return;
      setLive(s);
      setTimeout(poll, 3000);
    };
    poll();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (simKey === '' && cached.length) setSimKey(cached.find((c) => c.complete)?.session_key ?? '');
  }, [cached, simKey]);

  const openLive = (path: string) => {
    clock.openLive();
    location.href = path;
  };

  const simulate = async () => {
    setError('');
    const r = await fetch('/api/live/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionKey: simKey, fromLap }),
    });
    const body = await r.json();
    if (!r.ok) setError(body.error);
    else setLive(body);
  };

  const stopSim = async () => setLive(await (await fetch('/api/live/stop', { method: 'POST' })).json());

  const fresh = !!live?.session && !!live.lastMessageAt && Date.now() - live.lastMessageAt < 30_000;
  const feedLabel = !live
    ? 'Checking…'
    : live.source === 'simulation'
      ? `Simulating ${live.simulating?.label}`
      : !live.configured && !live.freeLive
        ? 'Not set up'
        : live.connected
          ? live.session
            ? `${live.freeLive && !live.configured ? 'Free live timing' : 'Connected'} · ${live.session.name}`
            : `${live.freeLive && !live.configured ? 'Free live timing' : 'Connected'} · waiting for the next session`
          : 'Connecting…';

  return (
    <section className="card live-card">
      <h2>Live</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span>
          <span className="dot" style={{ background: fresh ? 'var(--red)' : live?.connected ? 'var(--green)' : 'var(--dim)' }} />
          {feedLabel}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" disabled={!live?.session} onClick={() => openLive('/companion')}>
          Open companion view
        </button>
        <button className="btn" disabled={!live?.session} onClick={() => openLive('/wall')}>
          Full pit wall
        </button>
      </div>
      {live?.error && <div style={{ color: 'var(--red)', marginTop: 8, fontSize: 12 }}>{live.error}</div>}
      {live && !live.configured && (
        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          {live.freeLive ? (
            <>
              Free mode uses F1's own live timing: the tower, gaps, tyres, pit stops, race control, flags and weather are live. Car
              positions on the map are <b>estimated</b> from lap timing, and there's no live telemetry. For exact positions, add an OpenF1
              sponsor login to <code>.env</code> (see <code>.env.example</code>).
            </>
          ) : (
            <>
              To follow real sessions, copy <code>.env.example</code> to <code>.env</code>, add your OpenF1 sponsor login, and restart{' '}
              <code>npm run dev</code>.
            </>
          )}
        </div>
      )}
      <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
        Watching on the TV? Open the companion view on a laptop or tablet, then use <b>📺 TV delay → Sync to TV</b> so the data
        never gets ahead of the picture.
      </div>

      <div className="form-row" style={{ marginTop: 14 }}>
        <span className="muted">Rehearse with a simulated live race:</span>
        <select value={simKey} onChange={(e) => setSimKey(e.target.value ? Number(e.target.value) : '')}>
          {cached.filter((c) => c.complete).map((c) => (
            <option key={c.session_key} value={c.session_key}>
              {c.year} {c.meeting_name} · {c.session_name}
            </option>
          ))}
        </select>
        <label className="muted">
          from lap{' '}
          <input type="number" min={1} max={80} value={fromLap} onChange={(e) => setFromLap(Number(e.target.value) || 1)} style={{ width: 56 }} className="lap-jump" />
        </label>
        <button className="btn" disabled={simKey === ''} onClick={simulate}>
          Start simulation
        </button>
        {live?.source === 'simulation' && (
          <button className="btn" onClick={stopSim}>
            Stop
          </button>
        )}
      </div>
      {error && <div style={{ color: 'var(--red)', marginTop: 8 }}>{error}</div>}
    </section>
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
              Session {j.sessionKey}:{' '}
              {j.state === 'queued' ? 'waiting its turn' : j.state === 'running' ? j.progress?.step ?? 'starting' : j.state === 'done' ? 'done ✓' : 'failed'}
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
        {HOSTED
          ? 'Signed in on another device? It follows the same clock, wherever it is.'
          : <>Other devices on your Wi-Fi (TV, tablet, laptop) can join too: open <code>http://&lt;this computer's IP&gt;:5173/map</code> and they follow the same clock.</>}
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

/** Quick links to the history pages, with today's "on this day" race if it's already been loaded once. */
function ExploreCard() {
  const now = new Date();
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let today: [string, number, number, string, string, string, string, string, string, number][] = [];
  try {
    const saved = JSON.parse(localStorage.getItem('pitwall.winners.v1') ?? 'null');
    today = (saved?.data ?? []).filter((w: [string]) => w[0].slice(5) === md).sort((a: [string, number], b: [string, number]) => b[1] - a[1]);
  } catch {
    // not loaded yet
  }
  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Explore</h2>
        <span style={{ flex: 1 }} />
        <a className="icon-btn" href="/head-to-head" style={{ textDecoration: 'none' }}>⚔ Head to head</a>
        <a className="icon-btn" href="/predictions" style={{ textDecoration: 'none' }}>🔮 Predictions</a>
        <a className="icon-btn" href="/on-this-day" style={{ textDecoration: 'none' }}>📅 On this day</a>
      </div>
      {today[0] && (
        <div className="muted" style={{ marginTop: 8 }}>
          On this day in {today[0][1]}: <b className="text">{today[0][7]}</b> won the {today[0][3]}
          {today.length > 1 ? ` (and ${today.length - 1} more race${today.length > 2 ? 's' : ''} on this date)` : ''}.
        </div>
      )}
    </section>
  );
}

/** Space used by downloads, and the limit the app keeps them under. */
function StorageLine({ cached, onChange }: { cached: Cached[]; onChange: () => void }) {
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    getJson<{ limitGB: number | null }>('/api/storage').then((s) => setLimit(s.limitGB), () => {});
  }, []);
  const total = cached.reduce((x, c) => x + c.size_mb, 0);
  const change = async (v: string) => {
    const limitGB = v === 'none' ? null : Number(v);
    setLimit(limitGB);
    await fetch('/api/storage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limitGB }) });
    onChange();
  };
  if (limit === undefined) return null;
  return (
    <span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }} title="When downloads go over the limit, the races you opened longest ago are deleted (never ones marked ★)">
      {(total / 1000).toFixed(1)} GB used · keep under
      <select className="lap-jump" value={limit == null ? 'none' : String(limit)} onChange={(e) => change(e.target.value)}>
        {[2, 5, 10, 20, 50].map((g) => (
          <option key={g} value={g}>
            {g} GB
          </option>
        ))}
        <option value="none">no limit</option>
      </select>
    </span>
  );
}
