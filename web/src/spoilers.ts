// Spoiler-free mode: for people who watch races later. While it's on, results from recent races
// you haven't watched (the last three weeks) are hidden: winners and standings on the home page,
// season and driver pages, the circuit guide for that race, analysis of the race, and result
// notifications. A race counts as watched once a replay reaches the chequered flag, or when you
// say so. The setting and the watched list follow you between devices.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadUserData, saveUserData } from './data/userstore';

interface State {
  on: boolean;
  /** Races watched, as "year-round". */
  watched: string[];
}

let state: State = { on: false, watched: [] };
let loaded = false;
const listeners = new Set<() => void>();
/** Shown anyway in this browser tab ("year-round"), without counting as watched. */
const revealed = new Set<string>(
  (() => {
    try {
      return JSON.parse(sessionStorage.getItem('pitwall.revealed') ?? '[]') as string[];
    } catch {
      return [];
    }
  })(),
);

try {
  state = { ...state, ...JSON.parse(localStorage.getItem('pitwall.user.spoilers') ?? '{}') };
} catch {
  // ignore
}

function set(next: State) {
  state = next;
  listeners.forEach((f) => f());
  void saveUserData('spoilers', state);
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  loadUserData<State>('spoilers').then((s) => {
    if (s) {
      state = { on: !!s.on, watched: s.watched ?? [] };
      listeners.forEach((f) => f());
    }
  });
}

export const raceId = (year: number, round: number) => `${year}-${round}`;

export const spoilers = {
  setOn: (on: boolean) => set({ ...state, on }),
  markWatched: (id: string) => !state.watched.includes(id) && set({ ...state, watched: [...state.watched, id].slice(-100) }),
  reveal: (id: string) => {
    revealed.add(id);
    try {
      sessionStorage.setItem('pitwall.revealed', JSON.stringify([...revealed]));
    } catch {
      // ignore
    }
    listeners.forEach((f) => f());
  },
};

export function useSpoilers() {
  ensureLoaded();
  const s = useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => state,
  );
  // A version number so components re-render when something is revealed.
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  return {
    on: s.on,
    /** Should this race's result be hidden? */
    hidden: (id: string, raceStart: string | number) => {
      if (!s.on || s.watched.includes(id) || revealed.has(id)) return false;
      const start = typeof raceStart === 'number' ? raceStart : Date.parse(raceStart);
      const age = Date.now() - start;
      // Only recent races: anything older than three weeks you've seen or don't mind.
      return age > 0 && age < 21 * 86_400e3;
    },
  };
}
