// Weather for a race: the forecast for the weekend (or what it was on the day), and a rain radar
// around the circuit. Open-Meteo (forecast and history) and RainViewer (radar) are free, no key.
import { useEffect, useMemo, useState } from 'react';
import { LineChart } from './LineChart';

interface Hourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability?: number[];
  precipitation: number[];
  wind_speed_10m: number[];
}

const HOURLY = 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m';

async function weatherFor(lat: number, lng: number, start: Date): Promise<{ hourly: Hourly; kind: 'forecast' | 'history' }> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const from = new Date(start.getTime() - 2 * 86_400e3);
  const to = new Date(start.getTime() + 6 * 3600e3);
  const ageDays = (Date.now() - start.getTime()) / 86_400e3;
  // The forecast service covers the last ~90 days and the next 16; older races use the archive.
  const url =
    ageDays > 80
      ? `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${day(from)}&end_date=${day(to)}&hourly=temperature_2m,precipitation,wind_speed_10m&timezone=GMT`
      : `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&start_date=${day(from)}&end_date=${day(to)}&hourly=${HOURLY}&timezone=GMT`;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.reason ?? `weather service returned ${r.status}`);
  return { hourly: j.hourly, kind: start.getTime() > Date.now() ? 'forecast' : 'history' };
}

export function RaceWeather({ lat, lng, start }: { lat: number; lng: number; start: string }) {
  const when = useMemo(() => new Date(start), [start]);
  const [w, setW] = useState<{ hourly: Hourly; kind: 'forecast' | 'history' } | null>(null);
  const [error, setError] = useState('');
  const tooFar = when.getTime() - Date.now() > 15 * 86_400e3;
  const radarUseful = Math.abs(when.getTime() - Date.now()) < 4 * 86_400e3;
  const [radar, setRadar] = useState(radarUseful);

  useEffect(() => {
    setW(null);
    setError('');
    if (tooFar || !Number.isFinite(lat)) return;
    weatherFor(lat, lng, when).then(setW, (e) => setError(String(e.message ?? e)));
  }, [lat, lng, when, tooFar]);

  const raceHour = w ? w.hourly.time.findIndex((t) => Date.parse(t + 'Z') >= when.getTime() - 1800e3) : -1;
  const at = (k: keyof Hourly, i: number) => (w?.hourly[k] as number[] | undefined)?.[i];
  const rainDuringRace = w && raceHour >= 0 ? w.hourly.precipitation.slice(raceHour, raceHour + 2).reduce((a, b) => a + (b ?? 0), 0) : null;
  const local = (t: string) => new Date(t + 'Z');

  return (
    <section className="doc-section">
      <div className="doc-section-head">
        <h2>Weather</h2>
        <button className={'icon-btn' + (radar ? ' active' : '')} onClick={() => setRadar(!radar)}>
          🌧 Rain radar {radar ? 'on' : 'off'}
        </button>
      </div>
      {tooFar && <p className="muted">The forecast appears about two weeks before the race.</p>}
      {error && <p className="dim">Couldn't load the weather ({error}).</p>}
      {w && (
        <>
          <div className="tiles">
            {raceHour >= 0 && (
              <>
                <div className="tile">
                  <div className="tile-label">{w.kind === 'forecast' ? 'At lights out' : 'At the start'}</div>
                  <div className="tile-value">{at('temperature_2m', raceHour)?.toFixed(0)}°C</div>
                  <div className="tile-sub">wind {at('wind_speed_10m', raceHour)?.toFixed(0)} km/h</div>
                </div>
                <div className="tile">
                  <div className="tile-label">Rain during the race</div>
                  <div className="tile-value">
                    {w.kind === 'forecast' && at('precipitation_probability', raceHour) != null
                      ? `${Math.max(at('precipitation_probability', raceHour)!, at('precipitation_probability', raceHour + 1) ?? 0)}%`
                      : rainDuringRace! > 0.2
                        ? `${rainDuringRace!.toFixed(1)} mm`
                        : 'Dry'}
                  </div>
                  <div className="tile-sub">{w.kind === 'forecast' ? 'chance of rain' : 'over the race'}</div>
                </div>
              </>
            )}
          </div>
          <LineChart
            series={[
              { id: 't', label: '°C', colour: '#ffb020', values: w.hourly.temperature_2m },
              ...(w.hourly.precipitation_probability
                ? [{ id: 'p', label: 'rain %', colour: '#3fa7ff', values: w.hourly.precipitation_probability.map((v) => v / 2.5), dashed: true }]
                : [{ id: 'mm', label: 'rain mm×10', colour: '#3fa7ff', values: w.hourly.precipitation.map((v) => v * 10), dashed: true }]),
            ]}
            xLabels={w.hourly.time.map((t) => local(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit' }))}
            xEvery={12}
            height={170}
            yMin={0}
          />
          <p className="dim" style={{ fontSize: 11 }}>
            Hourly, in your time zone, from two days before the race. {w.hourly.precipitation_probability ? 'Rain line: chance of rain (0–100% scaled to the chart).' : ''} Weather from
            Open-Meteo.
          </p>
        </>
      )}
      {radar && <RainRadar lat={lat} lng={lng} />}
    </section>
  );
}

// ---- rain radar ----------------------------------------------------------------------

const ZOOM = 7; // RainViewer's free radar goes up to zoom 7

function tileOf(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  return { x, y };
}

function RainRadar({ lat, lng }: { lat: number; lng: number }) {
  const [frames, setFrames] = useState<{ time: number; path: string }[]>([]);
  const [host, setHost] = useState('');
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((r) => r.json())
      .then((j) => {
        const f = [...(j.radar?.past ?? []), ...(j.radar?.nowcast ?? [])];
        setHost(j.host);
        setFrames(f);
        setI(Math.max(0, (j.radar?.past?.length ?? 1) - 1));
      })
      .catch(() => setError("Couldn't reach the radar service."));
  }, []);

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const id = setInterval(() => setI((k) => (k + 1) % frames.length), 600);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  const { x, y } = tileOf(lat, lng, ZOOM);
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  const tiles: [number, number][] = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) tiles.push([dx, dy]);
  // Shift so the circuit sits in the middle of the 5×5 block.
  const offX = Math.round((x - tx - 0.5) * 256);
  const offY = Math.round((y - ty - 0.5) * 256);
  const frame = frames[i];

  if (error) return <p className="dim">{error}</p>;
  return (
    <div className="radar">
      <div className="radar-view">
        <div className="radar-tiles" style={{ transform: `translate(${-offX}px, ${-offY}px)` }}>
          {tiles.map(([dx, dy]) => (
            <img key={`b${dx},${dy}`} alt="" src={`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/${ZOOM}/${ty + dy}/${tx + dx}`} style={{ left: (dx + 2) * 256, top: (dy + 2) * 256 }} />
          ))}
          {/* Every frame is loaded once and only shown in turn, so the animation doesn't reload images. */}
          {frames.map((f, k) => (
            <div key={f.path} className="radar-frame" style={{ opacity: k === i ? 0.75 : 0 }}>
              {tiles.map(([dx, dy]) => (
                <img
                  key={`${dx},${dy}`}
                  alt=""
                  src={`${host}${f.path}/256/${ZOOM}/${tx + dx}/${ty + dy}/2/1_1.png`}
                  onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                  style={{ left: (dx + 2) * 256, top: (dy + 2) * 256 }}
                />
              ))}
            </div>
          ))}
        </div>
        <span className="radar-pin" title="The circuit" />
      </div>
      <div className="radar-bar">
        <button className="pb-btn" onClick={() => setPlaying(!playing)}>
          {playing ? '❚❚' : '▶'}
        </button>
        <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={i} onChange={(e) => (setPlaying(false), setI(Number(e.target.value)))} />
        <span className="num muted">{frame ? new Date(frame.time * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '–'}</span>
      </div>
      <p className="dim" style={{ fontSize: 11 }}>
        The last two hours of rain radar around the circuit (≈ 300 km across). Radar © RainViewer · map © Esri, HERE, Garmin, OpenStreetMap contributors.
      </p>
    </div>
  );
}
