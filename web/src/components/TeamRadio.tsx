// Team radio: every clip with what was said (speech recognition, so expect the odd misheard
// word), searchable, with play and jump-to buttons.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { SessionData } from '../data/session';
import { useTranscripts } from '../data/radio';
import { formatClock, leaderLap } from '../data/state';
import { clock } from '../sync/clock';
import { useNow } from '../hooks';
import { Panel } from './Panel';

export function TeamRadio({ data, area, lead }: { data: SessionData; area?: string; lead?: ReactNode }) {
  const t = useNow(2);
  const texts = useTranscripts(data);
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
      {texts === null && data.meta.radio.length > 0 && (
        <div className="dim" style={{ padding: '6px 10px', fontSize: 11 }}>
          No transcripts for this session yet ({data.live ? 'not during live sessions' : 'they appear once it has been published to the site'}). You can still play the clips.
        </div>
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
