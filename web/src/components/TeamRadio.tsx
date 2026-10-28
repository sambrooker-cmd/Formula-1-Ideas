// Team radio: every clip with what was said (speech recognition, so expect the odd misheard
// word), searchable, with play and jump-to buttons.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { forgetTranscripts, useTranscripts } from '../data/radio';
import { HOSTED } from '../env';
import { formatClock, leaderLap } from '../data/state';
import { clock } from '../sync/clock';
import { useNow } from '../hooks';
import { Panel } from './Panel';

export function TeamRadio({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(2);
  const [version, setVersion] = useState(0);
  const texts = useTranscripts(data, version);
  const job = useRadioJob(data.meta.session.key, () => {
    forgetTranscripts(data.meta.session.key);
    setVersion((v) => v + 1);
  });
  const [query, setQuery] = useState('');
  const [ahead, setAhead] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const play = (url: string) => {
    audio.current?.pause();
    audio.current = new Audio(url);
    audio.current.play().catch(() => undefined);
  };
  const code = (n: number) => data.drivers.get(n)?.code ?? String(n);
  const q = query.trim().toLowerCase();
  const clips = useMemo(
    () =>
      data.meta.radio
        .filter(([n, rt, url]) => (ahead || rt <= t) && (!q || (texts?.[url] ?? '').toLowerCase().includes(q) || code(n).toLowerCase() === q))
        .reverse(),
    [data.meta.radio, data.version, ahead, q, texts, Math.floor(t / 1000)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Panel title="Team radio" lead={lead} area={area} popout="/radio" bodyClass="scroll">
      <div className="moment-filters">
        <input className="search" placeholder="Search what was said, or a driver (e.g. VER)" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="muted" style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
          <input type="checkbox" checked={ahead} onChange={(e) => setAhead(e.target.checked)} /> show what's ahead
        </label>
      </div>
      {job.active ? (
        <div className="dim" style={{ padding: '6px 10px', fontSize: 12 }}>
          {job.active.stage === 'installing'
            ? 'Setting up speech recognition on this Mac (a one-off download of about 1 GB; a few minutes)…'
            : job.active.stage === 'transcribing'
              ? `Transcribing: ${job.active.done} of ${job.active.total} clips…`
              : job.active.stage === 'failed'
                ? `Transcribing failed: ${job.active.error}`
                : ''}
        </div>
      ) : (
        texts === null &&
        data.meta.radio.length > 0 && (
          <div className="dim" style={{ padding: '6px 10px', fontSize: 12 }}>
            {data.live ? (
              'Transcripts are made after the session. You can still play the clips.'
            ) : HOSTED ? (
              'No transcripts for this session. They can be made in the Mac app (F1’s server doesn’t let the site download the audio). You can still play the clips.'
            ) : (
              <>
                No transcripts yet.{' '}
                <button className="btn small" onClick={job.start}>
                  Transcribe this session on this Mac
                </button>{' '}
                (about {Math.max(1, Math.round((data.meta.radio.length * 4) / 60))} min; the first time also downloads speech recognition, about 1 GB)
              </>
            )}
          </div>
        )
      )}
      <ul className="moments">
        {clips.map(([n, rt, url]) => (
          <li key={url + rt} className={'moment no-icon radio-row' + (rt > t ? ' ahead' : '')}>
            <span className="moment-text">
              <b style={{ color: data.drivers.get(n)?.colour }}>{code(n)}</b>{' '}
              <button className="radio-btn" onClick={() => play(url)}>▶</button>{' '}
              {texts?.[url] ? <span>“{texts[url]}”</span> : <span className="dim">{texts === undefined ? '…' : texts ? '(nothing clear)' : ''}</span>}
            </span>
            <span className="rc-meta" style={{ cursor: 'pointer' }} onClick={() => clock.seek(rt - 5000)} title="Jump to this moment">
              L{leaderLap(data, rt) || '–'} {formatClock(rt - data.meta.raceStart)}
            </span>
          </li>
        ))}
        {clips.length === 0 && <li className="dim" style={{ padding: 12 }}>{q ? 'Nothing matches.' : 'No radio yet.'}</li>}
      </ul>
      {texts && <p className="dim" style={{ fontSize: 11, padding: '6px 10px 10px' }}>Transcribed by speech recognition, so names and jargon are sometimes misheard.</p>}
    </Panel>
  );
}

interface RadioJob {
  key: number;
  stage: 'installing' | 'transcribing' | 'done' | 'failed';
  done: number;
  total: number;
  error?: string;
}

/** The Mac's transcription job for this session, polled while it runs. */
function useRadioJob(key: number, onProgress: () => void) {
  const [active, setActive] = useState<RadioJob | null>(null);
  const [polling, setPolling] = useState(!HOSTED);
  useEffect(() => {
    if (!polling || HOSTED) return;
    let last = -1;
    const tick = async () => {
      const r = await fetch('/api/radio/job').then((x) => x.json()).catch(() => null);
      const j: RadioJob | null = r?.job?.key === key ? r.job : null;
      setActive(j && j.stage !== 'done' ? j : null);
      if (j && j.done !== last) {
        last = j.done;
        onProgress();
      }
      if (!j || j.stage === 'done' || j.stage === 'failed') setPolling(false);
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, [polling, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    const r = await fetch(`/api/sessions/${key}/radio/transcribe`, { method: 'POST' }).then((x) => x.json()).catch(() => null);
    if (r?.job) setActive(r.job);
    setPolling(true);
  };
  return { active, start };
}
