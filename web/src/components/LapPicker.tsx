// Choose two laps to compare (any driver, any lap). Defaults to the two selected drivers'
// fastest laps, or the session's two fastest drivers.
import { useEffect, useMemo, useState } from 'react';
import type { Lap, SessionData } from '../data/session';
import { formatLapTime } from '../data/state';
import { fastestLap, lapTrace, type LapTrace } from '../data/laptrace';
import { useSynced } from '../hooks';

export interface LapChoice {
  driver: number;
  /** Lap number, or 0 for "their fastest". */
  lap: number;
}

function resolve(data: SessionData, c: LapChoice): Lap | null {
  if (!c.lap) return fastestLap(data, c.driver);
  return data.laps.get(c.driver)?.find((l) => l.lap === c.lap && l.duration != null) ?? null;
}

export function useLapPair(data: SessionData) {
  const { selected } = useSynced();
  const defaults = useMemo(() => {
    const ranked = data.driverOrder
      .map((n) => ({ n, l: fastestLap(data, n) }))
      .filter((x) => x.l)
      .sort((a, b) => a.l!.duration! - b.l!.duration!)
      .map((x) => x.n);
    const a = selected[0] ?? ranked[0];
    const b = selected[1] ?? ranked.find((n) => n !== a);
    return [a, b];
  }, [data, selected]);
  const [a, setA] = useState<LapChoice>({ driver: defaults[0], lap: 0 });
  const [b, setB] = useState<LapChoice>({ driver: defaults[1], lap: 0 });
  // Follow the pit wall's driver selection when it changes.
  useEffect(() => {
    if (selected[0] != null) setA({ driver: selected[0], lap: 0 });
    if (selected[1] != null) setB({ driver: selected[1], lap: 0 });
  }, [selected]);
  const lapA = a.driver != null ? resolve(data, a) : null;
  const lapB = b.driver != null ? resolve(data, b) : null;
  const trA = useMemo<LapTrace | null>(() => (lapA ? lapTrace(data, a.driver, lapA) : null), [data, a.driver, lapA]);
  const trB = useMemo<LapTrace | null>(() => (lapB ? lapTrace(data, b.driver, lapB) : null), [data, b.driver, lapB]);
  return { a, b, setA, setB, trA, trB };
}

export function LapSelect({ data, value, onChange, tag }: { data: SessionData; value: LapChoice; onChange: (c: LapChoice) => void; tag: string }) {
  const d = data.drivers.get(value.driver);
  const laps = (data.laps.get(value.driver) ?? []).filter((l) => l.duration != null && !l.pitOut);
  return (
    <span className="lap-pick">
      <b className="lap-pick-tag" style={{ background: d?.colour }}>{tag}</b>
      <select className="lap-jump" value={value.driver} onChange={(e) => onChange({ driver: Number(e.target.value), lap: 0 })} aria-label={`Driver ${tag}`}>
        {data.driverOrder.map((n) => (
          <option key={n} value={n}>
            {data.drivers.get(n)?.code}
          </option>
        ))}
      </select>
      <select className="lap-jump" value={value.lap} onChange={(e) => onChange({ ...value, lap: Number(e.target.value) })} aria-label={`Lap ${tag}`}>
        <option value={0}>Fastest lap</option>
        {laps.map((l) => (
          <option key={l.lap} value={l.lap}>
            Lap {l.lap} · {formatLapTime(l.duration)}
          </option>
        ))}
      </select>
    </span>
  );
}
