import { lazy, StrictMode, Suspense, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { SessionData } from './data/session';
import { useSessionData, useSynced } from './hooks';
import { PlaybackBar } from './components/PlaybackBar';
import { TrackMap } from './components/TrackMap';
import { TimingTower } from './components/TimingTower';
import { RaceControl } from './components/RaceControl';
import { Telemetry } from './components/Telemetry';
import { Strategy } from './components/Strategy';
import { PitBattles } from './components/PitBattles';
import { LapCompare } from './components/LapCompare';
import { KeyMoments } from './components/KeyMoments';
import { PositionChart, RaceTrace, TyreWear } from './components/RaceCharts';
import { Tabbed } from './components/Tabbed';
import { Championship } from './components/Championship';
import { AlertsHost } from './components/Alerts';
import { SignInGate } from './components/SignInGate';
import { LongRuns } from './components/LongRuns';
import { Battles } from './components/Battles';
import { Predictor } from './components/Predictor';
import { ReplayGate, WatchedMarker } from './components/Spoilers';
import { Commentary } from './components/Commentary';
import { TeamRadio } from './components/TeamRadio';
import { openMiniWindow, Strip } from './components/Strip';
import { AllViewsButton } from './components/AllViews';

// three.js is big: only load it when the 3D page is opened.
const Replay3D = lazy(() => import('./three/Replay3D'));

// Pages and panels that aren't on the pit wall itself load on demand, so the first screen
// downloads less (each is its own small file, fetched the first time it's opened).
const named = <K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, key: K) =>
  lazy(() => load().then((m) => ({ default: m[key] })));
const Home = named(() => import('./components/Home'), 'Home');
const DriverDash = named(() => import('./components/DriverDash'), 'DriverDash');
const TvMode = named(() => import('./components/TvMode'), 'TvMode');
const RaceReport = named(() => import('./components/RaceReport'), 'RaceReport');
const Cockpit = named(() => import('./components/Cockpit'), 'Cockpit');
const GhostLap = named(() => import('./components/GhostLap'), 'GhostLap');
const Corners = named(() => import('./components/Corners'), 'Corners');
const StrategySim = named(() => import('./components/StrategySim'), 'StrategySim');
const Starts = named(() => import('./components/Starts'), 'Starts');
const Ratings = named(() => import('./components/Ratings'), 'Ratings');
const Overtakes = named(() => import('./components/Overtakes'), 'Overtakes');
const StrategyPlanner = named(() => import('./components/StrategyPlanner'), 'StrategyPlanner');
const SeasonStatsPage = named(() => import('./components/SeasonStats'), 'SeasonStatsPage');
const DriverSeasonPage = named(() => import('./components/DriverSeason'), 'DriverSeasonPage');
const CircuitGuidePage = named(() => import('./components/CircuitGuide'), 'CircuitGuidePage');
const CareerH2HPage = named(() => import('./components/CareerH2H'), 'CareerH2HPage');
const PredictionsPage = named(() => import('./components/Predictions'), 'PredictionsPage');
const OnThisDayPage = named(() => import('./components/OnThisDay'), 'OnThisDayPage');
const CleanAirPace = named(() => import('./components/RacePace'), 'CleanAirPace');
const TyreDeg = named(() => import('./components/RacePace'), 'TyreDeg');

type PanelComponent = ComponentType<{ data: SessionData; area?: string }>;

const SINGLE: Record<string, PanelComponent> = {
  '/map': TrackMap,
  '/tower': TimingTower,
  '/telemetry': Telemetry,
  '/race-control': RaceControl,
  '/strategy': Strategy,
  '/pit-battles': PitBattles,
  '/compare': LapCompare,
  '/moments': KeyMoments,
  '/race-trace': RaceTrace,
  '/positions': PositionChart,
  '/tyre-wear': TyreWear,
  '/championship': Championship,
  '/long-runs': LongRuns,
  '/ghost': GhostLap,
  '/corners': Corners,
  '/tyre-deg': TyreDeg,
  '/clean-air': CleanAirPace,
  '/strategy-sim': StrategySim,
  '/battles': Battles,
  '/starts': Starts,
  '/ratings': Ratings,
  '/predictor': Predictor,
  '/commentary': Commentary,
  '/radio': TeamRadio,
  '/overtakes': Overtakes,
  '/strategy-plan': StrategyPlanner,
};

/** Pit wall bottom-right: tyre strategy or the live championship. */
function StrategyTabs({ data }: { data: SessionData }) {
  return (
    <Tabbed
      storageKey="pitwall.tab.strategy"
      tabs={[
        { id: 'strategy', label: 'Strategy', render: (lead) => <Strategy data={data} area="strategy" lead={lead} /> },
        { id: 'battles', label: 'Pit battles', render: (lead) => <PitBattles data={data} area="strategy" lead={lead} /> },
        { id: 'champ', label: 'Championship', render: (lead) => <Championship data={data} area="strategy" lead={lead} /> },
      ]}
    />
  );
}

/** Pit wall bottom-left: telemetry and the lap-by-lap analysis charts. */
function AnalysisTabs({ data }: { data: SessionData }) {
  return (
    <Tabbed
      storageKey="pitwall.tab.analysis"
      tabs={[
        { id: 'tele', label: 'Telemetry', render: (lead) => <Telemetry data={data} area="tele" lead={lead} /> },
        { id: 'compare', label: 'Fastest laps', render: (lead) => <LapCompare data={data} area="tele" lead={lead} /> },
        { id: 'trace', label: 'Race trace', render: (lead) => <RaceTrace data={data} area="tele" lead={lead} /> },
        { id: 'positions', label: 'Positions', render: (lead) => <PositionChart data={data} area="tele" lead={lead} /> },
        { id: 'wear', label: 'Tyre wear', render: (lead) => <TyreWear data={data} area="tele" lead={lead} /> },
        { id: 'longruns', label: data.meta.session.type === 'Race' ? 'Stint pace' : 'Long runs', render: (lead) => <LongRuns data={data} area="tele" lead={lead} /> },
      ]}
    />
  );
}

/** The analysis page: deeper tools that want a whole screen. */
function AnalysisPage({ data }: { data: SessionData }) {
  return (
    <div className="analysis-page">
      <Tabbed
        storageKey="pitwall.tab.analysis-page"
        tabs={[
          { id: 'ghost', label: 'Ghost lap', render: (lead) => <GhostLap data={data} lead={lead} /> },
          { id: 'corners', label: 'Corners', render: (lead) => <Corners data={data} lead={lead} /> },
          { id: 'deg', label: 'Tyre deg', render: (lead) => <TyreDeg data={data} lead={lead} /> },
          { id: 'clean', label: 'Clean-air pace', render: (lead) => <CleanAirPace data={data} lead={lead} /> },
          { id: 'sim', label: 'Strategy sim', render: (lead) => <StrategySim data={data} lead={lead} /> },
          { id: 'battles', label: 'Battles', render: (lead) => <Battles data={data} lead={lead} /> },
          { id: 'start', label: 'Start', render: (lead) => <Starts data={data} lead={lead} /> },
          { id: 'overtakes', label: 'Overtakes', render: (lead) => <Overtakes data={data} lead={lead} /> },
          { id: 'plan', label: 'Race strategy', render: (lead) => <StrategyPlanner data={data} lead={lead} /> },
          { id: 'ratings', label: 'Ratings', render: (lead) => <Ratings data={data} lead={lead} /> },
        ]}
      />
    </div>
  );
}

/** Race control messages, or the key moments list. */
function ControlTabs({ data, area = 'rc' }: { data: SessionData; area?: string }) {
  return (
    <Tabbed
      storageKey="pitwall.tab.control"
      tabs={[
        { id: 'messages', label: 'Messages', render: (lead) => <RaceControl data={data} area={area} lead={lead} /> },
        { id: 'moments', label: 'Moments', render: (lead) => <KeyMoments data={data} area={area} lead={lead} /> },
        { id: 'commentary', label: 'Commentary', render: (lead) => <Commentary data={data} area={area} lead={lead} /> },
        { id: 'radio', label: 'Radio', render: (lead) => <TeamRadio data={data} area={area} lead={lead} /> },
        { id: 'battles', label: 'Battles', render: (lead) => <Battles data={data} area={area} lead={lead} /> },
        { id: 'predictor', label: 'Predictor', render: (lead) => <Predictor data={data} area={area} lead={lead} /> },
      ]}
    />
  );
}

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
      {data && (
        <button className="icon-btn" onClick={() => openMiniWindow(data)} title="Positions and gaps in a small window that stays on top of other apps">
          ▣ Mini window
        </button>
      )}
      {data && location.pathname !== '/analysis' && (
        <a className="icon-btn" href="/analysis" target="_blank" rel="noopener" style={{ textDecoration: 'none' }} title="Ghost laps, corners, tyre wear, pace, strategy simulator and battles">
          📈 Analysis
        </a>
      )}
      {data && location.pathname !== '/3d' && (
        <a className="icon-btn" href="/3d" target="_blank" rel="noopener" style={{ textDecoration: 'none' }} title="The replay in 3D, in a new window">
          🧊 3D
        </a>
      )}
      {data && location.pathname !== '/report' && (
        <a className="icon-btn" href="/report" target="_blank" rel="noopener" style={{ textDecoration: 'none' }} title="A written summary of this session">
          📰 Report
        </a>
      )}
      <AllViewsButton />
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
            <AlertsHost data={data} />
            <WatchedMarker data={data} />
            <div className="wall">
              <TrackMap data={data} area="map" />
              <TimingTower data={data} area="tower" />
              <ControlTabs data={data} />
              <AnalysisTabs data={data} />
              <StrategyTabs data={data} />
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
            <AlertsHost data={data} />
            <WatchedMarker data={data} />
            <div className="companion">
              <TrackMap data={data} area="map" />
              <TimingTower data={data} area="tower" />
              <ControlTabs data={data} />
            </div>
            <PlaybackBar data={data} />
          </>
        )}
      </WithSession>
    </div>
  );
}

/** A full-page view with alerts and the playback bar (driver dashboard, TV mode). */
function FullPage({ children, compactBar = false, topBar = true }: { children: (data: SessionData) => React.ReactNode; compactBar?: boolean; topBar?: boolean }) {
  return (
    <div className="page">
      <WithSession>
        {(data) => (
          <>
            {topBar && <TopBar data={data} />}
            <AlertsHost data={data} />
            <WatchedMarker data={data} />
            <div className="page-body">{children(data)}</div>
            <PlaybackBar data={data} compact={compactBar} />
          </>
        )}
      </WithSession>
    </div>
  );
}

/** Single panels that look at the whole race (hidden in spoiler-free mode until it's watched). */
const GATED = ['/ratings', '/overtakes', '/battles', '/strategy-sim'];

function Single({ Component }: { Component: PanelComponent }) {
  const hideBar = new URLSearchParams(location.search).get('bar') === '0';
  return (
    <div className="page">
      <WithSession>
        {(data) => (
          <>
            <WatchedMarker data={data} />
            <div className="page-body">
              {GATED.includes(location.pathname) ? (
                <ReplayGate data={data} what="This analysis">
                  <Component data={data} />
                </ReplayGate>
              ) : (
                <Component data={data} />
              )}
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
  if (path === '/driver') return <FullPage>{(data) => <DriverDash data={data} />}</FullPage>;
  if (path === '/season-stats') return <SeasonStatsPage />;
  if (path === '/driver-season') return <DriverSeasonPage />;
  if (path === '/circuit') return <CircuitGuidePage />;
  if (path === '/head-to-head') return <CareerH2HPage />;
  if (path === '/predictions') return <PredictionsPage />;
  if (path === '/on-this-day') return <OnThisDayPage />;
  if (path === '/report')
    return (
      <div className="page">
        <WithSession>
          {(data) => (
            <>
              <TopBar data={data} />
              <div className="report-scroll">
                <ReplayGate data={data} what="The report">
                  <RaceReport data={data} />
                </ReplayGate>
              </div>
            </>
          )}
        </WithSession>
      </div>
    );
  if (path === '/strip')
    return (
      <div className="page">
        <WithSession>{(data) => <Strip data={data} row={new URLSearchParams(location.search).get('layout') === 'row'} />}</WithSession>
      </div>
    );
  if (path === '/analysis')
    return (
      <FullPage>
        {(data) => (
          <ReplayGate data={data} what="The analysis of the whole race">
            <AnalysisPage data={data} />
          </ReplayGate>
        )}
      </FullPage>
    );
  if (path === '/3d')
    return (
      <FullPage>
        {(data) => (
          <Suspense fallback={<div className="center-msg">Loading 3D…</div>}>
            <Replay3D data={data} />
          </Suspense>
        )}
      </FullPage>
    );
  if (path === '/cockpit') return <FullPage compactBar>{(data) => <Cockpit data={data} />}</FullPage>;
  if (path === '/tv') return <FullPage compactBar topBar={false}>{(data) => <TvMode data={data} />}</FullPage>;
  if (SINGLE[path]) {
    document.title = `Pit Wall · ${path.slice(1)}`;
    return <Single Component={SINGLE[path]} />;
  }
  return <Home />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SignInGate>
      <Suspense fallback={<div className="center-msg">Loading…</div>}>
        <App />
      </Suspense>
    </SignInGate>
  </StrictMode>,
);
