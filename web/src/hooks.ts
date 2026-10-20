import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clock, getState, now, subscribe } from './sync/clock';
import { loadSession, type SessionData } from './data/session';

export function useSynced() {
  return useSyncExternalStore(subscribe, getState);
}

/** Current session time, re-rendering at most `fps` times a second. */
export function useNow(fps = 10) {
  const [t, setT] = useState(() => now());
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      if (ts - last >= 1000 / fps) {
        last = ts;
        setT(now());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
  return t;
}

export type SessionLoad =
  | { status: 'none' }
  | { status: 'loading'; loadedBytes: number }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: SessionData };

export function useSessionData(): SessionLoad {
  const { sessionKey } = useSynced();
  const [load, setLoad] = useState<SessionLoad>({ status: 'none' });
  useEffect(() => {
    if (sessionKey == null) {
      setLoad({ status: 'none' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading', loadedBytes: 0 });
    loadSession(sessionKey, (loadedBytes) => !cancelled && setLoad({ status: 'loading', loadedBytes })).then(
      (data) => {
        if (cancelled) return;
        clock.initialiseTime(data.meta.raceStart);
        setLoad({ status: 'ready', data });
      },
      (err) => !cancelled && setLoad({ status: 'error', error: (err as Error).message }),
    );
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);
  return load;
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}
