// Team radio transcripts (made with speech recognition when sessions are published; see
// server/transcribe.ts). Loaded once per session; null when there aren't any.
import { useEffect, useState } from 'react';
import type { SessionData } from './session';
import { HOSTED } from '../env';

const cache = new Map<number, Promise<Record<string, string> | null>>();

export function loadTranscripts(key: number) {
  if (!cache.has(key))
    cache.set(
      key,
      fetch(HOSTED ? `/data/s/${key}.radio.json` : `/api/sessions/${key}/radio`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => (j?.texts as Record<string, string>) ?? null)
        .catch(() => null), // the hosted site answers a missing file with its page, which isn't JSON
    );
  return cache.get(key)!;
}

/** Clip address → what was said (undefined while loading, null if there are none). */
export function useTranscripts(data: SessionData) {
  const key = data.meta.session.key;
  const [texts, setTexts] = useState<Record<string, string> | null | undefined>(undefined);
  useEffect(() => {
    if (data.live) return setTexts(null);
    let on = true;
    loadTranscripts(key).then((t) => on && setTexts(t));
    return () => {
      on = false;
    };
  }, [key, data.live]);
  return texts;
}
