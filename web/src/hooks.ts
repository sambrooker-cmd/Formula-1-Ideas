import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clock, getState, now, subscribe } from './sync/clock';
import { applyDelta, loadLiveSnapshot, loadSession, type SessionData } from './data/session';

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
  const { sessionKey, source } = useSynced();
  const [load, setLoad] = useState<SessionLoad>({ status: 'none' });

  // Replays: load the cached pack once.
  useEffect(() => {
    if (source !== 'replay') return;
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
  }, [sessionKey, source]);

  // Live: snapshot, then apply deltas as they stream in. Deltas that arrive while the
  // snapshot loads are queued; duplicates are ignored by applyDelta.
  useEffect(() => {
    if (source !== 'live') return;
    let cancelled = false;
    let data: SessionData | null = null;
    let queue: Record<string, any[]>[] = [];
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;

    const fetchSnapshot = () => {
      const mine = ++generation; // a newer snapshot request supersedes this one
      data = null;
      queue = [];
      setLoad({ status: 'loading', loadedBytes: 0 });
      loadLiveSnapshot((b) => !cancelled && mine === generation && setLoad({ status: 'loading', loadedBytes: b })).then(
        (d) => {
          if (cancelled || mine !== generation) return;
          data = d;
          for (const q of queue.splice(0)) applyDelta(d, q);
          clock.setLiveT0(d.meta.t0);
          setLoad({ status: 'ready', data: d });
        },
        (err) => {
          if (cancelled || mine !== generation) return;
          setLoad({ status: 'error', error: (err as Error).message + ' Waiting for one to start…' });
          retry = setTimeout(fetchSnapshot, 15_000);
        },
      );
    };

    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/stream`);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'session') fetchSnapshot();
        else if (msg.type === 'delta') {
          if (data) applyDelta(data, msg.topics);
          else queue.push(msg.topics);
        }
      };
      ws.onclose = () => {
        if (!cancelled) retry = setTimeout(() => (connect(), fetchSnapshot()), 3000);
      };
    };

    connect();
    fetchSnapshot();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [source]);

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
