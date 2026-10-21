import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { SessionData } from './data/session';
import { useSessionData, useSynced } from './hooks';
import { Home } from './components/Home';
import { PlaybackBar } from './components/PlaybackBar';
import { TrackMap } from './components/TrackMap';
import { TimingTower } from './components/TimingTower';
import { RaceControl } from './components/RaceControl';
import { Telemetry } from './components/Telemetry';
import { Strategy } from './components/Strategy';

type PanelComponent = ComponentType<{ data: SessionData; area?: string }>;

const SINGLE: Record<string, PanelComponent> = {
  '/map': TrackMap,
  '/tower': TimingTower,
  '/telemetry': Telemetry,
  '/race-control': RaceControl,
  '/strategy': Strategy,
};

function TopBar({ data }: { data?: SessionData }) {
  return (
    <div className="topbar">
      <a className="brand" href="/">
        <span className="brand-mark" /> PIT WALL
      </a>
      {data && (
        <span className="session-title">
          <b>
            {data.meta.session.year} {data.meta.session.meetingName}
          </b>{' '}
          · {data.meta.session.name} · {data.meta.session.circuit}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <a className="icon-btn" href="/" style={{ textDecoration: 'none' }}>
        Sessions & layouts
      </a>
    </div>
  );
}

function WithSession({ children }: { children: (data: SessionData) => React.ReactNode }) {
  const load = useSessionData();
  if (load.status === 'none')
    return (
      <div className="center-msg">
        <div>
          No session selected.
          <br />
          <a href="/">Pick one on the home page</a>, or open this window after another window has one loaded.
        </div>
      </div>
    );
  if (load.status === 'loading')
    return <div className="center-msg">Loading replay… {(load.loadedBytes / 1e6).toFixed(1)} MB</div>;
  if (load.status === 'error')
    return (
      <div className="center-msg">
        <div>
          {load.error}
          <br />
          <a href="/">Back to sessions</a>
        </div>
      </div>
    );
  return <>{children(load.data)}</>;
}

function Wall() {
  return (
    <div className="page">
      <WithSession>
        {(data) => (
          <>
            <TopBar data={data} />
            <div className="wall">
              <TrackMap data={data} area="map" />
              <TimingTower data={data} area="tower" />
              <RaceControl data={data} area="rc" />
              <Telemetry data={data} area="tele" />
              <Strategy data={data} area="strategy" />
            </div>
            <PlaybackBar data={data} />
          </>
        )}
      </WithSession>
    </div>
  );
}

/** For a laptop or tablet next to the TV: map, timing and race control, no telemetry (the TV has onboards). */
function Companion() {
  return (
    <div className="page">
      <WithSession>
        {(data) => (
          <>
            <TopBar data={data} />
            <div className="companion">
              <TrackMap data={data} area="map" />
              <TimingTower data={data} area="tower" />
              <RaceControl data={data} area="rc" />
            </div>
            <PlaybackBar data={data} />
          </>
        )}
      </WithSession>
    </div>
  );
}

function Single({ Component }: { Component: PanelComponent }) {
  const hideBar = new URLSearchParams(location.search).get('bar') === '0';
  return (
    <div className="page">
      <WithSession>
        {(data) => (
          <>
            <div className="page-body">
              <Component data={data} />
            </div>
            {!hideBar && <PlaybackBar data={data} compact />}
          </>
        )}
      </WithSession>
    </div>
  );
}

function App() {
  useSynced();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/wall') return <Wall />;
  if (path === '/companion') return <Companion />;
  if (SINGLE[path]) {
    document.title = `Pit Wall · ${path.slice(1)}`;
    return <Single Component={SINGLE[path]} />;
  }
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
